# GenHub Good First Issues

> 标注 `good first issue` 标签，面向想参与开源的新贡献者。
> 每个 Issue 包含：任务描述、涉及文件、难度、预估时间。

---

## #1 完善英文国际化翻译

**难度**: ⭐ | **预估**: 1-2h | **类型**: i18n

`src/locales/en.json` 当前内容过时（仍使用旧品牌名 "CodexHub"，版本号 v0.1.1），且缺少 `zh.json` 中已有的多数键值。

**待完成：**
- 将 `app.title` 从 "CodexHub" 改为 "GenHub"
- 补充 `zh.json` 中存在但 `en.json` 缺失的所有翻译键
- 修正乱码部分（如 `"language.zh": "涓枃"` → `"Chinese"`）

**涉及文件：**
- `src/locales/en.json`
- `src/locales/zh.json`（对照参考）

---

## #2 为缺失错误处理的接口添加 toast 提示

**难度**: ⭐ | **预估**: 1h | **类型**: UX

`src/App.tsx:1735` 有一处 `// TODO: toast 提示`，当前 API 调用失败时没有用户可见的错误提示。

**待完成：**
- 实现 toast 通知组件（或引入轻量 toast 库）
- 在 API 调用失败时显示 toast 而不是静默失败
- 覆盖场景：Provider 保存失败、工具安装失败、技能加载失败

**涉及文件：**
- `src/App.tsx`（主逻辑）
- 新建 `src/components/Toast.tsx` + `Toast.css`

---

## #3 添加 Hermes / OpenClaw / Claude Code 的工具描述

**难度**: ⭐ | **预估**: 30min | **类型**: 内容

侧边栏工具列表中，Hermes、OpenClaw、Claude Code 缺少能力描述。在 `src-tauri/src/db.rs` 中补充 tool 的 description 字段。

**待完成：**
- 为 hermes-agent 添加描述：双马尾天才编程少女，专精 Rust/TypeScript 代码审查与重构
- 为 openclaw 添加描述：多 Agent 自动化编排引擎
- 为 claude-code 添加描述：Claude 驱动的 CLI 编程助手

**涉及文件：**
- `src-tauri/src/db.rs`（查找工具初始化代码）
- 或相应的工具配置 JSON

---

## #4 清理备份文件和调试代码

**难度**: ⭐ | **预估**: 30min | **类型**: 清理

`src/` 目录下存在多个 `.bak_*` 备份文件（如 `App.tsx.bak_20260717_200901`），以及部分调试用的 `console.log`。

**待完成：**
- 确认所有 `.bak_*` 文件不再需要，移动或删除
- 搜索并移除调试用的 `console.log`（保留必要的错误日志）
- 检查 `src-tauri/src/lib.rs` 中是否还有残留的调试代码

**涉及文件：**
- `src/App.tsx.bak_*`
- `src/App.tsx`
- `src-tauri/src/lib.rs`

---

## #5 补充 SettingModal 中的「关于」页面

**难度**: ⭐⭐ | **预估**: 1-2h | **类型**: Feature

设置弹窗的「关于」标签页当前内容单薄，只有版本号。补充完整信息。

**待完成：**
- 添加技术栈展示（Rust + Tauri + React + TypeScript）
- 添加开源仓库链接
- 添加第三方依赖致谢列表
- 可选：添加检查更新按钮

**涉及文件：**
- `src/components/SettingsModal.tsx`
- `src/components/SettingsModal.css`

---

## #6 修复 CHANGELOG.md 格式一致性

**难度**: ⭐ | **预估**: 30min | **类型**: 文档

CHANGELOG 各版本使用不同格式（有的用 `### 新功能`，有的用 `- **功能名**`），统一为 [Keep a Changelog](https://keepachangelog.com/) 规范。

**待完成：**
- 统一所有版本条目为 `Added / Changed / Fixed / Removed` 格式
- 补充 v0.1.5 和 v0.1.6 的变更记录

**涉及文件：**
- `CHANGELOG.md`

---

## #7 为 .github/ 目录添加 Issue 模板

**难度**: ⭐ | **预估**: 30min | **类型**: 社区

当前仓库缺少 GitHub Issue 和 PR 模板。

**待完成：**
- 创建 `.github/ISSUE_TEMPLATE/bug_report.md`
- 创建 `.github/ISSUE_TEMPLATE/feature_request.md`
- 创建 `.github/pull_request_template.md`

**涉及文件：**
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/pull_request_template.md`

---

## #8 添加键盘快捷键文档

**难度**: ⭐ | **预估**: 1h | **类型**: 文档 + Feature

`ShortcutsModal` 已存在但快捷键列表可能不完整。完善快捷键并生成文档。

**待完成：**
- 审计所有已实现的快捷键（搜索 `onKeyDown` / `KeyboardEvent`）
- 补充到 `ShortcutsModal` 的展示列表
- 在 README 中添加快捷键速查表

**涉及文件：**
- `src/components/ShortcutsModal.tsx`
- `README.md`
