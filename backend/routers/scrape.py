"""立即执行路由 + WebSocket 进度推送"""
import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import ScrapeJob
from backend.schemas import ScrapeRequest, ScrapeJobOut
from backend.services import scrape_service
from backend.services.websocket_hub import hub

router = APIRouter(prefix="/api/scrape", tags=["scrape"])


@router.post("/start", response_model=ScrapeJobOut)
async def start_scrape(req: ScrapeRequest, db: Session = Depends(get_db)):
    """立即执行爬取或指令任务"""
    # 校验输入
    if req.type == "scrape":
        if not req.urls:
            raise HTTPException(status_code=400, detail="爬虫任务必须提供 urls")
        total = len(req.urls)
    else:
        if not req.command or not req.command.strip():
            raise HTTPException(status_code=400, detail="指令任务必须提供 command")
        total = 1

    # 创建 job 记录
    job_id = scrape_service.create_job_record(db, task_id=None, total=total)

    # 异步启动执行（不阻塞响应）
    if req.type == "scrape":
        asyncio.create_task(scrape_service.execute_scrape(
            db, job_id, req.urls, req.max_workers, None, req.webhook_url, req.webhook_headers
        ))
    else:
        asyncio.create_task(scrape_service.execute_command(
            db, job_id, req.command, None, req.webhook_url, req.webhook_headers
        ))

    # 返回 job 信息（前端拿到 job_id 后建立 WebSocket）
    job = db.query(ScrapeJob).filter(ScrapeJob.job_id == job_id).first()
    return ScrapeJobOut.model_validate(job)


@router.get("/{job_id}/status", response_model=ScrapeJobOut)
async def get_scrape_status(job_id: str, db: Session = Depends(get_db)):
    """查询执行状态"""
    job = db.query(ScrapeJob).filter(ScrapeJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job 不存在")
    return ScrapeJobOut.model_validate(job)


@router.websocket("/ws/{job_id}")
async def scrape_ws(ws: WebSocket, job_id: str):
    """WebSocket 实时进度推送"""
    await hub.connect(job_id, ws)
    try:
        while True:
            # 保持连接，可接收客户端心跳
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(job_id, ws)
