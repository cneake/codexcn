$creds = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("eakecn`:qjag 2LCM BB9r OTQz qPjj tDV2"))
$headers = @{"Authorization" = "Basic $creds"}
try {
    $resp = Invoke-RestMethod "https://agent.eake.cn/wp-json/wp/v2/types" -Headers $headers
    $resp | ConvertTo-Json -Depth 3 | Out-Host
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
