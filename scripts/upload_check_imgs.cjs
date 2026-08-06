const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const fs = require('fs');
const path = require('path');

const c = new Client();
c.on('ready', () => {
  // Upload PHP script
  const content = fs.readFileSync('D:/codexhubcn/cc-switch-clone/scripts/check_g3_imgs.php', 'utf8');
  const sftp = c.sftp((err, sftp) => {
    sftp.fastPut(Buffer.from(content), '/tmp/check_g3_imgs.php', {}, (err) => {
      if (err) { console.error('Upload error:', err); c.end(); return; }
      console.log('Uploaded OK');
      c.exec('php /tmp/check_g3_imgs.php', (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.on('end', () => { console.log(out); c.end(); });
      });
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});