@echo off
chcp 65001 >nul
echo ============================================
echo   视频爬取调度平台 - 启动器
echo ============================================
echo.
echo 正在启动...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
