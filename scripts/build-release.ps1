# GenHub Release 构建脚本（生成 NSIS 安装包）
# 用法: .\build-release.ps1
# 流程: 杀旧进程 → pnpm build → cargo tauri build
# 安装包输出到 src-tauri/target/release/bundle/

$ErrorActionPreference = "Stop"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  GenHub Release Build (v0.1.4)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 1. 杀掉旧 app.exe（Rust 编译需要独占）
Write-Host "[1/3] Kill old app.exe..." -ForegroundColor Yellow
$proc = Get-Process -Name "app" -ErrorAction SilentlyContinue
if ($proc) {
    Stop-Process -Id $proc.Id -Force
    Write-Host "  Killed PID $($proc.Id)" -ForegroundColor Gray
    Start-Sleep -Milliseconds 500
} else {
    Write-Host "  No running app.exe" -ForegroundColor Gray
}

# 2. 前端构建
Write-Host "[2/3] pnpm build..." -ForegroundColor Yellow
Set-Location $PROJECT_ROOT
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "pnpm build failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
Write-Host "  dist/ ready" -ForegroundColor Green

# 3. Rust 构建（release + NSIS）
Write-Host "[3/3] cargo tauri build --release..." -ForegroundColor Yellow
Set-Location "$PROJECT_ROOT\src-tauri"
cargo tauri build 2>&1 | Tee-Object -Variable log

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "  Build SUCCESS!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green

    # 列出安装包
    $bundleDir = "$PROJECT_ROOT\src-tauri\target\release\bundle"
    Get-ChildItem $bundleDir -Recurse -Include "*.exe","*.msi" | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 1)
        Write-Host "  $($_.Name) ($size MB)" -ForegroundColor White
    }
} else {
    Write-Host ""
    Write-Host "Build FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    Write-Host "See log above for details." -ForegroundColor Gray
    exit 1
}
