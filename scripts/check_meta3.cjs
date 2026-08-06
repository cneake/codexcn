const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  // Write PHP script to /tmp and execute
  const phpScript = `<?php
$conn = new mysqli('localhost', 'agent_wp', 'AiAgent2026!', 'agent_wp');
$ids = [2985, 2987, 2989, 2990, 2991, 3008];
foreach ($ids as $id) {
    echo "=== Post $id ===\\n";
    $r = $conn->query("SELECT meta_key, LEFT(meta_value, 80) AS v FROM wp_postmeta WHERE post_id=$id");
    while ($row = $r->fetch_assoc()) {
        echo $row['meta_key'] . " = " . $row['v'] . "\\n";
    }
}
$conn->close();
?>`;

  const tmpFile = '/tmp/check_post_meta.php';
  const buf = Buffer.from(phpScript, 'utf8');
  const sftp = c.sftp((err, sftp) => {
    sftp.writeFile(tmpFile, buf, {}, (err) => {
      if (err) { console.error('write err:', err); c.end(); return; }
      c.exec(`php ${tmpFile}`, (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.on('end', () => { console.log(out); c.end(); });
      });
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});