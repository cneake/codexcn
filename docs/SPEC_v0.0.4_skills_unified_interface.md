# CodexHub CN v0.0.4 技术方案
## 统一聊天界面调用工具 Skills

**版本：v0.0.4**
**日期：2026-06-23**
**状态：待用户确认后开工**

---

## 一、核心目标

让用户在 CodexHub CN 统一聊天界面里，选择任意工具后，能真正使用该工具的原生能力（读文件、写文件、执行命令等），而非仅发 API 聊天。

**产品原则**：
- 默认允许执行（自动执行，不弹确认框）
- 危险操作才弹确认（删除/格式化/系统级命令）
- 方案C混合：日常对话走统一界面，高级功能跳转工具原版

---

## 二、技术架构

### 2.1 数据流

```
用户选择工具（如Claude Code）
        ↓
用户发送消息："帮我读一下 config.json"
        ↓
前端 → Rust后端 `/api/chat/stream`
        ↓
Rust后端 → 调该工具 API（ Anthropic / OpenAI 兼容 / 其他）
        ↓
API 返回 tool_use (read_file)
        ↓
Rust后端 执行 Skill（读本地文件）
        ↓
结果通过 SSE 返回前端 → 用户看到 "✅ 已读取 config.json"
        ↓
同时 API 继续对话 → 最终回复用户
```

### 2.2 架构分层

```
┌─────────────────────────────────────────────────────┐
│                   前端 React UI                       │
│  聊天消息 / Skill执行过程展示 / 危险操作确认弹窗       │
└──────────────────────┬────────────────────────────────┘
                       │ invoke / SSE
┌──────────────────────▼────────────────────────────────┐
│              Rust Tauri 后端                          │
│  ┌──────────────────────────────────────────────┐   │
│  │            Skill Executor (核心)               │   │
│  │  receive_tool_call(tool_name, args)           │   │
│  │       ↓                                        │   │
│  │  根据 tool_name 调用对应 Skill Handler         │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │           Tool Adapter Layer                  │   │
│  │  ClaudeCodeAdapter / CodexAdapter /          │   │
│  │  GeminiAdapter / DeepSeekAdapter / ...       │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │          Universal Skills                    │   │
│  │  read_file / write_file / run_command       │   │
│  │  search_code / git_operations               │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                       ↓
              各工具官方 API
```

---

## 三、Skill 定义

### 3.1 Phase 1 实现（3个通用 Skill）

| Skill | 描述 | 示例 |
|-------|------|------|
| `read_file` | 读取文件内容 | "读 config.json" |
| `write_file` | 写入文件内容 | "写这些代码到 main.py" |
| `run_command` | 执行终端命令 | "跑 `npm install`" |

### 3.2 危险操作判定

以下操作**弹确认弹窗**，用户点"确认"后才执行：

| 操作 | 判断规则 |
|------|----------|
| 删除文件 | path 包含 `delete` / `remove` / `trash` |
| 删除目录 | 同上 |
| 格式化 | 命令含 `format` / `mkfs` / `rm -rf` / `del /f /s` |
| 系统级命令 | `reg add` / `net user` / `shutdown` / `taskkill`（非本进程） |
| 网络操作 | `curl` / `wget` 到非常用域名（白名单待定） |
| 写入系统目录 | Windows `C:\Windows\` / Linux `/etc/` / `/usr/` |

**默认允许的操作**：读文件、执行项目目录内的命令、写文件到项目目录。

---

## 四、后端实现

### 4.1 Rust 模块结构

```
src-tauri/src/
├── skills/
│   ├── mod.rs              # Skill Executor 入口
│   ├── universal/
│   │   ├── mod.rs
│   │   ├── read_file.rs   # read_file Skill
│   │   ├── write_file.rs  # write_file Skill
│   │   └── run_command.rs # run_command Skill
│   ├── adapters/
│   │   ├── mod.rs
│   │   ├── anthropic.rs   # Claude Code 适配器
│   │   ├── openai.rs      # Codex / Gemini CLI / DeepSeek 适配器
│   │   └── custom.rs      # Hermes / OpenClaw / OpenCode 适配器
│   └── dangerous.rs        # 危险操作判定
```

### 4.2 Skill Executor 接口

```rust
// skills/mod.rs
pub struct SkillResult {
    pub success: bool,
    pub output: String,      // 执行结果（用于API继续对话）
    pub display: String,      // 显示给用户的内容（格式化后）
    pub is_dangerous: bool,   // 是否危险操作
    pub danger_reason: Option<String>,
}

pub async fn execute_skill(
    tool_id: &str,           // claude-code / codex / deepseek / ...
    tool_call: ToolCall,     // { name, arguments }
    api_key: &str,
    base_url: &str,
) -> Result<SkillResult, Box<dyn Error + Send + Sync>>;
```

### 4.3 API 调用逻辑（复用现有 `send_chat_message`）

**修改点**：
- `send_chat_message` 不再直接调 API
- 新增 `send_chat_message_with_skills`：检测到 tool_use 时先执行 Skill，再将结果注入 API 继续

```rust
// 修改 lib.rs / chat.rs
pub async fn send_chat_message_with_skills(
    tool_id: String,
    message: String,
    session_id: String,
) -> Result<ChatStreamResponse, ...> {
    // 1. 调用工具 API（单轮，不等 tool_use 结果）
    let response = call_tool_api_once(&tool_id, &message, &session_id).await?;
    
    // 2. 检查是否有 tool_use
    if let Some(tool_calls) = response.tool_calls {
        for tool_call in tool_calls {
            // 3. 判定是否危险
            let danger = check_dangerous(&tool_call.name, &tool_call.arguments);
            
            if danger.is_dangerous {
                // 危险操作：返回前端让用户确认（不执行）
                return Ok(ChatStreamResponse::DangerousOp { 
                    tool_call, 
                    reason: danger.reason,
                });
            } else {
                // 4. 执行 Skill
                let result = execute_skill(&tool_id, tool_call).await?;
                
                // 5. 将结果注入 API 继续对话
                let continuation = format!(
                    "Tool {} returned: {}",
                    tool_call.name, result.output
                );
                return call_tool_api_once(&tool_id, &continuation, &session_id).await;
            }
        }
    }
    
    // 无 tool_use，直接返回普通回复
    Ok(ChatStreamResponse::Final(response))
}
```

### 4.4 Skill Handler 示例（read_file）

```rust
// skills/universal/read_file.rs
use std::path::Path;

pub async fn read_file(path: &str) -> Result<String, String> {
    let path = Path::new(path);
    
    // 安全检查：禁止读取系统目录
    let forbidden = ["C:\\Windows", "C:\\Program Files", "/etc/", "/usr/bin"];
    for dir in &forbidden {
        if path.to_string_lossy().contains(dir) {
            return Err(format!("禁止读取系统目录: {}", dir));
        }
    }
    
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("读取失败: {}", e))
}
```

### 4.5 Tool Adapter 示例（Claude Code / Anthropic）

```rust
// skills/adapters/anthropic.rs
use reqwest::Client;
use serde_json::json;

pub async fn call_anthropic_api(
    api_key: &str,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let client = Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": "claude-sonnet-4-20250514",
            "messages": messages,
            "tools": tools,
            "max_tokens": 4096
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    response.json().await.map_err(|e| e.to_string())
}
```

---

## 五、前端实现

### 5.1 消息渲染扩展

在 `ChatMessage` 组件中，新增 skill 执行过程展示：

```tsx
// ChatMessage.tsx 新增
{msg.type === 'skill_executing' && (
  <div className="skill-executing">
    <span className="skill-icon">⚙️</span>
    <span>执行 {msg.toolName}...</span>
  </div>
)}

{msg.type === 'skill_result' && (
  <div className="skill-result">
    <span className="skill-icon">✅</span>
    <pre>{msg.output}</pre>
  </div>
)}

{msg.type === 'dangerous_confirm' && (
  <div className="dangerous-confirm">
    <span className="danger-icon">⚠️</span>
    <p>即将执行危险操作：{msg.reason}</p>
    <p>命令：{msg.command}</p>
    <button onClick={() => confirmDangerous(msg.toolCallId)}>确认执行</button>
    <button onClick={() => cancelDangerous(msg.toolCallId)}>取消</button>
  </div>
)}
```

### 5.2 危险操作确认弹窗

复用现有 `overlay` + `modal-box` 样式：

```tsx
// DangerousConfirmModal.tsx
const DangerousConfirmModal = ({ toolCall, reason, onConfirm, onCancel }) => {
  return (
    <div className="overlay">
      <div className="modal-box dangerous-modal">
        <h3>⚠️ 危险操作确认</h3>
        <p>{reason}</p>
        <div className="command-preview">{toolCall.name}({JSON.stringify(toolCall.args)})</div>
        <div className="modal-actions">
          <button className="btn-danger" onClick={onConfirm}>确认执行</button>
          <button className="btn-cancel" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
};
```

### 5.3 Skill 执行日志面板（可选）

在聊天界面底部或侧边，显示最近执行的 Skill 列表：

```
[✅] read_file: config.json (0.3s)
[✅] write_file: main.py (1.2s)
[⚠️] delete: temp/ — 已取消
```

---

## 六、DeepSeek 第7个工具

### 6.1 添加位置

顶部工具栏新增 DeepSeek 图标，与现有 6 个工具并列。

### 6.2 技术实现

DeepSeek API 是 OpenAI 兼容格式，复用 `OpenAIAdapter`：

| 项目 | 值 |
|------|-----|
| API URL | `https://api.deepseek.com/v1/chat/completions` |
| 模型 | `deepseek-chat` |
| 认证 | Bearer Token |
| Function Call | OpenAI 格式 |

### 6.3 数据库变更

```sql
-- cli_tools 表新增 deepseek
INSERT INTO cli_tools (id, name, display_name, icon, enabled) 
VALUES ('deepseek', 'deepseek', 'DeepSeek', 'deepseek.svg', 1);

-- tool_provider_configs 表新增默认映射
INSERT INTO tool_provider_configs (tool_id, provider_id, model_mapping)
VALUES ('deepseek', 'siliconflow', '{"model": "deepseek-chat"}');
```

### 6.4 前端修改

```tsx
// App.tsx / ChatSidebar.tsx - TOOL_LIST
{
  id: 'deepseek',
  label: 'DeepSeek',
  icon: DeepSeekIcon,
  provider: 'siliconflow',
  api_format: 'openai',  // 复用 OpenAI 适配器
}
```

---

## 七、构建与发布

### 7.1 开发里程碑

| 阶段 | 内容 | 预计工时 |
|------|------|----------|
| Week 1 D1-D2 | 后端 Skill Executor 框架 + read_file Skill | 4h |
| Week 1 D3-D4 | write_file + run_command Skill + 危险判定 | 4h |
| Week 1 D5 | Claude Code + Codex Adapter 对接 | 3h |
| Week 2 D1-D2 | DeepSeek 第7工具 + 前端 UI | 3h |
| Week 2 D3-D4 | 危险操作确认弹窗 + 前端 Skill 日志 | 3h |
| Week 2 D5 | 联调测试 + Bug 修复 | 4h |

### 7.2 测试计划

- [ ] 读文件：正常读取 / 读取系统目录被拒绝
- [ ] 写文件：正常写入 / 写入系统目录被拒绝
- [ ] 执行命令：项目内命令正常 / 危险命令弹确认
- [ ] 7个工具切换：每个工具聊天功能正常
- [ ] DeepSeek：API 调用 + Function Call 正常

---

## 八、已知风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| API token 泄露 | Skill 执行暴露敏感信息 | Skill 执行结果不持久化，只做临时传递 |
| 文件路径穿越 | `../../etc/passwd` 读取系统文件 | 路径规范化后做白名单检查 |
| 命令注入 | `run_command` 执行恶意命令 | 命令白名单 + 参数过滤 |
| 各工具 Function Call 格式不一致 | 适配器工作量翻倍 | Phase 1 只做 Claude Code + Codex（Anthropic + OpenAI 格式最标准） |
