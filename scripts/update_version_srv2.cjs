const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const fs = require('fs');

// 上传 PHP 脚本
const phpContent = `<?php
// 更新版本号
$front = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/front-page.php';
$prod  = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/page-codexhub-cn.php';

$f = file_get_contents($front);
$f = preg_replace('/0\\.1\\.([0-9]+)/', '0.1.6', $f);
file_put_contents($front, $f);

$p = file_get_contents($prod);
$p = preg_replace('/0\\.1\\.([0-9]+)/', '0.1.6', $p);
file_put_contents($prod, $p);

echo "OK front-page: " . $f . "\\n";
echo "OK product: " . substr($p, 0, 200) . "\\n";
`;

const tmp = 'D:/tmp_version_update.php';
fs.writeFileSync(tmp, phpContent);

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    sftp.fastPut(tmp, '/tmp/update_ver.php', {}, (e) => {
      if (e) { console.error('SFTP put error:', e.message); conn.end(); return; }
      console.log('PHP script uploaded');
      conn.exec('php /tmp/update_ver.php && rm /tmp/update_ver.php', (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.on('close', () => {
          console.log(out);
          conn.end();
        });
      });
    });
  });
}).connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
