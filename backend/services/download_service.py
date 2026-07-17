"""下载服务：调用 yt-dlp（支持 docker exec 或本地），解析进度，自动重试，支持通过screen执行脚本命令"""
import os
import re
import asyncio
import shutil
from datetime import datetime
from typing import Optional, Dict

from sqlalchemy.orm import Session

from backend.models import DownloadTask
from backend.services.websocket_hub import hub
from backend.services import screen_service

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOWNLOAD_DIR = os.path.join(PROJECT_ROOT, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"

# yt-dlp 进度解析正则
PROGRESS_PATTERN = re.compile(
    r"\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+[\sKMGTPE]?B)\s+at\s+([\d.]+[\sKMGTPE]?B/s)\s+ETA\s+([\d:]+)"
)
SIZE_UNITS = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3}


def _parse_size(size_str: str) -> int:
    size_str = size_str.strip().replace(" ", "")
    m = re.match(r"([\d.]+)([A-Za-z]+)?", size_str)
    if not m:
        return 0
    num = float(m.group(1))
    unit = (m.group(2) or "B").upper()
    return int(num * SIZE_UNITS.get(unit, 1))


def _parse_yt_dlp_line(line: str) -> Optional[Dict]:
    """解析 yt-dlp 输出行，提取进度信息"""
    # 进度行
    match = PROGRESS_PATTERN.search(line)
    if match:
        return {
            "progress": float(match.group(1)),
            "total_bytes": _parse_size(match.group(2)),
            "speed": match.group(3),
            "eta": match.group(4),
        }
    # 标题提取
    title_match = re.search(r"\[download\]\s+Destination:\s+(.*)", line)
    if title_match:
        return {"filename": title_match.group(1).strip()}
    # 完成提示
    if "[download]" in line and ("100%" in line or "complete" in line.lower()):
        return {"completed": True}
    # 错误
    if "[error]" in line.lower():
        return {"error": line.strip()}
    return None


def _build_command(task: DownloadTask, use_docker: bool = False) -> list:
    """构建 yt-dlp 命令（支持 docker exec）"""
    filename = task.filename or "%(title)s.%(ext)s"
    output_path = os.path.join(DOWNLOAD_DIR, filename)

    if use_docker:
        # 使用 docker exec yt-dlp-webui
        cmd = [
            "docker", "exec", "yt-dlp-webui",
            "yt-dlp",
            "--user-agent", UA,
            "--add-header", f"Referer:{task.source_url or ''}",
            "-o", f"/downloads/{filename}",
            task.video_url,
        ]
    else:
        # 本地 yt-dlp（Windows）
        yt_dlp_path = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
        if not yt_dlp_path:
            yt_dlp_path = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "yt-dlp.exe")

        cmd = [
            yt_dlp_path,
            "--user-agent", UA,
            "--add-header", f"Referer:{task.source_url or ''}",
            "-o", output_path,
            task.video_url,
        ]
    return cmd


async def _update_task(db: Session, task_id: int, updates: Dict):
    """更新任务状态（事务安全）"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if task:
        for k, v in updates.items():
            setattr(task, k, v)
        db.commit()


async def _broadcast(task_id: int, message: dict):
    """通过 WebSocket 广播进度"""
    await hub.broadcast(f"dl_{task_id}", message)


async def _run_download(db: Session, task_id: int, use_docker: bool = False) -> bool:
    """执行单次下载，返回是否成功"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task:
        return False

    await _update_task(db, task_id, {"status": "running", "started_at": datetime.utcnow()})
    await _broadcast(task_id, {"type": "start", "payload": {}})

    cmd = _build_command(task, use_docker)
    await _broadcast(task_id, {"type": "log", "payload": {"log_line": f"$ {' '.join(cmd)}"}})

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=PROJECT_ROOT,
        )
    except Exception as e:
        err = f"启动失败: {e}"
        await _update_task(db, task_id, {"status": "failed", "error": err, "finished_at": datetime.utcnow()})
        await _broadcast(task_id, {"type": "error", "payload": {"error": err}})
        return False

    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        line_text = line.decode("utf-8", errors="replace").strip()
        if line_text:
            await _broadcast(task_id, {"type": "log", "payload": {"log_line": line_text}})

            parsed = _parse_yt_dlp_line(line_text)
            if parsed:
                updates = {}
                if "progress" in parsed:
                    updates["progress"] = int(parsed["progress"])
                if "total_bytes" in parsed:
                    updates["total_bytes"] = parsed["total_bytes"]
                if "speed" in parsed:
                    updates["speed"] = parsed["speed"]
                if "eta" in parsed:
                    updates["eta"] = parsed["eta"]
                if "filename" in parsed:
                    updates["filename"] = parsed["filename"]
                if "completed" in parsed:
                    updates["progress"] = 100
                if updates:
                    await _update_task(db, task_id, updates)
                    await _broadcast(task_id, {"type": "progress", "payload": updates})

    await proc.wait()
    exit_code = proc.returncode

    if exit_code == 0:
        await _update_task(db, task_id, {
            "status": "success",
            "progress": 100,
            "finished_at": datetime.utcnow(),
            "output_path": os.path.join(DOWNLOAD_DIR, task.filename or ""),
        })
        await _broadcast(task_id, {"type": "done", "payload": {"status": "success"}})
        return True
    else:
        err = f"进程退出码 {exit_code}"
        await _update_task(db, task_id, {"status": "failed", "error": err, "finished_at": datetime.utcnow()})
        await _broadcast(task_id, {"type": "done", "payload": {"status": "failed", "error": err}})
        return False


async def execute_download(db: Session, task_id: int):
    """执行下载（含自动重试），支持通过screen执行脚本命令"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task:
        return

    if task.command:
        await _execute_script_via_screen(db, task_id)
        return

    success = False
    while task.retry_count < task.max_retries:
        success = await _run_download(db, task_id)
        if success:
            break

        # 失败重试
        task.retry_count += 1
        db.commit()
        await _broadcast(task_id, {
            "type": "log",
            "payload": {"log_line": f"失败，重试 {task.retry_count}/{task.max_retries}...", "level": "warning"},
        })
        await _update_task(db, task_id, {"status": "retrying", "retry_count": task.retry_count})
        await asyncio.sleep(5)

    if not success:
        await _broadcast(task_id, {"type": "log", "payload": {"log_line": "已达到最大重试次数", "level": "error"}})


async def _execute_script_via_screen(db: Session, task_id: int):
    """通过screen执行脚本命令"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task or not task.command:
        return

    await _update_task(db, task_id, {"status": "running", "started_at": datetime.utcnow()})
    await _broadcast(task_id, {"type": "start", "payload": {}})

    session_name = f"dl_task_{task_id}"
    
    await _broadcast(task_id, {"type": "log", "payload": {"log_line": f"[Screen] 启动会话: {session_name}"}})
    await _broadcast(task_id, {"type": "log", "payload": {"log_line": f"$ {task.command}"}})

    success = await screen_service.create_screen(session_name, task.command, db)
    
    if success:
        await _broadcast(task_id, {"type": "log", "payload": {"log_line": "[Screen] 脚本已启动，可以在任务台查看实时日志", "level": "success"}})
        await _update_task(db, task_id, {"status": "running"})
    else:
        await _update_task(db, task_id, {"status": "failed", "error": "脚本启动失败", "finished_at": datetime.utcnow()})
        await _broadcast(task_id, {"type": "error", "payload": {"error": "脚本启动失败"}})


def create_download_task(db: Session, video_url: str = "", source_url: str = "", title: str = "", filename: str = "", script_id: int | None = None, command: str = "") -> int:
    """创建下载任务"""
    task = DownloadTask(
        video_url=video_url,
        source_url=source_url,
        script_id=script_id,
        command=command,
        title=title,
        filename=filename,
        status="pending",
        max_retries=3,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task.id
