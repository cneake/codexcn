// openclaw_manager.rs - OpenClaw Gateway lifecycle manager
// Manages the OpenClaw Gateway as a child process and exposes channel/plugin management.

use std::collections::HashSet;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

// ===== Types =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub port: u16,
    pub token: Option<String>,
    pub version: String,
    pub channels: Vec<ChannelInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub name: String,
    pub plugin_id: String,
    pub enabled: bool,
    pub status: String,
    pub accounts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub plugin_id: String,
    pub enabled: bool,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawCommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ===== Global Gateway Process =====

struct GatewayProcess {
    child: tokio::process::Child,
    port: u16,
}

static GATEWAY_PROCESS: Lazy<Mutex<Option<GatewayProcess>>> = Lazy::new(|| Mutex::new(None));

// ===== OpenClaw CLI Detection =====

fn find_openclaw_exe() -> Option<String> {
    // Write debug log to temp file (eprintln not visible in release)
    let log_path = r"C:\temp\codexhub_openclaw_debug.log";
    let mut log_lines: Vec<String> = Vec::new();

    // Strategy 1: Try direct execution (bypass path existence check)
    // If openclaw --version works, the command is available
    if let Ok(output) = std::process::Command::new("cmd")
        .args(["/C", "openclaw --version 2>nul"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log_lines.push(format!("# [Strategy 1] openclaw --version"));
        log_lines.push(format!("stdout: [{}]", stdout));
        log_lines.push(format!("stderr: [{}]", stderr));
        log_lines.push(format!("exit code: {:?}", output.status.code()));
        
        if output.status.success() && !stdout.is_empty() {
            // Command works via PATH! Use where to get full path.
            log_lines.push(format!("# [Result] openclaw works via PATH"));
            let _ = std::fs::write(log_path, log_lines.join("\r\n"));
            return Some("openclaw".to_string());
        }
    }

    // Strategy 2: Hardcoded fallback
    // Tauri release subprocess doesn't inherit user PATH additions from QClaw
    // openclaw.cmd is at a known location, return it directly
    let hardcoded = r"E:\工具\qclaw\v0.2.26.557\resources\openclaw\config\bin\openclaw.cmd";
    log_lines.push(format!("# [Strategy 2] Fallback to hardcoded path"));
    log_lines.push(format!("returning: {}", hardcoded));
    log_lines.push(format!("# [Result] OpenClaw at hardcoded location"));
    let _ = std::fs::write(log_path, log_lines.join("\r\n"));
    Some(hardcoded.to_string())
}

fn find_node_exe() -> Option<String> {
    let candidates = [
        r"E:\Nodejs\nodejs\node.exe",
        r"C:\Program Files\nodejs\node.exe",
        r"E:\工具\qclaw\v0.2.26.557\resources\openclaw\config\bin\node.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Fallback: try where
    if let Ok(output) = std::process::Command::new("where")
        .args(["node.exe"])
        .output()
    {
        let first = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(|l| l.trim().to_string())
            .unwrap_or_default();
        if !first.is_empty() && std::path::Path::new(&first).exists() {
            return Some(first);
        }
    }
    None
}

fn find_openclaw_mjs() -> Option<String> {
    let candidates = [
        r"E:\工具\qclaw\v0.2.26.557\resources\openclaw\node_modules\openclaw\openclaw.mjs",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Try to find it near openclaw.cmd
    if let Some(oc) = find_openclaw_exe() {
        let dir = std::path::Path::new(&oc).parent().unwrap();
        // Go up from bin/ to openclaw/
        let mjs = dir.join(r"..\..\..\node_modules\openclaw\openclaw.mjs");
        if mjs.exists() {
            return Some(mjs.to_string_lossy().to_string());
        }
    }
    None
}

// ===== Gateway Lifecycle =====

/// Start the OpenClaw Gateway as a background process managed by CodexHub
pub async fn start_gateway() -> Result<GatewayStatus, String> {
    {
        let port_to_probe = {
            let guard = GATEWAY_PROCESS.lock().map_err(|e| e.to_string())?;
            if let Some(ref gp) = *guard {
                Some(gp.port)
            } else {
                None
            }
        };
        if let Some(port) = port_to_probe {
            if let Ok(status) = probe_gateway_status(port, None).await {
                return Ok(status);
            }
            let mut guard = GATEWAY_PROCESS.lock().map_err(|e| e.to_string())?;
            *guard = None;
        }
    }

    let openclaw_path = find_openclaw_exe()
        .ok_or_else(|| "未找到 OpenClaw，请先安装：npm install -g @openclaw/cli".to_string())?;

    // Read configured port from openclaw.json
    let (_token, configured_port) = get_gateway_config().await.ok().unwrap_or((String::new(), 18789));
    let port = configured_port;

    eprintln!("[OpenClaw Manager] Starting gateway on port {}...", port);

    let mut child = Command::new("cmd")
        .args(["/C", &openclaw_path, "gateway", "--port", &port.to_string()])
        .env("QCLAW_CLI_NODE_BINARY", find_node_exe().unwrap_or_else(|| "node".to_string()))
        .env("QCLAW_CLI_OPENCLAW_MJS", find_openclaw_mjs().unwrap_or_default())
        .env("OPENCLAW_STATE_DIR", std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw")
        .env("OPENCLAW_CONFIG_PATH", std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw\openclaw.json")
        .env("RUST_LOG", "warn")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 OpenClaw Gateway 失败: {} (path: {})", e, openclaw_path))?;

    // Capture brief startup output
    if let Some(mut stdout) = child.stdout.take() {
        let mut buf = [0u8; 512];
        if let Ok(n) = stdout.read(&mut buf).await {
            let s = String::from_utf8_lossy(&buf[..n]);
            eprintln!("[OpenClaw Gateway] {}", s.lines().take(3).collect::<Vec<_>>().join("\n"));
        }
    }

    let tok_clone = _token.clone();
    let status = wait_for_gateway(port, tok_clone, 15).await;

    let gw_status = match status {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[OpenClaw Manager] Gateway probe error: {}", e);
            GatewayStatus {
                running: true,
                port,
                token: Some(_token),
                version: "?".to_string(),
                channels: vec![],
                error: Some(format!("Gateway 已启动但状态探针失败: {}", e)),
            }
        }
    };

    {
        let mut guard = GATEWAY_PROCESS.lock().map_err(|e| e.to_string())?;
        *guard = Some(GatewayProcess { child, port });
    }

    Ok(gw_status)
}

/// Stop the OpenClaw Gateway managed by CodexHub
pub async fn stop_gateway() -> Result<String, String> {
    // Extract child from mutex first, then await outside the lock
    let (port, child_to_kill) = {
        let mut guard = GATEWAY_PROCESS.lock().map_err(|e| e.to_string())?;
        match guard.take() {
            Some(gp) => (gp.port, Some(gp.child)),
            None => return Ok("Gateway 未运行".to_string()),
        }
    };
    // Now kill outside the mutex
    if let Some(mut child) = child_to_kill {
        let _ = child.kill().await;
    }

    let _ = kill_process_on_port(port).await;
    Ok(format!("Gateway 已停止 (端口 {})", port))
}

/// Get current gateway status
pub async fn get_gateway_status() -> Result<GatewayStatus, String> {
    let port: Option<u16> = {
        let guard = GATEWAY_PROCESS.lock().map_err(|e| e.to_string())?;
        match &*guard {
            Some(gp) => Some(gp.port),
            None => None,
        }
    };

    match port {
        Some(p) => {
            let config = get_gateway_config().await.ok();
            let tok = config.as_ref().map(|c| c.0.clone());
            probe_gateway_status(p, tok).await
        }
        None => {
            // Try to detect if gateway is already running (not managed by us)
            // First try from config
            if let Ok((_, port)) = get_gateway_config().await {
                if let Ok(status) = probe_gateway_status(port, None).await {
                    if status.running {
                        return Ok(GatewayStatus {
                            running: true,
                            port,
                            token: None,
                            version: status.version,
                            channels: status.channels,
                            error: Some("Gateway 由系统管理".to_string()),
                        });
                    }
                }
            }
            // Fallback scan common ports
            for p in &[18789u16, 18790, 9119] {
                if let Ok(status) = probe_gateway_status(*p, None).await {
                    if status.running {
                        return Ok(GatewayStatus {
                            running: true,
                            port: *p,
                            token: None,
                            version: status.version,
                            channels: status.channels,
                            error: Some("Gateway 由系统管理".to_string()),
                        });
                    }
                }
            }
            Ok(GatewayStatus {
                running: false,
                port: 0,
                token: None,
                version: String::new(),
                channels: vec![],
                error: Some("Gateway 未运行".to_string()),
            })
        }
    }
}

// ===== Gateway Config =====

async fn get_gateway_config() -> Result<(String, u16), String> {
    let config_path = std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw\openclaw.json";
    let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let port = json.get("gateway")
        .and_then(|v| v.get("port"))
        .and_then(|v| v.as_u64())
        .unwrap_or(18789) as u16;
    let token = json.get("gateway")
        .and_then(|v| v.get("auth"))
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    Ok((token, port))
}

// ===== Gateway Health Probe =====

async fn probe_gateway_status(port: u16, token: Option<String>) -> Result<GatewayStatus, String> {
    let url = format!("http://127.0.0.1:{}/", port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if let Some(t) = &token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }

    match req.send().await {
        Ok(resp) => {
            let running = resp.status().is_success() || resp.status().as_u16() == 401;
            Ok(GatewayStatus {
                running,
                port,
                token,
                version: resp.headers()
                    .get("x-openclaw-version")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                channels: vec![],
                error: None,
            })
        }
        Err(e) => {
            Err(format!("无法连接到 Gateway (端口 {}): {}", port, e))
        }
    }
}

async fn wait_for_gateway(port: u16, token: String, timeout_secs: u64) -> Result<GatewayStatus, String> {
    let start = std::time::Instant::now();
    let interval = std::time::Duration::from_millis(500);

    while start.elapsed().as_secs() < timeout_secs {
        if let Ok(status) = probe_gateway_status(port, Some(token.clone())).await {
            if status.running {
                return Ok(status);
            }
        }
        tokio::time::sleep(interval).await;
    }

    Err("Gateway 启动超时".to_string())
}

async fn kill_process_on_port(port: u16) -> Result<(), String> {
    let cmd = format!(
        "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{} ^| findstr LISTENING') do taskkill /F /PID %a 2>nul",
        port
    );
    let _output = Command::new("cmd")
        .args(["/C", &cmd])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ===== OpenClaw CLI Command Runner =====

pub async fn run_openclaw_command(args: Vec<String>) -> Result<OpenClawCommandResult, String> {
    let openclaw_path = find_openclaw_exe()
        .ok_or_else(|| "未找到 OpenClaw CLI".to_string())?;

    // On Windows, .cmd files must be executed via cmd /c
    let mut cmd_args = vec!["/C".to_string(), openclaw_path];
    cmd_args.extend(args);

    // openclaw.cmd requires these env vars (normally injected by QClaw Electron)
    let node_binary = find_node_exe().unwrap_or_else(|| "node".to_string());
    let mjs_path = find_openclaw_mjs().unwrap_or_default();

    let output = Command::new("cmd")
        .args(&cmd_args)
        .env("QCLAW_CLI_NODE_BINARY", node_binary)
        .env("QCLAW_CLI_OPENCLAW_MJS", mjs_path)
        .env("OPENCLAW_STATE_DIR", std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw")
        .env("OPENCLAW_CONFIG_PATH", std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw\openclaw.json")
        .env_remove("HTTPS_PROXY")
        .env_remove("HTTP_PROXY")
        .output()
        .await
        .map_err(|e| format!("执行 openclaw 失败: {}", e))?;

    Ok(OpenClawCommandResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

// ===== Channel Management =====

pub async fn list_channels() -> Result<Vec<ChannelInfo>, String> {
    let result = run_openclaw_command(vec!["channels".to_string(), "list".to_string()]).await?;

    let mut channels = vec![];
    let stdout = &result.stdout;

    // Parse lines like: "- 腾讯通路 default: " or "- wechat my-account: (disabled)"
    let mut in_channels = false;
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("Chat channels") || line.starts_with("chat channels") {
            in_channels = true;
            continue;
        }
        if line.starts_with("Auth providers") || line.starts_with("Usage") || line.starts_with("Docs") {
            in_channels = false;
            continue;
        }
        if !in_channels {
            continue;
        }
        // Parse "- channel_type account_name: status"
        if let Some(rest) = line.strip_prefix("- ") {
            let rest = rest.trim();
            let disabled = rest.contains("(disabled)") || rest.contains("禁用");
            // Split at colon or space to get channel type
            let (channel_type, _account) = if let Some(pos) = rest.find(':') {
                let before = rest[..pos].trim();
                let after = rest[pos+1..].trim();
                // before is like "腾讯通路 default" or "wechat myaccount"
                let parts: Vec<&str> = before.splitn(2, char::is_whitespace).collect();
                (parts[0].to_string(), parts.get(1).unwrap_or(&"").to_string())
            } else {
                let parts: Vec<&str> = rest.splitn(2, char::is_whitespace).collect();
                (parts[0].to_string(), parts.get(1).unwrap_or(&"").to_string())
            };

            // Map Chinese names to plugin IDs
            let plugin_id = match channel_type.as_str() {
                "腾讯通路" => "wechat-access".to_string(),
                "微信" => "wechat".to_string(),
                "飞书" | "Lark" => "feishu".to_string(),
                "钉钉" | "DingTalk" => "dingtalk".to_string(),
                "企业微信" | "WeCom" => "wecom".to_string(),
                "Telegram" => "telegram".to_string(),
                "Slack" => "slack".to_string(),
                "Discord" => "discord".to_string(),
                other => other.to_string(),
            };

            channels.push(ChannelInfo {
                name: channel_type,
                plugin_id,
                enabled: !disabled,
                status: if disabled { "已禁用".to_string() } else { "已连接".to_string() },
                accounts: vec![],
            });
        }
    }

    // If no channels found from CLI output, show known ones as unconfigured
    if channels.is_empty() {
        let known = [("wechat-access", "腾讯通路"), ("wechat", "微信"), ("feishu", "飞书"), ("dingtalk", "钉钉"), ("wecom", "企业微信"), ("telegram", "Telegram"), ("slack", "Slack")];
        for (id, name) in &known {
            channels.push(ChannelInfo {
                name: name.to_string(),
                plugin_id: id.to_string(),
                enabled: false,
                status: "未配置".to_string(),
                accounts: vec![],
            });
        }
    }

    Ok(channels)
}

pub async fn get_channel_status() -> Result<serde_json::Value, String> {
    let result = run_openclaw_command(vec!["channels".to_string(), "status".to_string()]).await?;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&result.stdout) {
        return Ok(json);
    }

    Ok(serde_json::json!({
        "raw": result.stdout,
        "success": result.success,
        "error": if result.success { "" } else { &result.stderr }
    }))
}

pub async fn set_channel_enabled(channel: String, enabled: bool) -> Result<String, String> {
    let action = if enabled { "enable" } else { "disable" };
    // Use 'openclaw channels add/remove' pattern or 'openclaw plugins enable/disable'
    let result = run_openclaw_command(vec![
        "channels".to_string(),
        action.to_string(),
        channel.clone(),
    ]).await;

    // Fallback to plugins command if channels command fails
    let result = match result {
        Ok(r) if r.success => r,
        _ => run_openclaw_command(vec![
            "plugins".to_string(),
            action.to_string(),
            channel.clone(),
        ]).await?,
    };

    if !result.success {
        return Err(format!("{} 渠道失败: {}", if enabled { "启用" } else { "禁用" }, result.stderr));
    }

    Ok(format!("{} 已{}", channel, if enabled { "启用" } else { "禁用" }))
}

pub async fn add_channel(channel: String) -> Result<String, String> {
    let result = run_openclaw_command(vec![
        "channels".to_string(),
        "add".to_string(),
        format!("--channel={}", channel),
    ]).await?;

    if !result.success {
        return Err(format!("添加渠道失败: {}", result.stderr));
    }

    Ok(format!("{} 渠道已添加，请配置 App ID 等信息", channel))
}

// ===== Plugin Management =====

pub async fn list_plugins() -> Result<Vec<PluginInfo>, String> {
    // Read plugins from openclaw.json config file instead of slow CLI command
    let config_path = std::env::var("USERPROFILE").unwrap_or_default() + r"\.qclaw\openclaw.json";
    let content = std::fs::read_to_string(&config_path).unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

    let mut plugins = vec![];

    // Try reading from plugins.entries in config
    if let Some(entries) = json.get("plugins").and_then(|v| v.get("entries")).and_then(|v| v.as_object()) {
        for (id, val) in entries {
            let enabled = val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let version = val.get("version").and_then(|v| v.as_str()).unwrap_or("-").to_string();
            let name = match id.as_str() {
                "wechat-access" => "腾讯通路",
                "qclaw-plugin" => "QClaw 插件",
                "lossless-claw" => "无损上下文",
                "browser" => "浏览器",
                "ollama" => "Ollama",
                "memory-core" => "记忆核心",
                "qclaw-embedding" => "嵌入模型",
                other => other,
            }.to_string();
            plugins.push(PluginInfo {
                name,
                plugin_id: id.clone(),
                enabled,
                version,
                description: String::new(),
            });
        }
    }

    // Also read plugins.allow list for channels
    if let Some(allow_list) = json.get("plugins").and_then(|v| v.get("allow")).and_then(|v| v.as_array()) {
        let existing_ids: std::collections::HashSet<String> = plugins.iter().map(|p| p.plugin_id.clone()).collect();
        for item in allow_list {
            if let Some(id) = item.as_str() {
                if !existing_ids.contains(id) {
                    let name = match id {
                        "wechat-access" => "腾讯通路",
                        "feishu" => "飞书",
                        "dingtalk" => "钉钉",
                        "wecom" => "企业微信",
                        "telegram" => "Telegram",
                        "slack" => "Slack",
                        "discord" => "Discord",
                        other => other,
                    }.to_string();
                    plugins.push(PluginInfo {
                        name,
                        plugin_id: id.to_string(),
                        enabled: false,
                        version: "-".to_string(),
                        description: "未加载".to_string(),
                    });
                }
            }
        }
    }

    // Fallback: known built-in plugins
    if plugins.is_empty() {
        let known = [
            ("wechat-access", "腾讯通路", true),
            ("feishu", "飞书", false),
            ("dingtalk", "钉钉", false),
            ("wecom", "企业微信", false),
            ("telegram", "Telegram", false),
            ("slack", "Slack", false),
            ("discord", "Discord", false),
        ];
        for (id, name, enabled) in &known {
            plugins.push(PluginInfo {
                name: name.to_string(),
                plugin_id: id.to_string(),
                enabled: *enabled,
                version: "-".to_string(),
                description: String::new(),
            });
        }
    }

    Ok(plugins)
}

pub fn check_openclaw_available() -> Result<String, String> {
    find_openclaw_exe()
        .map(|p| format!("OpenClaw 已找到: {}", p))
        .ok_or_else(|| "未安装 OpenClaw CLI，请运行: npm install -g @openclaw/cli".to_string())
}
