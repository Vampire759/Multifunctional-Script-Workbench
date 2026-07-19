"""FastAPI entry: register routes, start scheduler, serve frontend static files"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

from backend.database import init_db
from backend.services.scheduler_service import start_scheduler, shutdown_scheduler
from backend.services.auth_service import init_admin_user
from backend.routers import scrape, tasks, schedules, results, downloads, auth, screen, scripts, terminal, local_screen, packages, download_templates, docker_monitor, docker_push

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    from backend.database import SessionLocal
    with SessionLocal() as db:
        init_admin_user(db)
    
    import logging
    logging.basicConfig(level=logging.DEBUG)
    
    from backend.services.screen_service import list_screens, _active_broadcasters, _broadcast_log, get_session_log_path, start_health_check
    screens = await list_screens()
    print(f"[App] Found {len(screens)} screen sessions: {[s['name'] for s in screens]}")
    start_health_check()
    for screen_info in screens:
        session_name = screen_info["name"]
        log_path = get_session_log_path(session_name)
        if session_name not in _active_broadcasters or _active_broadcasters[session_name].done():
            task = __import__('asyncio').create_task(_broadcast_log(session_name, log_path))
            _active_broadcasters[session_name] = task
            print(f"[App] Started broadcast for screen session: {session_name}, task={task}")
        else:
            print(f"[App] Broadcast already running for: {session_name}")
    
    print("[App] Started: DB initialized, scheduler started, admin user created")
    yield
    shutdown_scheduler()
    print("[App] Shutdown complete")


app = FastAPI(
    title="Video Scraper Scheduler",
    description="Web-based video scraping and scheduling platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"[Router] Including scrape: {len(scrape.router.routes)} routes")
app.include_router(scrape.router)
print(f"[Router] Including tasks: {len(tasks.router.routes)} routes")
app.include_router(tasks.router)
print(f"[Router] Including schedules: {len(schedules.router.routes)} routes")
app.include_router(schedules.router)
print(f"[Router] Including results: {len(results.router.routes)} routes")
app.include_router(results.router)
print(f"[Router] Including downloads: {len(downloads.router.routes)} routes")
app.include_router(downloads.router)
print(f"[Router] Including download_templates: {len(download_templates.router.routes)} routes")
app.include_router(download_templates.router)
print(f"[Router] Including docker_monitor: {len(docker_monitor.router.routes)} routes")
app.include_router(docker_monitor.router)
print(f"[Router] Including auth: {len(auth.router.routes)} routes")
app.include_router(auth.router)
print(f"[Router] Including screen: {len(screen.router.routes)} routes")
app.include_router(screen.router)
print(f"[Router] Including scripts: {len(scripts.router.routes)} routes")
app.include_router(scripts.router)
print(f"[Router] Including terminal: {len(terminal.router.routes)} routes")
app.include_router(terminal.router)
print(f"[Router] Including local_screen: {len(local_screen.router.routes)} routes")
app.include_router(local_screen.router)
print(f"[Router] Including packages: {len(packages.router.routes)} routes")
app.include_router(packages.router)
print(f"[Router] Including docker_push: {len(docker_push.router.routes)} routes")
app.include_router(docker_push.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/stats")
def stats():
    from backend.database import SessionLocal
    from backend.models import ScrapeJob, VideoResult
    db = SessionLocal()
    try:
        running = db.query(ScrapeJob).filter(ScrapeJob.status == "running").count()
        success = db.query(ScrapeJob).filter(ScrapeJob.status == "success").count()
        failed = db.query(ScrapeJob).filter(ScrapeJob.status == "failed").count()
        total_videos = db.query(VideoResult).count()
        return {
            "running": running,
            "success": success,
            "failed": failed,
            "total_videos": total_videos,
        }
    finally:
        db.close()


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="frontend-assets")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(str(FRONTEND_DIST / "favicon.svg"))

    @app.get("/")
    async def serve_root():
        index_path = FRONTEND_DIST / "index.html"
        resp = FileResponse(str(index_path), media_type="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        index_path = FRONTEND_DIST / "index.html"
        resp = FileResponse(str(index_path), media_type="text/html")
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp
    
    print(f"[App] Frontend static files mounted: {FRONTEND_DIST}")
else:
    @app.get("/")
    def root():
        return {
            "message": "Video Scraper Scheduler API",
            "docs": "/docs",
            "frontend": "Not built yet, run 'npm run build' in frontend directory",
        }
