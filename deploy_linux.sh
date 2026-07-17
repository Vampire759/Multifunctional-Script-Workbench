#!/bin/bash
set -e

echo "============================================"
echo "  视频爬取调度平台 - Linux 一键部署脚本"
echo "============================================"
echo ""

PROJECT_DIR="/opt/video-spider"
GIT_URL="https://github.com/your-repo/video-spider.git"
BACKEND_PORT=8010

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${CYAN}[*] $1${NC}"; }
ok() { echo -e "${GREEN}[OK] $1${NC}"; }
warn() { echo -e "${YELLOW}[!] $1${NC}"; }
error() { echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

# 1. 检查 root
if [ "$(id -u)" != "0" ]; then
    warn "建议使用 root 用户运行，否则可能需要 sudo"
fi

# 2. 更新系统
info "更新系统包..."
apt-get update -y && apt-get upgrade -y

# 3. 安装依赖
info "安装基础依赖..."
apt-get install -y \
    python3 python3-venv python3-pip \
    nodejs npm \
    screen \
    curl wget git \
    ffmpeg

# 4. 安装 yt-dlp
info "安装 yt-dlp..."
pip3 install yt-dlp

# 5. 创建项目目录
info "创建项目目录..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# 6. 克隆代码（如果是新部署）
if [ ! -d ".git" ]; then
    info "克隆代码仓库..."
    git clone "$GIT_URL" .
else
    info "更新代码..."
    git pull
fi

# 7. 安装 Python 依赖
info "安装 Python 依赖..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt requests beautifulsoup4 lxml passlib[bcrypt] python-jose[cryptography]

# 8. 构建前端
info "构建前端..."
cd frontend
npm install
npm run build
cd ..

# 9. 创建 systemd 服务
info "创建 systemd 服务..."
cat > /etc/systemd/system/video-spider.service <<EOF
[Unit]
Description=Video Spider Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port $BACKEND_PORT
Restart=always
RestartSec=5
User=$(whoami)

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable video-spider
systemctl start video-spider

# 10. 防火墙设置
info "配置防火墙..."
if command -v ufw &> /dev/null; then
    ufw allow $BACKEND_PORT/tcp
    ufw reload
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=$BACKEND_PORT/tcp
    firewall-cmd --reload
fi

# 11. 初始化管理员用户（等待服务启动）
info "等待服务启动..."
sleep 10

# 12. 显示完成信息
echo ""
echo "============================================"
echo -e "  ${GREEN}部署完成！${NC}"
echo "============================================"
echo ""
echo "访问地址: http://$(hostname -I | awk '{print $1}'):$BACKEND_PORT"
echo "API 文档: http://$(hostname -I | awk '{print $1}'):$BACKEND_PORT/docs"
echo ""
echo "默认账号: admin / admin123"
echo ""
echo "管理命令:"
echo "  systemctl start video-spider    # 启动"
echo "  systemctl stop video-spider     # 停止"
echo "  systemctl restart video-spider  # 重启"
echo "  systemctl status video-spider   # 状态"
echo ""
echo "项目目录: $PROJECT_DIR"
echo "日志目录: $PROJECT_DIR/logs"
echo "下载目录: $PROJECT_DIR/downloads"
