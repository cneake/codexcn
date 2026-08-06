# Tauri 官方 Showcase 提交方案

## 提交地址

- Tauri 官方 Showcase 提交：https://github.com/tauri-apps/tauri/discussions/categories/showcase
- Tauri 官网展示申请：https://tauri.app/showcase/（通过 GitHub Discussion 被选中后自动收录）

---

## 提交内容（中英双语）

### 英文版 Discussion 标题

```
[Showcase] GenHub — AI CLI Tool Switcher & Desktop AI Workbench
```

### 英文正文

```
## GenHub

A desktop AI workbench that lets you manage and switch between 
multiple AI CLI tools (Claude Code, Hermes, OpenClaw, Gemini CLI, etc.) 
in a single window — no more Alt+Tabbing between 5 terminals.

### Built with Tauri 2

- Frontend: React 19 + TypeScript 6 + Vite 8
- Backend: Rust (18 modular crates)
- Key Tauri features used: single-instance, shell, dialog, fs, tray-icon

### Why Tauri?

We chose Tauri 2 over Electron for three reasons:
1. **5MB installer vs 150MB** — users install in seconds
2. **80MB RAM vs 400MB** — runs smoothly on 8GB machines
3. **Native Rust backend** — direct file I/O, process management, 
   SQLite without Node.js overhead

### Features

- 8 AI CLI tools in one window, one-click switching
- Tool-specific memory injection (each agent has its own SOUL.md)
- Built-in Monaco Editor (VS Code kernel) + xterm.js terminal
- Git panel (clone, diff, commit, branch management)
- Code runner (Python / JavaScript / Shell)
- Skill system with marketplace (npm / ZIP / one-click install)
- Multi-agent orchestration (parallel sub-agents with auto-summary)
- Token usage tracking (SQLite, per-provider/per-model)
- Local reverse proxy gateway (127.0.0.1:7899)
- Cron scheduler, SSH remote, screenshot tool

### Open Source

- GitHub: https://github.com/YOUR_USERNAME/genhub
- License: MIT
- Tech stack: Rust + Tauri 2 + React + TypeScript

### Screenshots

[Screenshot 1: Main chat interface with tool sidebar]
[Screenshot 2: Monaco Editor + terminal split view]
[Screenshot 3: Settings / Provider configuration]

---

Special thanks to the Tauri team for building an amazing framework.
```

---

## 截图清单

需要准备 3-4 张高质量截图（建议 2560x1440 或 1920x1080）：

| # | 内容 | 说明 |
|---|------|------|
| 1 | 主界面 | 侧边栏展示所有工具 + 聊天区域 + 顶部工具切换栏 |
| 2 | 编辑器模式 | Monaco Editor + 文件树 + 终端分屏 |
| 3 | 设置面板 | Provider 配置界面 + 模型选择 |
| 4 | Git 面板 | Diff 视图或 Commit 界面 |

**截图技巧：**
- 深色主题优先（GenHub 默认深色，截图更好看）
- 用真实对话内容，不要 Lorem Ipsum
- 截取 2560x1440 分辨率，Tauri 官网需要高清图

---

## 其他可提交的平台

| 平台 | 提交方式 | 优先级 |
|------|---------|--------|
| **Tauri Showcase** | GitHub Discussion | 最高 |
| **Rust 中文社区** | rustcc.cn 发帖 | 高 |
| **Awesome Tauri** | PR 到 [awesome-tauri](https://github.com/tauri-apps/awesome-tauri) | 高 |
| **Awesome Rust** | PR 到 [awesome-rust](https://github.com/rust-unofficial/awesome-rust) | 中 |
| **Product Hunt** | 发布产品页（需英文） | 中 |
| **Hacker News** | Show HN 发帖 | 中 |

---

## Awesome Tauri PR 内容

```markdown
### GenHub

[GenHub](https://github.com/YOUR_USERNAME/genhub) — AI CLI tool switcher 
and desktop AI workbench. Manage Claude Code, Hermes, OpenClaw, and 
more in a single window. Built with Tauri 2, React 19, and Rust.

![GenHub](./screenshot.png)
```

---

## Awesome Rust PR 内容

分类放在 `Applications — Productivity` 下：

```markdown
* [GenHub](https://github.com/YOUR_USERNAME/genhub) — Desktop AI workbench.
  Manage multiple AI CLI tools (Claude Code, Hermes, OpenClaw) in one window.
  Built with Tauri 2.
```

---

## 建议执行顺序

1. **当天**：README 已就绪 → Push 到 GitHub
2. **第 2 天**：截 3 张高质量截图 → 提交 Tauri Showcase Discussion
3. **第 3 天**：发技术文章到 V2EX + 掘金（`docs/promo-article.md`）
4. **第 4 天**：PR 到 awesome-tauri + awesome-rust
5. **持续**：在 V2EX/掘金回复评论，保持帖子活跃度
