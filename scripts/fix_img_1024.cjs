const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const py = `python3 << 'PYEOF'
fp = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/single.php'
with open(fp, 'r', encoding='utf-8') as f:
    s = f.read()

old = """.detail-content img {
  display:block;
  max-width:80%;
  height:auto;
  margin:20px auto;
  border-radius:8px;
  border:1px solid rgba(0,240,255,0.15);
}"""

new = """.detail-content img {
  display:block;
  width:1024px;
  max-width:100%;
  height:540px;
  object-fit:cover;
  margin:20px auto;
  border-radius:8px;
  border:1px solid rgba(0,240,255,0.15);
}"""

if old in s:
    s = s.replace(old, new)
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(s)
    print('OK: img fixed to 1024x540, object-fit cover')
else:
    print('NOT FOUND')
PYEOF`;

  c.exec(py, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});