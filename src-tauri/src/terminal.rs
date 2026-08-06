// 内嵌终端 PTY 管理
// 使用 tokio::process::Command 启动子进程，通过 pipe 双向通信
// 前端 xterm.js 通过 Tauri event 交互

use std::collections::HashMap;
use std::sync::LazyLock;
use dashmap::DashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::process::Stdio;
use tokio::process::{Child, Command, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]

/// 终端会话状态
pub struct TerminalSession {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
    pub stdout: Mutex<Option<ChildStdout>>,
    pub tool_id: String,
    pub tool_name: String,
}

/// 全局终端会话表：session_id -> TerminalSession
pub static TERMINALS: LazyLock<DashMap<String, TerminalSession>, fn() -> DashMap<String, TerminalSession>> =
    LazyLock::new(DashMap::new);

/// 工具命令映射
fn get_tool_command(tool_id: &str) -> Option<(String, String)> {
    match tool_id {
        "claude-code" => Some(("claude".to_string(), "Claude Code".to_string())),
        "codex" => Some(("codex".to_string(), "Codex CLI".to_string())),
        "gemini-cli" => Some(("gemini".to_string(), "Gemini CLI".to_string())),
        "opencode" => Some(("opencode".to_string(), "OpenCode".to_string())),
        "openclaw" => Some(("openclaw".to_string(), "OpenClaw".to_string())),
        "hermes-agent" => Some(("hermes".to_string(), "Hermes Agent".to_string())),
        _ => None,
    }
}

/// 创建终端会话，返回 session_id
/// cwd: 可选的工作目录，默认用户主目录
#[tauri::command]
pub async fn create_terminal_session(
    app: AppHandle,
    tool_id: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let (cmd, name) = get_tool_command(&tool_id).ok_or("未知工具")?;

    // 检查命令是否存在
    let check = Command::new("where")
        .arg(&cmd)
        .creation_flags(0x08000000)
        .output()
        .await
        .map_err(|e| format!("检查命令失败: {}", e))?;

    if !check.status.success() {
        return Err(format!("{} 未安装或不在 PATH 中", cmd));
    }

    // 确定工作目录：用户指定 > 用户主目录
    let work_dir = match cwd {
        Some(ref p) if !p.is_empty() => p.clone(),
        _ => dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string()),
    };

    let session_id = format!("term_{}_{}", tool_id, chrono_timestamp());

    // Windows 下用 cmd 启动交互式 shell（不用 /c，/c 执行完就退出）
    // Unix 用 sh -i 启动交互式 shell
    let mut child = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("启动失败: {}", e))?
    } else {
        Command::new("sh")
            .args(["-i"])
            .current_dir(&work_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动失败: {}", e))?
    };

    let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;

    let session = TerminalSession {
        child: Mutex::new(Some(child)),
        stdin: Mutex::new(Some(stdin)),
        stdout: Mutex::new(Some(stdout)),
        tool_id: tool_id.clone(),
        tool_name: name,
    };

    TERMINALS.insert(session_id.clone(), session);

    // 启动 stdout 读取任务，将输出转发到前端
    let sid = session_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let mut data = [0u8; 4096];
            let should_break;
            {
                let term_opt = TERMINALS.get(&sid);
                match term_opt {
                    None => break,
                    Some(term_ref) => {
                        let mut out_guard = term_ref.stdout.lock().await;
                        match out_guard.as_mut() {
                            None => break,
                            Some(reader) => {
                                match reader.read(&mut data).await {
                                    Ok(0) | Err(_) => { should_break = true; }
                                    Ok(n) => {
                                        let output = String::from_utf8_lossy(&data[..n]).to_string();
                                        let _ = app_clone.emit("terminal_output", serde_json::json!({
                                            "session_id": sid,
                                            "data": output,
                                        }));
                                        should_break = false;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if should_break {
                let _ = app_clone.emit("terminal_exit", serde_json::json!({ "session_id": sid }));
                TERMINALS.remove(&sid);
                break;
            }
            // 小延迟避免 CPU 空转
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    });

    Ok(session_id)
}

/// 向终端写入输入
#[tauri::command]
pub async fn write_terminal(session_id: String, data: String) -> Result<(), String> {
    let term_opt = TERMINALS.get(&session_id).ok_or("终端不存在")?;
    let mut stdin_guard = term_opt.stdin.lock().await;
    match stdin_guard.as_mut() {
        Some(writer) => {
            writer.write_all(data.as_bytes()).await.map_err(|e| e.to_string())?;
            writer.flush().await.map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err("stdin 已关闭".to_string()),
    }
}

/// 调整终端大小（pty resize）
#[tauri::command]
pub async fn resize_terminal(_session_id: String, _cols: u16, _rows: u16) -> Result<(), String> {
    // pipe 模式不支持 pty resize，保留接口供未来扩展
    Ok(())
}

/// 关闭终端会话
#[tauri::command]
pub async fn close_terminal(session_id: String) -> Result<(), String> {
    if let Some((_, term)) = TERMINALS.remove(&session_id) {
        let mut child_guard = term.child.lock().await;
        if let Some(mut child) = child_guard.take() {
            child.kill().await.ok();
            child.wait().await.ok();
        }
    }
    Ok(())
}

/// 列出活跃的终端会话
#[tauri::command]
pub async fn list_terminals() -> Vec<HashMap<String, String>> {
    TERMINALS.iter().map(|entry| {
        let mut map = HashMap::new();
        map.insert("session_id".to_string(), entry.key().clone());
        map.insert("tool_id".to_string(), entry.value().tool_id.clone());
        map.insert("tool_name".to_string(), entry.value().tool_name.clone());
        map
    }).collect()
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
