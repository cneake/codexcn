$creds = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("eakecn`:qjag 2LCM BB9r OTQz qPjj tDV2"))
$headers = @{
    "Authorization" = "Basic $creds"
    "Content-Type" = "application/json"
}

$content = @"
<p>📢 重要公告</p>
<p><strong>CodexHub CN</strong> 即日起正式更名为 <strong>GenHub</strong>（中文名：精灵中心）。</p>
<h3>为什么要改名？</h3>
<ul>
<li>「CodexHub」与官方 OpenAI Codex 名称过于接近，容易造成混淆</li>
<li>GenHub 更能体现我们「AI 工具集散地」的产品定位</li>
<li>新名称更简短、好记、国际范</li>
</ul>
<h3>升级指南</h3>
<p>如果您正在使用 CodexHub CN：</p>
<ol>
<li>前往 <a href="https://agent.eake.cn/genhub-cn/">genhub-cn 产品页</a> 下载最新版本 GenHub</li>
<li>卸载旧版本，安装新版本即可</li>
<li>所有配置、API Key、工具设置均完整保留</li>
</ol>
<h3>联系方式</h3>
<ul>
<li>下载地址：<a href="https://agent.eake.cn/genhub-cn/">https://agent.eake.cn/genhub-cn/</a></li>
<li>官网：<a href="https://agent.eake.cn">https://agent.eake.cn</a></li>
</ul>
<p>感谢您的理解与支持！</p>
"@

$body = @{
    title = "CodexHub CN 正式更名为 GenHub"
    content = $content
    status = "publish"
} | ConvertTo-Json -Depth 10

$uri = "https://agent.eake.cn/wp-json/wp/v2/ylan/announcements"
$resp = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body
Write-Host "Created: ID=$($resp.id) slug=$($resp.slug)"
