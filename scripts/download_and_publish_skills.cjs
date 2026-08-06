const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const https = require('https');
const fs = require('fs');
const path = require('path');

const skills = [
  {
    slug: 'internship-scout',
    title: '实习 Scout — BOSS直聘实习岗位抓取',
    category: '工具',
    author: 'wkf16',
    repo: 'wkf16/internship-scout',
    version: '1.0.0',
    tags: ['招聘', 'BOSS直聘', '实习', 'Notion'],
    desc: '从BOSS直聘自动抓取实习岗位，AI评分打标，同步Notion。自动获取职位列表、提取JD原文、智能分类排序。',
  },
  {
    slug: 'xhs-cover',
    title: '小红书封面生成器',
    category: '创作',
    author: 'xwchris',
    repo: 'xwchris/xhs-cover-skill',
    version: '3.0.0',
    tags: ['小红书', '封面', '图片生成', '社交媒体'],
    desc: '通过npx生成小红书风格封面图片，支持多种比例（3:4/1:1/16:9），首次使用自动引导注册，跨平台支持。',
  },
  {
    slug: 'mineru-pdf-parser',
    title: 'MinerU PDF解析器 — 论文转Markdown',
    category: '文档',
    author: 'liuzk233',
    repo: 'liuzk233/openclaw-mineru-skill',
    version: '1.0.0',
    tags: ['PDF', '论文', 'Markdown', 'MinerU', '学术'],
    desc: '使用MinerU API将PDF学术论文转换为Markdown格式，支持arxiv链接直接解析，自动提取图片并修正路径。',
  },
  {
    slug: 'skill-creator',
    title: 'Skill Creator — OpenClaw技能创建工具',
    category: '开发',
    author: 'openclaw',
    repo: 'openclaw/openclaw',
    version: '1.0.0',
    tags: ['OpenClaw', 'Skill', '开发工具', '元技能'],
    desc: '创建、编辑、审核、整理、验证或重构Agent Skills和SKILL.md文件。规范化的Skill开发工作流工具。',
  },
  {
    slug: 'analytics-metrics',
    title: 'Analytics & Metrics — 数据可视化看板',
    category: '数据',
    author: 'hoodini',
    repo: 'hoodini/ai-agents-skills',
    version: '1.0.0',
    tags: ['数据可视化', '图表', 'Recharts', 'KPI', '看板'],
    desc: '使用Recharts构建数据可视化和分析看板，支持折线图、柱状图、饼图等，触发词：analytics、dashboard、charts、KPI。',
  },
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function main() {
  const tmpDir = 'C:\\temp_skills';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Step 1: Download ZIPs locally
  for (const s of skills) {
    const zipPath = `${tmpDir}\\${s.slug}.zip`;
    if (fs.existsSync(zipPath)) { console.log(`EXISTS (skip): ${s.slug}`); continue; }
    const url = `https://github.com/${s.repo}/archive/refs/heads/main.zip`;
    console.log(`Downloading ${s.slug}...`);
    await downloadFile(url, zipPath);
    console.log(`Done: ${s.slug} (${(fs.statSync(zipPath).size/1024).toFixed(1)}KB)`);
  }

  // Step 2: Upload each ZIP to server via SFTP
  const c = new Client();
  c.on('ready', () => {
    c.sftp((err, sftp) => {
      if (err) { console.error(err); c.end(); return; }
      let i = 0;
      function uploadNext() {
        if (i >= skills.length) {
          c.end();
          return;
        }
        const s = skills[i];
        const localPath = `${tmpDir}\\${s.slug}.zip`;
        const remotePath = `/www/wwwroot/agent.eake.cn/wp-content/downloads/${s.slug}.zip`;
        console.log(`Uploading ${s.slug}.zip...`);
        sftp.fastPut(localPath, remotePath, {}, (err2) => {
          if (err2) { console.error(`Upload error ${s.slug}:`, err2); i++; uploadNext(); return; }
          console.log(`Uploaded: ${s.slug}.zip`);
          i++;
          uploadNext();
        });
      }
      uploadNext();
    });
  }).connect({ host: '103.52.153.201', port: 22, username: 'root', password: 'Ea61091793' });
}

main().catch(console.error);
