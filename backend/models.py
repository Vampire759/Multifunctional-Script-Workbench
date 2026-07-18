"""SQLAlchemy ORM 模型"""
from datetime import datetime
from sqlalchemy import Column, Integer, Text, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from backend.database import Base


class Task(Base):
    """任务（爬虫 / 指令）"""
    __tablename__ = "task"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False, default="scrape")  # scrape | command
    script_id = Column(Integer, ForeignKey("script.id"))     # 关联脚本
    urls = Column(Text)            # JSON 数组, type=scrape
    command = Column(Text)         # shell 指令, type=command
    max_workers = Column(Integer, default=5)
    webhook_url = Column(Text)
    webhook_headers = Column(Text)  # JSON
    push_time = Column(String)      # 推送时间（cron表达式）
    created_at = Column(DateTime, default=datetime.utcnow)

    schedules = relationship("Schedule", back_populates="task", cascade="all, delete-orphan")
    jobs = relationship("ScrapeJob", back_populates="task")
    script = relationship("Script")


class Schedule(Base):
    """定时任务"""
    __tablename__ = "schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    cron_expr = Column(String, nullable=False)
    target_type = Column(String, nullable=False, default="task")  # task | screen | script
    target_id = Column(Integer, ForeignKey("task.id", ondelete="CASCADE"), nullable=True)
    screen_name = Column(String, nullable=True)
    screen_source = Column(String, nullable=True)  # container | local
    script_id = Column(Integer, ForeignKey("script.id", ondelete="CASCADE"), nullable=True)
    command = Column(Text)
    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime)
    next_run_at = Column(DateTime)

    task = relationship("Task", back_populates="schedules")
    script = relationship("Script")


class ScrapeJob(Base):
    """一次执行（爬虫/指令）"""
    __tablename__ = "scrape_job"

    job_id = Column(String, primary_key=True)
    task_id = Column(Integer, ForeignKey("task.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending|running|success|failed
    total = Column(Integer, default=0)
    completed = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime)
    error = Column(Text)
    # 指令任务输出
    output = Column(Text)

    task = relationship("Task", back_populates="jobs")
    results = relationship("VideoResult", back_populates="job", cascade="all, delete-orphan")


class VideoResult(Base):
    """视频结果（仅爬虫任务产生）"""
    __tablename__ = "video_result"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String, ForeignKey("scrape_job.job_id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(Text)
    url = Column(Text, nullable=False)
    source_url = Column(Text, nullable=False)
    collected_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("ScrapeJob", back_populates="results")


class DownloadTask(Base):
    """下载任务（调用 yt-dlp）"""
    __tablename__ = "download_task"

    id = Column(Integer, primary_key=True, autoincrement=True)
    video_url = Column(Text)
    source_url = Column(Text)
    script_id = Column(Integer, ForeignKey("script.id"))
    command = Column(Text)
    title = Column(Text)
    filename = Column(Text)
    status = Column(String, nullable=False, default="pending")  # pending|running|success|failed|retrying
    progress = Column(Integer, default=0)
    speed = Column(String)
    eta = Column(String)
    downloaded_bytes = Column(Integer, default=0)
    total_bytes = Column(Integer, default=0)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    error = Column(Text)
    output_path = Column(Text)
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    script = relationship("Script")


class ScreenTask(Base):
    """Screen 会话任务"""
    __tablename__ = "screen_task"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False)
    command = Column(Text)
    status = Column(String, nullable=False, default="pending")
    log_path = Column(Text)
    error = Column(Text)
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class Script(Base):
    """Python 脚本模板"""
    __tablename__ = "script"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    filename = Column(String, unique=True, nullable=False)
    content = Column(Text, nullable=False)
    description = Column(Text)
    status = Column(String, nullable=False, default="draft")  # draft|active
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class User(Base):
    """用户模型"""
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
