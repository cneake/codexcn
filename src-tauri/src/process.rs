// 进程管理器：启动/停止 MCP 服务器子进程
// 由于 std::process::Child 不是 Send，我们只存 PID，不持有 Child 句柄
// 运行时通过 PID 杀进程

use dashmap::DashMap;
use std::process::Stdio;
use std::sync::LazyLock;
use tokio::process::Command;

/// 全局 MCP 进程 PID 表：server_id -> pid
pub static MCP_PIDS: LazyLock<DashMap<String, u32>, fn() -> DashMap<String, u32>> =
    LazyLock::new(DashMap::new);

/// 从命令行参数 JSON 数组字符串解析为 Vec<String>
fn parse_args(args_str: &Option<String>) -> Vec<String> {
    match args_str {
        Some(s) if !s.is_empty() => {
            serde_json::from_str::<Vec<String>>(s).unwrap_or_else(|_| vec![])
        }
        _ => vec![],
    }
}

/// 查找 npx-cli.js 的绝对路径
/// Windows 上 npx.cmd 在 cmd 子进程里会触发 "此时不应有 )" 错误（cmd 8.0 解析 bug），
/// 所以我们绕过 npx.cmd，直接用 node 执行 npx-cli.js
pub fn find_npx_cli_js() -> Result<String, String> {
    // 候选路径：系统 Nodejs 安装目录
    let candidates = [
        r"E:\Nodejs\nodejs\node_modules\npm\bin\npx-cli.js",
        r"C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js",
        r"C:\Program Files (x86)\nodejs\node_modules\npm\bin\npx-cli.js",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }
    // 回退：尝试用 `where node` 找 node 安装目录
    if let Ok(output) = std::process::Command::new("where").arg("node").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(node_exe) = stdout.lines().next() {
            // node.exe → ../node_modules/npm/bin/npx-cli.js
            if let Some(parent) = std::path::Path::new(node_exe.trim()).parent() {
                let candidate = parent.join("node_modules").join("npm").join("bin").join("npx-cli.js");
                if candidate.exists() {
                    return Ok(candidate.to_string_lossy().to_string());
                }
            }
        }
    }
    Err("未找到 npx-cli.js，请确认 Node.js 安装正确".to_string())
}

/// 启动单个 MCP 服务器进程，返回 PID
pub async fn start_mcp_process(
    server_id: &str,
    command: &str,
    args: &[String],
) -> Result<u32, String> {
    let _args_str = if args.is_empty() {
        String::new()
    } else {
        args.join(" ")
    };

    // 直接用 node 执行 npx-cli.js，绕过 npx.cmd 的 cmd 8.0 解析 bug
    let npx_cli = find_npx_cli_js()?;
    let mut npx_args: Vec<String> = vec!["--yes".to_string()];
    npx_args.push(command.to_string());
    if !args.is_empty() {
        npx_args.extend(args.iter().cloned());
    }

    let mut cmd = Command::new("node");
    cmd.arg(&npx_cli);
    cmd.args(&npx_args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let child = cmd.spawn().map_err(|e| format!("启动失败: {}", e))?;
    let pid = child.id().ok_or("无法获取 PID")?;

    // 记录 PID（MCP 是长时间运行进程，不等待）
    MCP_PIDS.insert(server_id.to_string(), pid);

    Ok(pid)
}

/// 杀掉指定 PID 的进程，返回是否成功
pub async fn kill_pid(pid: u32) -> bool {
    let output = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output()
        .await
        .ok();
    output.map(|o| o.status.success()).unwrap_or(false)
}

/// 启动所有 enabled 的 stdio MCP 服务器
pub async fn start_all_enabled(servers: Vec<crate::mcp::McpServer>) -> (Vec<String>, Vec<String>) {
    let mut success = vec![];
    let mut failed = vec![];

    for s in servers.into_iter().filter(|s| s.enabled) {
        let transport = &s.transport;
        if transport == "stdio" {
            if let Some(ref cmd) = s.command {
                if cmd.is_empty() { continue; }
                let args = parse_args(&s.args);
                match start_mcp_process(&s.id, cmd, &args).await {
                    Ok(pid) => { success.push(format!("{} (PID {})", s.name, pid)); }
                    Err(e) => { failed.push(format!("{}: {}", s.name, e)); }
                }
            } else {
                failed.push(format!("{}: 缺少命令", s.name));
            }
        }
        // sse/http 暂时跳过
    }

    (success, failed)
}

/// 停止所有正在运行的 MCP 进程
pub async fn stop_all_running(servers: Vec<crate::mcp::McpServer>) -> Vec<String> {
    let mut stopped = vec![];

    for s in servers.into_iter().filter(|s| s.pid.is_some()) {
        if let Some(pid) = s.pid {
            let killed = kill_pid(pid).await;
            MCP_PIDS.remove(&s.id);
            if killed {
                stopped.push(format!("{} (PID {})", s.name, pid));
            } else {
                stopped.push(format!("{} (已退出)", s.name));
            }
        }
    }

    stopped
}
