const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  // 1. 列出所有 wp-image-* ID
  const sql1 = `mysql agent_wp -e "SELECT ID, guid, post_mime_type FROM wp_posts WHERE post_type='attachment' AND ID IN (SELECT meta_value FROM wp_postmeta WHERE meta_key='_thumbnail_id' AND post_id=2985) OR guid LIKE '%genhub-guide-3%' OR post_parent=2985 ORDER BY ID;"`;
  // 2. 提取 post_content 里所有 img 标签的 src
  const sql2 = `mysql agent_wp -e "SELECT post_content FROM wp_posts WHERE ID=2985 LIMIT 1;" > /tmp/g3.html`;
  // 3. 看 uploads/2026/08 目录哪些图片
  const sql3 = `ls -la /www/wwwroot/agent.eake.cn/wp-content/uploads/2026/08/ 2>&1 | head -30`;

  c.exec(`${sql1}; echo '---DIVIDER---'; ${sql2}; cat /tmp/g3.html | grep -oE 'src="[^"]*"' | head -20; echo '---DIVIDER---'; ${sql3}`, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});