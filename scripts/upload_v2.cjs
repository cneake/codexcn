const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const fs = require('fs');
const path = require('path');

const src = 'D:/codexhubcn/cc-switch-clone/src-tauri/target/release/bundle/nsis/GenHub_0.1.6_x64-setup.exe';
const dst = '/www/wwwroot/agent.eake.cn/wp-content/downloads/GenHub_0.1.6_x64-setup.exe';

console.log('Connecting...');
const conn = new Client();
conn.on('ready', () => {
  console.log('Uploading:', src);
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); conn.end(); return; }
    sftp.fastPut(src, dst, { chunkSize: 32768 }, (err2) => {
      if (err2) { console.error('Upload error:', err2); conn.end(); return; }
      console.log('Upload OK:', dst);
      conn.end();
    });
  });
}).on('error', (e) => { console.error('SSH error:', e); }).connect({
  host: '103.52.153.201',
  port: 22,
  username: 'root',
  password: 'Ea61091793',
});
