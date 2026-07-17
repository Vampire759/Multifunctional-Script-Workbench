# 工作台（Workbench）

> 智能任务管理系统 - 基于 FastAPI + React 的一站式任务管理工作台

[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://www.docker.com/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-yellow.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [部署方式](#部署方式)
  - [Docker 部署（推荐）](#docker-部署推荐)
  - [手动部署](#手动部署)
  - [宿主机 Screen 代理（可选）](#宿主机-screen-代理可选)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [目录结构](#目录结构)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 项目简介

**工作台（Workbench）** 是一个功能强大的智能任务管理系统，集成了任务调度、Screen 会话管理、脚本执行、日志中心等核心功能。采用前后端分离架构，后端基于 FastAPI 构建，前端使用 React + TypeScript 开发，通过 Docker 实现一键部署。

无论是需要管理定时爬虫任务、远程终端会话，还是自动化脚本执行，工作台都能为你提供统一的管理界面和完善的监控能力。

---

## 功能特性

### 🏃 任务台
- 创建和管理各种类型的任务
- 实时查看任务状态和输出
- 支持任务的启动、停止、重启操作

### ⏰ 定时任务
- 基于 Cron 表达式的灵活调度
- 支持关联任务、Screen 会话或脚本
- 调度历史记录查看

### 📥 下载管理
- 集中管理下载任务
- 实时下载进度监控
- 下载历史记录

### 📜 日志中心
- **会话管理** - 管理容器内的 Screen 会话
- **历史日志** - 按会话分组查看历史日志
- **实时日志** - WebSocket 实时推送日志
- **日志导出** - 一键导出日志文件
- **日志分组** - 按会话智能分组管理

#### 🔧 技术实现细节
日志系统采用 `script -f` 命令实时记录终端输出（替代 screen 原生 log 功能，后者在 Docker 容器环境中存在写入问题），配合后台广播线程逐行读取日志文件并通过 WebSocket 推送到前端：
- **日志采集**：`script -f` 命令随 screen 会话启动，实时将终端输出写入日志文件（UTF-8 编码，支持中文）
- **实时推送**：后台异步线程以 1 秒间隔增量读取日志文件，通过 WebSocket Hub 广播给所有订阅客户端
- **内容清洗**：自动移除 ANSI 转义码、控制字符，确保日志内容干净可读
- **历史日志**：按会话分组存储在 `logs/{session_name}/` 目录下，支持分页浏览和下载

### 📝 脚本管理
- 上传和管理 Python 脚本
- 在线执行脚本
- **自动安装脚本依赖**（详见下方说明）
- 脚本执行历史记录

#### ✨ 自动安装 Python 依赖

执行脚本时，系统会自动扫描脚本中的 `import` 语句，并智能识别和安装缺失的第三方依赖：

- **标准库识别**：内置 200+ Python 标准库白名单（os, sys, json, re 等），自动跳过
- **包名映射**：常见模块名自动映射到 pip 包名，例如：
  - `bs4` → `beautifulsoup4`
  - `PIL` → `Pillow`
  - `cv2` → `opencv-python`
  - `yaml` → `PyYAML`
  - `sklearn` → `scikit-learn`
  - `dateutil` → `python-dateutil`
  - `dotenv` → `python-dotenv`
  - `jwt` → `PyJWT`
- **已安装跳过**：已安装的包不会重复安装
- **批量安装**：缺失依赖一次性批量安装，超时保护 120 秒
- **执行反馈**：返回实际安装的依赖列表，前端显示安装结果

> 💡 你也可以在脚本中使用 `try/except ImportError` 配合 `os.system("pip install xxx")` 的方式实现运行时自动安装。

### 🖥️ 本地 Screen 监控
- 监控宿主机上的 Screen 会话
- 实时查看会话输出
- 向会话发送命令
- 自动保存会话日志到日志中心
- 支持中文字符正确显示

### ⚙️ 任务管理
- 全局任务配置
- 任务模板管理

### 👤 个人设置
- 用户信息管理
- 系统偏好设置

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器客户端                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ 任务台页面   │  │ 日志中心     │  │ 本地Screen   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / WebSocket
┌──────────────────────────────▼──────────────────────────────┐
│                     Docker 容器内                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  FastAPI 后端 (Python 3.11)                          │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐    │  │
│  │  │  API    │  │ WebSocket│  │ 定时任务调度器   │    │  │
│  │  └─────────┘  └──────────┘  └──────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │              Screen 会话管理                    │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  前端静态文件 (React + Vite 构建)                     │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌────────────┐  ┌───────────┐  ┌─────────────────────┐  │
│  │ SQLite 数据库 │  │ 日志目录  │  │ scripts/ 脚本目录   │  │
│  └────────────┘  └───────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                      宿主机（可选）                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Host Screen Agent (port 3001)                       │  │
│  │  - 管理宿主机上的 Screen 会话                         │  │
│  │  - 实时获取会话日志                                   │  │
│  │  - 向会话发送命令                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

**后端：**
- FastAPI - 现代、高性能的 Python Web 框架
- SQLAlchemy - Python ORM 工具包
- APScheduler - 定时任务调度
- WebSocket - 实时通信
- Python-JOSE - JWT 认证

**前端：**
- React 18 - 用户界面库
- TypeScript - 类型安全
- Vite - 前端构建工具
- Tailwind CSS - 原子化 CSS 框架
- Framer Motion - 动画库
- Lucide React - 图标库
- Zustand - 状态管理

**部署：**
- Docker - 容器化部署
- Docker Compose - 容器编排

---

## 快速开始

### 环境要求

- **Docker** >= 20.10
- **Docker Compose** >= 2.0
- **Git**（可选，用于克隆代码）

### 一键启动（裸环境零依赖部署）

> 🎯 **零依赖部署**：即使你的服务器什么都没装（没有 Docker、没有 Git、没有 curl），只要能联网，运行下面这一条命令即可完成全部部署！

```bash
# 克隆项目（如果没有 git，脚本会自动安装）
git clone <your-repo-url>
cd workbench

# 赋予执行权限并运行智能部署脚本
chmod +x deploy_smart.sh
./deploy_smart.sh
```

`deploy_smart.sh` 会自动完成以下工作：
1. **检测操作系统**（Ubuntu/Debian/CentOS/RHEL/Fedora/Rocky/AlmaLinux）
2. **检查并安装 curl**（如果缺失）
3. **检查并安装 Git**（如果缺失）
4. **检查并安装 Docker**（如果缺失，从官方源安装）
5. **检查并安装 Docker Compose**（如果缺失，安装 v2 插件或独立版本）
6. **准备目录结构**（data/ logs/ scripts/ downloads/）
7. **构建镜像并启动服务**
8. **验证服务健康状态**

> 💡 脚本采用「**有的环境跳过，没有的环境安装**」策略，重复运行也安全。需要 sudo 权限来安装系统级依赖。

服务启动后，访问 [http://localhost:3000](http://localhost:3000) 即可使用。

### 默认账号

| 用户名 | 密码 |
|--------|------|
| `admin` | `admin123` |

> ⚠️ **安全提示**：首次登录后请立即修改默认密码！

---

## 部署方式

### Docker 部署（推荐）

Docker 部署是最简单、最快速的方式，所有依赖都已打包在镜像中。

#### 方式 A：智能部署脚本（推荐，适合裸环境）

```bash
chmod +x deploy_smart.sh
./deploy_smart.sh
```

脚本会自动检测并安装所有缺失的依赖（Docker、Docker Compose、Git、curl），然后构建并启动服务。详见上文 [一键启动](#一键启动裸环境零依赖部署)。

#### 方式 B：手动 Docker 部署（已有 Docker 环境）

##### 1. 准备工作

确保已安装 Docker 和 Docker Compose：

```bash
docker --version
docker compose version
```

如果没有安装，请参考 [Docker 官方文档](https://docs.docker.com/get-docker/) 进行安装，或直接使用本项目的 `deploy_smart.sh` 自动安装。

##### 2. 获取代码

```bash
git clone <your-repo-url>
cd workbench
```

##### 3. 配置环境变量（可选）

编辑 `docker-compose.yml` 文件，修改以下环境变量：

```yaml
environment:
  - SECRET_KEY=your_secure_random_key_here  # 建议修改为随机字符串
  - API_KEY=your_api_key_here               # API 密钥
  - LOG_LEVEL=info                          # 日志级别: debug, info, warning, error
```

##### 4. 启动服务

```bash
# 构建并启动
docker compose up -d --build

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

##### 5. 验证服务

```bash
# 检查健康状态
curl http://localhost:3000/health

# 返回示例: {"status":"ok"}
```

##### 6. 停止服务

```bash
# 停止服务
docker compose down

# 停止服务并删除数据卷（⚠️ 会丢失所有数据）
docker compose down -v
```

##### 7. 更新版本

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose up -d --build
```

### 手动部署

如果你想在本地直接运行（不使用 Docker），可以按以下步骤操作。

#### 前置依赖

- Python >= 3.11
- Node.js >= 18
- npm 或 yarn
- screen
- bsdmainutils（包含 script 命令，用于日志记录）

#### 1. 安装后端依赖

```bash
# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# 或
.venv\Scripts\activate     # Windows

# 安装 Python 依赖
pip install -r requirements.txt
```

#### 2. 安装前端依赖并构建

```bash
cd frontend
npm install
npm run build
cd ..
```

#### 3. 创建必要的目录

```bash
mkdir -p data logs scripts downloads
```

#### 4. 启动服务

```bash
# 启动后端服务
uvicorn backend.main:app --host 0.0.0.0 --port 3000
```

服务启动后访问 [http://localhost:3000](http://localhost:3000)。

### 宿主机 Screen 代理（可选）

如果你想监控和操作宿主机上的 Screen 会话，需要在宿主机上启动 `host_screen_agent.py`。

#### 1. 启动代理

```bash
# 直接运行
python3 host_screen_agent.py

# 或后台运行
nohup python3 host_screen_agent.py > /tmp/host_agent.log 2>&1 &
```

代理默认监听 `0.0.0.0:3001`。

#### 2. 验证代理

```bash
curl http://localhost:3001/list

# 返回示例: {"success": true, "data": [...]}
```

#### 3. 配置 Docker 容器连接代理

`docker-compose.yml` 中已配置 `extra_hosts`，容器内可以通过 `host.docker.internal:3001` 访问宿主机代理，无需额外配置。

#### 4. 设置开机自启（可选）

创建 systemd 服务：

```ini
# /etc/systemd/system/workbench-agent.service
[Unit]
Description=Workbench Host Screen Agent
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/path/to/workbench
ExecStart=/usr/bin/python3 host_screen_agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable workbench-agent
sudo systemctl start workbench-agent
```

---

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SECRET_KEY` | `change_me_to_a_random_string` | JWT 签名密钥，**生产环境必须修改** |
| `API_KEY` | `your_api_key_here` | API 访问密钥 |
| `LOG_LEVEL` | `info` | 日志级别：`debug`, `info`, `warning`, `error`, `critical` |
| `SCREENDIR` | `/app/screen_sockets` | Screen 会话 socket 目录 |
| `PYTHONUNBUFFERED` | `1` | Python 输出不缓冲 |

### 端口说明

| 端口 | 服务 | 说明 |
|------|------|------|
| `3000` | 主应用 | 前端页面 + API 接口（容器内 8000） |
| `3001` | Host Screen Agent | 宿主机 Screen 代理（可选，宿主机上运行） |

---

## API 文档

启动服务后，访问以下地址查看 API 文档：

- **Swagger UI**: http://localhost:3000/docs
- **ReDoc**: http://localhost:3000/redoc

### 主要 API 接口

#### 认证
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `GET /api/auth/me` - 获取当前用户信息

#### 任务管理
- `GET /api/screen/list` - 获取 Screen 会话列表
- `POST /api/screen/create` - 创建 Screen 会话
- `POST /api/screen/stop/{name}` - 停止 Screen 会话
- `DELETE /api/screen/{name}` - 删除 Screen 会话
- `GET /api/screen/{name}/log` - 获取会话日志

#### 定时任务
- `GET /api/scheduler/jobs` - 获取定时任务列表
- `POST /api/scheduler/jobs` - 创建定时任务
- `PUT /api/scheduler/jobs/{id}` - 更新定时任务
- `DELETE /api/scheduler/jobs/{id}` - 删除定时任务

#### 脚本管理
- `GET /api/scripts` - 获取脚本列表
- `POST /api/scripts/upload` - 上传脚本
- `POST /api/scripts/{id}/run` - 执行脚本

#### 本地 Screen（宿主机）
- `GET /api/local-screen/list` - 获取宿主机 Screen 会话列表
- `POST /api/local-screen/create` - 创建宿主机 Screen 会话
- `POST /api/local-screen/stop/{name}` - 停止宿主机 Screen 会话
- `GET /api/local-screen/log/{name}` - 获取宿主机会话日志
- `WS /api/local-screen/ws/{name}` - 宿主机会话 WebSocket

#### 日志中心
- `GET /api/logs/files` - 获取日志文件列表
- `GET /api/logs/{filename}` - 读取日志文件内容
- `DELETE /api/logs/{filename}` - 删除日志文件

---

## 目录结构

```
workbench/
├── backend/                    # 后端代码
│   ├── main.py                # FastAPI 应用入口
│   ├── config.py              # 配置文件
│   ├── database.py            # 数据库连接
│   ├── models/                # 数据模型
│   ├── schemas/               # Pydantic 模式
│   ├── routers/               # API 路由
│   │   ├── auth.py           # 认证相关
│   │   ├── screen.py         # Screen 会话管理
│   │   ├── local_screen.py   # 宿主机 Screen 代理
│   │   ├── scheduler.py      # 定时任务
│   │   ├── logs.py           # 日志管理
│   │   └── ...
│   ├── services/              # 业务逻辑
│   │   ├── screen_service.py # Screen 服务
│   │   └── ...
│   └── utils/                 # 工具函数
│
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   │   ├── Dashboard.tsx     # 任务台
│   │   │   ├── LogCenter.tsx     # 日志中心
│   │   │   ├── LocalScreen.tsx   # 本地Screen
│   │   │   └── ...
│   │   ├── components/       # 公共组件
│   │   ├── stores/           # 状态管理
│   │   ├── lib/              # 工具库
│   │   └── ...
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── scripts/                    # 用户脚本目录
│   └── ...
│
├── data/                       # 数据目录（运行时生成）
│   └── db.sqlite3            # SQLite 数据库
│
├── logs/                       # 日志目录（运行时生成）
│   └── ...
│
├── downloads/                  # 下载目录（运行时生成）
│   └── ...
│
├── host_screen_agent.py       # 宿主机 Screen 代理（可选）
├── Dockerfile                 # Docker 镜像构建文件（多阶段构建）
├── docker-compose.yml         # Docker Compose 配置
├── requirements.txt           # Python 依赖
├── .dockerignore              # Docker 忽略文件
├── deploy_smart.sh            # 🌟 智能部署脚本（裸环境一键部署，自动安装 Docker/Git 等）
├── deploy.sh                  # Linux 部署脚本
├── deploy_linux.sh            # Linux 部署脚本（备用）
├── deploy.bat                 # Windows 部署脚本
└── README.md                  # 项目说明文档
```

---

## 常见问题

### Q1: 如何修改默认密码？

登录后进入「个人设置」页面修改密码，或通过 API 修改：

```bash
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Content-Type: application/json" \
  -d '{"old_password": "admin123", "new_password": "your_new_password"}'
```

### Q2: Screen 会话创建失败怎么办？

1. 检查容器内 screen 是否正常安装：
   ```bash
   docker compose exec app screen --version
   ```

2. 检查目录权限：
   ```bash
   docker compose exec app ls -la /app/screen_sockets
   ```

3. 查看后端日志：
   ```bash
   docker compose logs app | grep -i error
   ```

### Q3: 中文字符显示乱码？

1. 确保使用最新版本的镜像（已配置 UTF-8 区域设置）
2. 对于宿主机 Screen 会话，确保系统 locale 为 UTF-8
3. 查看 [LocalScreen 页面](#) 上的中文显示是否正常

### Q4: 如何备份数据？

所有数据都保存在 `data/` 和 `logs/` 目录中，直接备份这两个目录即可：

```bash
# 备份
tar -czf workbench-backup-$(date +%Y%m%d).tar.gz data/ logs/ scripts/

# 恢复
tar -xzf workbench-backup-YYYYMMDD.tar.gz
docker compose restart
```

### Q5: 如何修改端口？

编辑 `docker-compose.yml`：

```yaml
ports:
  - "3000:8000"  # 修改左侧的端口号，如 "8080:8000"
```

然后重启服务：

```bash
docker compose up -d
```

### Q6: 宿主机 Screen 会话连不上？

1. 确认 `host_screen_agent.py` 是否在运行：
   ```bash
   ps aux | grep host_screen_agent
   ```

2. 检查 3001 端口是否监听：
   ```bash
   lsof -i :3001
   ```

3. 测试代理是否可用：
   ```bash
   curl http://localhost:3001/list
   ```

### Q7: 日志文件在哪里？

- **容器内 Screen 会话日志**: `logs/` 目录下
- **宿主机 Screen 会话日志**: `logs/local_{session_name}/` 目录下
- **后端服务日志**: `docker compose logs app`

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发环境搭建

```bash
# 1. 克隆仓库
git clone <your-repo-url>
cd workbench

# 2. 安装后端依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 安装前端依赖
cd frontend
npm install
cd ..

# 4. 启动后端
uvicorn backend.main:app --reload --port 8000

# 5. 启动前端开发服务器（另开一个终端）
cd frontend
npm run dev
```

### 代码规范

- Python: 遵循 PEP 8 规范
- TypeScript: 使用 ESLint 检查
- 提交信息: 使用中文描述，简洁明了

---

## 许可证

[MIT License](LICENSE)

---

## 联系方式

如有问题或建议，欢迎提交 Issue。

---

**Enjoy your workbench! 🚀**
