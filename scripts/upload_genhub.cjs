const { Client } = require('ssh2');
const path = require('path');

const baseDir = 'D:\\codexhubcn\\cc-switch-clone';
const files = [
    'src-tauri/target/release/bundle/nsis/GenHub_0.1.5_x64-setup.exe',
    'src-tauri/target/release/bundle/nsis/GenHub_0.1.5_x64-setup.exe.sha256',
    'src-tauri/target/release/bundle/msi/GenHub_0.1.5_x64_zh-CN.msi',
    'src-tauri/target/release/bundle/msi/GenHub_0.1.5_x64_zh-CN.msi.sha256'
];
const remoteDir = '/www/wwwroot/agent.eake.cn/wp-content/downloads/';

const c = new Client();
c.on('ready', () => {
    console.log('SSH connected');
    c.sftp((err, sftp) => {
        if (err) { console.error('SFTP error:', err); c.end(); return; }
        let done = 0;
        files.forEach(f => {
            const fullPath = path.join(baseDir, f);
            const bn = path.basename(f);
            sftp.fastPut(fullPath, remoteDir + bn, {}, (e) => {
                if (e) { console.error('FAIL:', bn, e.message); }
                else { console.log('OK:', bn); }
                if (++done === files.length) { c.end(); console.log('All done'); }
            });
        });
    });
});
c.on('error', e => console.error('SSH error:', e));
c.connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
