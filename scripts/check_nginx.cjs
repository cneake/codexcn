const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error(err); conn.end(); return; }
    // List nginx config
    sftp.readdir('/etc/nginx/conf.d/', (err, list) => {
      if (err) { console.log('conf.d error:', err.message); }
      else { console.log('=== conf.d/ ==='); list.forEach(f => console.log(f.filename)); }
      
      // Read the agent.eake.cn config
      sftp.readFile('/etc/nginx/conf.d/agent.eake.cn.conf', (err, data) => {
        if (err) { 
          sftp.readFile('/etc/nginx/nginx.conf', (err2, data2) => {
            if (err2) { console.log('No nginx config found'); conn.end(); return; }
            console.log('=== nginx.conf ===');
            console.log(data2.toString().substring(0, 3000));
            conn.end();
          });
          return;
        }
        console.log('=== agent.eake.cn.conf ===');
        console.log(data.toString());
        conn.end();
      });
    });
  });
}).on('error', e => console.error('ERR:', e.message))
  .connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793', readyTimeout: 15000 });
