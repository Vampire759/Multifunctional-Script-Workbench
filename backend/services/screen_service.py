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
        if os.path.exists(SCREEN_SOCK_DIR):
            for sock_file in os.listdir(SCREEN_SOCK_DIR):
                if sock_file.endswith(".socket") or sock_file.startswith("screen."):
                    continue
                try:
                    parts = sock_file.split(".")
                    if len(parts) >= 2:
                        pid = parts[0]
                        name = ".".join(parts[1:])
                        screens.append({
                            "pid": pid,
                            "name": name,
                            "status": "running",
                        })
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"Error listing screens from socket dir {SCREEN_SOCK_DIR}: {e}")
    
    if not screens:
        try:
            output = await _run_command(["screen", "-list"])
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
    
    return screens


async def create_screen(session_name: str, command: str, db: Session) -> bool:
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
            try:
                env = os.environ.copy()
                env['TERM'] = 'xterm-256color'
                
                screen_cmd = ["screen", "-dmS", session_name, "/bin/bash", "-i"]
                
                proc = await asyncio.create_subprocess_exec(
                    *screen_cmd,
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()
                
                stdout_str = stdout.decode("utf-8", errors="replace")
                stderr_str = stderr.decode("utf-8", errors="replace")
                
                logger.info(f"Screen process exited with code: {proc.returncode}")
                logger.info(f"Screen stdout: {stdout_str}")
                logger.info(f"Screen stderr: {stderr_str}")
                
                await asyncio.sleep(1)
                
                screens = await list_screens()
                session_found = any(s["name"] == session_name for s in screens)
                
                if not session_found:
                    task.status = "failed"
                    task.error = f"Screen session not found after creation. Exit code: {proc.returncode}, stderr: {stderr_str}"
                    db.commit()
                    return False
                
                logger.info(f"Screen session created successfully: {session_name}")
            except Exception as e:
                import traceback
                error_details = traceback.format_exc()
                logger.error(f"Error creating screen session: {error_details}")
                task.status = "failed"
                task.error = f"Exception: {str(e)}"
                db.commit()
                return False
            
            if command.strip():
                cmd_lower = command.strip().lower()
                logger.info(f"Original command: {command}")
                logger.info(f"Command lower: {cmd_lower}")
                
                if cmd_lower.startswith("python ") or cmd_lower.startswith("python3 "):
                    parts = command.split(" ", 1)
                    logger.info(f"Command parts: {parts}")
                    if len(parts) >= 2:
                        script_part = parts[1]
                        logger.info(f"Script part: {script_part}")
                        if script_part.startswith("/app/scripts/") or script_part.startswith("scripts/"):
                            if script_part.startswith("scripts/"):
                                script_path = f"/app/{script_part}"
                            else:
                                script_path = script_part
                            
                            script_args = []
                            if " " in script_part:
                                script_path_part, args_part = script_part.split(" ", 1)
                                if script_path_part.startswith("scripts/"):
                                    script_path = f"/app/{script_path_part}"
                                else:
                                    script_path = script_path_part
                                script_args = args_part.split(" ")
                            
                            wrapped_cmd = f"python /app/scripts/auto_run.py {script_path} {' '.join(script_args)}"
                            escaped_cmd = wrapped_cmd.replace("'", "'\\''")
                            logger.info(f"Wrapped command: {wrapped_cmd}")
                        else:
                            escaped_cmd = command.replace("'", "'\\''")
                    else:
                        escaped_cmd = command.replace("'", "'\\''")
                else:
                    escaped_cmd = command.replace("'", "'\\''")
                
                logger.info(f"Sending to screen: {escaped_cmd}")
                await _run_command([
                    "screen", "-S", session_name, "-X", "stuff",
                    f"{escaped_cmd}\n"
                ])
        
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
        escaped_cmd = command.replace("'", "'\\''")
        await _run_command(["screen", "-S", session_name, "-X", "stuff", f"{escaped_cmd}\n"])
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
                await hub.broadcast(f"screen_{session_name}", {
                    "type": "done",
                    "payload": {"status": "exited"},
                })
                break
            
            if not os.path.exists(log_path):
                try:
                    await _run_command(["screen", "-S", session_name, "-X", "logfile", log_path])
                    await _run_command(["screen", "-S", session_name, "-X", "log", "on"])
                    logger.info(f"Enabled logging for {session_name} to {log_path}")
                except Exception as e:
                    logger.error(f"Failed to enable logging for {session_name}: {e}")
                await asyncio.sleep(1)
                continue
            
            try:
                with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(last_pos)
                    content = f.read()
                    if content:
                        lines = content.split("\n")
                        logger.debug(f"Found {len(lines)} new lines for {session_name}")
                        for line in lines:
                            if line.strip():
                                stripped = _strip_ansi_codes(line.strip())
                                await hub.broadcast(f"screen_{session_name}", {
                                    "type": "log",
                                    "payload": {"log_line": stripped},
                                })
                        last_pos = f.tell()
            except OSError as e:
                logger.error(f"Error reading log file {log_path}: {e}")
        except Exception as e:
            logger.error(f"Broadcast error for {session_name}: {e}")
        
        await asyncio.sleep(1)


async def stop_screen(session_name: str, db: Session) -> bool:
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
        await _run_command(["screen", "-S", session_name, "-X", "quit"])
    
    await asyncio.sleep(1)
    
    task = db.query(ScreenTask).filter(ScreenTask.name == session_name).first()
    if task:
        task.status = "stopped"
        task.finished_at = datetime.utcnow()
        db.commit()
    
    screens = await list_screens()
    return not any(s["name"] == session_name for s in screens)


def _strip_ansi_codes(text: str) -> str:
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[.*?[a-zA-Z])')
    return ansi_escape.sub('', text)

async def get_screen_log(session_name: str, tail_lines: int = 100) -> str:
    log_path = get_screen_log_path(session_name)
    
    try:
        screens = await list_screens()
        screen_exists = any(s["name"] == session_name for s in screens)
        
        if screen_exists:
            await _run_command(["screen", "-S", session_name, "-X", "hardcopy", "-h", log_path])
        
        if not os.path.exists(log_path):
            return ""
        
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            content = "".join(lines[-tail_lines:])
            return _strip_ansi_codes(content)
    except:
        return ""


def get_screen_tasks(db: Session) -> List[ScreenTask]:
    return db.query(ScreenTask).order_by(ScreenTask.created_at.desc()).all()


def get_screen_task(db: Session, name: str) -> Optional[ScreenTask]:
    return db.query(ScreenTask).filter(ScreenTask.name == name).first()
