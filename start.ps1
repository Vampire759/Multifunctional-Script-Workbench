# 一键启动脚本：检查依赖 + 启动后端（前端已构建为静态资源）
# 用法: powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

function Write-Step($msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!]  $msg" -ForegroundColor Yellow }

# ---------- 1. 检查 Python 依赖（使用项目内 venv） ----------
$venvPython = "$ROOT\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Step "创建虚拟环境 .venv..."
    python -m venv "$ROOT\.venv"
    & $venvPython -m pip install --upgrade pip
}

Write-Step "检查 Python 后端依赖..."
$pyOk = $true
try {
    & $venvPython -c "import fastapi, uvicorn, sqlalchemy, pydantic, apscheduler, httpx, bs4, requests" 2>$null
    if ($LASTEXITCODE -ne 0) { $pyOk = $false }
} catch { $pyOk = $false }

if (-not $pyOk) {
    Write-Warn "缺少 Python 依赖，正在安装到 venv..."
    & $venvPython -m pip install -r "$ROOT\backend\requirements.txt" requests beautifulsoup4 lxml
    if ($LASTEXITCODE -ne 0) { Write-Host "Python 依赖安装失败" -ForegroundColor Red; exit 1 }
}
Write-Ok "Python 依赖就绪"

# ---------- 2. 检查前端构建 ----------
$feDist = "$ROOT\frontend\dist"
if (-not (Test-Path $feDist)) {
    Write-Warn "前端未构建，正在构建..."
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Push-Location "$ROOT\frontend"
    npm install 2>$null
    npm run build
    Pop-Location
    if ($LASTEXITCODE -ne 0) { Write-Host "前端构建失败" -ForegroundColor Red; exit 1 }
}
Write-Ok "前端构建就绪"

# ---------- 3. 启动后端（托管前端静态资源） ----------
Write-Step "启动服务器 (http://127.0.0.1:8010)..."
$backendProc = Start-Process -FilePath $venvPython -ArgumentList "-m","uvicorn","backend.main:app","--host","127.0.0.1","--port","8010" -WorkingDirectory $ROOT -PassThru -WindowStyle Normal
Write-Ok "服务器已启动 (PID: $($backendProc.Id))"

Start-Sleep -Seconds 3

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  平台已启动" -ForegroundColor Green
Write-Host "  访问地址: http://127.0.0.1:8010" -ForegroundColor White
Write-Host "  API 文档: http://127.0.0.1:8010/docs" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`n按任意键停止服务..." -ForegroundColor Yellow
[Console]::ReadKey($true) | Out-Null

# 清理
Write-Host "`n[*] 正在停止服务..." -ForegroundColor Cyan
Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
Write-Ok "已停止"
