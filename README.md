<p align="center">
  <img src="src/assets/genhub-avatar.svg" width="120" alt="GenHub" />
</p>

<h1 align="center">GenHub</h1>
<p align="center">
  <strong>AI 工具切换台 — 让多个 AI Agent 在你的桌面协同工作</strong>
</p>

<p align="center">
  <a href="#-feature"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Rust-1.80%2B-orange" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-6.x-3178c6" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Tauri-2.x-ffc131" /></a>
</p>

<p align="center">
  <img src="docs/screenshot-hero.png" width="720" alt="GenHub Screenshot" />
  <br/>
  <em>（截图占位 — 替换为实际界面 GIF）</em>
</p>

---

## GenHub 是什么？

GenHub 不是一个聊天框。它是一个 **AI 工具切换台**——在桌面端同时管理多个 AI Agent，一键切换、并行对话，让 Claude Code、Hermes、OpenClaw 等工具在你的桌面上协同工作。

**传统方式**：开 5 个终端窗口，分别运行 5 个 CLI，来回 Alt+Tab 切换  
**GenHub 方式**：一个窗口，点击侧边栏一秒切换，所有 AI 共享同一个工作区

---

## 解决的问题

| 痛点 | GenHub 怎么解决 |
|------|----------------|
| 多个 AI CLI 散落各处 | 统一侧边栏，点击切换，无需开 N 个终端 |
| 每个工具都要单独配 API Key | 一次配置，所有工具共用 Provider |
| 切换工具后丢失上下文 | 工作区级对话历史持久化 |
| 不知道哪个工具适合当前任务 | 工具标签 + 能力说明，一目了然 |
| 手动安装 CLI 依赖地狱 | 内置工具安装器，一键装齐 Node/Python/Git/uv |

---

## 功能矩阵

### AI 工具管理
- **8 个 CLI 工具**：Claude Code、Claude Desktop、Codex、Gemini CLI、OpenCode、OpenClaw、Hermes Agent、Qoder CLI
- **10+ Provider 预设**：OpenAI、Anthropic、Google Gemini、DeepSeek、火山引擎/Doubao、MoonShot 等
- **一键切换**：点击侧边栏，0.5 秒切换工具，保留对话上下文
- **并行对话**：多个工具同时开启不同对话，互不干扰

### 开发者工具套件
- **Monaco 编辑器**：VS Code 内核，支持所有主流语言语法高亮
- **内嵌终端**：xterm.js 多标签终端，无需切换到外部 Terminal
- **Git 面板**：clone / status / commit / diff / 分支管理，一站式
- **代码执行器**：Python / JavaScript / Shell 在线运行
- **文件树**：VS Code 风格 EXPLORER，右键新建/重命名/删除

### 高级特性
- **技能系统**：npm 安装 + ZIP 导入 + 市场搜索，扩展 AI 能力边界
- **多 Agent 编排**：多个子 Agent 并行讨论，自动汇总结论
- **定时任务**：Cron 调度器，到点自动执行
- **Token 计量**：SQLite 持久化，按 Provider/模型追踪用量
- **本地网关**：127.0.0.1:7899 反向代理
- **SSH 远程**：连接远程服务器，远程 AI 辅助运维

---

## 技术架构

```
 ┌──────────────────────────────────────────┐
 │              React 19 + Vite 8           │  ← WebView 前端
 │   Monaco Editor · xterm · react-markdown │
 ├──────────────────────────────────────────┤
 │             Tauri 2 (Rust)               │  ← 系统桥接层
 │   命令注册 · 窗口管理 · 系统托盘 · 菜单   │
 ├──────────────────────────────────────────┤
 │              Rust 后端核心                │  ← 本地能力
 │  SQLite · 网关 · 进程管理 · 沙箱 · Cron  │
 └──────────────────────────────────────────┘
```

**为什么选 Tauri？**  
比起 Electron，Tauri 2 打包体积小 10 倍、内存占用低 60%、启动速度快 3 倍。Rust 后端原生处理文件 I/O、进程管理、定时任务——不依赖 Node.js 运行时。

---

## 快速开始

### 前提条件
- [Rust](https://rustup.rs/) 1.80+
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 8+
- Windows: [Microsoft Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 安装与运行

```bash
git clone https://github.com/YOUR_USERNAME/genhub.git
cd genhub

pnpm install
pnpm tauri:dev
```

### 构建安装包

```bash
pnpm tauri:build
```

安装包位于 `src-tauri/target/release/bundle/`

---

## 项目结构

```
genhub/
├── src/                    # React 前端 (~35 组件)
│   ├── components/         # ChatMain, SettingsModal, GitPanel, Terminal...
│   ├── assets/             # 图标、头像
│   └── locales/            # 国际化 (zh / en)
├── src-tauri/              # Rust 后端 (~18 个功能模块)
│   └── src/
│       ├── lib.rs          # 命令注册
│       ├── db.rs           # SQLite 数据库
│       ├── gateway.rs      # 本地反向代理
│       ├── orchestrator.rs # 多 Agent 编排
│       ├── skills.rs       # 技能系统
│       └── ...             # 16 个独立功能模块
├── skills.json             # 技能索引
└── CHANGELOG.md            # 更新日志
```

---

## 贡献

我们欢迎所有形式的贡献！从 Bug 报告到 PR，从文档改进到技能开发。

### 快速贡献点
- 查看 [Good First Issues](https://github.com/YOUR_USERNAME/genhub/labels/good%20first%20issue)
- 为 GenHub 开发一个技能（Skill）
- 改进中英文翻译
- 修复 CHANGELOG 中列出的已知问题

### 贡献流程
1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交修改 (`git commit -m 'feat: add amazing feature'`)
4. 推送 (`git push origin feat/amazing-feature`)
5. 创建 Pull Request

---

## 路线图

- [x] 8 CLI 工具管理
- [x] Monaco 编辑器 + 终端 + Git
- [x] 技能系统 + 市场
- [x] Token 用量统计
- [x] 多 Agent 编排
- [ ] VS Code 插件（在编辑器中直接调用 GenHub）
- [ ] 技能开发者工具（一键打包上传）
- [ ] Web 版（浏览器直接使用）
- [ ] 团队协作（共享工作区 + 技能）

---

## 许可证

MIT © 2024 安宁亚蓝信息技术有限公司

---

## 致谢

GenHub 建立在众多优秀的开源项目之上：
- [Tauri](https://tauri.app/) — 极致轻量的桌面应用框架
- [React](https://react.dev/) — UI 框架
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — VS Code 内核编辑器
- [xterm.js](https://xtermjs.org/) — 终端模拟器
- [SQLite](https://sqlite.org/) — 嵌入式数据库
