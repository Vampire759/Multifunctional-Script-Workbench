# ============================================================
# Multifunctional Script Workbench - Dockerfile
# 多阶段构建：前端构建 + 后端运行时
# 适用于裸环境部署（仅需 Docker 即可运行）
# ============================================================

# ============================================================
# Stage 1: 构建前端
# ============================================================
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# 安装依赖（利用 Docker 缓存层加速构建）
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund

# 构建前端产物
COPY frontend/ .
RUN npx vite build

# ============================================================
# Stage 2: 运行时镜像
# ============================================================
FROM python:3.11-slim

LABEL maintainer="Workbench Team"
LABEL description="Multifunctional Script Workbench - 智能任务管理系统"
LABEL version="1.0.0"

WORKDIR /app

# ------------------------------------------------------------
# 安装系统依赖（涵盖裸环境所需的所有工具）
# ------------------------------------------------------------
# 基础工具：
#   - screen:        Screen 会话管理（核心功能）
#   - bash:          Bash Shell（交互式会话）
#   - git:           Git 版本控制
#   - procps:        进程管理工具（ps, top, kill 等）
#   - locales:       区域设置（支持 UTF-8 中文）
#   - curl:          网络请求工具（健康检查 + 下载）
#   - bsdmainutils:  包含 script 命令（用于实时日志记录）
#
# 网络与安全：
#   - ca-certificates: CA 证书（HTTPS 请求必需）
#   - openssh-client:  SSH 客户端（Git SSH 协议 + 远程操作）
#   - wget:            备用下载工具
#
# 文件与编辑：
#   - vim:    文本编辑器
#   - less:   分页查看器
#   - file:   文件类型检测
#   - unzip:  ZIP 解压
#   - tar:    归档工具（slim 镜像通常已含）
#   - gzip:   压缩工具
#
# 系统与时间：
#   - tzdata: 时区数据（支持中文时区 Asia/Shanghai）
#
# 构建依赖（部分 Python 包需要编译）：
#   - build-essential: gcc/g++/make
#   - python3-dev:     Python 开发头文件
#   - libffi-dev:      cffi 库依赖
#   - libssl-dev:      SSL 开发库
RUN apt-get update && apt-get install -y --no-install-recommends \
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
# 配置 UTF-8 区域设置（支持中文显示）
# ------------------------------------------------------------
RUN sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && sed -i 's/# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    TZ=Asia/Shanghai

# 配置时区
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# ------------------------------------------------------------
# 升级 pip 并安装 Python 依赖
# ------------------------------------------------------------
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

# ------------------------------------------------------------
# 复制前端构建产物
# ------------------------------------------------------------
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# ------------------------------------------------------------
# 复制后端代码
# ------------------------------------------------------------
COPY backend/ ./backend/

# ------------------------------------------------------------
# 复制脚本目录（如果存在）
# ------------------------------------------------------------
COPY scripts/ ./scripts/

# ------------------------------------------------------------
# 创建必要的目录
# ------------------------------------------------------------
# - data:             数据库和数据文件
# - logs:             日志文件
# - downloads:        下载文件
# - /app/screen_sockets: Screen 会话 socket 目录（必须 700 权限）
RUN mkdir -p data logs scripts downloads /app/screen_sockets \
    && chmod 700 /app/screen_sockets

# Screen 环境变量（必须指向自定义目录，避免系统默认目录权限问题）
ENV SCREENDIR=/app/screen_sockets

# ------------------------------------------------------------
# 健康检查
# ------------------------------------------------------------
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# ------------------------------------------------------------
# 启动命令
# ------------------------------------------------------------
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
