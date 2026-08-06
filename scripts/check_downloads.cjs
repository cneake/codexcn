const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error(err); conn.end(); return; }
    sftp.readdir('/www/wwwroot/agent.eake.cn/wp-content/downloads/', (err, list) => {
      if (err) { console.error(err); conn.end(); return; }
      list.forEach(f => console.log(`${f.attrs.size}\t${f.filename}`));
      conn.end();
    });
  });
}).on('error', e => console.error('ERR:', e.message))
  .connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793', readyTimeout: 15000 });
