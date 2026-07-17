"""爬虫/指令执行器：通过 subprocess 调用爬虫脚本或 shell 指令，解析输出并广播进度"""
import os
import sys
import json
import uuid
import asyncio
import subprocess
from datetime import datetime
from typing import Optional, List, Dict

from sqlalchemy.orm import Session

from backend.models import Task, ScrapeJob, VideoResult
from backend.services.websocket_hub import hub
from backend.services.push_service import push_webhook

# 现有爬虫脚本路径（项目根目录下）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRAPER_SCRIPT = os.path.join(PROJECT_ROOT, "网站爬取app.py")


def _make_job_id() -> str:
    return datetime.utcnow().strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:8]


def _emit_sync(job_id: str, message: dict):
    """同步包装：将广播事件提交到事件循环"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(hub.broadcast(job_id, message), loop)
        else:
            loop.run_until_complete(hub.broadcast(job_id, message))
    except RuntimeError:
        # 无事件循环（如纯线程上下文），创建新循环
        asyncio.run(hub.broadcast(job_id, message))


async def _emit(job_id: str, message: dict):
    await hub.broadcast(job_id, message)


async def execute_scrape(
    db: Session,
    job_id: str,
    urls: List[str],
    max_workers: int = 5,
    task_id: Optional[int] = None,
    webhook_url: Optional[str] = None,
    webhook_headers: Optional[Dict[str, str]] = None,
) -> str:
    """执行爬虫任务：subprocess 调用 网站爬取app.py --cli"""
    # 更新 job 状态为 running
    job = db.query(ScrapeJob).filter(ScrapeJob.job_id == job_id).first()
    if job:
        job.status = "running"
        job.total = len(urls)
        db.commit()

    await _emit(job_id, {"type": "log", "payload": {"log_line": f"启动爬虫，共 {len(urls)} 个 URL"}})

    cmd = [
        sys.executable,
        SCRAPER_SCRIPT,
        "--cli",
        "--urls", *urls,
        "--max-workers", str(max_workers),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=PROJECT_ROOT,
        )
    except Exception as e:
        if job:
            job.status = "failed"
            job.error = f"启动失败: {e}"
            job.finished_at = datetime.utcnow()
            db.commit()
        await _emit(job_id, {"type": "error", "payload": {"error": str(e)}})
        await _emit(job_id, {"type": "done", "payload": {"status": "failed"}})
        return job_id

    seq_counter = 0
    total_videos = 0

    # 逐行读取 stdout（每行一个 JSON 事件）
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        line_text = line.decode("utf-8", errors="replace").strip()
        if not line_text:
            continue
        try:
            evt = json.loads(line_text)
        except json.JSONDecodeError:
            await _emit(job_id, {"type": "log", "payload": {"log_line": line_text}})
            continue

        evt_type = evt.get("type")
        if evt_type == "start":
            total = evt.get("total", len(urls))
            if job:
                job.total = total
                db.commit()
            await _emit(job_id, {"type": "progress", "payload": {"total": total, "completed": 0}})
        elif evt_type == "progress":
            completed = evt.get("completed", 0)
            total = evt.get("total", len(urls))
            current_url = evt.get("current_url", "")
            if job:
                job.completed = completed
                db.commit()
            await _emit(job_id, {
                "type": "progress",
                "payload": {"completed": completed, "total": total, "current_url": current_url},
            })
        elif evt_type == "result":
            source_url = evt.get("source_url", "")
            videos = evt.get("videos", [])
            # 入库
            for v in videos:
                seq_counter += 1
                result = VideoResult(
                    job_id=job_id,
                    seq=seq_counter,
                    title=v.get("title"),
                    url=v.get("url", ""),
                    source_url=source_url,
                )
                db.add(result)
                total_videos += 1
                await _emit(job_id, {
                    "type": "result",
                    "payload": {
                        "result": {
                            "seq": seq_counter,
                            "title": v.get("title"),
                            "url": v.get("url", ""),
                            "source_url": source_url,
                            "collected_at": datetime.utcnow().isoformat(),
                        }
                    },
                })
            db.commit()
        elif evt_type == "error":
            err = evt.get("error", "")
            await _emit(job_id, {"type": "log", "payload": {"log_line": f"[错误] {err}", "level": "error"}})
        elif evt_type == "done":
            await _emit(job_id, {
                "type": "log",
                "payload": {"log_line": f"完成，共提取 {evt.get('total_videos', 0)} 个视频"},
            })

    await proc.wait()
    exit_code = proc.returncode

    if job:
        job.status = "success" if exit_code == 0 else "failed"
        job.finished_at = datetime.utcnow()
        if exit_code != 0:
            job.error = f"进程退出码 {exit_code}"
        db.commit()

    await _emit(job_id, {
        "type": "done",
        "payload": {
            "status": job.status if job else "success",
            "total_videos": total_videos,
        },
    })

    # Webhook 推送
    if webhook_url:
        payload = {
            "job_id": job_id,
            "type": "scrape",
            "status": job.status if job else "success",
            "total_videos": total_videos,
            "total": job.total if job else len(urls),
            "finished_at": datetime.utcnow().isoformat(),
        }
        await push_webhook(webhook_url, payload, webhook_headers)

    return job_id


async def execute_command(
    db: Session,
    job_id: str,
    command: str,
    task_id: Optional[int] = None,
    webhook_url: Optional[str] = None,
    webhook_headers: Optional[Dict[str, str]] = None,
) -> str:
    """执行指令任务：subprocess 调用 shell 指令，实时输出 stdout/stderr"""
    job = db.query(ScrapeJob).filter(ScrapeJob.job_id == job_id).first()
    if job:
        job.status = "running"
        job.total = 1
        db.commit()

    await _emit(job_id, {"type": "log", "payload": {"log_line": f"$ {command}"}})

    # Windows: shell=True; 使用 PowerShell 仅当显式需要，这里用默认 shell
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=PROJECT_ROOT,
        )
    except Exception as e:
        if job:
            job.status = "failed"
            job.error = f"启动失败: {e}"
            job.finished_at = datetime.utcnow()
            db.commit()
        await _emit(job_id, {"type": "error", "payload": {"error": str(e)}})
        await _emit(job_id, {"type": "done", "payload": {"status": "failed"}})
        return job_id

    output_lines = []
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        line_text = line.decode("utf-8", errors="replace").rstrip("\r\n")
        if line_text:
            output_lines.append(line_text)
            await _emit(job_id, {"type": "log", "payload": {"log_line": line_text}})
            # 更新进度（指令任务每行算一步）
            if job:
                job.completed += 1
                db.commit()
            await _emit(job_id, {
                "type": "progress",
                "payload": {"completed": job.completed if job else 1, "total": None, "current_url": command},
            })

    await proc.wait()
    exit_code = proc.returncode
    full_output = "\n".join(output_lines)

    if job:
        job.status = "success" if exit_code == 0 else "failed"
        job.finished_at = datetime.utcnow()
        job.output = full_output
        if exit_code != 0:
            job.error = f"进程退出码 {exit_code}"
        db.commit()

    await _emit(job_id, {
        "type": "done",
        "payload": {
            "status": job.status if job else "success",
            "exit_code": exit_code,
        },
    })

    if webhook_url:
        payload = {
            "job_id": job_id,
            "type": "command",
            "status": job.status if job else "success",
            "command": command,
            "exit_code": exit_code,
            "output": full_output[-4000:] if len(full_output) > 4000 else full_output,
            "finished_at": datetime.utcnow().isoformat(),
        }
        await push_webhook(webhook_url, payload, webhook_headers)

    return job_id


def create_job_record(
    db: Session,
    task_id: Optional[int] = None,
    total: int = 0,
) -> str:
    """创建 job 记录，返回 job_id"""
    job_id = _make_job_id()
    job = ScrapeJob(
        job_id=job_id,
        task_id=task_id,
        status="pending",
        total=total,
        completed=0,
    )
    db.add(job)
    db.commit()
    return job_id
