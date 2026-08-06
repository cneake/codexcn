const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const sql = `mysql agent_wp -B -e "SELECT post_id, meta_key, LEFT(meta_value, 100) AS v FROM wp_postmeta WHERE post_id IN (2985, 2987, 2989, 2990, 2991, 3008) ORDER BY post_id, meta_key;"`;
  c.exec(sql, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});