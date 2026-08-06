const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = 'ls /www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/ | grep -E "\\.php$"';
  c.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});