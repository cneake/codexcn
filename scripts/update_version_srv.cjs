const { Client } = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');

const conn = new Client();
conn.on('ready', () => {
  const frontPage = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/front-page.php';
  const sedCmd1 = `sed -i 's/0\\.1\\.3/0.1.6/g' ${frontPage}`;
  conn.exec(sedCmd1, (err, stream) => {
    stream.on('close', () => {
      console.log('front-page.php updated (0.1.3 -> 0.1.6)');
      const prodPage = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/page-codexhub-cn.php';
      const sedCmd2 = `sed -i 's/0\\.1\\.5/0.1.6/g' ${prodPage}`;
      conn.exec(sedCmd2, (err2, stream2) => {
        stream2.on('close', () => {
          console.log('page-codexhub-cn.php updated (0.1.5 -> 0.1.6)');
          conn.end();
        });
      });
    });
  });
}).connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
