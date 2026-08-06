# Fix NSIS custom-lang.nsh BOM issue
# Tauri bundler adds UTF-8 BOM to custom-lang.nsh during packaging,
# but NSIS interprets BOM bytes as commands -> "Invalid command: 锘?"
# Fix: strip the 3-byte BOM from the release copy
$releasePath = "D:\codexhubcn\cc-switch-clone\src-tauri\target\release\nsis\x64\custom-lang.nsh"
if (Test-Path $releasePath) {
    $bytes = [System.IO.File]::ReadAllBytes($releasePath)
    # UTF-8 BOM = EF BB BF
    if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $stripped = $bytes[3..($bytes.Length-1)]
        [System.IO.File]::WriteAllBytes($releasePath, $stripped)
        Write-Output "[fix-nsis-encoding] BOM stripped, now $($stripped.Length) bytes"
    } else {
        Write-Output "[fix-nsis-encoding] No BOM found, file intact"
    }
} else {
    Write-Output "[fix-nsis-encoding] File not found: $releasePath"
}
