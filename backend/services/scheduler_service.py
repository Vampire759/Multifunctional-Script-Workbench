"""定时任务服务：基于 APScheduler，按 Cron 触发任务"""
import asyncio
import json
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.database import SessionLocal
from backend.models import Task, Schedule, Script
from backend.services import scrape_service, screen_service

# 全局调度器
scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")


def _parse_cron(expr: str) -> CronTrigger:
    """解析 5 段 Cron 表达式（分 时 日 月 周）"""
    parts = expr.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Cron 表达式必须是 5 段（分 时 日 月 周），收到: {expr}")
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute, hour=hour, day=day, month=month, day_of_week=day_of_week
    )


def _job_id_for_schedule(schedule_id: int) -> str:
    return f"schedule_{schedule_id}"


async def _run_scheduled_task(schedule_id: int):
    """调度器触发的执行函数"""
    db = SessionLocal()
    try:
        sched = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not sched or not sched.enabled:
            return

        if sched.target_type == "task":
            task = sched.task
            if not task:
                return
            webhook_headers = json.loads(task.webhook_headers) if task.webhook_headers else None
            if task.type == "scrape":
                urls = json.loads(task.urls) if task.urls else []
                job_id = scrape_service.create_job_record(db, task_id=task.id, total=len(urls))
                await scrape_service.execute_scrape(
                    db, job_id, urls, task.max_workers or 5, task.id, task.webhook_url, webhook_headers
                )
            else:
                job_id = scrape_service.create_job_record(db, task_id=task.id, total=1)
                await scrape_service.execute_command(
                    db, job_id, task.command or "", task.id, task.webhook_url, webhook_headers
                )
        elif sched.target_type == "screen":
            if sched.screen_name:
                cmd = sched.command or " "
                await screen_service.send_command(sched.screen_name, cmd)
        elif sched.target_type == "script":
            script = sched.script
            if script and script.content:
                import subprocess
                result = subprocess.run(
                    ["python", "-c", script.content],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                print(f"[Scheduler] 脚本执行结果: {result.stdout}")
                if result.returncode != 0:
                    print(f"[Scheduler] 脚本执行错误: {result.stderr}")

        sched.last_run_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        print(f"[Scheduler] 执行定时任务 {schedule_id} 失败: {e}")
    finally:
        db.close()


def add_schedule(schedule_id: int, cron_expr: str, enabled: bool = True):
    """添加调度任务到调度器"""
    if not enabled:
        return
    trigger = _parse_cron(cron_expr)
    job_id = _job_id_for_schedule(schedule_id)
    # 若已存在，先移除
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass
    scheduler.add_job(
        _run_scheduled_task,
        trigger=trigger,
        args=[schedule_id],
        id=job_id,
        replace_existing=True,
    )


def remove_schedule(schedule_id: int):
    """从调度器移除"""
    try:
        scheduler.remove_job(_job_id_for_schedule(schedule_id))
    except Exception:
        pass


def update_schedule_next_run(db, schedule_id: int):
    """更新数据库中的 next_run_at 字段"""
    try:
        job = scheduler.get_job(_job_id_for_schedule(schedule_id))
        sched = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if sched and job and job.next_run_time:
            sched.next_run_at = job.next_run_time.astimezone().replace(tzinfo=None)
            db.commit()
    except Exception as e:
        print(f"[Scheduler] 更新 next_run_at 失败: {e}")


def load_all_schedules():
    """启动时从 DB 加载所有启用的调度"""
    db = SessionLocal()
    try:
        schedules = db.query(Schedule).filter(Schedule.enabled == True).all()
        for sched in schedules:
            try:
                add_schedule(sched.id, sched.cron_expr, enabled=True)
                update_schedule_next_run(db, sched.id)
            except Exception as e:
                print(f"[Scheduler] 加载调度 {sched.id} 失败: {e}")
        print(f"[Scheduler] 已加载 {len(schedules)} 个调度任务")
    finally:
        db.close()


def start_scheduler():
    """启动调度器（在 FastAPI startup 事件中调用）"""
    if not scheduler.running:
        scheduler.start()
        load_all_schedules()


def shutdown_scheduler():
    """关闭调度器"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
