#!/usr/bin/env bash
# ============================================================
# Multifunctional Script Workbench - 一键智能部署脚本
# 自动检测并安装缺失的环境依赖（Docker、Docker Compose）
# 适用于：Ubuntu / Debian / CentOS / RHEL / Fedora / Arch
# ============================================================
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目信息
PROJECT_NAME="Multifunctional Script Workbench"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
print_step()    { echo -e "\n${CYAN}=== $1 ===${NC}"; }

# ============================================================
# Step 1: 检测操作系统
# ============================================================
detect_os() {
    print_step "检测操作系统"
    
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID=$ID
        OS_LIKE=$ID_LIKE
        print_success "操作系统: $PRETTY_NAME"
    elif [ -f /etc/redhat-release ]; then
        OS_ID="rhel"
        print_success "操作系统: $(cat /etc/redhat-release)"
    else
        print_error "无法识别的操作系统，请手动安装依赖"
        exit 1
    fi
}

# ============================================================
# Step 2: 检查并安装 Docker
# ============================================================
install_docker() {
    print_step "检查 Docker"
    
    if command -v docker &> /dev/null; then
        print_success "Docker 已安装: $(docker --version)"
        return 0
    fi
    
    print_warn "Docker 未安装，开始自动安装..."
    
    # 获取 sudo 权限（如果需要）
    SUDO=""
    if [ "$EUID" -ne 0 ]; then
        SUDO="sudo"
        # 测试 sudo 权限
        if ! $SUDO -v 2>/dev/null; then
            print_error "需要 sudo 权限来安装 Docker，请使用 root 用户或配置 sudo"
            exit 1
        fi
    fi
    
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            print_info "使用 apt 包管理器安装 Docker..."
            $SUDO apt-get update
            $SUDO apt-get install -y ca-certificates curl gnupg lsb-release
            $SUDO mkdir -p /etc/apt/keyrings
            $SUDO rm -f /etc/apt/keyrings/docker.gpg
            curl -fsSL https://download.docker.com/linux/$ID/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg || true
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $(lsb_release -cs) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
            $SUDO apt-get update
            $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        centos|rhel|rocky|almalinux|fedora)
            print_info "使用 yum/dnf 包管理器安装 Docker..."
            $SUDO yum install -y yum-utils
            $SUDO yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            $SUDO yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        *)
            print_error "不支持的操作系统: $OS_ID"
            print_info "请参考官方文档手动安装 Docker: https://docs.docker.com/engine/install/"
            exit 1
            ;;
    esac
    
    # 启动并设置开机自启
    $SUDO systemctl enable docker
    $SUDO systemctl start docker
    
    # 将当前用户加入 docker 组
    if [ "$SUDO" != "" ]; then
        $SUDO usermod -aG docker $USER
        print_warn "已将用户 $USER 加入 docker 组，请重新登录或运行 'newgrp docker' 生效"
    fi
    
    if command -v docker &> /dev/null; then
        print_success "Docker 安装成功: $(docker --version)"
    else
        print_error "Docker 安装失败，请参考官方文档手动安装"
        exit 1
    fi
}

# ============================================================
# Step 3: 检查并安装 Docker Compose
# ============================================================
install_docker_compose() {
    print_step "检查 Docker Compose"
    
    # 优先使用 docker compose（v2 插件）
    if docker compose version &> /dev/null; then
        print_success "Docker Compose (plugin) 已安装: $(docker compose version)"
        return 0
    fi
    
    # 检查独立版本
    if command -v docker-compose &> /dev/null; then
        print_success "Docker Compose (standalone) 已安装: $(docker-compose --version)"
        return 0
    fi
    
    print_warn "Docker Compose 未安装，开始自动安装..."
    
    SUDO=""
    if [ "$EUID" -ne 0 ]; then
        SUDO="sudo"
    fi
    
    # 获取最新版本号
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep "tag_name" | cut -d '"' -f 4)
    if [ -z "$COMPOSE_VERSION" ]; then
        COMPOSE_VERSION="v2.24.0"
    fi
    
    print_info "安装 Docker Compose $COMPOSE_VERSION..."
    $SUDO curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    $SUDO chmod +x /usr/local/bin/docker-compose
    
    if command -v docker-compose &> /dev/null; then
        print_success "Docker Compose 安装成功: $(docker-compose --version)"
    else
        print_error "Docker Compose 安装失败"
        exit 1
    fi
}

# ============================================================
# Step 4: 检查并安装 Git（可选）
# ============================================================
install_git() {
    print_step "检查 Git"
    
    if command -v git &> /dev/null; then
        print_success "Git 已安装: $(git --version)"
        return 0
    fi
    
    print_warn "Git 未安装，开始自动安装..."
    
    SUDO=""
    if [ "$EUID" -ne 0 ]; then
        SUDO="sudo"
    fi
    
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            $SUDO apt-get update && $SUDO apt-get install -y git
            ;;
        centos|rhel|rocky|almalinux|fedora)
            $SUDO yum install -y git
            ;;
        *)
            print_warn "无法自动安装 Git，请手动安装"
            return 1
            ;;
    esac
    
    if command -v git &> /dev/null; then
        print_success "Git 安装成功: $(git --version)"
    fi
}

# ============================================================
# Step 5: 检查并安装 curl（可选）
# ============================================================
install_curl() {
    print_step "检查 curl"
    
    if command -v curl &> /dev/null; then
        print_success "curl 已安装: $(curl --version | head -1)"
        return 0
    fi
    
    print_warn "curl 未安装，开始自动安装..."
    
    SUDO=""
    if [ "$EUID" -ne 0 ]; then
        SUDO="sudo"
    fi
    
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            $SUDO apt-get update && $SUDO apt-get install -y curl
            ;;
        centos|rhel|rocky|almalinux|fedora)
            $SUDO yum install -y curl
            ;;
    esac
}

# ============================================================
# Step 6: 准备目录结构
# ============================================================
prepare_directories() {
    print_step "准备目录结构"
    
    mkdir -p "$PROJECT_DIR/data"
    mkdir -p "$PROJECT_DIR/logs"
    mkdir -p "$PROJECT_DIR/scripts"
    mkdir -p "$PROJECT_DIR/downloads"
    
    print_success "目录结构已准备: data/ logs/ scripts/ downloads/"
}

# ============================================================
# Step 7: 构建并启动服务
# ============================================================
build_and_start() {
    print_step "构建并启动服务"
    
    cd "$PROJECT_DIR"
    
    # 判断使用 docker compose 还是 docker-compose
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi
    
    print_info "使用 $COMPOSE_CMD 构建镜像..."
    $COMPOSE_CMD build
    
    print_info "启动服务..."
    $COMPOSE_CMD up -d
    
    print_info "等待服务启动..."
    sleep 5
    
    # 检查服务状态
    if $COMPOSE_CMD ps | grep -q "Up\|running"; then
        print_success "服务已启动"
    else
        print_error "服务启动失败，查看日志: $COMPOSE_CMD logs"
        exit 1
    fi
}

# ============================================================
# Step 8: 验证服务
# ============================================================
verify_service() {
    print_step "验证服务"
    
    local max_retries=30
    local retry=0
    
    while [ $retry -lt $max_retries ]; do
        if curl -sf http://localhost:3000/ > /dev/null 2>&1; then
            print_success "服务运行正常！"
            echo ""
            echo -e "${GREEN}========================================${NC}"
            echo -e "${GREEN}  $PROJECT_NAME 部署成功！${NC}"
            echo -e "${GREEN}========================================${NC}"
            echo ""
            echo -e "访问地址: ${CYAN}http://localhost:3000${NC}"
            echo -e "API 文档: ${CYAN}http://localhost:3000/docs${NC}"
            echo -e "默认账号: ${CYAN}admin${NC}"
            echo -e "默认密码: ${CYAN}admin123${NC}"
            echo ""
            echo -e "常用命令:"
            echo -e "  查看日志:   docker compose logs -f"
            echo -e "  停止服务:   docker compose down"
            echo -e "  重启服务:   docker compose restart"
            echo -e "  查看状态:   docker compose ps"
            echo ""
            return 0
        fi
        retry=$((retry + 1))
        print_warn "等待服务启动... ($retry/$max_retries)"
        sleep 2
    done
    
    print_error "服务启动超时，请检查日志: docker compose logs"
    exit 1
}

# ============================================================
# 主流程
# ============================================================
main() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  $PROJECT_NAME           ║${NC}"
    echo -e "${CYAN}║  一键智能部署脚本                              ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    
    detect_os
    install_curl
    install_git
    install_docker
    install_docker_compose
    prepare_directories
    build_and_start
    verify_service
}

main "$@"
