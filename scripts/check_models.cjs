const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const php = `<?php
$conn = new mysqli('localhost', 'agent_wp', 'AiAgent2026!', 'agent_wp');
$r = $conn->query("SELECT post_title, post_name, id FROM wp_posts WHERE post_type='post' AND post_status='publish' AND post_content LIKE '%model%' ORDER BY id DESC LIMIT 50");
echo "Posts with 'model' in content:\n";
while ($row = $r->fetch_assoc()) {
    echo "ID=" . $row['id'] . " | " . $row['post_title'] . "\n";
}
echo "\n--- Models category ---\n";
$r2 = $conn->query("SELECT t.name FROM wp_terms t JOIN wp_term_taxonomy tt ON t.term_id=tt.term_id WHERE tt.taxonomy='category' ORDER BY t.term_id");
while ($row = $r2->fetch_assoc()) echo $row['name'] . "\n";
$conn->close();
?>`;

  c.sftp((err, sftp) => {
    sftp.writeFile('/tmp/check_models.php', Buffer.from(php, 'utf8'), {}, () => {
      c.exec('php /tmp/check_models.php', (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.on('end', () => { console.log(out); c.end(); });
      });
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});