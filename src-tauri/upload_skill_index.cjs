const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const appDir = 'C:\\Users\\Administrator\\.qclaw\\workspace-yw3plsutb1jupnif\\cc-switch-clone\\src-tauri\\target\\release';
const skillsFile = path.join(appDir, 'skills_upload.json');

if (!fs.existsSync(skillsFile)) {
  console.error('❌ 未找到 skills_upload.json');
  console.log('请先在技能管理中添加/删除技能，生成临时文件后再上传');
  process.exit(1);
}

const conn = new Client();

conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    
    console.log('📤 上传 skills_upload.json 到服务器...');
    sftp.fastPut(skillsFile, '/www/wwwroot/agent.eake.cn/wp-content/downloads/skills.json', (err) => {
      if (err) throw err;
      
      console.log('✅ 上传成功！');
      console.log('🌐 访问地址: https://agent.eake.cn/wp-content/downloads/skills.json');
      
      // 删除本地临时文件
      fs.unlinkSync(skillsFile);
      console.log('🗑️ 已删除本地临时文件');
      
      conn.end();
    });
  });
}).connect({
  host: '103.52.153.201',
  port: 22,
  username: 'root',
  password: 'Ea61091793'
});
