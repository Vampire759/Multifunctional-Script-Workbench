"""Docker 容器监控 API 路由"""
import asyncio
import json
import threading
import queue
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

logging.getLogger('docker').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logging.getLogger('requests').setLevel(logging.WARNING)

from backend.database import get_db
from backend.schemas import GenericResp
from backend.services.websocket_hub import hub

router = APIRouter(prefix="/api/docker", tags=["docker"])


def _get_client():
    try:
        import docker
        return docker.from_env(timeout=30)
    except ImportError:
        raise HTTPException(status_code=500, detail="Docker SDK 未安装")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Docker 连接失败: {str(e)}")


logger = logging.getLogger(__name__)


@router.get("/containers", response_model=list[dict])
def list_containers():
    """获取所有容器列表"""
    try:
        client = _get_client()
        containers = client.containers.list(all=True)
        logger.info(f"Docker containers found: {len(containers)}")
        result = []
        for c in containers:
            attrs = c.attrs
            status = attrs.get("State", {}).get("Status", "")
            state = attrs.get("State", {}).get("Running", False)
            if state is True:
                state = "running"
            elif attrs.get("State", {}).get("Paused", False):
                state = "paused"
            else:
                state = "exited"
            ports = []
            port_settings = attrs.get("NetworkSettings", {}).get("Ports", {})
            for port, bindings in port_settings.items():
                if bindings:
                    for p in bindings:
                        ports.append(f"{p.get('HostIp', '')}:{p.get('HostPort', '')}->{port}")
            image_name = attrs.get("Config", {}).get("Image", "")
            result.append({
                "id": attrs.get("Id", "")[:12],
                "name": attrs.get("Name", "").lstrip('/'),
                "image": image_name,
                "status": status,
                "state": state,
                "ports": ", ".join(ports),
                "created": attrs.get("Created", ""),
            })
        logger.info(f"Returning {len(result)} containers")
        return result
    except Exception as e:
        logger.error(f"Error listing containers: {e}", exc_info=True)
        return []


@router.get("/container/{container_id}", response_model=dict)
def get_container(container_id: str):
    """获取容器详细信息"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        info = c.attrs
        return {
            "id": info.get("Id", "")[:12],
            "name": info.get("Name", "").lstrip('/'),
            "image": info.get("Config", {}).get("Image", ""),
            "status": info.get("State", {}).get("Status", ""),
            "state": info.get("State", {}).get("Running", False),
            "ports": info.get("NetworkSettings", {}).get("Ports", {}),
            "created": info.get("Created", ""),
            "command": " ".join(info.get("Config", {}).get("Cmd", [])),
            "labels": info.get("Config", {}).get("Labels", {}),
            "mounts": info.get("Mounts", []),
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/container/{container_id}/start", response_model=GenericResp)
def start_container(container_id: str):
    """启动容器"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        c.start()
        return GenericResp(success=True, message="容器已启动")
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/container/{container_id}/stop", response_model=GenericResp)
def stop_container(container_id: str):
    """停止容器"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        c.stop()
        return GenericResp(success=True, message="容器已停止")
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/container/{container_id}/restart", response_model=GenericResp)
def restart_container(container_id: str):
    """重启容器"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        c.restart()
        return GenericResp(success=True, message="容器已重启")
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/container/{container_id}/pause", response_model=GenericResp)
def pause_container(container_id: str):
    """暂停容器"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        c.pause()
        return GenericResp(success=True, message="容器已暂停")
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/container/{container_id}/unpause", response_model=GenericResp)
def unpause_container(container_id: str):
    """恢复容器"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        c.unpause()
        return GenericResp(success=True, message="容器已恢复")
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _log_collector(container_id: str, log_queue: queue.Queue, stop_event: threading.Event):
    """在后台线程中收集容器日志"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        log_stream = c.logs(stream=True, follow=True, tail=100)
        
        for line in log_stream:
            if stop_event.is_set():
                break
            if line:
                log_text = line.decode('utf-8', errors='replace').strip()
                if log_text:
                    log_queue.put(log_text)
    except Exception:
        pass


@router.websocket("/logs/{container_id}")
async def docker_logs_ws(ws: WebSocket, container_id: str):
    """WebSocket 实时日志推送"""
    await ws.accept()
    
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        
        initial_logs = c.logs(tail=50).decode('utf-8', errors='replace').strip()
        if initial_logs:
            for line in initial_logs.split('\n'):
                line = line.strip()
                if line:
                    await ws.send_text(line)
                    await asyncio.sleep(0.01)
    except Exception:
        pass
    
    log_queue = queue.Queue(maxsize=1000)
    stop_event = threading.Event()
    collector_thread = threading.Thread(
        target=_log_collector,
        args=(container_id, log_queue, stop_event),
        daemon=True
    )
    
    try:
        collector_thread.start()
        
        while True:
            try:
                log_text = log_queue.get(timeout=1)
                await ws.send_text(log_text)
            except queue.Empty:
                continue
            except WebSocketDisconnect:
                break
                
    except Exception as e:
        try:
            await ws.send_text(f"Error: {str(e)}")
        except:
            pass
    finally:
        stop_event.set()
        try:
            await ws.close()
        except:
            pass


@router.get("/logs/{container_id}", response_model=dict)
def get_container_logs(container_id: str, tail: int = 100):
    """获取容器日志"""
    try:
        client = _get_client()
        c = client.containers.get(container_id)
        logs = c.logs(tail=tail).decode('utf-8', errors='replace')
        lines = logs.split('\n') if logs else []
        return {
            "container_id": container_id,
            "logs": lines,
            "count": len(lines),
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="容器不存在")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=dict)
def get_docker_stats():
    """获取 Docker 整体状态"""
    try:
        client = _get_client()
        containers = client.containers.list(all=True)
        images = client.images.list()
        
        running_count = sum(1 for c in containers if c.status == "running")
        
        return {
            "containers_total": len(containers),
            "containers_running": running_count,
            "containers_stopped": len(containers) - running_count,
            "images_total": len(images),
        }
    except Exception as e:
        return {
            "containers_total": 0,
            "containers_running": 0,
            "containers_stopped": 0,
            "images_total": 0,
        }


@router.get("/test", response_model=dict)
def test_docker():
    """测试 Docker 连接"""
    try:
        client = _get_client()
        containers = client.containers.list(all=True)
        container_names = [c.name for c in containers]
        return {
            "success": True,
            "containers_count": len(containers),
            "container_names": container_names,
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }