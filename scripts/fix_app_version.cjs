const fs = require('fs');
const f = 'D:/codexhubcn/cc-switch-clone/src/App.tsx';
let data = fs.readFileSync(f, 'utf8');
const repls = [
  ['v0.1.1{isUpdateAvailable', 'v0.1.6{isUpdateAvailable'],
  ['版本 v0.1.1</p>', '版本 v0.1.6</p>'],
  ['版本 v0.1.1 · 更新日期', '版本 v0.1.6 · 更新日期'],
];
for (const [a, b] of repls) {
  const cnt = data.split(a).length - 1;
  data = data.split(a).join(b);
  console.log(a, '->', cnt, 'replaced');
}
fs.writeFileSync(f, data, 'utf8');
console.log('App.tsx version fixed to 0.1.6');
