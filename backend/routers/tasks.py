"""任务 CRUD 路由"""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Task
from backend.schemas import TaskCreate, TaskUpdate, TaskOut, GenericResp

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _task_to_out(task: Task) -> TaskOut:
    return TaskOut(
        id=task.id,
        name=task.name,
        type=task.type,
        script_id=task.script_id,
        urls=json.loads(task.urls) if task.urls else None,
        command=task.command,
        max_workers=task.max_workers or 5,
        webhook_url=task.webhook_url,
        webhook_headers=json.loads(task.webhook_headers) if task.webhook_headers else None,
        push_time=task.push_time,
        created_at=task.created_at,
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    return [_task_to_out(t) for t in tasks]


@router.post("", response_model=TaskOut)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    # 校验
    if payload.type == "scrape" and not payload.urls:
        raise HTTPException(status_code=400, detail="爬虫任务必须提供 urls")
    if payload.type == "command" and not payload.command:
        raise HTTPException(status_code=400, detail="指令任务必须提供 command")

    task = Task(
        name=payload.name,
        type=payload.type,
        script_id=payload.script_id,
        urls=json.dumps(payload.urls, ensure_ascii=False) if payload.urls else None,
        command=payload.command,
        max_workers=payload.max_workers,
        webhook_url=payload.webhook_url,
        webhook_headers=json.dumps(payload.webhook_headers, ensure_ascii=False) if payload.webhook_headers else None,
        push_time=payload.push_time,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _task_to_out(task)


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        task.name = data["name"]
    if "type" in data:
        task.type = data["type"]
    if "script_id" in data:
        task.script_id = data["script_id"]
    if "urls" in data:
        task.urls = json.dumps(data["urls"], ensure_ascii=False) if data["urls"] else None
    if "command" in data:
        task.command = data["command"]
    if "max_workers" in data:
        task.max_workers = data["max_workers"]
    if "webhook_url" in data:
        task.webhook_url = data["webhook_url"]
    if "webhook_headers" in data:
        task.webhook_headers = json.dumps(data["webhook_headers"], ensure_ascii=False) if data["webhook_headers"] else None
    if "push_time" in data:
        task.push_time = data["push_time"]

    db.commit()
    db.refresh(task)
    return _task_to_out(task)


@router.delete("/{task_id}", response_model=GenericResp)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    db.delete(task)
    db.commit()
    return GenericResp(success=True, message="已删除")
