# CodexHub / GenHub 源码 Bug 审查报告

**审查范围**: `src-tauri/src/` 下全部 22 个 Rust 源文件  
**审查日期**: 2026-08-06

---

## 严重 Bug (CRITICAL)

### Bug 1: Tauri 命令重复注册

**文件**: `lib.rs`  
**行号**: 430-433 和 512-516

`toggle_skill_overlay`、`log_skill_invoke`、`get_recent_skill_invokes` 三个命令在 `tauri::generate_handler!` 宏中被注册了**两次**：

```rust
// 第一次注册 (行 430-433)
toggle_skill_overlay,
log_skill_invoke,
get_recent_skill_invokes,
get_main_window_rect,

// ... 中间隔了 80 行 ...

// 第二次注册 (行 512-516)
toggle_skill_overlay,   // ← 重复！
log_skill_invoke,       // ← 重复！
get_recent_skill_invokes, // ← 重复！
```

**影响**: 编译时可能产生警告或错误，运行时可能导致命令注册冲突。  
**修复**: 删除第二次注册（行 512-514 的重复项）。

---

### Bug 2: `toggle_cron_job` 用空字符串查询任务

**文件**: `lib.rs`  
**行号**: 2798

```rust
fn toggle_cron_job(job_id: String, enabled: bool, ...) -> Result<(), String> {
    db.toggle_cron_job(&job_id, enabled)?;
    if enabled {
        let job = db.get_cron_jobs(&"".to_string())  // ← BUG: 用空字符串查 tool_id
            .ok()
            .and_then(|jobs| jobs.into_iter().find(|j| j.id == job_id));
        if let Some(job) = job {
            scheduler.start_job(job, app);
        }
    }
}
```

**影响**: `get_cron_jobs("")` 按空字符串过滤 `tool_id`，查不到任何任务，导致**启用定时任务时调度器不会启动该任务**。  
**修复**: `toggle_cron_job` 函数需要增加 `tool_id` 参数，或改用 `db.get_cron_job_by_id(&job_id)` 直接按 ID 查询。

---

### Bug 3: PPTX 解析器 `</a:t>` 闭合标签检测越界 Panic

**文件**: `binary_parser.rs`  
**行号**: 242-244

```rust
while end < len
    && !(chars[end] == '<' && end + 4 < len && chars[end + 1] == '/'
        && chars[end + 2] == 'a' && chars[end + 3] == ':'
        && chars[end + 4] == 't' && chars[end + 5] == '>')  // ← end+5 可能越界
```

**问题**: 条件 `end + 4 < len` 只保证 `end + 4` 是有效索引（`end + 4 ≤ len - 1`），但 `end + 5` 可能等于 `len`（越界）。当 PPTX XML 以 `...<` + `/at` 结尾时，`chars[end + 5]` 会 **panic**。

**对比**: DOCX 解析器（行 183-190）使用了正确的 `end + 5 < len` 条件。  
**修复**: 将 `end + 4 < len` 改为 `end + 5 < len`。

---

### Bug 4: PPTX 解析器段落标签检测错误

**文件**: `binary_parser.rs`  
**行号**: 217-223

```rust
// 检测 </p> 段落结束 → 换行
if chars[i] == '<' && i + 5 < len && chars[i + 1] == '/'
    && chars[i + 2] == 'p' && chars[i + 3] == '>'
```

**问题**: PPTX XML 使用 `<a:p>` / `</a:p>` 作为段落标签，不是 `<p>` / `</p>`。当前代码检测 `</p>`，永远不会匹配 `</a:p>`（因为 `chars[i+2]` 是 `a` 不是 `p`）。

**影响**: PPTX 幻灯片中所有段落文本被拼接成一行，无换行分隔。  
**修复**: 改为检测 `</a:p>`：
```rust
if chars[i] == '<' && i + 4 < len && chars[i + 1] == '/' && chars[i + 2] == 'a'
    && chars[i + 3] == ':' && chars[i + 4] == 'p' && chars[i + 5] == '>'
```

---

### Bug 5: `check_latest_version` 正则表达式双重转义错误

**文件**: `lib.rs`  
**行号**: 1722

```rust
let rel_path_re = regex::Regex::new(
    r#"(wp-content/downloads/[^"'<>\\s]+\\.(?:exe|msi|zip))"#
).unwrap();
```

**问题**: 在 Rust 原始字符串 `r#"..."#` 中：
- `\\s` 是 3 个字符 `\` `\` `s`，在正则中匹配**字面反斜杠 + 字母 s**，而非空白字符
- `\\.` 是 3 个字符 `\` `\` `.`，在正则中匹配**字面反斜杠 + 任意字符**，而非字面点号

**影响**:
1. 字符类 `[^"'<>\\s]` 排除了字母 `s`，导致包含 `s` 的路径无法匹配（如 `setup.exe`、`installer.msi`）
2. `\\.` 无法匹配文件扩展名前的点号 `.`
3. 空格未被排除，可能匹配到含空格的无效路径
4. **版本检测的备用下载链接提取完全失效**

**修复**: 将 `\\s` 改为 `\s`，`\\.` 改为 `\.`：
```rust
r#"(wp-content/downloads/[^"'<>\s]+\.(?:exe|msi|zip))"#
```

---

## 中等 Bug (MEDIUM)

### Bug 6: 网关日志记录请求体长度而非响应体长度

**文件**: `gateway.rs`  
**行号**: 201

```rust
let resp_len = body_bytes.len();  // ← body_bytes 是请求体，不是响应体
```

**问题**: `body_bytes` 是从 `req.collect()` 读取的**请求体**，但变量名 `resp_len` 和传入 `log_api_call` 的 `response_length` 参数都暗示这是响应长度。实际响应体在行 224 才读取。

**影响**: API 日志中记录的响应长度完全错误。  
**修复**: 在读取响应体后计算长度：
```rust
let resp_body = match resp.bytes().await { ... };
let resp_len = resp_body.len();
```

---

### Bug 7: `stop_all_running` 清除全部 PID 记录

**文件**: `process.rs`  
**行号**: 144

```rust
pub async fn stop_all_running(servers: Vec<crate::mcp::McpServer>) -> Vec<String> {
    for s in servers.into_iter().filter(|s| s.pid.is_some()) {
        // ... 停止进程 ...
    }
    MCP_PIDS.clear();  // ← 清除所有，包括未传入的服务器
}
```

**影响**: 如果传入的 `servers` 是全局 MCP 服务器的子集，`MCP_PIDS.clear()` 会清除所有 PID 记录，包括仍在运行的服务器。  
**修复**: 只移除已停止服务器的 PID：
```rust
for s in servers.iter().filter(|s| s.pid.is_some()) {
    if let Some(pid) = s.pid {
        // ...
        MCP_PIDS.remove(&s.id);
    }
}
// 删除 MCP_PIDS.clear();
```

---

### Bug 8: 沙箱永远报告 exit_code: 0

**文件**: `sandbox.rs`  
**行号**: 203-206

```rust
let _ = app.emit("sandbox_done", serde_json::json!({
    "session_id": sid_orig,
    "exit_code": 0,  // ← 硬编码 0，不检查实际退出码
}));
```

**问题**: 无论子进程实际退出码是什么，始终发送 `exit_code: 0`。进程超时被 kill 或异常退出时也报告成功。  
**修复**: 从 `child.wait()` 获取实际退出码。

---

### Bug 9: `apply_config_template` 未实际应用模板

**文件**: `lib.rs`  
**行号**: 606-610

```rust
fn apply_config_template(id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    let templates = db.get_config_templates()?;
    let _t = templates.into_iter().find(|t| t.id == id).ok_or("template not found")?;
    Ok("applied".to_string())  // ← 找到模板但什么都没做
}
```

**影响**: 前端调用"应用配置模板"后显示成功，但实际没有执行任何配置切换操作。  
**修复**: 遍历 `tool_provider_map`，调用 `db.activate_provider_for_tool()` 逐个应用。

---

### Bug 10: `static mut` 全局调度器（不安全）

**文件**: `cron_scheduler.rs`  
**行号**: 161

```rust
static mut SCHEDULER: Option<Arc<CronScheduler>> = None;
```

**问题**: 使用 `static mut` 存储全局状态，通过 `unsafe` 块读写。在多线程环境下可能导致**数据竞争**。  
**修复**: 使用 `std::sync::LazyLock<Mutex<Option<Arc<CronScheduler>>>>` 或 `once_cell::sync::Lazy`。

---

### Bug 11: 工具目录硬编码旧品牌名

**文件**: `config_writer.rs`  
**行号**: 9

```rust
let dir = PathBuf::from(pf).join("CodexHub CN").join("tools");
//                          ^^^^^^^^^^^^^^ 旧品牌名，但应用已更名为 GenHub
```

**影响**: 品牌升级后，安装目录可能变为 `GenHub`，但代码仍查找 `CodexHub CN`，导致找不到工具目录。  
**修复**: 同时检查 `"GenHub"` 和 `"CodexHub CN"` 两个目录名。

---

## 低级 Bug (LOW)

### Bug 12: 大量乱码注释和错误消息

**文件**: `lib.rs`  
**多处行号**: 450, 754, 1398, 1402, 1412, 1446, 1520, 1530, 1700

多处注释和错误消息存在编码损坏（mojibake），例如：
- 行 1398: `Err("缁愭褰涢張顏呭閸?".to_string())` — 错误消息无法阅读
- 行 450: `// 鎼存梻鏁ら幒褍鍩?` — 注释无法阅读
- 行 754: `// Provider 閸涙垝鎶?` — 注释无法阅读

**影响**: 错误消息会直接显示给用户，乱码严重影响用户体验。  
**修复**: 重新用 UTF-8 编码写入正确的中文文本。

---

### Bug 13: `unwrap()` 可能导致 Panic

**文件**: `lib.rs`  
**行号**: 1775, 1970

```rust
// 行 1775
let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();

// 行 1970
let exe_path = std::env::current_exe().unwrap();
```

**影响**: 在系统时钟异常或无法确定 exe 路径时，`unwrap()` 会导致进程 panic 退出。  
**修复**: 使用 `unwrap_or_default()` 或返回 `Result`。

---

### Bug 14: 调试代码遗留未清理

**文件**: `lib.rs`  
**行号**: 1264-1271, 1295-1302, 1305-1312

`log_skill_invoke` 函数中有多处写入调试日志文件的代码，每次调用都会向 `%TEMP%\codexhub_skill_invoke_debug.log` 追加日志：

```rust
let _ = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(format!("{}\\codexhub_skill_invoke_debug.log", ...))
    .map(|mut f| { ... });
```

同样，`stream_chat` 函数（行 2206-2210）也有将每个 SSE chunk 写入调试日志的代码。  
**影响**: 持续写入临时文件，长期运行后可能产生大量日志文件，影响性能和磁盘空间。  
**修复**: 删除调试代码，或用 `log::debug!` 替代并受日志级别控制。

---

## 汇总

| 严重度 | 数量 | 描述 |
|--------|------|------|
| 🔴 严重 | 5 | 重复注册、空字符串查询、越界panic、标签检测错误、正则错误 |
| 🟡 中等 | 6 | 日志错误、PID清除、exit_code硬编码、模板未应用、unsafe、旧品牌名 |
| 🟢 低级 | 3 | 乱码、unwrap panic、调试代码遗留 |
| **合计** | **14** | |
