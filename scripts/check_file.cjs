const { Client } = require('ssh2');
const conn = new Client();
const exec = (cmd) => new Promise((res, rej) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return rej(err);
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => out += d);
    stream.on('close', () => res(out));
  });
});

conn.on('ready', async () => {
  try {
    console.log('=== files with %20 ===');
    console.log(await exec('ls -la /www/wwwroot/agent.eake.cn/wp-content/downloads/ 2>&1 | grep -E "%20|0\\.1\\.1"'));
    console.log('=== check first 100 bytes of 0.1.1 setup file ===');
    console.log(await exec('head -c 200 "/www/wwwroot/agent.eake.cn/wp-content/downloads/CodexHub%20CN_0.1.1_x64-setup.exe" 2>&1 | xxd | head -10'));
    console.log('=== file type ===');
    console.log(await exec('file "/www/wwwroot/agent.eake.cn/wp-content/downloads/CodexHub%20CN_0.1.1_x64-setup.exe" 2>&1'));
    console.log('=== md5sum ===');
    console.log(await exec('md5sum "/www/wwwroot/agent.eake.cn/wp-content/downloads/CodexHub%20CN_0.1.1_x64-setup.exe" 2>&1'));
    console.log('=== access log latest ===');
    console.log(await exec('tail -20 /www/wwwlogs/agent.eake.cn.log 2>&1 | grep -E "downloads|0.1.1" | tail -10'));
  } catch (e) { console.log('ERR:', e.message); }
  conn.end();
}).on('error', e => console.error('ERR:', e.message))
  .connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793', readyTimeout: 15000 });
