const fs = require('fs');
const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');

const conn = new Client();
conn.on('ready', () => {
    const localPath = 'D:/codexhubcn/cc-switch-clone/src-tauri/target/release/bundle/nsis/GenHub_0.1.5_x64-setup.exe';
    const remotePath = '/www/wwwroot/agent.eake.cn/wp-content/downloads/GenHub_0.1.5_x64-setup.exe';
    const stat = fs.statSync(localPath);
    console.log('Size:', (stat.size / 1024 / 1024).toFixed(2), 'MB');

    conn.sftp((err, sftp) => {
        sftp.fastPut(localPath, remotePath, { step: (total, chunk, total2) => {
            if (chunk === total2) console.log('Upload complete!');
        }}, (err) => {
            if (err) { console.error('SFTP error:', err.message); conn.end(); return; }
            console.log('Success!');
            conn.end();
        });
    });
}).connect({
    host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793'
});
