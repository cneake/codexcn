const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const sql = `mysql agent_wp -B -N -e "SELECT post_content FROM wp_posts WHERE ID=2985 LIMIT 1;" 2>/dev/null`;
  c.exec(sql, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => {
      // 提取所有 img src
      const matches = [...out.matchAll(/wp-image-(\d+)/g)];
      console.log('wp-image IDs found:', matches.map(m => m[1]));
      const srcMatches = [...out.matchAll(/src="([^"]+)"/g)];
      console.log('img srcs:', srcMatches.map(m => m[1]));
      c.end();
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});