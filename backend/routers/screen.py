"""Screen 会话管理 API 路由"""
import asyncio
import json
import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import ScreenTask
from backend.schemas import GenericResp
from backend.services import screen_service
from backend.services.websocket_hub import hub
from backend.services import pty_service

LOG_DIR = "/app/logs"

router = APIRouter(prefix="/api/screen", tags=["screen"])


@router.post("/create", response_model=GenericResp)
async def create_screen_session(
    name: str,
    command: str = "",
    db: Session = Depends(get_db),
):
    if not name:
        raise HTTPException(status_code=400, detail="name 必填")
    
    try:
        success = await screen_service.create_screen(name, command, db)
        if success:
            task = screen_service.get_screen_task(db, name)
            is_existing = task and task.created_at and (task.started_at and task.started_at == task.created_at or False)
            msg = f"Screen 会话 '{name}' 已创建" if not task or not task.id or task.status == "running" else f"Screen 会话 '{name}' 已存在，正在复用"
            return GenericResp(success=True, message=msg)
        
        task = screen_service.get_screen_task(db, name)
        error_msg = task.error if task else "未知错误"
        return GenericResp(success=False, message=f"创建失败: {error_msg}")
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Create screen error: {error_details}")
        return GenericResp(success=False, message=f"创建失败: {str(e)}")


@router.get("/test-screen")
async def test_screen():
    """测试screen命令是否正常工作"""
    try:
        import os
        result = await screen_service._run_command(["screen", "-version"])
        logger.info(f"Screen version: {result}")
        
        result2 = await screen_service._run_command(["ls", "-la", "/run/screen"])
        logger.info(f"Screen dir: {result2}")
        
        env_check = os.environ.get('USER', 'unknown')
        logger.info(f"Current user: {env_check}")
        
        test_name = f"test_{os.getpid()}"
        result3 = await screen_service._run_command(["screen", "-dmS", test_name, "/bin/bash", "-i"])
        logger.info(f"Create screen result: {result3}")
        
        await screen_service._run_command(["sleep", "1"])
        
        screens = await screen_service.list_screens()
        logger.info(f"Available screens: {screens}")
        
        found = any(s["name"] == test_name for s in screens)
        
        await screen_service._run_command(["screen", "-S", test_name, "-X", "quit"])
        
        return {
            "success": True,
            "message": "Screen command test completed",
            "screens_found": len(screens),
            "test_session_created": found,
            "user": env_check,
        }
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Test screen error: {error_details}")
        return {
            "success": False,
            "message": str(e),
            "details": error_details,
        }


@router.post("/send/{name}", response_model=GenericResp)
async def send_to_screen(name: str, command: str, db: Session = Depends(get_db)):
    """向 screen 会话发送命令（支持系统会话和数据库会话）"""
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == name for s in screens)
    
    if not screen_exists:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    success = await screen_service.send_command(name, command)
    if success:
        return GenericResp(success=True, message=f"命令已发送到会话 '{name}'")
    return GenericResp(success=False, message="发送失败")


@router.get("/list", response_model=list[dict])
async def list_screen_sessions(db: Session = Depends(get_db)):
    tasks = screen_service.get_screen_tasks(db)
    screens = await screen_service.list_screens()
    
    screen_map = {s["name"]: s for s in screens}
    result = []
    
    for task in tasks:
        screen = screen_map.get(task.name)
        if screen:
            status = screen["status"]
            pid = screen.get("pid")
        else:
            status = task.status or "stopped"
            pid = None
        result.append({
            "id": task.id,
            "name": task.name,
            "command": task.command,
            "status": status,
            "pid": pid,
            "log_path": task.log_path,
            "error": task.error,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "finished_at": task.finished_at.isoformat() if task.finished_at else None,
            "created_at": task.created_at.isoformat() if task.created_at else None,
        })
    
    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result


@router.get("/log/{name}", response_model=dict)
async def get_screen_log(
    name: str,
    tail: int = Query(100),
    db: Session = Depends(get_db),
):
    task = screen_service.get_screen_task(db, name)
    if not task:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    log_content = await screen_service.get_screen_log(name, tail)
    return {"name": name, "log": log_content}


@router.post("/stop/{name}", response_model=GenericResp)
async def stop_screen_session(name: str, db: Session = Depends(get_db)):
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == name for s in screens)
    
    if not screen_exists:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    task = screen_service.get_screen_task(db, name)
    success = await screen_service.stop_screen(name, db)
    if success:
        return GenericResp(success=True, message=f"Screen 会话 '{name}' 已终止")
    return GenericResp(success=False, message="终止失败")


@router.delete("/{name}", response_model=GenericResp)
async def delete_screen_task(name: str, db: Session = Depends(get_db)):
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == name for s in screens)
    task = screen_service.get_screen_task(db, name)
    
    if not screen_exists and not task:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    if screen_exists:
        await screen_service.stop_screen(name)
    
    if task:
        db.delete(task)
        db.commit()
        return GenericResp(success=True, message=f"已删除会话记录 '{name}'")
    else:
        return GenericResp(success=True, message=f"已终止系统会话 '{name}'")


@router.websocket("/ws/{name}")
async def screen_ws(ws: WebSocket, name: str):
    """WebSocket 实时日志推送 + 命令输入"""
    await hub.connect(f"screen_{name}", ws)
    
    from backend.services.screen_service import _active_broadcasters, _broadcast_log, get_session_log_path, _clean_log_content
    
    log_path = get_session_log_path(name)
    
    if name not in _active_broadcasters or _active_broadcasters[name].done():
        _active_broadcasters[name] = asyncio.create_task(_broadcast_log(name, log_path))
    
    try:
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                for line in lines[-200:]:
                    line = line.strip()
                    if line:
                        cleaned = _clean_log_content(line)
                        await ws.send_text(json.dumps({
                            "type": "log",
                            "payload": {"log_line": cleaned}
                        }, ensure_ascii=False))
    except Exception as e:
        pass
    
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "command":
                    await screen_service.send_command(name, msg.get("payload", ""))
            except json.JSONDecodeError:
                await screen_service.send_command(name, data)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(f"screen_{name}", ws)


@router.websocket("/terminal/{name}")
async def screen_terminal_ws(ws: WebSocket, name: str):
    """WebSocket PTY终端连接 - 真正的终端交互"""
    await ws.accept()
    logger = __import__('logging').getLogger(__name__)
    logger.info(f"Screen terminal connection requested: {name}")
    
    screens = await screen_service.list_screens()
    screen_exists = any(s["name"] == name for s in screens)
    
    if not screen_exists:
        logger.warning(f"Screen session {name} not found, creating...")
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        await asyncio.create_subprocess_exec("screen", "-dmS", name, "/bin/bash", "-i", env=env)
        await asyncio.sleep(1)
        logger.info(f"Created screen session: {name}")
    
    try:
        proc = await pty_service.start_terminal(f"screen_{name}", ws, f"screen -x {name}")
        
        if proc is None:
            await ws.send_text("\r\n终端启动失败\r\n")
            return
        
        while True:
            try:
                data = await ws.receive_text()
                pty_service.write_to_terminal(f"screen_{name}", data.encode('utf-8'))
            except Exception:
                try:
                    data = await ws.receive_bytes()
                    pty_service.write_to_terminal(f"screen_{name}", data)
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Screen terminal error: {e}", exc_info=True)
        try:
            await ws.send_text(f"\r\nError: {str(e)}\r\n")
        except:
            pass
    finally:
        pty_service.stop_terminal(f"screen_{name}")


@router.get("/log-files", response_model=list[dict])
async def list_log_files(grouped: bool = Query(False)):
    """获取历史日志文件列表"""
    if grouped:
        return list_log_files_grouped()
    
    log_files = []
    if os.path.exists(LOG_DIR):
        for item in sorted(os.listdir(LOG_DIR)):
            item_path = os.path.join(LOG_DIR, item)
            if item.endswith(".log"):
                stat = os.stat(item_path)
                log_files.append({
                    "name": item,
                    "path": item_path,
                    "size": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "session_name": None,
                })
            elif os.path.isdir(item_path):
                for filename in sorted(os.listdir(item_path)):
                    if filename.endswith(".log"):
                        filepath = os.path.join(item_path, filename)
                        stat = os.stat(filepath)
                        log_files.append({
                            "name": filename,
                            "path": filepath,
                            "size": stat.st_size,
                            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "session_name": item,
                        })
    return sorted(log_files, key=lambda x: x["modified_at"], reverse=True)


def list_log_files_grouped() -> list[dict]:
    """获取按会话分组的日志文件列表"""
    sessions = []
    if os.path.exists(LOG_DIR):
        for item in sorted(os.listdir(LOG_DIR)):
            item_path = os.path.join(LOG_DIR, item)
            if os.path.isdir(item_path):
                files = []
                for filename in sorted(os.listdir(item_path)):
                    if filename.endswith(".log"):
                        filepath = os.path.join(item_path, filename)
                        stat = os.stat(filepath)
                        files.append({
                            "name": filename,
                            "path": filepath,
                            "size": stat.st_size,
                            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        })
                if files:
                    sessions.append({
                        "session_name": item,
                        "files": sorted(files, key=lambda x: x["modified_at"], reverse=True),
                        "total_files": len(files),
                        "total_size": sum(f["size"] for f in files),
                        "last_modified": max(f["modified_at"] for f in files),
                    })
    return sorted(sessions, key=lambda x: x["last_modified"], reverse=True)


def _find_log_file_path(filename: str) -> str:
    """查找日志文件的完整路径"""
    filepath = os.path.join(LOG_DIR, filename)
    if os.path.exists(filepath):
        return filepath
    
    for item in os.listdir(LOG_DIR):
        item_path = os.path.join(LOG_DIR, item)
        if os.path.isdir(item_path):
            candidate = os.path.join(item_path, filename)
            if os.path.exists(candidate):
                return candidate
    
    return None


@router.get("/log-files/{filename}")
async def download_log_file(filename: str):
    """下载历史日志文件"""
    filepath = _find_log_file_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="日志文件不存在")
    
    if not filename.endswith(".log"):
        raise HTTPException(status_code=400, detail="只能下载日志文件")
    
    return FileResponse(
        filepath,
        filename=filename,
        media_type="text/plain",
    )


@router.get("/log-files/{filename}/content")
async def get_log_file_content(filename: str, tail: int = Query(100)):
    """获取日志文件内容"""
    filepath = _find_log_file_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="日志文件不存在")
    
    if not filename.endswith(".log"):
        raise HTTPException(status_code=400, detail="只能查看日志文件")
    
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            content = "".join(lines[-tail:])
            return {"filename": filename, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/log-files/{filename}", response_model=GenericResp)
async def delete_log_file(filename: str):
    """删除单个日志文件"""
    filepath = _find_log_file_path(filename)
    if not filepath:
        raise HTTPException(status_code=404, detail="日志文件不存在")
    
    if not filename.endswith(".log"):
        raise HTTPException(status_code=400, detail="只能删除日志文件")
    
    try:
        os.remove(filepath)
        return GenericResp(success=True, message=f"日志文件 '{filename}' 已删除")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/log-files/session/{session_name}", response_model=GenericResp)
async def delete_session_logs(session_name: str):
    """删除整个会话的日志文件夹"""
    session_dir = os.path.join(LOG_DIR, session_name)
    if not os.path.exists(session_dir):
        raise HTTPException(status_code=404, detail="会话日志文件夹不存在")
    
    if not os.path.isdir(session_dir):
        raise HTTPException(status_code=400, detail="路径不是文件夹")
    
    try:
        import shutil
        shutil.rmtree(session_dir)
        return GenericResp(success=True, message=f"会话 '{session_name}' 的所有日志已删除")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
