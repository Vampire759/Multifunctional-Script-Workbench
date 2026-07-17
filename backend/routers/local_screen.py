"""本地 Screen 监控路由 - 代理调用宿主机上的 screen_agent，同时保存日志到日志中心"""

import httpx
import logging
import asyncio
import os
from datetime import datetime
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from typing import Dict

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/local-screen", tags=["local-screen"])

HOST_AGENT_URL = "http://host.docker.internal:3001"

# 日志中心目录（与 screen_service 一致）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)


async def _call_host_agent(method: str, path: str, **kwargs) -> Dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{HOST_AGENT_URL}{path}"
            if method == "GET":
                resp = await client.get(url, **kwargs)
            elif method == "POST":
                resp = await client.post(url, **kwargs)
            else:
                return {"success": False, "message": f"Unsupported method: {method}"}
            return resp.json()
    except httpx.ConnectError:
        return {"success": False, "message": "无法连接到宿主机 Screen Agent，请确保 host_screen_agent.py 已启动"}
    except Exception as e:
        logger.error(f"Host agent call failed: {e}")
        return {"success": False, "message": str(e)}


def _get_latest_local_log_path(session_name: str) -> str:
    """获取本地 screen 会话最新的日志文件路径，如不存在或过大则创建新的"""
    session_log_dir = os.path.join(LOG_DIR, f"local_{session_name}")
    os.makedirs(session_log_dir, exist_ok=True)
    if os.path.exists(session_log_dir):
        files = sorted([f for f in os.listdir(session_log_dir) if f.endswith(".log")], reverse=True)
        if files:
            filepath = os.path.join(session_log_dir, files[0])
            # 如果当前日志文件超过 10MB，创建新文件
            if os.path.getsize(filepath) < 10 * 1024 * 1024:
                return filepath
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return os.path.join(session_log_dir, f"{timestamp}.log")


def _save_log_to_file(session_name: str, content: str):
    """将日志内容追加保存到日志中心文件"""
    try:
        log_path = _get_latest_local_log_path(session_name)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"Failed to save log for {session_name}: {e}")


@router.get("/list", response_model=dict)
async def list_local_screens():
    """获取宿主机上的 screen 会话列表"""
    return await _call_host_agent("GET", "/list")


@router.get("/log/{name}", response_model=dict)
async def get_local_screen_log(name: str):
    """获取宿主机上指定 screen 会话的日志"""
    return await _call_host_agent("GET", f"/log/{name}")


@router.get("/info/{name}", response_model=dict)
async def get_local_screen_info(name: str):
    """获取宿主机上指定 screen 会话的信息"""
    return await _call_host_agent("GET", f"/info/{name}")


@router.post("/create", response_model=dict)
async def create_local_screen(name: str = Query(...)):
    """在宿主机上创建 screen 会话"""
    return await _call_host_agent("POST", "/create", json={"name": name})


@router.post("/send/{name}", response_model=dict)
async def send_local_screen_command(name: str, command: str = Query(...)):
    """向宿主机上指定 screen 会话发送命令"""
    return await _call_host_agent("POST", f"/send/{name}", json={"command": command})


@router.post("/stop/{name}", response_model=dict)
async def stop_local_screen(name: str):
    """停止宿主机上指定 screen 会话"""
    return await _call_host_agent("POST", f"/stop/{name}")


@router.websocket("/ws/{name}")
async def local_screen_ws(ws: WebSocket, name: str):
    """WebSocket 实时日志推送 + 命令输入（宿主机 screen），同时保存日志到日志中心"""
    await ws.accept()

    last_pos = 0
    is_running = True
    save_buffer = ""

    async def flush_save_buffer():
        """定期将缓冲区内容写入日志文件"""
        nonlocal save_buffer, is_running
        while is_running:
            await asyncio.sleep(5)
            if save_buffer:
                _save_log_to_file(name, save_buffer)
                save_buffer = ""

    async def log_puller():
        nonlocal last_pos, is_running, save_buffer
        while is_running:
            try:
                result = await _call_host_agent("GET", f"/log-delta/{name}", params={"pos": last_pos})
                if result.get("success"):
                    data = result.get("data", "")
                    new_pos = result.get("pos", last_pos)
                    if data and new_pos > last_pos:
                        await ws.send_text(data)
                        save_buffer += data
                        last_pos = new_pos
            except Exception as e:
                logger.error(f"Log puller error: {e}")
            await asyncio.sleep(1)

    puller_task = asyncio.create_task(log_puller())
    saver_task = asyncio.create_task(flush_save_buffer())

    try:
        while True:
            data = await ws.receive_text()
            try:
                import json
                msg = json.loads(data)
                if msg.get("type") == "command":
                    payload = msg.get("payload", "")
                    await _call_host_agent("POST", f"/send/{name}", json={"command": payload})
                    save_buffer += f"\n> {payload}\n"
            except Exception:
                await _call_host_agent("POST", f"/send/{name}", json={"command": data})
                save_buffer += f"\n> {data}\n"
    except WebSocketDisconnect:
        pass
    finally:
        is_running = False
        puller_task.cancel()
        saver_task.cancel()
        # 断开前刷新剩余缓冲
        if save_buffer:
            _save_log_to_file(name, save_buffer)
            save_buffer = ""
