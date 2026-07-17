#!/bin/bash

set -e

echo "============================================"
echo "         一键部署脚本 - 智能任务管理系统"
echo "============================================"

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo "[ERROR] Docker 未安装，请先安装 Docker"
        echo "        安装命令：curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo "[ERROR] Docker Compose 未安装，请先安装 Docker Compose"
        echo "        安装命令：sudo apt install docker-compose-plugin"
        exit 1
    fi
    
    echo "[OK] Docker 环境检查通过"
}

check_git() {
    if ! command -v git &> /dev/null; then
        echo "[ERROR] Git 未安装，请先安装 Git"
        echo "        安装命令：sudo apt install git -y"
        exit 1
    fi
    echo "[OK] Git 环境检查通过"
}

clone_repo() {
    echo ""
    echo "正在克隆代码仓库..."
    if [ -d "sokkp-project" ]; then
        echo "[INFO] 检测到已有 sokkp-project 目录，跳过克隆"
        cd sokkp-project
        git pull
    else
        git clone https://github.com/your-username/sokkp-project.git
        cd sokkp-project
    fi
    echo "[OK] 代码仓库克隆完成"
}

setup_directories() {
    echo ""
    echo "正在创建数据目录..."
    mkdir -p data logs scripts
    echo "[OK] 目录创建完成"
}

build_and_run() {
    echo ""
    echo "正在构建并启动容器..."
    
    COMPOSE_CMD="docker compose"
    if ! command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    fi
    
    $COMPOSE_CMD -p sokkp up -d --build
    echo "[OK] 容器构建并启动完成"
}

wait_for_service() {
    echo ""
    echo "正在等待服务启动..."
    for i in {1..30}; do
        if curl -s http://localhost:8000/health &> /dev/null; then
            echo "[OK] 服务启动成功！"
            return 0
        fi
        echo "等待中 ($i/30)..."
        sleep 2
    done
    echo "[ERROR] 服务启动超时，请检查日志：docker logs sokkp-app-1"
    return 1
}

main() {
    check_docker
    check_git
    clone_repo
    setup_directories
    build_and_run
    wait_for_service
    
    echo ""
    echo "============================================"
    echo "         部署完成！"
    echo "============================================"
    echo ""
    echo "服务地址: http://localhost:8000"
    echo ""
    echo "常用命令:"
    echo "  查看日志: docker logs -f sokkp-app-1"
    echo "  停止服务: docker compose -p sokkp down"
    echo "  重启服务: docker compose -p sokkp restart"
    echo "  更新代码: git pull && docker compose -p sokkp up -d --build"
}

main "$@"
