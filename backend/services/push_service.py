"""Webhook 推送服务：任务完成后调用用户配置的 Webhook"""
import asyncio
import json
from typing import Optional, Dict
import httpx


async def push_webhook(
    webhook_url: str,
    payload: dict,
    headers: Optional[Dict[str, str]] = None,
    max_retries: int = 3,
) -> bool:
    """
    调用 Webhook，支持重试（指数退避）。
    返回 True 表示最终成功，False 表示全部重试失败。
    """
    if not webhook_url:
        return False

    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(webhook_url, json=payload, headers=req_headers)
                if 200 <= resp.status_code < 300:
                    return True
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as e:
            last_error = str(e)

        if attempt < max_retries:
            await asyncio.sleep(2 ** (attempt - 1))  # 1s, 2s, 4s

    print(f"[PushService] Webhook 推送失败（重试 {max_retries} 次）: {last_error}")
    return False
