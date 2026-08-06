const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');

const conn = new Client();
conn.on('ready', () => {
  const cmd = `sed -i 's/0\\.1\\.5/0.1.6/g' /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/page-codexhub-cn.php && grep -o '0\\.1\\.[0-9]' /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/page-codexhub-cn.php | head -3`;
  conn.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('close', () => {
      console.log('Product page result:', out.trim());
      conn.end();
    });
  });
}).connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
