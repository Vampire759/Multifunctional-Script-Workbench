"""定时任务 CRUD + 手动触发路由"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Schedule, Task, Script
from backend.schemas import ScheduleCreate, ScheduleUpdate, ScheduleOut, GenericResp
from backend.services import scheduler_service, scrape_service

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _sched_to_out(sched: Schedule) -> ScheduleOut:
    return ScheduleOut(
        id=sched.id,
        name=sched.name,
        cron_expr=sched.cron_expr,
        target_type=sched.target_type,
        target_id=sched.target_id,
        screen_name=sched.screen_name,
        script_id=sched.script_id,
        command=sched.command,
        enabled=bool(sched.enabled),
        last_run_at=sched.last_run_at,
        next_run_at=sched.next_run_at,
    )


@router.get("", response_model=list[ScheduleOut])
def list_schedules(db: Session = Depends(get_db)):
    items = db.query(Schedule).order_by(Schedule.id.desc()).all()
    return [_sched_to_out(s) for s in items]


@router.post("", response_model=ScheduleOut)
def create_schedule(payload: ScheduleCreate, db: Session = Depends(get_db)):
    if payload.target_type == "task":
        if not payload.target_id:
            raise HTTPException(status_code=400, detail="任务类型必须指定任务ID")
        task = db.query(Task).filter(Task.id == payload.target_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="关联任务不存在")
    elif payload.target_type == "screen":
        if not payload.screen_name:
            raise HTTPException(status_code=400, detail="Screen类型必须指定会话名称")
    elif payload.target_type == "script":
        if not payload.script_id:
            raise HTTPException(status_code=400, detail="脚本类型必须指定脚本ID")
        script = db.query(Script).filter(Script.id == payload.script_id).first()
        if not script:
            raise HTTPException(status_code=404, detail="脚本不存在")

    try:
        scheduler_service._parse_cron(payload.cron_expr)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    sched = Schedule(
        name=payload.name,
        cron_expr=payload.cron_expr,
        target_type=payload.target_type,
        target_id=payload.target_id,
        screen_name=payload.screen_name,
        script_id=payload.script_id,
        command=payload.command,
        enabled=payload.enabled,
    )
    db.add(sched)
    db.commit()
    db.refresh(sched)

    if sched.enabled:
        scheduler_service.add_schedule(sched.id, sched.cron_expr, enabled=True)
        scheduler_service.update_schedule_next_run(db, sched.id)
        db.refresh(sched)

    return _sched_to_out(sched)


@router.patch("/{sched_id}", response_model=ScheduleOut)
def update_schedule(sched_id: int, payload: ScheduleUpdate, db: Session = Depends(get_db)):
    sched = db.query(Schedule).filter(Schedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="定时任务不存在")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        sched.name = data["name"]
    if "cron_expr" in data:
        try:
            scheduler_service._parse_cron(data["cron_expr"])
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        sched.cron_expr = data["cron_expr"]
    if "target_type" in data:
        sched.target_type = data["target_type"]
    if "target_id" in data:
        sched.target_id = data["target_id"]
    if "screen_name" in data:
        sched.screen_name = data["screen_name"]
    if "script_id" in data:
        sched.script_id = data["script_id"]
    if "command" in data:
        sched.command = data["command"]
    if "enabled" in data:
        sched.enabled = data["enabled"]

    db.commit()
    db.refresh(sched)

    if sched.enabled:
        scheduler_service.add_schedule(sched.id, sched.cron_expr, enabled=True)
        scheduler_service.update_schedule_next_run(db, sched.id)
    else:
        scheduler_service.remove_schedule(sched.id)
        sched.next_run_at = None
        db.commit()
        db.refresh(sched)

    return _sched_to_out(sched)


@router.delete("/{sched_id}", response_model=GenericResp)
def delete_schedule(sched_id: int, db: Session = Depends(get_db)):
    sched = db.query(Schedule).filter(Schedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="调度不存在")
    scheduler_service.remove_schedule(sched_id)
    db.delete(sched)
    db.commit()
    return GenericResp(success=True, message="已删除")


@router.post("/{sched_id}/trigger", response_model=GenericResp)
async def trigger_schedule(sched_id: int, db: Session = Depends(get_db)):
    """立即手动触发调度任务"""
    sched = db.query(Schedule).filter(Schedule.id == sched_id).first()
    if not sched:
        raise HTTPException(status_code=404, detail="调度不存在")
    # 异步执行（不阻塞）
    asyncio.create_task(scheduler_service._run_scheduled_task(sched_id))
    return GenericResp(success=True, message="已触发执行")
