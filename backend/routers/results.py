"""结果查询与导出路由"""
import csv
import io
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import VideoResult, ScrapeJob
from backend.schemas import ResultPage, VideoResultOut

router = APIRouter(prefix="/api/results", tags=["results"])


@router.get("", response_model=ResultPage)
def list_results(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    job_id: str | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(VideoResult)
    if job_id:
        q = q.filter(VideoResult.job_id == job_id)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (VideoResult.title.like(like)) | (VideoResult.url.like(like)) | (VideoResult.source_url.like(like))
        )

    total = q.count()
    items = (
        q.order_by(VideoResult.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ResultPage(
        items=[VideoResultOut.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db)):
    """列出所有执行记录（用于结果中心筛选）"""
    jobs = db.query(ScrapeJob).order_by(ScrapeJob.started_at.desc()).limit(100).all()
    return [
        {
            "job_id": j.job_id,
            "task_id": j.task_id,
            "status": j.status,
            "total": j.total,
            "completed": j.completed,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        }
        for j in jobs
    ]


def _stream_text(items):
    buf = io.StringIO()
    for i, r in enumerate(items, 1):
        title = r.title or ""
        if title:
            buf.write(f"{i} {title} {r.url}\n")
        else:
            buf.write(f"{i} {r.url}\n")
    return buf.getvalue().encode("utf-8")


@router.get("/export")
def export_results(
    format: str = Query("txt", pattern="^(txt|json|csv)$"),
    job_id: str | None = None,
    keyword: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(VideoResult)
    if job_id:
        q = q.filter(VideoResult.job_id == job_id)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter(
            (VideoResult.title.like(like)) | (VideoResult.url.like(like)) | (VideoResult.source_url.like(like))
        )
    items = q.order_by(VideoResult.id.asc()).all()

    if format == "txt":
        content = _stream_text(items)
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=results.txt"},
        )
    elif format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["seq", "title", "url", "source_url", "collected_at"])
        for i, r in enumerate(items, 1):
            writer.writerow([i, r.title or "", r.url, r.source_url, r.collected_at.isoformat() if r.collected_at else ""])
        return StreamingResponse(
            io.BytesIO(buf.getvalue().encode("utf-8-sig")),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=results.csv"},
        )
    else:  # json
        data = [
            {
                "seq": i,
                "title": r.title,
                "url": r.url,
                "source_url": r.source_url,
                "collected_at": r.collected_at.isoformat() if r.collected_at else None,
            }
            for i, r in enumerate(items, 1)
        ]
        content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=results.json"},
        )
