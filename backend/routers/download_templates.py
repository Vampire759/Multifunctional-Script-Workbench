"""下载任务模板 API 路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from backend.database import get_db
from backend.models import DownloadTemplate
from backend.schemas import GenericResp

router = APIRouter(prefix="/api/download-templates", tags=["download-templates"])


@router.get("", response_model=list[dict])
def list_templates(db: Session = Depends(get_db)):
    """获取下载模板列表"""
    templates = db.query(DownloadTemplate).options(joinedload(DownloadTemplate.script)).order_by(DownloadTemplate.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "script_id": t.script_id,
            "script_name": t.script.name if t.script else None,
            "command_format": t.command_format,
            "output_format": t.output_format,
            "push_format": t.push_format,
            "custom_command": t.custom_command,
            "description": t.description,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in templates
    ]


@router.post("", response_model=GenericResp)
def create_template(
    name: str,
    script_id: int | None = None,
    command_format: str = "",
    output_format: str = "",
    push_format: str = "",
    custom_command: str = "",
    description: str = "",
    db: Session = Depends(get_db),
):
    """创建下载模板"""
    if not name.strip():
        raise HTTPException(status_code=400, detail="模板名称必填")

    template = DownloadTemplate(
        name=name.strip(),
        script_id=script_id,
        command_format=command_format,
        output_format=output_format,
        push_format=push_format,
        custom_command=custom_command,
        description=description,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return GenericResp(success=True, message="模板已创建", data={"template_id": template.id})


@router.put("/{template_id}", response_model=GenericResp)
def update_template(
    template_id: int,
    name: str | None = None,
    script_id: int | None = None,
    command_format: str | None = None,
    output_format: str | None = None,
    push_format: str | None = None,
    custom_command: str | None = None,
    description: str | None = None,
    db: Session = Depends(get_db),
):
    """更新下载模板"""
    template = db.query(DownloadTemplate).filter(DownloadTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")

    if name is not None:
        template.name = name.strip()
    if script_id is not None:
        template.script_id = script_id
    if command_format is not None:
        template.command_format = command_format
    if output_format is not None:
        template.output_format = output_format
    if push_format is not None:
        template.push_format = push_format
    if custom_command is not None:
        template.custom_command = custom_command
    if description is not None:
        template.description = description

    db.commit()
    return GenericResp(success=True, message="模板已更新")


@router.delete("/{template_id}", response_model=GenericResp)
def delete_template(template_id: int, db: Session = Depends(get_db)):
    """删除下载模板"""
    template = db.query(DownloadTemplate).filter(DownloadTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")

    db.delete(template)
    db.commit()
    return GenericResp(success=True, message="模板已删除")