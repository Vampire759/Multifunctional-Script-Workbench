# ============================================================
# Multifunctional Script Workbench - Dockerfile
# 使用宿主机预构建的前端产物，避免Docker内部npm网络问题
# 添加环境检查和缓存优化，减少重复构建时间
# ============================================================

# ============================================================
# 运行时镜像（单阶段构建，前端已在宿主机构建）
# ============================================================
FROM python:3.11-slim

LABEL maintainer="Workbench Team"
LABEL description="Multifunctional Script Workbench - 智能任务管理系统"
LABEL version="1.0.0"

WORKDIR /app

# ------------------------------------------------------------
# 系统依赖安装（使用条件检查，已安装则跳过）
# ------------------------------------------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        screen \
        bash \
        git \
        procps \
        locales \
        curl \
        bsdmainutils \
        ca-certificates \
        openssh-client \
        wget \
        vim \
        less \
        file \
        unzip \
        tar \
        gzip \
        tzdata \
        build-essential \
        python3-dev \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 配置环境变量（利用Docker缓存，不变则跳过后续步骤）
# ------------------------------------------------------------
ENV LANG=C.UTF-8 \
    LANGUAGE=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    TZ=Asia/Shanghai \
    SCREENDIR=/tmp/screen_sockets \
    LOG_LEVEL=info

# 配置时区
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ------------------------------------------------------------
# Python依赖安装（缓存优化：先复制requirements.txt）
# 如果requirements.txt不变，Docker会使用缓存跳过此步骤
# ------------------------------------------------------------
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# ------------------------------------------------------------
# 创建必要的目录
# ------------------------------------------------------------
RUN mkdir -p data logs scripts downloads \
    && chmod 700 /app \
    && mkdir -p /tmp/screen_sockets \
    && chmod 700 /tmp/screen_sockets

# ------------------------------------------------------------
# 复制预构建的前端产物（最后复制，最大化缓存利用）
# ------------------------------------------------------------
COPY frontend/dist ./frontend/dist

# ------------------------------------------------------------
# 复制后端代码
# ------------------------------------------------------------
COPY backend/ ./backend/

# ------------------------------------------------------------
# 复制脚本目录（如果存在）
# ------------------------------------------------------------
COPY scripts/ ./scripts/

# ------------------------------------------------------------
# 复制宿主机 Screen Agent
# ------------------------------------------------------------
COPY host_screen_agent.py ./host_screen_agent.py

# ------------------------------------------------------------
# 健康检查
# ------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

EXPOSE 8000

# ------------------------------------------------------------
# 启动命令
# ------------------------------------------------------------
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
