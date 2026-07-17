"""WebSocket Hub：维护 job_id → 连接集合，广播进度事件"""
import asyncio
import json
from typing import Dict, Set
from fastapi import WebSocket


class WebSocketHub:
    def __init__(self):
        # job_id -> set of WebSocket
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, job_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.setdefault(job_id, set()).add(ws)

    async def disconnect(self, job_id: str, ws: WebSocket):
        async with self._lock:
            conns = self._connections.get(job_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._connections.pop(job_id, None)

    async def broadcast(self, job_id: str, message: dict):
        """向指定 job 的所有连接广播消息"""
        async with self._lock:
            conns = list(self._connections.get(job_id, set()))
        dead = []
        text = json.dumps(message, ensure_ascii=False, default=str)
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                conns_set = self._connections.get(job_id)
                if conns_set:
                    for ws in dead:
                        conns_set.discard(ws)


# 全局单例
hub = WebSocketHub()
