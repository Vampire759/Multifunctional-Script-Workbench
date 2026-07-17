"""下载任务 API 路由"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import DownloadTask
from backend.schemas import GenericResp
from backend.services import download_service
from backend.services.websocket_hub import hub

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


@router.post("", response_model=GenericResp)
async def create_download(
    video_url: str = "",
    source_url: str = "",
    script_id: int | None = None,
    command: str = "",
    title: str = "",
    filename: str = "",
    db: Session = Depends(get_db),
):
    """创建下载任务并立即执行"""
    if not video_url and not command:
        raise HTTPException(status_code=400, detail="video_url 或 command 必填")

    task_id = download_service.create_download_task(db, video_url, source_url, title, filename, script_id, command)
    asyncio.create_task(download_service.execute_download(db, task_id))

    return GenericResp(success=True, message="下载任务已创建", data={"task_id": task_id})


@router.post("/batch", response_model=GenericResp)
async def create_batch_download(
    items: list[dict],
    db: Session = Depends(get_db),
):
    """批量创建下载任务"""
    task_ids = []
    for item in items:
        video_url = item.get("video_url")
        if not video_url:
            continue
        task_id = download_service.create_download_task(
            db,
            video_url,
            item.get("source_url", ""),
            item.get("title", ""),
            item.get("filename", ""),
        )
        task_ids.append(task_id)
        asyncio.create_task(download_service.execute_download(db, task_id))

    return GenericResp(success=True, message=f"已创建 {len(task_ids)} 个下载任务", data={"task_ids": task_ids})


@router.get("", response_model=list[dict])
def list_downloads(
    status: str = Query(None),
    db: Session = Depends(get_db),
):
    """获取下载任务列表"""
    q = db.query(DownloadTask).order_by(DownloadTask.created_at.desc())
    if status:
        q = q.filter(DownloadTask.status == status)
    tasks = q.all()
    return [
        {
            "id": t.id,
            "video_url": t.video_url,
            "source_url": t.source_url,
            "script_id": t.script_id,
            "command": t.command,
            "title": t.title,
            "filename": t.filename,
            "status": t.status,
            "progress": t.progress,
            "speed": t.speed,
            "eta": t.eta,
            "downloaded_bytes": t.downloaded_bytes,
            "total_bytes": t.total_bytes,
            "retry_count": t.retry_count,
            "max_retries": t.max_retries,
            "error": t.error,
            "output_path": t.output_path,
            "started_at": t.started_at.isoformat() if t.started_at else None,
            "finished_at": t.finished_at.isoformat() if t.finished_at else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tasks
    ]


@router.get("/{task_id}", response_model=dict)
def get_download(task_id: int, db: Session = Depends(get_db)):
    """获取单个下载任务"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {
        "id": task.id,
        "video_url": task.video_url,
        "source_url": task.source_url,
        "title": task.title,
        "filename": task.filename,
        "status": task.status,
        "progress": task.progress,
        "speed": task.speed,
        "eta": task.eta,
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": task.total_bytes,
        "retry_count": task.retry_count,
        "max_retries": task.max_retries,
        "error": task.error,
        "output_path": task.output_path,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }


@router.post("/{task_id}/retry", response_model=GenericResp)
async def retry_download(task_id: int, db: Session = Depends(get_db)):
    """手动重试下载"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "running":
        raise HTTPException(status_code=400, detail="任务正在运行中")

    task.status = "pending"
    task.retry_count = 0
    task.error = None
    task.progress = 0
    db.commit()

    asyncio.create_task(download_service.execute_download(db, task_id))
    return GenericResp(success=True, message="已重新开始下载")


@router.delete("/{task_id}", response_model=GenericResp)
def delete_download(task_id: int, db: Session = Depends(get_db)):
    """删除下载任务"""
    task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    db.delete(task)
    db.commit()
    return GenericResp(success=True, message="已删除")


@router.websocket("/ws/{task_id}")
async def download_ws(ws: WebSocket, task_id: int):
    """WebSocket 实时下载进度推送"""
    await hub.connect(f"dl_{task_id}", ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(f"dl_{task_id}", ws)
