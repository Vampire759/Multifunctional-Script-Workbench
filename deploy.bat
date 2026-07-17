@echo off
chcp 65001 >nul

echo ========================================
echo   一键部署脚本 - Python脚本任务管理系统
echo ========================================

docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker 未安装，请先安装 Docker
    pause
    exit /b 1
)

docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker Compose 未安装，请先安装 Docker Compose
    pause
    exit /b 1
)

echo [信息] 正在检查 Docker 服务...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker 服务未运行，请启动 Docker
    pause
    exit /b 1
)

echo [信息] 正在下载项目...
if exist "script-task-manager" (
    echo [警告] 目录已存在，将更新代码
    cd script-task-manager && git pull
) else (
    git clone https://github.com/your-repo/script-task-manager.git
    cd script-task-manager
)

echo [信息] 正在构建并启动容器...
docker-compose up -d --build

echo.
echo ========================================
echo   部署成功！
echo ========================================
echo [访问地址] http://localhost:8000
echo [默认账号] admin / admin123
echo [端口] 8000
echo.
echo [管理命令]
echo   查看日志: docker-compose logs -f
echo   停止服务: docker-compose down
echo   重启服务: docker-compose restart
echo   更新代码: git pull && docker-compose up -d --build

pause