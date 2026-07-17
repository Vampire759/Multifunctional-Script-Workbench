"""Screen 会话管理服务：创建/列表/日志/终止/发送命令"""
import os
import re
import asyncio
import platform
import logging
from datetime import datetime
from typing import List, Dict, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from backend.database import SessionLocal
from backend.models import ScreenTask
from backend.services.websocket_hub import hub

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

SCREEN_SOCK_DIR = "/app/screen_sockets"
os.makedirs(SCREEN_SOCK_DIR, exist_ok=True)
os.chmod(SCREEN_SOCK_DIR, 0o700)
os.environ['SCREENDIR'] = SCREEN_SOCK_DIR

IS_WINDOWS = platform.system() == "Windows"

_running_processes: Dict[str, asyncio.subprocess.Process] = {}
_active_broadcasters: Dict[str, asyncio.Task] = {}


def get_screen_log_path(session_name: str) -> str:
    session_log_dir = os.path.join(LOG_DIR, session_name)
    os.makedirs(session_log_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return os.path.join(session_log_dir, f"{timestamp}.log")


async def _run_command(args: List[str], env: dict = None) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, _ = await proc.communicate()
    return stdout.decode("utf-8", errors="replace").strip()


async def list_screens() -> List[Dict]:
    if IS_WINDOWS:
        screens = []
        for name, proc in _running_processes.items():
            if proc.returncode is None:
                screens.append({
                    "pid": str(proc.pid),
                    "name": name,
                    "status": "running",
                })
        return screens
    
    screens = []
    
    try:
        env = os.environ.copy()
        env['SCREENDIR'] = SCREEN_SOCK_DIR
        output = await _run_command(["screen", "-list"], env=env)
        lines = output.strip().split("\n")
        for line in lines:
            if "No Sockets" in line or "Sockets in" in line or "Remove dead" in line:
                continue
            line_clean = line.replace("\t", " ").strip()
            m = re.match(r"(\d+)\.(\S+)\s+\([^)]+\)\s+\(([^)]+)\)", line_clean)
            if m:
                status = m.group(3)
                if "Dead" in status:
                    continue
                screens.append({
                    "pid": m.group(1),
                    "name": m.group(2),
                    "status": status,
                })
    except Exception as e:
        logger.error(f"Error listing screens with screen -list: {e}")
    
    if not screens and os.path.exists(SCREEN_SOCK_DIR):
        try:
            for sock_file in os.listdir(SCREEN_SOCK_DIR):
                if sock_file.endswith(".socket") or sock_file.startswith("screen."):
                    continue
                try:
                    parts = sock_file.split(".")
                    if len(parts) >= 2:
                        pid = parts[0]
                        name = ".".join(parts[1:])
                        try:
                            os.kill(int(pid), 0)
                            screens.append({
                                "pid": pid,
                                "name": name,
                                "status": "running",
                            })
                        except (OSError, ValueError):
                            sock_path = os.path.join(SCREEN_SOCK_DIR, sock_file)
                            try:
                                os.remove(sock_path)
                                logger.info(f"Removed dead screen socket: {sock_file}")
                            except OSError:
                                pass
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Error listing screens from socket dir {SCREEN_SOCK_DIR}: {e}")
    
    return screens


async def create_screen(session_name: str, command: str, db: Session) -> bool:
    screens = await list_screens()
    existing_screen = any(s["name"] == session_name for s in screens)
    if existing_screen:
        logger.info(f"Session {session_name} already exists, reusing existing session")
        task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
        if task:
            task.status = "running"
            task.started_at = datetime.utcnow()
            db.commit()
        log_path = get_session_log_path(session_name)
        if session_name not in _active_broadcasters or _active_broadcasters[session_name].done():
            _active_broadcasters[session_name] = asyncio.create_task(_broadcast_log(session_name, log_path))
        return True
    
    log_path = get_screen_log_path(session_name)
    
    task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
    if not task:
        task = ScreenTask(
            name=session_name,
            command=command,
            status="running",
            log_path=log_path,
            created_at=datetime.utcnow(),
        )
        db.add(task)
    else:
        task.command = command
        task.status = "running"
        task.started_at = datetime.utcnow()
        task.log_path = log_path
    db.commit()
    db.refresh(task)

    try:
        if IS_WINDOWS:
            log_file = open(log_path, "a", encoding="utf-8")
            proc = await asyncio.create_subprocess_exec(
                "powershell", "-Command", command or "echo 'Empty session'",
                stdout=log_file,
                stderr=log_file,
            )
            _running_processes[session_name] = proc
            
            asyncio.create_task(_monitor_windows_process(session_name, proc, db))
        else:
            max_retries = 2
            session_created = False
            last_error = ""
            
            for attempt in range(max_retries + 1):
                try:
                    env = os.environ.copy()
                    env['TERM'] = 'xterm-256color'
                    env['LANG'] = 'C.UTF-8'
                    env['LC_ALL'] = 'C.UTF-8'
                    env['SCREENDIR'] = SCREEN_SOCK_DIR

                    screen_cmd = [
                        "screen", "-dmS", session_name,
                        "/bin/bash", "-i"
                    ]
                    
                    logger.info(f"Creating screen session: {' '.join(screen_cmd)}")
                    logger.info(f"SCREENDIR: {SCREEN_SOCK_DIR}")
                    logger.info(f"Log path: {log_path}")
                    
                    proc = await asyncio.create_subprocess_exec(
                        *screen_cmd,
                        env=env,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, stderr = await proc.communicate()
                    
                    stdout_str = stdout.decode("utf-8", errors="replace")
                    stderr_str = stderr.decode("utf-8", errors="replace")
                    
                    logger.info(f"Screen create attempt {attempt + 1}, exit code: {proc.returncode}")
                    if stderr_str:
                        logger.info(f"Screen stderr: {stderr_str}")
                    if stdout_str:
                        logger.info(f"Screen stdout: {stdout_str}")
                    
                    await asyncio.sleep(2)
                    
                    screens = await list_screens()
                    session_found = any(s["name"] == session_name for s in screens)
                    
                    if session_found:
                        session_created = True
                        logger.info(f"Screen session created successfully: {session_name}")
                        break
                    else:
                        last_error = f"Exit code: {proc.returncode}, stderr: {stderr_str}, stdout: {stdout_str}"
                        logger.warning(f"Session not found after attempt {attempt + 1}: {last_error}")
                        if attempt < max_retries:
                            await asyncio.sleep(1)
                except Exception as e:
                    last_error = str(e)
                    logger.warning(f"Create attempt {attempt + 1} failed: {e}")
                    if attempt < max_retries:
                        await asyncio.sleep(1)
            
            if not session_created:
                task.status = "failed"
                task.error = f"Failed to create screen session after {max_retries + 1} attempts. Last error: {last_error}"
                db.commit()
                return False
            
            await _run_command([
                "screen", "-S", session_name, "-X", "logfile", log_path
            ], env=env)
            await _run_command([
                "screen", "-S", session_name, "-X", "log", "on"
            ], env=env)
            logger.info(f"Enabled logging for {session_name} to {log_path}")
            
            time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            init_msg = f"echo '[SESSION INIT] {session_name}' && echo '[TIME] {time_str}' && echo '[STATUS] 会话已创建，等待命令执行...'\n"
            await _run_command([
                "screen", "-S", session_name, "-X", "stuff",
                init_msg
            ], env=env)
            
            await asyncio.sleep(0.5)
            
            if command.strip():
                escaped_cmd = command.replace("'", "'\\''")
                logger.info(f"Sending to screen: {command}")
                await _run_command([
                    "screen", "-S", session_name, "-X", "stuff",
                    f"{escaped_cmd}\n"
                ], env=env)
        
        await asyncio.sleep(1)
        
        if session_name not in _active_broadcasters or _active_broadcasters[session_name].done():
            _active_broadcasters[session_name] = asyncio.create_task(_broadcast_log(session_name, log_path))
        return True
    except Exception as e:
        task.status = "failed"
        task.error = str(e)
        logger.error(f"Error creating screen session {session_name}: {e}", exc_info=True)
        db.commit()
        return False


async def _monitor_windows_process(session_name: str, proc: asyncio.subprocess.Process, db: Session):
    await proc.wait()
    if session_name in _running_processes:
        del _running_processes[session_name]
    
    task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
    if task:
        task.status = "stopped"
        task.finished_at = datetime.utcnow()
        db.commit()


async def send_command(session_name: str, command: str) -> bool:
    if IS_WINDOWS:
        print(f"[Screen] Windows 不支持向运行中进程发送命令: {command}")
        return False
    
    try:
        env = os.environ.copy()
        env['SCREENDIR'] = SCREEN_SOCK_DIR
        escaped_cmd = command.replace("'", "'\\''")
        await _run_command(["screen", "-S", session_name, "-X", "stuff", f"{escaped_cmd}\n"], env=env)
        await hub.broadcast(f"screen_{session_name}", {
            "type": "log",
            "payload": {"log_line": f"> {command}", "level": "input"},
        })
        return True
    except Exception as e:
        print(f"[Screen] 发送命令失败: {e}")
        return False


def get_session_log_path(session_name: str) -> str:
    session_log_dir = os.path.join(LOG_DIR, session_name)
    os.makedirs(session_log_dir, exist_ok=True)
    if os.path.exists(session_log_dir):
        files = sorted([f for f in os.listdir(session_log_dir) if f.endswith(".log")], reverse=True)
        if files:
            return os.path.join(session_log_dir, files[0])
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return os.path.join(session_log_dir, f"{timestamp}.log")


async def _broadcast_log(session_name: str, log_path: str):
    last_pos = 0
    
    logger.info(f"Starting broadcast for session: {session_name}, log_path: {log_path}")

    while True:
        try:
            screens = await list_screens()
            screen_exists = any(s["name"] == session_name for s in screens)
            
            if not screen_exists:
                logger.info(f"Session {session_name} no longer exists, stopping broadcast")
                try:
                    if os.path.exists(log_path):
                        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                            f.seek(last_pos)
                            content = f.read()
                            if content:
                                for line in content.split("\n"):
                                    if line.strip():
                                        stripped = _clean_log_content(line.strip())
                                        await hub.broadcast(f"screen_{session_name}", {
                                            "type": "log",
                                            "payload": {"log_line": stripped},
                                        })
                except Exception:
                    pass
                try:
                    db = SessionLocal()
                    task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
                    if task:
                        task.status = "stopped"
                        task.finished_at = datetime.utcnow()
                        db.commit()
                    db.close()
                except Exception:
                    pass
                await hub.broadcast(f"screen_{session_name}", {
                    "type": "done",
                    "payload": {"status": "exited"},
                })
                break
            
            if not os.path.exists(log_path):
                await asyncio.sleep(1)
                continue
            
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(last_pos)
                    content = f.read()
                    if content:
                        lines = content.split("\n")
                        for line in lines:
                            if line.strip():
                                cleaned = _clean_log_content(line.strip())
                                await hub.broadcast(f"screen_{session_name}", {
                                    "type": "log",
                                    "payload": {"log_line": cleaned},
                                })
                        last_pos = f.tell()
            except OSError as e:
                logger.error(f"Error reading log file {log_path}: {e}")
        except Exception as e:
            logger.error(f"Broadcast error for {session_name}: {e}")
        
        await asyncio.sleep(1)


async def stop_screen(session_name: str, db: Session = None) -> bool:
    if IS_WINDOWS:
        if session_name in _running_processes:
            proc = _running_processes[session_name]
            try:
                proc.terminate()
                await proc.wait()
                del _running_processes[session_name]
            except:
                pass
    else:
        env = os.environ.copy()
        env['SCREENDIR'] = SCREEN_SOCK_DIR
        await _run_command(["screen", "-S", session_name, "-X", "quit"], env=env)
    
    await asyncio.sleep(1)
    
    if db:
        task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
        if task:
            task.status = "stopped"
            task.finished_at = datetime.utcnow()
            db.commit()
    
    screens = await list_screens()
    return not any(s["name"] == session_name for s in screens)


def _clean_log_content(text: str) -> str:
    """清理日志内容：移除 ANSI 转义码、控制字符，保留可读文本"""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[.*?[a-zA-Z])')
    text = ansi_escape.sub('', text)
    text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', text)
    text = re.sub(r'\r+', '', text)
    return text

async def get_screen_log(session_name: str, tail_lines: int = 100) -> str:
    log_path = get_session_log_path(session_name)
    
    try:
        if not os.path.exists(log_path):
            return ""
        
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            content = "".join(lines[-tail_lines:])
            return _clean_log_content(content)
    except:
        return ""


def get_screen_tasks(db: Session) -> List[ScreenTask]:
    return db.query(ScreenTask).order_by(ScreenTask.created_at.desc()).all()


def get_screen_task(db: Session, name: str) -> Optional[ScreenTask]:
    return db.query(ScreenTask).filter(ScreenTask.name == name).first()
