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
    console.log('=== nginx config locations ===');
    console.log(await exec('ls /etc/nginx/ 2>&1'));
    console.log('=== sites-enabled ===');
    console.log(await exec('ls /etc/nginx/sites-enabled/ 2>&1; ls /etc/nginx/conf.d/ 2>&1'));
    console.log('=== /www/server/panel/vhost/nginx ===');
    console.log(await exec('ls /www/server/panel/vhost/nginx/ 2>&1 | head -20'));
    console.log('=== agent.eake.cn config (try1) ===');
    console.log(await exec('cat /www/server/panel/vhost/nginx/agent.eake.cn.conf 2>&1 | head -60'));
  } catch (e) { console.log('ERR:', e.message); }
  conn.end();
}).on('error', e => console.error('ERR:', e.message))
  .connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793', readyTimeout: 15000 });
