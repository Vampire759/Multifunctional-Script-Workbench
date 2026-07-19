"""Docker推送路由：通过screen执行Docker构建和推送命令"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import ScreenTask
from backend.schemas import GenericResp
from backend.services import screen_service
from backend.services.websocket_hub import hub

router = APIRouter(prefix="/api/docker-push", tags=["docker-push"])

DOCKER_PUSH_SESSION_NAME = "docker_push"


@router.post("/start", response_model=GenericResp)
async def start_docker_push(
    command: str = "",
    db: Session = Depends(get_db),
):
    """启动或重启Docker推送screen会话"""
    if not command.strip():
        command = "docker build -t myapp . && docker push myapp:latest"
    
    screens = await screen_service.list_screens()
    existing_screen = any(s["name"] == DOCKER_PUSH_SESSION_NAME for s in screens)
    
    if existing_screen:
        await screen_service.stop_screen(DOCKER_PUSH_SESSION_NAME, db)
        await asyncio.sleep(1)
    
    success = await screen_service.create_screen(DOCKER_PUSH_SESSION_NAME, command, db)
    
    if success:
        return GenericResp(success=True, message="Docker推送会话已启动", data={"session_name": DOCKER_PUSH_SESSION_NAME})
    else:
        return GenericResp(success=False, message="Docker推送会话启动失败")


@router.post("/stop", response_model=GenericResp)
async def stop_docker_push(db: Session = Depends(get_db)):
    """停止Docker推送screen会话"""
    await screen_service.stop_screen(DOCKER_PUSH_SESSION_NAME, db)
    return GenericResp(success=True, message="Docker推送会话已停止")


@router.get("/status", response_model=dict)
async def get_docker_push_status(db: Session = Depends(get_db)):
    """获取Docker推送会话状态"""
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == DOCKER_PUSH_SESSION_NAME for s in screens)
    
    task = db.query(ScreenTask).filter(ScreenTask.name == DOCKER_PUSH_SESSION_NAME).first()
    
    return {
        "running": screen_exists,
        "status": task.status if task else "unknown",
        "command": task.command if task else "",
        "started_at": task.started_at.isoformat() if task and task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task and task.finished_at else None,
    }


@router.post("/re-push", response_model=GenericResp)
async def re_push_docker(command: str = "", db: Session = Depends(get_db)):
    """向现有Docker推送会话重新发送命令（可持续推送）"""
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == DOCKER_PUSH_SESSION_NAME for s in screens)
    
    if not screen_exists:
        if not command.strip():
            command = "docker build -t myapp . && docker push myapp:latest"
        success = await screen_service.create_screen(DOCKER_PUSH_SESSION_NAME, command, db)
        if success:
            return GenericResp(success=True, message="Docker推送会话已创建并开始推送")
        else:
            return GenericResp(success=False, message="Docker推送会话创建失败")
    
    if not command.strip():
        task = db.query(ScreenTask).filter(ScreenTask.name == DOCKER_PUSH_SESSION_NAME).first()
        if task:
            command = task.command
    
    if not command.strip():
        return GenericResp(success=False, message="没有可用的推送命令")
    
    success = await screen_service.send_command(DOCKER_PUSH_SESSION_NAME, command)
    if success:
        return GenericResp(success=True, message="推送命令已发送")
    else:
        return GenericResp(success=False, message="发送命令失败")


@router.websocket("/ws")
async def docker_push_ws(ws: WebSocket):
    """WebSocket 实时日志推送"""
    await hub.connect(f"screen_{DOCKER_PUSH_SESSION_NAME}", ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(f"screen_{DOCKER_PUSH_SESSION_NAME}", ws)