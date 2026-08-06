const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const sql = 'mysql agent_wp -e "SELECT LENGTH(post_content) as len FROM wp_posts WHERE post_name=\'genhub-guide-3\' AND post_status=\'publish\' LIMIT 1;"';
  c.exec(sql, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => {
      console.log(out);
      // Also check for img tags
      const sql2 = 'mysql agent_wp -e "SELECT post_content FROM wp_posts WHERE post_name=\'genhub-guide-3\' AND post_status=\'publish\' LIMIT 1;" | findstr /i img';
      c.exec(sql2, (err2, s2) => {
        let out2 = '';
        s2.on('data', d => out2 += d);
        s2.on('end', () => { console.log('img lines:', out2); c.end(); });
      });
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});
