const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const fs = require('fs');
const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.log('SFTP error:', err.message); conn.end(); return; }
    sftp.fastPut('D:/codexhubcn/cc-switch-clone/scripts/genhub-register.php', '/www/wwwroot/agent.eake.cn/genhub-register.php', (err) => {
      if (err) { console.log('Upload error:', err.message); conn.end(); return; }
      console.log('Upload OK');
      conn.end();
    });
  });
}).connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
