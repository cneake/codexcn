const fs = require('fs');
const f = 'D:/codexhubcn/cc-switch-clone/src/App.tsx';
let data = fs.readFileSync(f, 'utf8');

// 定位 changelog 条目区块：从 v0.1.1 条目开始，到 v0.0.2 条目闭合结束
const startAnchor = "<div style={{color:'var(--text)',fontWeight:500}}>v0.1.1</div>";
const si = data.indexOf(startAnchor);
const blockStart = data.lastIndexOf('<div style={{marginBottom:12}}>', si);

const endAnchor = '配置模板系统</div>';
const ei = data.indexOf(endAnchor);
const blockEnd = data.indexOf('</div>', ei) + '</div>'.length;

const L1 = '                '; // 16 spaces
const L2 = '                  '; // 18 spaces
const TRANS = '修复了已知 BUG，增强可用性（过渡版本）';

const versions = [
  ['v0.1.6', [
    '品牌升级为 GenHub（原 CodexHub CN）',
    '平台账号登录 / 注册（聊天记录本地持久化）',
    '多 Agent 协作（主 Agent 派发子任务 + 汇总）',
    '自然语言定时任务（对话建任务自动执行）',
    '沙箱代码运行（Python / JS / Shell）',
    '所有弹窗支持拖动',
  ]],
  ['v0.1.5', [
    '品牌更名 GenHub，统一图标与配色',
    '登录认证与用户体系',
    '截图增强（自由选区 / 窗口识别 / 工具栏跟随）',
    '模型库详情页更新',
  ]],
  ['v0.1.4', [
    '三屏布局与文件树',
    'Git 操作面板',
    '全屏模式',
    '全面中文化',
  ]],
  ['v0.1.3', [
    'Code Runner 多语言执行 + stdin',
    '模型 combobox 与版本动态获取',
    'Grok Build 集成',
  ]],
  ['v0.1.2', [
    '本地反向代理网关（API Key 注入）',
    '公告系统',
    '使用手册清理',
  ]],
  ['v0.1.1', [
    '截图功能（自由选区 + canvas 裁剪 + 工具栏）',
    '文件附件（图片 / 文本上传 + 缩略图）',
    '技能市场重构（用户上传 / 出厂内置）',
    '技能调用：5秒去重 + tools 字段流式解析 + 对话框高亮',
    'Token 账本（费用 / 余额 / 趋势）',
    '清理存储空间',
    '修复 dist 目录同步（vite 与 Tauri 读取路径不一致）',
  ]],
  ['v0.1.0', [
    '新增 eaKe API 统一中转（推荐）',
    '技能市场（313 个技能，WordPress API）',
    'Agent 管理（版本检测/一键升级/诊断冲突）',
    'MCP 管理（21 个预设服务）',
    'NSIS 中文卸载界面',
    '一键安装弹窗 + 已安装工具卸载',
    'Provider 申请 API Key 链接全覆盖',
    '6 个工具专属彩色 SVG 图标',
  ]],
  ['v0.0.9', [TRANS]],
  ['v0.0.8', [TRANS]],
  ['v0.0.7', [TRANS]],
  ['v0.0.6', [TRANS]],
  ['v0.0.5', [TRANS]],
  ['v0.0.4', [
    '内嵌终端管理（6 个 AI CLI 工具）',
    '终端切换视图自动重连',
    '浅色/深色主题切换优化',
    '数据导入/导出功能',
    '启动 Splash 屏幕优化',
  ]],
  ['v0.0.3', [
    '流式聊天界面（SSE）',
    '52px 图标轨道 UI 布局',
    '会话管理 & 历史记录',
    '自动版本检测 & 更新',
    '系统托盘 + 单例运行',
  ]],
  ['v0.0.2', [
    '18 个 Provider 一键切换',
    '6 个 CLI 工具检测与安装',
    'MCP 服务管理',
    '用量统计与告警',
    '配置模板系统',
  ]],
  ['v0.0.1', [
    '项目初始化与基础架构',
    '单工具聊天框架搭建',
  ]],
];

function entry(v, items, last) {
  const open = last ? '<div>' : '<div style={{marginBottom:12}}>';
  let s = L1 + open + '\n';
  s += L2 + `<div style={{color:'var(--text)',fontWeight:500}}>${v}</div>\n`;
  for (const it of items) {
    s += L2 + `<div>• ${it}</div>\n`;
  }
  s += L1 + '</div>';
  return s;
}

let newBlock = '';
for (let i = 0; i < versions.length; i++) {
  newBlock += entry(versions[i][0], versions[i][1], i === versions.length - 1);
  if (i !== versions.length - 1) newBlock += '\n';
}

data = data.slice(0, blockStart) + newBlock + data.slice(blockEnd);
fs.writeFileSync(f, data, 'utf8');
console.log('changelog filled. total versions:', versions.length);
