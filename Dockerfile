# ============================================================
# Stage 1: 构建前端
# ============================================================
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# 安装依赖（利用 Docker 缓存）
COPY frontend/package*.json ./
RUN npm install

# 构建前端
COPY frontend/ .
RUN npx vite build

# ============================================================
# Stage 2: 运行时镜像
# ============================================================
FROM python:3.11-slim

LABEL maintainer="Workbench Team"
LABEL description="工作台 - 智能任务管理系统"
LABEL version="1.0.0"

WORKDIR /app

# 安装系统依赖
# - screen: Screen 会话管理
# - bash: Bash Shell
# - git: Git 版本控制
# - procps: 进程管理工具
# - locales: 区域设置（支持 UTF-8 中文）
# - curl: 网络请求工具
# - bsdmainutils: 包含 script 命令（用于日志记录）
RUN apt-get update && apt-get install -y --no-install-recommends \
    screen \
    bash \
    git \
    procps \
    locales \
    curl \
    bsdmainutils \
    && rm -rf /var/lib/apt/lists/*

# 配置 UTF-8 区域设置
RUN sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制前端构建产物
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# 复制后端代码
COPY backend/ ./backend/

# 复制脚本目录（如果存在）
COPY scripts/ ./scripts/

# 创建必要的目录
# - data: 数据库和数据文件
# - logs: 日志文件
# - downloads: 下载文件
# - /app/screen_sockets: Screen 会话 socket 目录
RUN mkdir -p data logs scripts downloads /app/screen_sockets \
    && chmod 755 /app/screen_sockets

# Screen 环境变量
ENV SCREENDIR=/app/screen_sockets

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# 启动命令
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
