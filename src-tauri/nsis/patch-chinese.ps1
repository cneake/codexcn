# Patch NSIS SimpChinese language file for full Chinese uninstaller UI
$targetDir = "$PSScriptRoot\..\target\release\nsis\x64"
$langFile = "$targetDir\SimpChinese.nsh"

if (-not (Test-Path $langFile)) {
    Write-Host "SimpChinese.nsh not found, skipping patch"
    exit 0
}

Write-Host "Patching SimpChinese.nsh for Chinese uninstaller UI..."

$content = Get-Content $langFile -Raw

# Add standard MUI uninstaller strings if not present
$patch = @"

; === Patched Chinese Uninstaller Strings ===
LangString ^UninstallCaption `${LANG_SIMPCHINESE} "卸载 `$(^Name)"
LangString ^UninstallSubCaption `${LANG_SIMPCHINESE} ": 确认卸载"
LangString ^UninstallingSubCaption `${LANG_SIMPCHINESE} ": 正在卸载"
LangString ^UnCompletedSubCaption `${LANG_SIMPCHINESE} ": 卸载完成"
LangString ^UninstallBtn `${LANG_SIMPCHINESE} "卸载(&U)"
LangString ^CancelBtn `${LANG_SIMPCHINESE} "取消(&C)"
LangString ^BackBtn `${LANG_SIMPCHINESE} "< 上一步(&B)"
LangString ^NextBtn `${LANG_SIMPCHINESE} "下一步(&N) >"
LangString ^CloseBtn `${LANG_SIMPCHINESE} "关闭(&L)"

"@

# Check if already patched
if ($content -match "Patched Chinese Uninstaller Strings") {
    Write-Host "Already patched, skipping"
    exit 0
}

# Append patch to end of file
Add-Content -Path $langFile -Value $patch -Encoding UTF8
Write-Host "Patch applied successfully"
