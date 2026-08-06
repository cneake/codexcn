const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = 'sed -n "53,68p" /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/single.php | cat -A';
  c.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log('===BEGIN===\n' + out + '===END==='); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});