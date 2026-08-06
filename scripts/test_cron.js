// 测试定时任务系统
const { spawn } = require('child_process');

// 启动 app 并调用 cron_test
const app = spawn('D:\\codexhubcn\\cc-switch-clone\\src-tauri\\target\\release\\app.exe', [], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
app.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  console.log('[App]', text.trim());
});

app.stderr.on('data', (data) => {
  const text = data.toString();
  if (text.includes('[CronScheduler]') || text.includes('[gateway]') || text.includes('error')) {
    console.log('[App]', text.trim());
  }
});

// 等待启动后调用测试命令
setTimeout(() => {
  console.log('\n=== 调用 cron_test 命令 ===\n');
  // 使用 Tauri CLI 调用
  const invoke = spawn('D:\\tools\\qclaw\\v0.2.35.624\\resources\\node\\node.exe', [
    '-e',
    `
    const { invoke } = require('@tauri-apps/api/core');
    invoke('cron_test').then(r => console.log('Result:', r)).catch(e => console.error('Error:', e));
    `
  ], {
    cwd: 'D:\\codexhubcn\\cc-switch-clone',
    stdio: 'inherit'
  });
  
  setTimeout(() => {
    app.kill();
    process.exit(0);
  }, 5000);
}, 3000);
