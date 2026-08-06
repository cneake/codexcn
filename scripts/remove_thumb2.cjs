const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const php = `<?php
$conn = new mysqli('localhost', 'agent_wp', 'AiAgent2026!', 'agent_wp');

$r = $conn->query("SELECT meta_value FROM wp_postmeta WHERE post_id=2985 AND meta_key='_thumbnail_id'");
if ($row = $r->fetch_assoc()) {
    $thumb_id = $row['meta_value'];
    echo "Thumbnail ID: $thumb_id\\n";

    $r2 = $conn->query("SELECT meta_value FROM wp_postmeta WHERE post_id=$thumb_id AND meta_key='_wp_attached_file'");
    if ($r2 && $row2 = $r2->fetch_assoc()) {
        $file = '/www/wwwroot/agent.eake.cn/wp-content/uploads/' . $row2['meta_value'];
        echo "File: $file\\n";
        echo "Exists: " . (file_exists($file) ? 'YES' : 'NO') . "\\n";
    }

    $conn->query("DELETE FROM wp_postmeta WHERE post_id=2985 AND meta_key='_thumbnail_id'");
    echo "Deleted _thumbnail_id, affected: " . $conn->affected_rows . "\\n";
} else {
    echo "No _thumbnail_id for post 2985\\n";
}

echo "DONE\\n";
?>`;

  c.sftp((err, sftp) => {
    sftp.writeFile('/tmp/rm_thumb.php', Buffer.from(php, 'utf8'), {}, () => {
      c.exec('php /tmp/rm_thumb.php', (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.on('end', () => { console.log(out); c.end(); });
      });
    });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});