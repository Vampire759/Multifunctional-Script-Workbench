"""脚本管理 API 路由"""
import os
import time
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Script
from backend.schemas import GenericResp
from backend.services import script_service, screen_service

router = APIRouter(prefix="/api/scripts", tags=["scripts"])

_script_cache = {"data": None, "timestamp": 0, "ttl": 60}


class CreateScriptRequest(BaseModel):
    name: str
    description: str = ""
    script_type: str = "general"


class UpdateScriptRequest(BaseModel):
    content: str
    description: str = ""


class ExecuteScriptRequest(BaseModel):
    args: str = ""


@router.get("/", response_model=list[dict])
def list_scripts(db: Session = Depends(get_db)):
    now = time.time()
    if _script_cache["data"] and now - _script_cache["timestamp"] < _script_cache["ttl"]:
        return _script_cache["data"]
    
    scripts = script_service.get_scripts(db)
    db_scripts_by_filename = {s.filename: s for s in scripts}
    
    script_files = script_service.list_script_files()
    
    result = []
    max_db_id = max((s.id for s in scripts), default=0)
    
    for idx, sf in enumerate(script_files):
        filename = sf["filename"]
        if filename in db_scripts_by_filename:
            s = db_scripts_by_filename[filename]
            result.append({
                "id": s.id,
                "name": s.name,
                "filename": s.filename,
                "description": s.description,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            })
        else:
            name = filename.replace(".py", "")
            result.append({
                "id": max_db_id + idx + 1,
                "name": name,
                "filename": filename,
                "description": f"文件系统脚本: {filename}",
                "status": "available",
                "created_at": None,
                "updated_at": None,
            })
    
    _script_cache["data"] = result
    _script_cache["timestamp"] = now
    return result


@router.get("/files", response_model=list[dict])
def list_script_files():
    """列出 scripts 目录下所有脚本文件"""
    return script_service.list_script_files()


@router.post("/files/{filename}/execute", response_model=dict)
async def execute_script_file(filename: str, args: str = "", db: Session = Depends(get_db)):
    """执行 scripts 目录下的脚本文件（自动安装依赖）"""
    if not filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="只支持 .py 文件")
    
    script_files = script_service.list_script_files()
    if not any(f["filename"] == filename for f in script_files):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    filepath = os.path.join(script_service.SCRIPTS_DIR, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        installed = script_service.install_missing_dependencies(content)
    except Exception:
        installed = []
    
    session_name = f"file_{filename.replace('.py', '')}"
    command = f"python scripts/{filename} {args}".strip()
    
    success = await screen_service.create_screen(session_name, command, db)
    if success:
        return {
            "success": True,
            "message": f"脚本 '{filename}' 已启动" + (f"，自动安装了 {len(installed)} 个依赖" if installed else ""),
            "session_name": session_name,
            "installed_deps": installed,
        }
    return {"success": False, "message": "启动失败"}


@router.get("/{script_id}", response_model=dict)
def get_script(script_id: int, db: Session = Depends(get_db)):
    script = script_service.get_script(db, script_id)
    if not script:
        raise HTTPException(status_code=404, detail="脚本不存在")
    
    return {
        "id": script.id,
        "name": script.name,
        "filename": script.filename,
        "description": script.description,
        "content": script.content,
        "status": script.status,
        "created_at": script.created_at.isoformat() if script.created_at else None,
        "updated_at": script.updated_at.isoformat() if script.updated_at else None,
    }


@router.post("/", response_model=dict)
def create_script(req: CreateScriptRequest, db: Session = Depends(get_db)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="脚本名称必填")
    
    script = script_service.create_script(db, req.name.strip(), req.description, req.script_type)
    return {
        "success": True,
        "message": f"脚本 '{req.name}' 已创建",
        "script": {
            "id": script.id,
            "name": script.name,
            "filename": script.filename,
            "description": script.description,
            "content": script.content,
            "status": script.status,
            "created_at": script.created_at.isoformat() if script.created_at else None,
        },
    }


@router.post("/upload")
async def upload_script(file: UploadFile = File(...), description: str = "", db: Session = Depends(get_db)):
    """上传脚本文件"""
    if not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="只支持 .py 文件")
    
    content = await file.read()
    try:
        content_str = content.decode("utf-8")
    except UnicodeDecodeError:
        content_str = content.decode("gbk", errors="replace")
    
    script = script_service.upload_script(db, file.filename, content_str, description)
    return {
        "success": True,
        "message": f"脚本 '{script.name}' 已上传",
        "script": {
            "id": script.id,
            "name": script.name,
            "filename": script.filename,
        },
    }


@router.put("/{script_id}", response_model=GenericResp)
def update_script(script_id: int, req: UpdateScriptRequest, db: Session = Depends(get_db)):
    script = script_service.update_script(db, script_id, req.content, req.description)
    if not script:
        raise HTTPException(status_code=404, detail="脚本不存在")
    return GenericResp(success=True, message="脚本已更新")


@router.delete("/{script_id}", response_model=GenericResp)
def delete_script(script_id: int, db: Session = Depends(get_db)):
    success = script_service.delete_script(db, script_id)
    if not success:
        raise HTTPException(status_code=404, detail="脚本不存在")
    return GenericResp(success=True, message="脚本已删除")


@router.post("/{script_id}/execute", response_model=dict)
async def execute_script(script_id: int, args: str = "", db: Session = Depends(get_db)):
    """执行脚本（自动安装依赖）"""
    script = script_service.get_script(db, script_id)
    if not script:
        raise HTTPException(status_code=404, detail="脚本不存在")
    
    try:
        installed = script_service.install_missing_dependencies(script.content or "")
    except Exception:
        installed = []
    
    session_name = f"script_{script.name}"
    command = f"python scripts/{script.filename} {args}".strip()
    
    success = await screen_service.create_screen(session_name, command, db)
    if success:
        return {
            "success": True,
            "message": f"脚本 '{script.name}' 已启动" + (f"，自动安装了 {len(installed)} 个依赖" if installed else ""),
            "session_name": session_name,
            "installed_deps": installed,
        }
    return {"success": False, "message": "启动失败"}
