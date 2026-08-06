const fs = require('fs');
const f = 'D:/codexhubcn/cc-switch-clone/src/App.tsx';
let d = fs.readFileSync(f, 'utf8');
// 匹配：v0.0.1 最后 item 闭合 + v0.0.1 条目闭合(捕获) + 多余的多余闭合(删除)
const re = /(单工具聊天框架搭建<\/div>\n\s*<\/div>\r\n)\s*<\/div>\r\n/;
if (re.test(d)) {
  d = d.replace(re, '$1');
  fs.writeFileSync(f, d, 'utf8');
  console.log('OK: removed extra </div> after v0.0.1');
} else {
  console.log('pattern NOT found');
}
