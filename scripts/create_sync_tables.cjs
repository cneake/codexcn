const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync('D:/codexhubcn/cc-switch-clone/scripts/genhub_sync_tables.sql', 'utf8');

// SSH 执行 SQL
const conn = new Client();
conn.on('ready', () => {
  conn.exec('mysql -u agent_wp -p"AiAgent2026!" agent_wp -e "' + sql.replace(/\n/g, ' ') + '"', (err, stream) => {
    if (err) { console.log('SSH exec error:', err.message); conn.end(); return; }
    stream.on('data', d => console.log(d+''));
    stream.stderr.on('data', d => console.log('ERR:', d+''));
    stream.on('close', () => { conn.end(); console.log('Done'); });
  });
}).connect({
  host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793'
});
