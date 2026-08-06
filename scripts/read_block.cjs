const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  // 用 Python 写文件更安全，做精确替换
  const py = `python3 << 'PYEOF'
import re
fp = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/single.php'
with open(fp, 'r', encoding='utf-8') as f:
    s = f.read()

# 找原文"有特色图时，移除内容中所有<img>标签"那行附近
old_block = """  if (has_post_thumbnail()) {
    // 有特色图时，移除内容中所有<img>标签，避免重复
    $post_content = preg_replace('/<img[^>]*>/i', '', $post_content);
  } else {
    // 无特色图时，只保留第一张图片，移除其余
    $count = 0;
    $post_content = preg_replace_callback('/<img[^>]*>/i', function($m) use (&$count) {
      $count++;
      return $count === 1 ? $m[0] : '';
    }, $post_content);
  }"""

new_block = """  // 不再根据特色图删除正文图片 —— 封面图通常是 logo/装饰，不一定是正文首图
  // 用户反馈：删除逻辑导致正文配图全部丢失，已禁用 2026-08-05
  $post_content = preg_replace_callback('/<img[^>]*>/i', function($m) {
    return $m[0];
  }, $post_content);"""

if old_block in s:
    s = s.replace(old_block, new_block)
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(s)
    print('OK: replaced')
else:
    print('NOT FOUND, try partial match')
    idx = s.find("has_post_thumbnail()")
    if idx >= 0:
        print('Context around has_post_thumbnail():')
        print(s[idx:idx+500])
PYEOF`;

  c.exec(py, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});