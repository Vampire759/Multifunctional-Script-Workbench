"""Pydantic 请求/响应模型"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ---------- 任务 ----------
class TaskBase(BaseModel):
    name: str
    type: str = Field("scrape", pattern="^(scrape|command)$")
    script_id: Optional[int] = None
    urls: Optional[List[str]] = None
    command: Optional[str] = None
    max_workers: int = 5
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None
    push_time: Optional[str] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = Field(None, pattern="^(scrape|command)$")
    script_id: Optional[int] = None
    urls: Optional[List[str]] = None
    command: Optional[str] = None
    max_workers: Optional[int] = None
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None
    push_time: Optional[str] = None


class TaskOut(TaskBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- 定时任务 ----------
class ScheduleBase(BaseModel):
    name: str
    cron_expr: str


class ScheduleCreate(ScheduleBase):
    target_type: str = Field("task", pattern="^(task|screen|script)$")
    target_id: Optional[int] = None
    screen_name: Optional[str] = None
    screen_source: Optional[str] = None
    script_id: Optional[int] = None
    command: Optional[str] = None
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    cron_expr: Optional[str] = None
    target_type: Optional[str] = Field(None, pattern="^(task|screen|script)$")
    target_id: Optional[int] = None
    screen_name: Optional[str] = None
    screen_source: Optional[str] = None
    script_id: Optional[int] = None
    command: Optional[str] = None
    enabled: Optional[bool] = None


class ScheduleOut(ScheduleBase):
    id: int
    target_type: str
    target_id: Optional[int] = None
    screen_name: Optional[str] = None
    screen_source: Optional[str] = None
    script_id: Optional[int] = None
    command: Optional[str] = None
    enabled: bool
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- 执行 ----------
class ScrapeRequest(BaseModel):
    """立即执行（不持久化任务）"""
    urls: Optional[List[str]] = None
    command: Optional[str] = None
    type: str = Field("scrape", pattern="^(scrape|command)$")
    max_workers: int = 5
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None


class VideoResultOut(BaseModel):
    seq: int
    title: Optional[str] = None
    url: str
    source_url: str
    collected_at: datetime

    class Config:
        from_attributes = True


class ScrapeJobOut(BaseModel):
    job_id: str
    task_id: Optional[int] = None
    status: str
    total: int
    completed: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    output: Optional[str] = None
    results: List[VideoResultOut] = []

    class Config:
        from_attributes = True


# ---------- 结果查询 ----------
class ResultPage(BaseModel):
    items: List[VideoResultOut]
    total: int
    page: int
    page_size: int


# ---------- 通用 ----------
class GenericResp(BaseModel):
    success: bool = True
    message: str = ""
    data: Optional[Any] = None
