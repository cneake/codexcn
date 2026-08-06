/**
 * inject-nsis-lang.cjs
 * 在 Tauri 生成 NSIS 脚本后、编译前自动注入中文卸载界面文本
 * 用法：node inject-nsis-lang.cjs
 */

const fs = require('fs');
const path = require('path');

// 找到 target/release/nsis 目录（x64 或 x86）
function findNsisDir() {
  const bases = [
    path.join(__dirname, 'target', 'release', 'nsis', 'x64'),
    path.join(__dirname, 'target', 'release', 'nsis', 'x86'),
  ];
  for (const dir of bases) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// 要注入的中文 LangString 定义（用数组拼装，避开 ${} 模板字符串语法）
const CHINESE_LINES = [
  '',
  '; === Injected by inject-nsis-lang.cjs ===',
  '; NSIS MUI 标准卸载界面中文文本',
  'LangString ^UninstallCaption ${LANG_SIMPCHINESE} "$(^Name) 卸载"',
  'LangString ^UninstallSubCaption ${LANG_SIMPCHINESE} ": 确认"',
  'LangString ^UninstallingSubCaption ${LANG_SIMPCHINESE} ": 正在卸载"',
  'LangString ^UnCompletedSubCaption ${LANG_SIMPCHINESE} ": 完成"',
  'LangString ^UninstallBtn ${LANG_SIMPCHINESE} "卸载(&U)"',
  'LangString ^ConfirmSubCaption ${LANG_SIMPCHINESE} ": 确认"',
  'LangString ^CloseBtn ${LANG_SIMPCHINESE} "关闭(&L)"',
  '; === End injected strings ===',
  '',
];

function inject() {
  const nsisDir = findNsisDir();
  if (!nsisDir) {
    console.log('[inject-nsis-lang] 未找到 NSIS 目录，跳过注入');
    console.log('[inject-nsis-lang] 提示：如果这是构建时运行，说明 NSIS 脚本尚未生成，beforeBundleCommand 时机不对');
    return;
  }

  const nshPath = path.join(nsisDir, 'SimpChinese.nsh');
  if (!fs.existsSync(nshPath)) {
    console.log('[inject-nsis-lang] 未找到 ' + nshPath + '，跳过注入');
    return;
  }

  let content = fs.readFileSync(nshPath, 'utf8');

  // 避免重复注入
  if (content.includes('Injected by inject-nsis-lang.cjs')) {
    console.log('[inject-nsis-lang] 已注入过，跳过');
    return;
  }

  // 追加中文字符串（用换行符拼接，避免模板字符串 ${} 问题）
  content += CHINESE_LINES.join('\n');
  fs.writeFileSync(nshPath, content, 'utf8');
  console.log('[inject-nsis-lang] ✅ 已注入中文卸载文本到 ' + nshPath);
}

inject();
