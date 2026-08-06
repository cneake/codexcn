<?php
$conn = new mysqli('localhost', 'agent_wp', 'AiAgent2026!', 'agent_wp');
echo "Searching for content rendering files...\n";
$conn->close();
?>
# List theme PHP files
echo "===Theme files==="
ls /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/*.php 2>/dev/null
echo "===Single/content files==="
ls /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/*single*.php /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/*content*.php 2>/dev/null