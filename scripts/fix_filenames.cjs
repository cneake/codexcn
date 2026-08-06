const { Client } = require('ssh2');
const conn = new Client();
const exec = (cmd) => new Promise((res, rej) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return rej(err);
    let out = '', errOut = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => errOut += d);
    stream.on('close', code => res({ code, out, err: errOut }));
  });
});

conn.on('ready', async () => {
  try {
    const dl = '/www/wwwroot/agent.eake.cn/wp-content/downloads';
    
    // 1. List current state
    let r = await exec(`ls -la "${dl}" | grep -E "%20|0\\.1\\.1"`);
    console.log('Before:');
    console.log(r.out);
    
    // 2. Rename %20 files to use actual space
    // CodexHub%20CN_0.1.1_x64-setup.exe -> CodexHub CN_0.1.1_x64-setup.exe
    r = await exec(`cd "${dl}" && for f in CodexHub%20CN_0.1.1*.exe CodexHub%20CN_0.1.1*.msi CodexHub%20CN_0.1.0*.exe CodexHub%20CN_0.1.0*.msi; do
  if [ -f "$f" ]; then
    newname=$(echo "$f" | sed 's/%20/ /g')
    if [ "$f" != "$newname" ]; then
      mv "$f" "$newname"
      echo "Renamed: $f -> $newname"
    fi
  fi
done`);
    console.log('Renames:');
    console.log(r.out);
    if (r.err) console.log('STDERR:', r.err);
    
    // 3. Delete old 0.1.0 files (we only need 0.1.1)
    r = await exec(`cd "${dl}" && rm -f "CodexHub CN_0.1.0_x64-setup.exe" "CodexHub CN_0.1.0_x64_zh-CN.msi" "CodexHub%20CN_0.1.0_x64-setup.exe" "CodexHub%20CN_0.1.0_x64_zh-CN.msi" && echo "Old 0.1.0 files removed"`);
    console.log(r.out);
    
    // 4. Verify final state
    r = await exec(`ls -la "${dl}" | grep -E "0\\.1\\.1"`);
    console.log('After:');
    console.log(r.out);
    
  } catch (e) { console.log('ERR:', e.message); }
  conn.end();
}).on('error', e => console.error('ERR:', e.message))
  .connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793', readyTimeout: 15000 });
