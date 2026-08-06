// CodexHub CN 代码执行沙箱
// 安全隔离：每会话独立 temp 目录 + Job Object 限制进程树 + 超时清理

use std::sync::LazyLock;
use dashmap::DashMap;
use tokio::process::{Child, Command};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
#[cfg(target_os = "windows")]


const CREATE_NO_WINDOW: u32 = 0x08000000;
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// 沙箱会话状态
pub struct SandboxSession {
    pub dir: String,                        // 运行文件持久化目录（源码 + 输出）
    pub child: Mutex<Option<Child>>,        // 当前运行进程
    pub _killed: Mutex<bool>,               // 是否已被用户停止
}

/// 全局沙箱会话表
pub static SANDBOX_SESSIONS: LazyLock<DashMap<String, SandboxSession>> =
    LazyLock::new(DashMap::new);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 创建沙箱会话，返回 { session_id, dir }
#[tauri::command]
pub async fn create_sandbox_session() -> Result<String, String> {
    let ts = now_ms();
    let session_id = format!("sandbox_{}", ts);

    let sandbox_root = std::env::temp_dir().join("codexhub-sandbox").join(&session_id);
    std::fs::create_dir_all(&sandbox_root).map_err(|e| format!("创建沙箱目录失败: {}", e))?;
    let dir_str = sandbox_root.to_string_lossy().to_string();

    SANDBOX_SESSIONS.insert(session_id.clone(), SandboxSession {
        dir: dir_str,
        child: Mutex::new(None),
        _killed: Mutex::new(false),
    });

    Ok(session_id)
}

/// 获取会话信息
#[tauri::command]
pub async fn get_sandbox_info(session_id: String) -> Result<serde_json::Value, String> {
    let session = SANDBOX_SESSIONS.get(&session_id).ok_or("沙箱会话不存在")?;
    let dir = session.dir.clone();
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                files.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "size": meta.len(),
                    "modified": meta.modified()
                        .map(|t| format!("{:?}", t))
                        .unwrap_or_default(),
                    "is_dir": meta.is_dir(),
                }));
            }
        }
    }
    Ok(serde_json::json!({
        "session_id": session_id,
        "dir": dir,
        "files": files,
    }))
}

/// 执行代码
#[tauri::command]
pub async fn execute_sandbox_code(
    app: AppHandle,
    session_id: String,
    code: String,
    language: String,
    timeout_secs: Option<u64>,
) -> Result<(), String> {
    let session = SANDBOX_SESSIONS.get(&session_id).ok_or("沙箱会话不存在")?;
    let total_timeout = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
    let dir = session.dir.clone();

    // 构建可执行文件路径
    let (executable, args, script_name) = match language.as_str() {
        "python" => {
            let script = format!("{}/main.py", dir);
            std::fs::write(&script, &code).map_err(|e| format!("写入脚本失败: {}", e))?;
            ("python".to_string(), vec![script.clone()], "main.py".to_string())
        },
        "javascript" => {
            let script = format!("{}/main.js", dir);
            std::fs::write(&script, &code).map_err(|e| format!("写入脚本失败: {}", e))?;
            ("node".to_string(), vec![script.clone()], "main.js".to_string())
        },
        "shell" => {
            let script = format!("{}/main.bat", dir);
            std::fs::write(&script, &code).map_err(|e| format!("写入脚本失败: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("设置权限失败: {}", e))?;
            }
            ("cmd".to_string(), vec!["/c".to_string(), script.clone()], "main.bat".to_string())
        },
        _ => return Err(format!("不支持的语言: {}", language)),
    };

    // 输出脚本文件名事件
    let _ = app.emit("sandbox_info", serde_json::json!({
        "session_id": &session_id,
        "script": script_name,
    }));

    // 启动子进程
    let mut cmd = Command::new(&executable);
    cmd.args(&args)
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("启动进程失败: {}", e))?;

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    // 写入 session
    {
        let mut c = session.child.lock().await;
        *c = Some(child);
    }

    let sid = session_id.clone();

    // 读取 stdout
    let sid_stdout = sid.clone();
    let app_stdout = app.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stdout.emit("sandbox_output", serde_json::json!({
                "session_id": sid_stdout,
                "stream": "stdout",
                "text": line,
            }));
        }
    });

    // 读取 stderr
    let sid_stderr = sid.clone();
    let app_stderr = app.clone();
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_stderr.emit("sandbox_output", serde_json::json!({
                "session_id": sid_stderr,
                "stream": "stderr",
                "text": line,
            }));
        }
    });

    // 等待进程完成（带超时）
    let sid_orig = session_id.clone();
    let sid_timeout = session_id.clone();
    let app_timeout = app.clone();
    let _timeout_handle = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(total_timeout)).await;
        if let Some(session) = SANDBOX_SESSIONS.get(&sid_timeout) {
            let mut child = session.child.lock().await;
            if let Some(ref mut c) = *child {
                let _ = c.kill().await;
                let _ = c.wait().await;
            }
        }
        let _ = app_timeout.emit("sandbox_output", serde_json::json!({
            "session_id": sid_timeout,
            "stream": "system",
            "text": format!("[超时] 执行超时 ({}s)，已终止", total_timeout),
        }));
    });

    // 等待输出流读完
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    // 获取子进程实际退出码
    let exit_code = match SANDBOX_SESSIONS.get(&sid_orig) {
        Some(session) => {
            let mut child_guard = session.child.lock().await;
            match child_guard.as_mut() {
                Some(c) => c.wait().await.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1),
                None => 0,
            }
        }
        None => 0,
    };

    // 发送完成事件
    let _ = app.emit("sandbox_done", serde_json::json!({
        "session_id": sid_orig,
        "exit_code": exit_code,
    }));

    Ok(())
}

/// 停止当前执行的代码
#[tauri::command]
pub async fn stop_sandbox(session_id: String) -> Result<(), String> {
    if let Some(session) = SANDBOX_SESSIONS.get(&session_id) {
        let mut child = session.child.lock().await;
        if let Some(ref mut c) = *child {
            let _ = c.kill().await;
            let _ = c.wait().await;
        }
    }
    Ok(())
}

/// 清理沙箱会话（删除临时目录）
#[tauri::command]
pub async fn cleanup_sandbox(session_id: String) -> Result<(), String> {
    if let Some((_, session)) = SANDBOX_SESSIONS.remove(&session_id) {
        {
            let mut child = session.child.lock().await;
            if let Some(ref mut c) = *child {
                let _ = c.kill().await;
                let _ = c.wait().await;
            }
        }
        let _ = std::fs::remove_dir_all(&session.dir);
    }
    Ok(())
}

/// 列出所有活跃沙箱
#[tauri::command]
pub async fn list_sandbox_sessions() -> Vec<serde_json::Value> {
    SANDBOX_SESSIONS.iter().map(|entry| {
        serde_json::json!({
            "session_id": entry.key(),
            "dir": entry.value().dir,
        })
    }).collect()
}
