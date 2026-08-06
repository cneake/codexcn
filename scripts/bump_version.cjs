/**
 * bump_version.cjs — 统一所有位置的版本号（构建前必跑）
 *
 * 用法:
 *   node scripts/bump_version.cjs 0.1.7     # 升级到 0.1.7（会自动改 tauri.conf.json）
 *   node scripts/bump_version.cjs           # 不带参数：从 tauri.conf.json 读当前版本，幂等同步其余位置
 *
 * 覆盖位置:
 *   1. src-tauri/tauri.conf.json        (version 字段，唯一真源)
 *   2. src-tauri/Cargo.toml            (version，决定 exe 文件版本 + get_app_version())
 *   3. src/App.tsx                     (侧边栏 track-version / 关于弹窗 / 免责声明 当前版本显示)
 *   4. src/locales/zh.json, en.json    (app.version)
 *
 * 注意: 更新日志(changelog)里的历史版本号 (如 v0.1.1 / v0.1.0) 故意不改，保留历史。
 * 服务器产品页/首页请用: node scripts/update_version_srv.cjs (SSH 不稳定需重试)
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/codexhubcn/cc-switch-clone';
const confPath = path.join(ROOT, 'src-tauri/tauri.conf.json');

let conf = fs.readFileSync(confPath, 'utf8');
let newVer = process.argv[2];
if (!newVer) {
  const m = conf.match(/"version":\s*"([^"]+)"/);
  newVer = m ? m[1] : null;
}
if (!newVer || !/^\d+\.\d+\.\d+$/.test(newVer)) {
  console.error('用法: node scripts/bump_version.cjs <x.y.z>');
  process.exit(1);
}
console.log('==> 目标版本:', newVer);

// 1. tauri.conf.json
conf = conf.replace(/"version":\s*"[^"]+"/, `"version": "${newVer}"`);
fs.writeFileSync(confPath, conf, 'utf8');
console.log('[1] tauri.conf.json ->', newVer);

// 2. Cargo.toml
const cargoPath = path.join(ROOT, 'src-tauri/Cargo.toml');
let cargo = fs.readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(/^version = "[^"]+"/m, `version = "${newVer}"`);
fs.writeFileSync(cargoPath, cargo, 'utf8');
console.log('[2] Cargo.toml ->', newVer);

// 3. App.tsx 当前版本显示（保留 changelog 历史）
const appPath = path.join(ROOT, 'src/App.tsx');
let app = fs.readFileSync(appPath, 'utf8');
const before = (app.match(/v0\.1\.\d+/g) || []).length;
app = app.replace(/v\d+\.\d+\.\d+\{isUpdateAvailable/g, `v${newVer}{isUpdateAvailable`);
app = app.replace(/版本 v\d+\.\d+\.\d+<\/p>/g, `版本 v${newVer}</p>`);
app = app.replace(/版本 v\d+\.\d+\.\d+ · 更新日期/g, `版本 v${newVer} · 更新日期`);
fs.writeFileSync(appPath, app, 'utf8');
console.log('[3] App.tsx 当前版本显示 ->', `v${newVer}`);

// 4. locales
for (const loc of ['zh.json', 'en.json']) {
  const p = path.join(ROOT, 'src/locales', loc);
  const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
  j['app.version'] = `v${newVer}`;
  fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
  console.log('[4]', loc, '->', j['app.version']);
}

console.log('\n本地版本号已统一为 v' + newVer);
console.log('下一步: pnpm tauri build --bundles nsis && node scripts/upload_v2.cjs');
console.log('服务器(产品页/首页): node scripts/update_version_srv.cjs');
