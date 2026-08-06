const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  // 1. 查 post 用的模板
  const sql = `mysql agent_wp -B -N -e "SELECT meta_value FROM wp_postmeta WHERE post_id=2985 AND meta_key='_wp_page_template';"`;
  // 2. 查 single.php 里所有涉及 img 的代码
  const php = `grep -n -i "img\|figure\|lazy\|decode\|loading" /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/single.php 2>/dev/null | head -20`;
  c.exec(`${sql}; echo '---TPL---'; ${php}`, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});