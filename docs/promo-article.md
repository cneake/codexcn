# 我受够了在 5 个 AI 终端之间切来切去，于是用 Rust + Tauri 写了个工具切换台

> 贴在 V2EX → 开发者分享；发在掘金 → 前端 / Rust 双标签

---

每天的工作流大概是这样：

1. Claude Code 里写后端逻辑
2. 切到 Hermes 做代码审查
3. 再切到 OpenClaw 跑自动化脚本
4. 然后 Gemini CLI 帮我翻译文档
5. 时不时还得开普通终端 git commit

于是桌面上 5 个终端窗口，Alt+Tab 按到手指抽筋。

而且每个 CLI 工具都要单独配 API Key，token 用量也不知道，月底一看账单——裂开。

## 为什么不直接用 VS Code 插件？

VS Code 里的 AI 插件确实不少，Copilot、Cody、Continue……但问题在于：

- **绑定编辑器**：你在 Terminal 里跑脚本、在浏览器里看文档的时候，它帮不上忙
- **单一模型**：大部分插件只对接一个 Provider，想换模型得装另一个插件
- **没有工具管理**：Claude Code 这种 CLI-first 的工具，VSC 插件管不了

我想要的不是「一个自带 AI 的编辑器」，而是「一个管理 AI 工具的操作台」。

## 技术选型：为什么是 Rust + Tauri

摆在我面前有三个选项：

| 框架 | 打包体积 | 内存占用 | 启动速度 | 生态 |
|------|---------|---------|---------|------|
| Electron | 150MB+ | 400MB+ | 慢 | 海量 |
| Tauri 1.x | 5MB | 100MB | 快 | 一般 |
| **Tauri 2.x** | **5MB** | **80MB** | **很快** | **快速增长** |

选了 Tauri 2。Rust 后端直接处理文件 I/O、进程管理、SQLite——全是原生性能，不经过 Node.js 中转。

前端 React 19 + Vite 8 + TypeScript 6，全部最新版，没历史包袱。

## 架构：怎么能让 8 个 CLI 共存在一个窗口里

核心思路很简单：

```
┌───────────────────┐  ┌──────────────────────────┐
│   32px 侧边栏     │  │                          │
│                   │  │      AI 对话区域          │
│  🕊 Hermes       │  │                          │
│  ⚙ OpenClaw     │  │   "帮我 review 这段代码"    │
│  ⚡ Claude Code  │  │                          │
│  ...             │  │   [消息列表] [输入框]      │
│                   │  │                          │
└───────────────────┘  └──────────────────────────┘
```

关键设计决策：

**1. 每个工具独立会话**

不是「统一对话窗口切换模型」，而是每个工具维护自己的会话列表。切到 Hermes 看到的是 Hermes 的对话历史，切到 Claude Code 看到的是 Claude Code 的——心理模型不同，使用场景也不同。

**2. 工具专属记忆文件**

Hermes 加载 `~/.hermes/SOUL.md`，OpenClaw 加载 `~/.openclaw/AGENTS.md`，每个工具在对话前注入自己的角色设定和记忆。这样切工具时人格和行为准则也跟着切。

```rust
// lib.rs — 注入工具专属记忆
if let Some(mem_files) = memory_files_for_tool(&tool_id) {
    for path in &mem_files {
        if let Ok(content) = std::fs::read_to_string(path) {
            system_prompt.push_str(&format!(
                "\n\n<!-- {} -->\n{}",
                path.file_name().unwrap_or_default().to_string_lossy(),
                content
            ));
        }
    }
}
```

**3. 统一 Provider 管理**

所有工具共享 Provider 配置。Claude Code 用 Anthropic、Hermes 用 DeepSeek——在设置里配一次，所有工具都能用。不用每个 CLI 重复填 API Key。

## 那些踩过的坑

### 坑 1：Rust borrow checker 教你做人

Tauri 的状态管理用 `Mutex<HashMap<String, Child>>` 存进程句柄。当你想同时 kill 多个进程时：

```rust
// ❌ 编译不过
for (name, child) in MCP_PIDS.lock().unwrap().iter_mut() {
    child.kill()?;
    MCP_PIDS.lock().unwrap().remove(name); // 死锁
}

// ✅ 先收集 key，再逐个处理
let keys: Vec<String> = MCP_PIDS.lock().unwrap().keys().cloned().collect();
for key in keys {
    if let Some(mut child) = MCP_PIDS.lock().unwrap().remove(&key) {
        child.kill()?;
    }
}
```

### 坑 2：Windows 下 EXE 进程锁

`cargo build --release` 时如果之前的 app.exe 还在跑着，rustc 拿不到文件锁直接报错。而且 Windows 的 `taskkill` 杀不干净，子进程残留。

解决办法：`taskkill /F /IM app.exe` 干掉所有残留 + 临时目录编译 `CARGO_TARGET_DIR=C:/tmp/cc-build`

### 坑 3：PPTX 解析越界

解析 `.pptx` 文件（本质是 ZIP）时，按 OpenXML 标准找标签。写成了 `</p>`（HTML 思维），实际应该是 `</a:p>`（OOXML 命名空间）。

```rust
// ❌ 边界条件没处理好，遇到截断的 XML 直接 panic
if end + 4 < len { ... }

// ✅ 加上安全边界
if end + 5 < len { ... }
```

### 坑 4：正则双重转义

在 Rust 的 raw string 里写正则，脑子没转过来：

```rust
// ❌ 写成了匹配字面量 \s
Regex::new(r#"\\s"#)

// ✅ raw string 里直接用 \s
Regex::new(r#"\s"#)
```

## 实际情况：它真的有用吗？

用了三周，真实感受：**不是「又一个工具」，而是「少开了 5 个窗口」。**

- 切到 Hermes 让它 review 刚才写的代码，1 秒切换，不用开新终端敲 `hermes review xxx`
- Git 面板直接在当前窗口看 diff、commit，不用切到 SourceTree 或命令行
- Monaco 编辑器改代码 + AI 对话并排，边聊边改，效率翻倍

当然也有不够好的地方：首次启动加载工具列表有点慢（SQLite 初始化），技能市场内容还不够丰富，Windows 安装包签名还在搞。

## 开源 & 试试看

GitHub: [github.com/yourname/genhub](https://github.com)

```bash
git clone https://github.com/yourname/genhub.git
cd genhub
pnpm install
pnpm tauri:dev
```

欢迎提 Issue、PR，或者给 GenHub 开发一个技能。Good First Issue 已经标好了，Rust / TypeScript / React 方向都有。

---

*如果你也有类似的「Alt+Tab PTSD」，试试看，也许少开 5 个终端的人生会好一点。*

*标签：Rust Tauri React TypeScript AI 工具 桌面应用 开源*
