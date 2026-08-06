# GenHub 更新日志

## v0.1.4 (2026-07-26)

### 编辑器功能
- **三屏布局**：左侧 EXPLORER 220px / 中间 Monaco 编辑器 / 右侧输出区 360px
- **文件树重写**：嵌套结构、展开/折叠动画、右键菜单（新建/重命名/删除）、顶部 📄+/📁+ 按钮
- **VS Code 风格文件图标**：Python 🐍、JS/TS、HTML/CSS、Go 等语言徽章
- **Monaco 主题跟随系统**：dark→`vs-dark`，light→`light`
- **错误高亮**：`MarkerSeverity.Error` + `revealLineInCenter` 自动滚动到错误行
- **文件树持久化**：`localStorage` 键 `genhub_filetree`，5 个写入点同步
- **全屏功能**：窗口最大化 + 隐藏左右栏，Esc 退出

### Git 面板
- **GitHub 按钮**：内联 SVG logo + 文字 + 下拉箭头
- **GitHub 菜单**：克隆仓库 / 在 GitHub 上查看 / 创建仓库 / 设置 Token
- **打开文件夹**：`pick_folder` 选择目录，切换工作区
- **非 Git 目录浏览**：显示文件列表，点击文件夹进入
- **中文化**：主分支/拉取/推送/提交/暂存/修改/未跟踪/已同步 等
- **加载提示**：文件列表加载中显示旋转图标 + "正在加载文件，请稍后……"

### 性能优化
- **目录读取**：排除 `.fingerprint`/`.cargo` 等 Rust 构建目录，避免显示 4 万+ 临时文件
- **GitHub 菜单**：`transition: all` → `transition: background-color`，`React.memo` 包裹菜单项
- **fetchStatus**：移除 `workspaceDir` 依赖，避免循环重渲染

### 修复
- GitHub 菜单连续点击卡死（`menuClosingRef` 标记）
- GitHub 菜单点击无反应（`window.open` → Tauri shell `open`）
- 目录加载性能问题（排除构建目录）
- Shell 多行执行（临时 `.bat` 文件）

---

## v0.1.3 (2026-07-25)

### 新功能
- Code Runner 多语言执行支持（Python/JavaScript/Shell）
- stdin 输入支持（后端 `Stdio::piped()`）
- Git 操作面板（状态/提交日志/分支三 Tab）
- 公告系统（WordPress CPT `announcement`）
- 本地反向代理网关（127.0.0.1:7899）

### 改进
- 产品页 Hero 区域重构
- Logo 替换为 GenHub
- 使用手册旧文清理

### 修复
- 文章 ID 207 截断问题
- 火山引擎（doubao）配置修复

---

## v0.1.2 (2026-07-18)

### 新功能
- 截图三件套（全屏截图→overlay 选区→canvas 裁剪→保存）
- 会员 + Token 全链路打通（WordPress 注册 → One API 账户自动创建）

### 改进
- 产品页兼容性标记
- 头像方案改为渐变首字母 div

---

## v0.1.0 (2026-07-04)

### 首次发布
- 8 个 CLI 工具管理（Claude Code/Claude Desktop/Codex/Gemini CLI/OpenCode/OpenClaw/Hermes Agent/Qoder CLI）
- 10 个 Provider 预设
- Token 计量统计（SQLite 持久化）
- 统一两栏 UI（32px 图标轨道 + 主区域）
- 浅色/深色主题切换
- 技能系统（npm 安装 + ZIP 安装）
- 环境检测汇总页面
