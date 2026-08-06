use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// 获取 GenHub 工具目录 = {安装目录}/tools/
fn get_tools_dir() -> PathBuf {
    // 优先用 Program Files（已安装场景），兼容新旧品牌名
    if let Ok(pf) = std::env::var("ProgramFiles") {
        for name in &["GenHub", "CodexHub CN"] {
            let dir = PathBuf::from(&pf).join(name).join("tools");
            if dir.exists() { return dir; }
        }
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        for name in &["GenHub", "CodexHub CN"] {
            let dir = PathBuf::from(&pf86).join(name).join("tools");
            if dir.exists() { return dir; }
        }
    }
    // 回退：exe 所在目录/tools/
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.join("tools");
        }
    }
    PathBuf::from(".")
}

/// 清理 AppData\QClaw\npm-global 下的 shim 文件，解决 EBUSY 文件锁
fn clear_npm_global_shim_files(npm_package: &str) {
    let last = npm_package.rsplit('/').next().unwrap_or(npm_package);
    let known_bins = ["hermes", "hermes-agent", "codex", "claude", "opencode", "openclaw", "gemini", "qodercli", "deepseek"];
    let base = PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
        .join("QClaw").join("npm-global");
    for name in std::iter::once(npm_package)
        .chain(std::iter::once(last))
        .chain(known_bins.iter().copied())
    {
        for ext in &["cmd", "ps1"] {
            let path = base.join(format!("{}.{}", name, ext));
            if path.exists() { let _ = std::fs::remove_file(&path); }
        }
    }
}

/// 工具检测结果（给前端引导页用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDetectResult {
    pub tool_id: String,
    pub tool_name: String,
    pub icon: String,
    pub installed: bool,
    pub config_dir: String,
    pub command: String,
}

/// 工具配置条目（用于导出）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolConfigEntry {
    pub tool_id: String,
    pub tool_name: String,
    pub config_path: String,
    pub config_type: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub provider_name: Option<String>,
}

/// 直接运行 CLI 工具（拉起新终端窗口）
/// Windows 用 CREATE_NEW_CONSOLE + 隐藏 powershell 窗口
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn launch_tool(tool_id: String) -> Result<(), String> {
    let (tool_cmd, display_name, _env_var) = match tool_id.as_str() {
        "claude-code" => ("claude", "Claude Code", None),
        "codex" => ("codex", "OpenAI Codex CLI", None),
        "gemini-cli" => ("gemini", "Gemini CLI", None),
        "opencode" => ("opencode", "OpenCode", None),
        "openclaw" => ("openclaw", "OpenClaw", None),
        "hermes-agent" => ("hermes", "Hermes Agent", None),
        "qoder-cli" => ("qodercli", "Qoder CLI", Some("QODER_PERSONAL_ACCESS_TOKEN")),
        _ => return Err(format!("未知工具: {}", tool_id)),
    };

    // 先检查命令是否存在
    let check = std::process::Command::new("where")
        .arg(tool_cmd)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW for where check
        .output();

    if let Ok(output) = check {
        if !output.status.success() {
            return Err(format!("{} 未安装或不在 PATH 中，请先安装", tool_cmd));
        }
    }

    // Qoder CLI：从 ~/.qoder/credentials.json 读取 token
    let qoder_token = if tool_id == "qoder-cli" {
        let path = dirs::home_dir()
            .map(|h| h.join(".qoder").join("credentials.json"))
            .filter(|p| p.exists());
        path.and_then(|p| {
            let content = std::fs::read_to_string(&p).ok()?;
            serde_json::from_str::<serde_json::Value>(&content).ok()
        })
        .and_then(|v| v.get("personal_access_token")?.as_str().map(String::from))
    } else { None };

    // 优先使用 Windows Terminal，回退到 PowerShell
    let title = format!("GenHub - {}", display_name);

    // 尝试 Windows Terminal
    let wt_path = std::env::var("LOCALAPPDATA")
        .map(|p| std::path::PathBuf::from(p).join("Microsoft\\WindowsApps\\wt.exe"))
        .ok()
        .filter(|p| p.exists());

    if wt_path.is_some() {
        let env_setup = if let Some(ref token) = qoder_token {
            format!(r#"$env:QODER_PERSONAL_ACCESS_TOKEN='{}'; "#, token)
        } else { String::new() };
        let welcome = format!(
            r#"powershell -NoExit -Command "{}Write-Host '  ╔══════════════════════════════╗' -ForegroundColor Cyan; Write-Host ('  ║  GenHub 正在启动 ' + '{}' + '  ║') -ForegroundColor Yellow; Write-Host '  ║  请稍后...                    ║' -ForegroundColor Cyan; Write-Host '  ╚══════════════════════════════╝' -ForegroundColor Cyan; Write-Host ''; & {}; Read-Host -Prompt '按 Enter 关闭'" "#,
            env_setup, display_name, tool_cmd
        );
        let mut cmd = std::process::Command::new("wt");
        cmd.args(&["--title", &title, "powershell", "-NoExit", "-Command", &welcome]);
        cmd.spawn().map_err(|e| format!("启动 {} 失败: {}", tool_cmd, e))?;
        return Ok(());
    }

    // 回退到 PowerShell（带欢迎语和彩色界面）
    let env_line = if let Some(ref token) = qoder_token {
        format!(r#"$env:QODER_PERSONAL_ACCESS_TOKEN='{}'; "#, token)
    } else { String::new() };

    let ps_script = format!(
        r#"
$host.UI.RawUI.WindowTitle='{}'
$host.UI.RawUI.BackgroundColor='Black'
Clear-Host
Write-Host ''
Write-Host '  ╔══════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║                                      ║' -ForegroundColor Cyan
Write-Host ('  ║  GenHub 正在为您启动 ' + '{}' + '  ║') -ForegroundColor Yellow
Write-Host '  ║  请稍后...                            ║' -ForegroundColor Cyan
Write-Host '  ║                                      ║' -ForegroundColor Cyan
Write-Host '  ╚══════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''
Write-Host '  提示: 按 Ctrl+C 可随时终止程序' -ForegroundColor DarkGray
Write-Host ''
"#,
        title, display_name
    );

    let full_cmd = format!("{}{}", env_line, ps_script);
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(&["-NoExit", "-Command", &full_cmd]);
    cmd.creation_flags(0x00000010); // CREATE_NEW_CONSOLE
    cmd.spawn().map_err(|e| format!("启动 {} 失败: {}", tool_cmd, e))?;
    Ok(())
}

/// 获取用户 home 目录
fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())
}

/// 原子写入文件：先写临时文件再 rename
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败 {}: {}", parent.display(), e))?;
    }

    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("重命名文件失败: {}", e))?;

    log::info!("配置已写入: {}", path.display());
    Ok(())
}

/// Claude Code: ~/.claude/settings.json
fn write_claude_code(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".claude").join("settings.json");

    let config = serde_json::json!({
        "permissions": {
            "allow": [],
            "deny": []
        },
        "env": {
            "ANTHROPIC_BASE_URL": base_url,
            "ANTHROPIC_API_KEY": api_key
        }
    });

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// Claude Code: ~/.claude.json (老版本配置)
fn write_claude_json(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".claude.json");

    let config = serde_json::json!({
        "primaryApiKey": api_key,
        "apiBaseUrl": base_url
    });

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// Codex: ~/.codex/config.json
fn write_codex(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".codex").join("config.json");

    let config = serde_json::json!({
        "api_key": api_key,
        "base_url": base_url
    });

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// OpenCode: ~/.opencode/config.json
fn write_opencode(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".opencode").join("config.json");

    let config = serde_json::json!({
        "provider": {
            "name": "custom",
            "base_url": base_url,
            "api_key": api_key
        }
    });

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// OpenClaw: ~/.openclaw/config.json
fn write_openclaw(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".openclaw").join("config.json");

    let config = serde_json::json!({
        "providers": {
            "default": {
                "baseURL": base_url,
                "apiKey": api_key
            }
        }
    });

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// Gemini CLI: ~/.gemini/settings.toml
fn write_gemini_cli(_base_url: &str, _api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".gemini").join("settings.toml");

    let content = format!(
        r#"[general]
# GenHub - 自动配置
api_endpoint = "{}"
api_key = "{}"
"#,
        _base_url, _api_key
    );

    atomic_write(&path, &content)
}

/// Qoder CLI: ~/.qoder/credentials.json（环境变量认证）
fn write_qoder_cli(api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".qoder").join("credentials.json");
    let config = serde_json::json!({
        "personal_access_token": api_key
    });
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// Hermes Agent: ~/.hermes/config.yaml
fn write_hermes_agent(base_url: &str, api_key: &str) -> Result<(), String> {
    let path = home_dir()?.join(".hermes").join("config.yaml");

    // 读取现有配置，保留其他字段
    let existing: serde_yaml::Mapping = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_yaml::from_str(&s).ok())
        .unwrap_or_default();

    let mut map = existing;

    // 设置 providers.default（合并方式）
    let mut provider_entry = serde_yaml::Mapping::new();
    provider_entry.insert(serde_yaml::Value::String("base_url".into()), serde_yaml::Value::String(base_url.into()));
    provider_entry.insert(serde_yaml::Value::String("api_key".into()), serde_yaml::Value::String(api_key.into()));
    provider_entry.insert(serde_yaml::Value::String("model".into()), serde_yaml::Value::String("".into()));
    map.insert(serde_yaml::Value::String("providers".into()), serde_yaml::Value::Mapping(provider_entry));

    let content = serde_yaml::to_string(&map).map_err(|e| e.to_string())?;
    atomic_write(&path, &content)
}

/// 检测命令是否在 PATH 中可用
fn is_in_path(cmd: &str) -> bool {
    // 直接在 PATH 里搜可执行文件，不调 where.exe（避免弹窗）
    if let Ok(paths) = std::env::var("PATH") {
        for dir in paths.split(';') {
            let candidate = std::path::Path::new(dir).join(cmd);
            // 检查 .exe/.cmd/.bat 三种常见 Windows 可执行文件后缀
            if candidate.with_extension("exe").exists()
                || candidate.with_extension("cmd").exists()
                || candidate.with_extension("bat").exists()
                || candidate.exists()
            {
                return true;
            }
        }
    }
    false
}

/// 检测 Claude Desktop 是否安装（Windows GUI 应用，检测配置目录或 exe）
fn is_claude_desktop_installed() -> bool {
    let appdata = std::env::var("APPDATA").ok();
    let localappdata = std::env::var("LOCALAPPDATA").ok();

    // 检测配置目录
    if let Some(appdata) = &appdata {
        let cfg = std::path::Path::new(appdata).join("Anthropic").join("Claude").join("claude_desktop_config.json");
        if cfg.exists() { return true; }
    }
    // 检测 exe
    if let Some(local) = &localappdata {
        let exe = std::path::Path::new(local).join("Anthropic").join("Claude").join("Claude.exe");
        if exe.exists() { return true; }
    }
    false
}

/// 检测已安装的工具列表（配置目录存在 + 命令在 PATH 中）
pub fn detect_installed_tools() -> Vec<String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    // (tool_id, config_dir, executable_commands)
    let mut candidates: Vec<(&str, PathBuf, &[&str])> = vec![
        ("claude-code", home.join(".claude"), &["claude"][..]),
        ("codex", home.join(".codex"), &["codex"][..]),
        ("gemini-cli", home.join(".gemini"), &["gemini"][..]),
        ("opencode", home.join(".opencode"), &["opencode"][..]),
        ("openclaw", home.join(".openclaw"), &["openclaw", "qclaw"][..]),
        ("hermes-agent", home.join(".hermes"), &["hermes"][..]),
    ];
    // grok-build: 下载类型工具，检测 ~/.grok/bin/grok.exe 是否存在
    let grok_bin = home.join(".grok").join("bin").join("grok.exe");
    if grok_bin.exists() {
        candidates.push(("grok-build", home.join(".grok"), &["grok"][..]));
    }
    candidates.iter()
        .filter(|(_, dir, cmds)| dir.exists() && cmds.iter().any(|c| is_in_path(c)))
        .map(|(id, _, _)| id.to_string())
        .collect()
}

/// 详细检测所有工具的安装状态（给前端引导页用）
pub fn detect_tools_detail() -> Vec<ToolDetectResult> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let candidates: [(&str, &str, &str, PathBuf, &[&str]); 9] = [
        ("claude-code", "Claude Code", "🤖", home.join(".claude"), &["claude"][..]),
        ("claude-desktop", "Claude Desktop", "🖥️", PathBuf::new(), &[][..]),
        ("codex", "Codex", "💎", home.join(".codex"), &["codex"][..]),
        ("gemini-cli", "Gemini CLI", "✨", home.join(".gemini"), &["gemini"][..]),
        ("opencode", "OpenCode", "🔓", home.join(".opencode"), &["opencode"][..]),
        ("openclaw", "OpenClaw", "⚡", home.join(".openclaw"), &["openclaw", "qclaw"][..]),
        ("hermes-agent", "Hermes Agent", "🧭", home.join(".hermes"), &["hermes"][..]),
        ("grok-build", "Grok Build", "🤖", home.join(".grok").join("bin"), &["grok"][..]),
        ("qoder-cli", "Qoder CLI", "🚀", home.join(".qoder"), &["qodercli"][..]),
    ];
    let env_it = [
        ("env-node", "Node.js", "💚", &["node"][..] as &[&str]),
        ("env-npm", "npm", "📦", &["npm"][..]),
        ("env-python", "Python", "🐍", &["python3", "python"][..]),
        ("env-git", "Git", "🔀", &["git"][..]),
        ("env-pnpm", "pnpm", "⚡", &["pnpm"][..]),
        ("env-yarn", "Yarn", "🧶", &["yarn"][..]),
        ("env-docker", "Docker", "🐳", &["docker"][..]),
    ].into_iter().map(|(id, name, icon, cmds)| {
        let cmd_found = cmds.iter().any(|c| is_in_path(c));
        let found_cmd = cmds.iter().find(|c| is_in_path(c)).copied().unwrap_or(cmds[0]);
        ToolDetectResult {
            tool_id: id.to_string(),
            tool_name: name.to_string(),
            icon: icon.to_string(),
            installed: cmd_found,
            config_dir: String::new(),
            command: found_cmd.to_string(),
        }
    });
    let cli_it = candidates.iter().map(|(id, name, icon, dir, cmds)| {
        if *id == "claude-desktop" {
            // Claude Desktop 是 GUI 应用，特殊检测
            let installed = is_claude_desktop_installed();
            ToolDetectResult {
                tool_id: id.to_string(),
                tool_name: name.to_string(),
                icon: icon.to_string(),
                installed,
                config_dir: std::env::var("APPDATA").unwrap_or_default() + "\\Anthropic\\Claude",
                command: "Claude.exe".to_string(),
            }
        } else {
            let dir_exists = dir.exists();
            let cmd_found = cmds.iter().any(|c| is_in_path(c));
            let found_cmd = cmds.iter().find(|c| is_in_path(c)).unwrap_or(&cmds[0]);
            // 仅以 npm package.json 为准：read_npm_global_package_version 成功才算安装。
            // 避免误判：
            //   1) PATH 里同名命令（Python hermes.exe）
            //   2) 残留的 ~/.hermes 配置目录
            //   3) 损坏的 .cmd 脚本
            let installed = get_npm_package(id)
                .and_then(|pkg| read_npm_global_package_version(pkg).ok())
                .is_some();
            // 兑底：如果是 download 类型（get_npm_package 返回 None），用 dir + cmd 判断
            // 特别检查 dir 目录下是否存在命令文件（解决 PATH 未刷新的问题）
            let installed = if get_npm_package(id).is_none() {
                let file_found = cmds.iter().any(|c| dir.join(c).exists() || dir.join(&format!("{}.exe", c)).exists());
                dir_exists && (cmd_found || file_found)
            } else {
                installed
            };
            ToolDetectResult {
                tool_id: id.to_string(),
                tool_name: name.to_string(),
                icon: icon.to_string(),
                installed,
                config_dir: dir.display().to_string(),
                command: found_cmd.to_string(),
            }
        }
    });
    env_it.chain(cli_it).collect()
}

/// 写入配置并返回结构化结果
#[allow(dead_code)]
pub fn write_config_result(tool_id: &str, base_url: &str, api_key: &str) -> Result<String, String> {
    write_config(tool_id, base_url, api_key)?;
    Ok(format!("已切换 {} 的 Provider", tool_id))
}

/// 根据 tool_id 写入对应工具的配置文件
pub fn write_config(tool_id: &str, base_url: &str, api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("API Key 为空，无法写入配置".to_string());
    }

    match tool_id {
        "claude-code" => {
            write_claude_code(base_url, api_key)?;
            write_claude_json(base_url, api_key)?;
        }
        "codex" => write_codex(base_url, api_key)?,
        "opencode" => write_opencode(base_url, api_key)?,
        "openclaw" => write_openclaw(base_url, api_key)?,
        "gemini-cli" => write_gemini_cli(base_url, api_key)?,
        "hermes-agent" => write_hermes_agent(base_url, api_key)?,
        "qoder-cli" => write_qoder_cli(api_key)?,
        _ => return Err(format!("未知工具: {}", tool_id)),
    }

    Ok(())
}

/// 获取所有工具的当前配置（用于导出）
pub fn get_all_tool_configs() -> Vec<ToolConfigEntry> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    vec![
        ToolConfigEntry {
            tool_id: "claude-code".to_string(),
            tool_name: "Claude Code".to_string(),
            config_path: home.join(".claude/settings.json").display().to_string(),
            config_type: "json".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "codex".to_string(),
            tool_name: "Codex".to_string(),
            config_path: home.join(".codex/config.json").display().to_string(),
            config_type: "json".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "gemini-cli".to_string(),
            tool_name: "Gemini CLI".to_string(),
            config_path: home.join(".gemini/settings.toml").display().to_string(),
            config_type: "toml".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "opencode".to_string(),
            tool_name: "OpenCode".to_string(),
            config_path: home.join(".opencode/config.json").display().to_string(),
            config_type: "json".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "openclaw".to_string(),
            tool_name: "OpenClaw".to_string(),
            config_path: home.join(".openclaw/config.json").display().to_string(),
            config_type: "json".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "hermes-agent".to_string(),
            tool_name: "Hermes Agent".to_string(),
            config_path: home.join(".hermes/config.yaml").display().to_string(),
            config_type: "yaml".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
        ToolConfigEntry {
            tool_id: "qoder-cli".to_string(),
            tool_name: "Qoder CLI".to_string(),
            config_path: home.join(".qoder/credentials.json").display().to_string(),
            config_type: "json".to_string(),
            base_url: None,
            api_key: None,
            provider_name: None,
        },
    ]
}

/// 当前工具配置预览
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentToolConfig {
    pub tool_id: String,
    pub tool_name: String,
    pub provider_name: Option<String>,
    pub base_url: Option<String>,
    pub api_key_masked: Option<String>,
}

pub fn get_current_config(tool_id: &str) -> Option<CurrentToolConfig> {
    let home = dirs::home_dir()?;
    let (path, name) = match tool_id {
        "claude-code" => (home.join(".claude/settings.json"), "Claude Code"),
        "codex" => (home.join(".codex/config.json"), "Codex"),
        "gemini-cli" => (home.join(".gemini/settings.toml"), "Gemini CLI"),
        "opencode" => (home.join(".opencode/config.json"), "OpenCode"),
        "openclaw" => (home.join(".openclaw/config.json"), "OpenClaw"),
        "hermes-agent" => (home.join(".hermes/config.json"), "Hermes Agent"),
        _ => return None,
    };
    if !path.exists() {
        return Some(CurrentToolConfig {
            tool_id: tool_id.to_string(),
            tool_name: name.to_string(),
            provider_name: None,
            base_url: None,
            api_key_masked: None,
        });
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let provider_name = extract_json_str(&content, "provider")
        .or_else(|| extract_json_str(&content, "provider_id"));
    let base_url = extract_json_str(&content, "api_base")
        .or_else(|| extract_json_str(&content, "base_url"));
    let api_key = extract_json_str(&content, "api_key")
        .or_else(|| extract_json_str(&content, "ANTHROPIC_API_KEY"))
        .or_else(|| extract_json_str(&content, "OPENAI_API_KEY"))
        .or_else(|| extract_json_str(&content, "GOOGLE_API_KEY"));
    let api_key_masked = api_key.as_ref().map(|k| {
        if k.len() <= 8 { "****".to_string() } else { format!("{}...{}", &k[..4], &k[k.len()-4..]) }
    });
    Some(CurrentToolConfig {
        tool_id: tool_id.to_string(),
        tool_name: name.to_string(),
        provider_name,
        base_url,
        api_key_masked,
    })
}

fn extract_json_str(content: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\":", key);
    if let Some(pos) = content.find(&pattern) {
        let after = &content[pos + pattern.len()..];
        let after = after.trim_start_matches(|c: char| c.is_whitespace() || c == ':' || c == '"');
        if after.starts_with('"') {
            let end = after[1..].find('"').map(|i| i + 2)?;
            Some(after[1..end].to_string())
        } else {
            let end = after.find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_' && c != ':' && c != '/').unwrap_or(after.len());
            let val = &after[..end];
            if !val.is_empty() { Some(val.to_string()) } else { None }
        }
    } else { None }
}

// ===== Version Detection & Upgrade =====

/// NPM 包映射：tool_id -> npm package name
pub fn get_npm_package(tool_id: &str) -> Option<&'static str> {
    match tool_id {
        "claude-code" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "gemini-cli" => Some("@google/gemini-cli"),
        "qoder-cli" => Some("@qoder-ai/qodercli"),
        "opencode" => Some("opencode-ai"),
        "deepseek-cli" => Some("@sluisr/deepseek-cli"),
        "openclaw" => Some("openclaw"),
        "hermes-agent" => Some("hermes-agent"),
        _ => None,
    }
}

/// 获取工具命令名
pub fn get_tool_command(tool_id: &str) -> &'static str {
    match tool_id {
        "claude-code" => "claude",
        "codex" => "codex",
        "gemini-cli" => "gemini",
        "opencode" => "opencode",
        "deepseek-cli" => "deepseek",
        "openclaw" => "openclaw",
        "hermes-agent" => "hermes",
        "qoder-cli" => "qodercli",
        "grok-build" => "grok",
        _ => "",
    }
}

/// 运行 `cmd --version` 获取本地版本号（统一提取纯版本号）
///
/// Windows 上 npm 全局安装的工具是 .cmd 批处理文件，Rust 的 Command::new
/// 不会自动加 .cmd 扩展名，必须通过 cmd /c 执行。同时用 CREATE_NO_WINDOW
/// 标志避免弹出黑色窗口。
pub fn get_local_version(tool_id: &str) -> Result<String, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let cmd = get_tool_command(tool_id);
    if cmd.is_empty() {
        return Err("unknown tool".to_string());
    }

    // 0. 强制以 npm 全局 package.json 为唯一判断依据
    //    理由：.cmd 脚本可能指向不存在的 JS，--version 会输出 Node 自身版本造成误判。
    //    如果 package.json 不存在，说明包未安装（不管 .cmd 脚本是不是残留），直接返回错误。
    if let Some(pkg) = get_npm_package(tool_id) {
        return read_npm_global_package_version(pkg);
    }

    // download 类型工具（如 grok-build），没有 npm 包，只能走 cmd --version
    let output = std::process::Command::new("cmd")
        .args(["/c", cmd, "--version"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(o) => parse_version_output(cmd, o),
        Err(_e) => std::process::Command::new(cmd)
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e2| format!("无法执行 {} --version: {}", cmd, e2))
            .and_then(|o| parse_version_output(cmd, o)),
    }
}

/// 从工具目录的 node_modules/package.json 读版本号
/// 用 --prefix 安装后，shim 和 package 都放在 {get_tools_dir()}，
/// 不再依赖 npm 全局 prefix（避免 AppData/QClaw 文件锁）
fn read_npm_global_package_version(pkg: &str) -> Result<String, String> {
    let prefix = get_tools_dir();

    // 2. 读 <prefix>/node_modules/<pkg>/package.json
    let pkg_json_path = std::path::Path::new(&prefix)
        .join("node_modules")
        .join(pkg)
        .join("package.json");

    if !pkg_json_path.exists() {
        return Err(format!("package.json 不存在: {}", pkg_json_path.display()));
    }

    let content = std::fs::read_to_string(&pkg_json_path)
        .map_err(|e| format!("读取失败: {}", e))?;

    // 3. 简单提取 "version" 字段
    let pkg_json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let ver = pkg_json.get("version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "package.json 无 version 字段".to_string())?;

    Ok(ver.to_string())
}

fn parse_version_output(cmd: &str, output: std::process::Output) -> Result<String, String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            if let Some(v) = extract_version(&stderr) { return Ok(v); }
        }
        return Err(format!("{} --version 退出码: {}", cmd, output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = format!("{} {}", stdout, stderr);
    extract_version(&combined).ok_or_else(|| format!("无法解析版本号: {}", combined))
}

/// 从文本中提取纯版本号（支持 v1.2.3 / 1.2.3 / 2026.6.5 等格式）
fn extract_version(text: &str) -> Option<String> {
    // 先找 semver 格式 x.y.z（可能带 v 前缀）
    let re = regex::Regex::new(r"[vV]?(\d+\.\d+\.\d+)").ok()?;
    if let Some(cap) = re.captures(text) {
        return Some(cap[1].to_string());
    }
    // 再找日期格式 YYYY.M.D 或 YYYY-M-D
    let re2 = regex::Regex::new(r"(\d{4}[.\-]\d{1,2}[.\-]\d{1,2})").ok()?;
    if let Some(cap) = re2.captures(text) {
        return Some(cap[1].to_string());
    }
    None
}

/// 语义化版本号比较（支持 semver x.y.z 和日期格式 YYYY.M.D）
/// 返回 -1 (a<b), 0 (a==b), 1 (a>b)
///
/// 示例：
///   compare_versions("2.1.138", "2.1.193") = -1
///   compare_versions("0.13.0", "0.4.4") = 1   （13>4 段位比较）
///   compare_versions("2026.6.5", "2026.6.10") = -1
///   compare_versions("1.0", "1.0.0") = 0
fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |v: &str| -> Vec<u64> {
        v.split(|c: char| c == '.' || c == '-' || c == '+')
            .filter_map(|s| s.parse::<u64>().ok())
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let max_len = va.len().max(vb.len());
    for i in 0..max_len {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x < y { return -1; }
        if x > y { return 1; }
    }
    0
}

/// 从 npm registry 获取最新版本号
pub async fn get_npm_latest_version(tool_id: &str) -> Result<String, String> {
    let pkg = get_npm_package(tool_id).ok_or("unknown tool".to_string())?;
    let url = format!("https://registry.npmjs.org/{}/latest", pkg);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("reqwest client: {}", e))?;
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 npm registry 失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("npm registry 返回 {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {}", e))?;
    let version = body["version"].as_str().ok_or("响应中无 version 字段")?;
    Ok(version.to_string())
}

/// 升级工具（npm install -g package@latest），cmd /c 静默执行不弹窗
pub fn upgrade_tool(tool_id: &str) -> Result<String, String> {
    upgrade_tool_with_progress_impl(tool_id, None)
}

/// 带进度事件的升级
pub fn upgrade_tool_with_progress(
    tool_id: &str,
    window: Option<&tauri::Window>,
) -> Result<String, String> {
    upgrade_tool_with_progress_impl(tool_id, window)
}

fn upgrade_tool_with_progress_impl(tool_id: &str, window: Option<&tauri::Window>) -> Result<String, String> {
    let pkg = get_npm_package(tool_id).ok_or("unknown tool".to_string())?;
    let emit = |step: &str, msg: &str| {
        if let Some(w) = window {
            let _ = w.emit("tool_install_progress", serde_json::json!({
                "tool_id": tool_id,
                "step": step,
                "message": msg,
            }));
        }
    };
    emit("start", &format!("准备升级 {}...", pkg));
    let prefix = get_tools_dir();
    let prefix_str = prefix.to_string_lossy().to_string();
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/c", "npm", "install", "-g", &format!("{}@latest", pkg), "--prefix", &prefix_str, "--json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000);
    let mut child = cmd.spawn().map_err(|e| format!("无法执行 npm install: {}", e))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let tool_id_owned = tool_id.to_string();
    let win_clone = window.cloned();
    let stdout_thread = stdout.map(|mut s| {
        let tid = tool_id_owned.clone();
        let win = win_clone.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(&mut s);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() { continue; }
                let step = if line.contains("idealTree") { "resolving" }
                          else if line.contains("reify") { "downloading" }
                          else if line.contains("audit") { "auditing" }
                          else { "progress" };
                let short = if line.len() > 60 { format!("{}...", &line[..57]) } else { line.clone() };
                if let Some(w) = &win {
                    let _ = w.emit("tool_install_progress", serde_json::json!({
                        "tool_id": tid,
                        "step": step,
                        "message": short,
                    }));
                }
            }
        })
    });
    let stderr_thread = stderr.map(|mut s| {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(&mut s);
            let mut err_buf = String::new();
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    err_buf.push_str(&line); err_buf.push('\n');
                }
            }
            err_buf
        })
    });
    let status = child.wait().map_err(|e| format!("等待进程失败: {}", e))?;
    let _ = stdout_thread.and_then(|t| t.join().ok());
    let stderr_text = stderr_thread.and_then(|t| t.join().ok()).unwrap_or_default();
    if status.success() {
        emit("done", &format!("{} 升级成功", pkg));
        Ok("升级完成".to_string())
    } else {
        let combined = if stderr_text.is_empty() { String::new() } else { stderr_text.clone() };
        if combined.contains("EBUSY") || combined.contains("resource busy") || combined.contains("rename") {
            emit("retry", "检测到文件占用，清理后重试...");
            clear_npm_global_shim_files(&pkg);
            // 重试一次（不递增进度）
            let retry = std::process::Command::new("cmd")
                .args(["/c", "npm", "install", "-g", &format!("{}@latest", pkg), "--prefix", &prefix_str, "--json"])
                .creation_flags(0x08000000)
                .output();
            match retry {
                Ok(o) if o.status.success() => {
                    emit("done", &format!("{} 升级成功（清理后重试）", pkg));
                    return Ok("升级完成".to_string());
                }
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stderr).to_string();
                    let short = if s.len() > 200 { format!("{}...", &s[..200]) } else { s.clone() };
                    emit("error", &short);
                    return Err(format!("升级失败: {}", short));
                }
                Err(e) => return Err(format!("重试失败: {}", e)),
            }
        }
        let short = if stderr_text.len() > 200 { format!("{}...", &stderr_text[..200]) } else { stderr_text.clone() };
        emit("error", &short);
        Err(format!("升级失败: {}", short))
    }
}

// / 卸载工具（npm uninstall -g）
pub fn install_tool(tool_id: &str, npm_package: &str) -> Result<String, String> {
    if tool_id == "claude-desktop" {
        return Err("Claude Desktop 请从 https://claude.ai/download 下载安装".to_string());
    }
    if tool_id == "grok-build" {
        return Err("Grok Build 请从 https://x.ai/cli 下载安装".to_string());
    }
    if tool_id == "deepseek-cli" {
        return Err("DeepSeek CLI 是内置工具，无需安装".to_string());
    }
    if npm_package.is_empty() {
        return Err("此工具不支持自动安装".to_string());
    }

    install_tool_with_progress(tool_id, npm_package, None)
}

/// 带进度事件版本的安装（可被前端 invoke 带 window 调用以获取实时进度）
pub fn install_tool_with_progress(
    tool_id: &str,
    npm_package: &str,
    window: Option<&tauri::Window>,
) -> Result<String, String> {
    if tool_id == "claude-desktop" { return Err("Claude Desktop 请从 https://claude.ai/download 下载安装".to_string()); }
    if tool_id == "grok-build" { return Err("Grok Build 请从 https://x.ai/cli 下载安装".to_string()); }
    if tool_id == "deepseek-cli" { return Err("DeepSeek CLI 是内置工具，无需安装".to_string()); }
    if npm_package.is_empty() { return Err("此工具不支持自动安装".to_string()); }

    let prefix = get_tools_dir();
    let prefix_str = prefix.to_string_lossy().to_string();

    let emit = |step: &str, msg: &str| {
        if let Some(w) = window {
            let _ = w.emit("tool_install_progress", serde_json::json!({
                "tool_id": tool_id,
                "step": step,
                "message": msg,
            }));
        }
    };

    emit("start", &format!("准备安装 {}...", npm_package));

    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/c", "npm", "install", "-g", npm_package, "--prefix", &prefix_str, "--json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000); // CREATE_NO_WINDOW：隐藏 cmd 黑窗

    let mut child = cmd.spawn().map_err(|e| format!("无法执行 npm install: {}", e))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 后台线程：读 stdout，每读一行就 emit 到前端
    let tool_id_owned = tool_id.to_string();
    let window_clone = window.cloned();
    let stdout_thread = stdout.map(|mut s| {
        let tid = tool_id_owned.clone();
        let win = window_clone.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(&mut s);
            let mut last_msg = String::new();
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() { continue; }
                let step = if line.contains("idealTree") { "resolving" }
                          else if line.contains("reify") { "downloading" }
                          else if line.contains("audit") { "auditing" }
                          else { "progress" };
                let short = if line.len() > 60 { format!("{}...", &line[..57]) } else { line.clone() };
                last_msg = short.clone();
                println!("[install:{}] {}", tid, short);
                if let Some(w) = &win {
                    let _ = w.emit("tool_install_progress", serde_json::json!({
                        "tool_id": tid,
                        "step": step,
                        "message": short,
                    }));
                }
            }
            last_msg
        })
    });

    // 后台线程：读 stderr
    let stderr_thread = stderr.map(|mut s| {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(&mut s);
            let mut err_buf = String::new();
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    err_buf.push_str(&line);
                    err_buf.push('\n');
                }
            }
            err_buf
        })
    });

    // 等待完成
    let status = child.wait().map_err(|e| format!("等待进程失败: {}", e))?;

    let stdout_text = stdout_thread.and_then(|t| t.join().ok()).unwrap_or_default();
    let stderr_text = stderr_thread.and_then(|t| t.join().ok()).unwrap_or_default();

    if status.success() {
        emit("done", &format!("{} 安装成功", npm_package));
        Ok(format!("安装完成 ({})", npm_package))
    } else {
        // 拼凑错误
        let combined = if stderr_text.is_empty() { stdout_text } else { stderr_text };
        let raw = combined.clone();

        if raw.contains("EBUSY") || raw.contains("resource busy") || raw.contains("rename") {
            emit("retry", "检测到文件占用，清理后重试...");
            clear_npm_global_shim_files(npm_package);
            let _ = std::process::Command::new("cmd")
                .args(["/c", "npm", "install", "-g", npm_package, "--prefix", &prefix_str, "--json"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(0x08000000)
                .output();
            // 重试时再调一次以拿到结果
            let retry = std::process::Command::new("cmd")
                .args(["/c", "npm", "install", "-g", npm_package, "--prefix", &prefix_str, "--json"])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("重试失败: {}", e))?;
            if retry.status.success() {
                emit("done", "重试安装成功");
                return Ok(format!("安装完成 (重试, {})", npm_package));
            }
            let err2 = String::from_utf8_lossy(&retry.stderr).to_string();
            emit("error", &format!("重试仍失败: {}", if err2.is_empty() { String::from("未知错误") } else { err2.clone() }));
            return Err(format!("安装失败 (重试): {}", if err2.is_empty() { "未知错误".to_string() } else { err2 }));
        }
        let short = if combined.len() > 200 { format!("{}...", &combined[..200]) } else { combined.clone() };
        emit("error", &format!("安装失败: {}", short));
        Err(format!("安装失败: {}", if combined.is_empty() { "未知错误".to_string() } else { combined }))
    }
}

/// 卸载工具（npm uninstall -g --prefix）
pub fn install_download_tool(
    tool_id: &str,
    _install_url: &str,
    window: Option<&tauri::Window>,
) -> Result<String, String> {
    let emit = |step: &str, msg: &str| {
        if let Some(w) = window {
            let _ = w.emit("tool_install_progress", serde_json::json!({
                "tool_id": tool_id,
                "step": step,
                "message": msg,
            }));
        }
    };

    emit("preparing", "准备安装 Grok Build...");
    emit("downloading", "正在连接 Grok 服务器...");

    let ps_script = r#"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'x86_64' }
    'x86'   { 'x86_64' }
    'ARM64' { 'aarch64' }
    default { $null }
}
if (-not $arch) { Write-Host 'ERR:Unsupported arch'; exit 1 }
$platform = "windows-$arch"

$BaseUrlPrimary = 'https://x.ai/cli'
$BaseUrlFallback = 'https://storage.googleapis.com/grok-build-public-artifacts/cli'
$GrokDir = Join-Path $env:USERPROFILE '.grok'
$BinDir = Join-Path $GrokDir 'bin'
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

# 直接走 GCS 回退，x.ai 被墙在国内无法访问
Write-Host 'SOURCE:GCS'
$BaseUrl = $BaseUrlFallback

# GCS 没有 /stable 端点，使用已知最新版本（国内可访问）
$KnownVersions = @('0.2.3', '0.2.2', '0.2.1', '0.2.0')
$ver = $null
$lastErr = ''
foreach ($tryVer in $KnownVersions) {
    $testUrl = "$BaseUrl/grok-$tryVer-windows-x86_64.exe"
    try {
        $resp = Invoke-WebRequest -Uri $testUrl -Method HEAD -UseBasicParsing -TimeoutSec 5
        $ver = $tryVer
        Write-Host "VERSION:$ver"
        break
    } catch {
        $lastErr = $_.Exception.Message
    }
}
if (-not $ver) {
    Write-Host "ERR:Failed to find available version: $lastErr"
    exit 1
}

Write-Host 'DOWNLOAD_START'
$dlPath = Join-Path $env:TEMP "grok-$platform-$ver.exe"
$artifactBase = "$BaseUrl/grok-$ver-$platform"
$downloaded = $false

$dlUrl = "$artifactBase.exe"
Write-Host "DOWNLOAD:$dlUrl"
try {
    $req = [System.Net.HttpWebRequest]::Create($dlUrl)
    $req.Timeout = 300000
    $req.ReadWriteTimeout = 300000
    $resp = $req.GetResponse()
    $total = $resp.ContentLength
    $st = $resp.GetResponseStream()
    $fs = [System.IO.File]::Create($dlPath)
    $buf = New-Object byte[] 8192
    $read = 0; $tot = 0; $lastPct = -1
    while (($read = $st.Read($buf, 0, $buf.Length)) -gt 0) {
        $fs.Write($buf, 0, $read)
        $tot += $read
        if ($total -gt 0) {
            $pct = [math]::Floor(($tot / $total) * 100)
            if ($pct -ne $lastPct -and $pct % 5 -eq 0) {
                Write-Host "PROGRESS:$pct"
                $lastPct = $pct
            }
        }
    }
    $fs.Close(); $st.Close(); $resp.Close()
    $downloaded = $true
    Write-Host 'PROGRESS:100'
} catch {
    Write-Host "ERR:Download failed: $($_.Exception.Message)"
}

if (-not $downloaded) {
    Write-Host 'ERR:Download failed'
    exit 1
}

Write-Host 'INSTALL_START'
$dest = Join-Path $BinDir 'grok.exe'
Copy-Item -Path $dlPath -Destination $dest -Force
$agentDest = Join-Path $BinDir 'agent.exe'
Copy-Item -Path $dlPath -Destination $agentDest -Force

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$BinDir;$userPath", 'User')
    $env:Path = "$BinDir;$env:Path"
}

Remove-Item $dlPath -Force -EA SilentlyContinue
Write-Host "DONE:$ver"
"#;

    let tmp_path = std::env::temp_dir().join(format!("grok_install_{}.ps1", std::process::id()));
    use std::io::Write;
    let mut f = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("创建安装脚本失败: {}", e))?;
    f.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("写入脚本失败: {}", e))?;
    f.write_all(ps_script.as_bytes())
        .map_err(|e| format!("写入脚本失败: {}", e))?;
    drop(f);

    let mut child = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", &tmp_path.to_string_lossy()])
        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动安装进程失败: {}", e))?;

    let mut version_found = String::new();

    fn strip_ansi(s: &str) -> String {
        let mut r = String::with_capacity(s.len());
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                while let Some(&ch) = chars.peek() {
                    chars.next();
                    if ch == 'm' { break; }
                }
            } else {
                r.push(c);
            }
        }
        r
    }

    if let Some(stdout) = child.stdout.take() {
        use std::io::{BufRead, BufReader};
        let mut reader = BufReader::new(stdout).lines();
        while let Some(Ok(line)) = reader.next() {
            let clean = strip_ansi(line.trim());
            if clean.is_empty() { continue; }
            if clean.starts_with("PROGRESS:") {
                if let Ok(pct) = clean["PROGRESS:".len()..].trim().parse::<u32>() {
                    emit("downloading", &format!("下载中... {}%", pct.min(95)));
                }
            } else if clean.starts_with("VERSION:") {
                let v = clean["VERSION:".len()..].trim().to_string();
                version_found = v.clone();
                emit("downloading", &format!("检测到版本 v{}", v));
            } else if clean == "DOWNLOAD_START" {
                emit("downloading", "正在下载 Grok Build...");
            } else if clean == "INSTALL_START" {
                emit("installing", "正在安装到 ~/.grok/bin...");
            } else if clean.starts_with("DONE:") {
                let v = clean["DONE:".len()..].trim();
                emit("done", &format!("Grok Build v{} 安装完成", v));
            } else if clean.starts_with("ERR:") {
                let msg = clean["ERR:".len()..].trim();
                emit("error", msg);
            }
        }
    }

    let _ = std::fs::remove_file(&tmp_path);

    let status = child.wait().map_err(|e| format!("等待安装进程失败: {}", e))?;

    if !status.success() {
        emit("error", "安装失败，进程退出码异常");
        return Err("Grok Build 安装失败".to_string());
    }

    if version_found.is_empty() {
        emit("error", "未获取到版本号，安装可能失败");
        return Err("未获取到 Grok Build 版本号".to_string());
    }

    emit("verifying", "验证安装...");
    let grok_bin = std::env::var("USERPROFILE")
        .map(|p| std::path::Path::new(&p).join(".grok").join("bin").join("grok.exe"))
        .map_err(|_| "无法获取用户目录")?;

    if !grok_bin.exists() {
        return Err(format!("安装验证失败: {} 不存在", grok_bin.display()));
    }

    emit("done", &format!("Grok Build v{} 安装成功！", version_found));
    Ok(format!("Grok Build v{} 安装完成", version_found))
}

pub fn uninstall_tool(tool_id: &str) -> Result<String, String> {
    if tool_id == "claude-desktop" {
        return Err("Claude Desktop 需通过 Windows「设置 → 应用」卸载".to_string());
    }
    if tool_id == "grok-build" {
        if let Ok(home) = std::env::var("USERPROFILE") {
            let dir = std::path::Path::new(&home).join(".grok");
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| format!("删除 ~/.grok 失败: {}", e))?;
                return Ok("Grok Build 已卸载".to_string());
            }
        }
        return Err("Grok Build 未安装".to_string());
    }
    let pkg = get_npm_package(tool_id).ok_or("unknown tool".to_string())?;
    if pkg.is_empty() {
        return Err("此工具不需要卸载".to_string());
    }
    let prefix = get_tools_dir();
    let prefix_str = prefix.to_string_lossy().to_string();

    let output = std::process::Command::new("cmd")
        .args(["/c", "npm", "uninstall", "-g", &pkg, "--prefix", &prefix_str])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW：隐藏 cmd 黑窗
        .output()
        .map_err(|e| format!("无法执行 npm uninstall: {}", e))?;

    if output.status.success() {
        Ok("卸载完成".to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("卸载失败: {}", err))
    }
}

/// 诊断工具安装冲突
#[derive(serde::Serialize)]
pub struct ConflictItem {
    pub source: String,
    pub path: String,
    pub version: String,
    pub is_default: bool,
    pub runnable: bool,
}

#[derive(serde::Serialize)]
pub struct DiagnoseResult {
    pub has_conflict: bool,
    pub items: Vec<ConflictItem>,
    pub default_path: Option<String>,
}

/// 后台静默执行 where/which 命令查找所有安装位置
pub fn diagnose_tool_conflicts(tool_id: &str) -> Result<DiagnoseResult, String> {
    let cmd = get_tool_command(tool_id);
    if cmd.is_empty() {
        return Err("unknown tool".to_string());
    }

    // 1. 通过 where.exe 查找所有位置（CREATE_NO_WINDOW 避免弹黑窗）
    let where_output = std::process::Command::new("where")
        .arg(&cmd)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("where 命令失败: {}", e))?;

    let mut items: Vec<ConflictItem> = Vec::new();
    let mut default_path: Option<String> = None;

    if where_output.status.success() {
        let stdout = String::from_utf8_lossy(&where_output.stdout);
        for line in stdout.lines() {
            let path = line.trim().to_string();
            if path.is_empty() { continue; }

            // 检测该路径是否可运行（用 cmd /c 走 .cmd 必须 CREATE_NO_WINDOW）
            let runnable = std::process::Command::new("cmd")
                .args(["/c", &path, "--version"])
                .creation_flags(0x08000000)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);

            // 尝试获取版本
            let version = if runnable {
                std::process::Command::new("cmd")
                    .args(["/c", &path, "--version"])
                    .creation_flags(0x08000000)
                    .output()
                    .ok()
                    .and_then(|o| {
                        let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if !out.is_empty() { Some(out) } else if !err.is_empty() { Some(err) } else { None }
                    })
                    .unwrap_or_else(|| "未知".to_string())
            } else {
                "无法运行".to_string()
            };

            // 第一个路径是默认路径
            let is_default = default_path.is_none();
            if is_default {
                default_path = Some(path.clone());
            }

            // 判断来源
            let source = if path.contains("npm") || path.contains("node_modules") {
                "npm"
            } else if path.contains("pip") || path.contains("Python") {
                "pip"
            } else {
                "system"
            }.to_string();

            items.push(ConflictItem {
                source,
                path,
                version,
                is_default,
                runnable,
            });
        }
    }

    // 2. 检查 npm 全局目录（CREATE_NO_WINDOW 避免弹黑窗）
    if let Ok(npm_root) = std::process::Command::new("cmd")
        .args(["/c", "npm", "root", "-g"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    {
        let npm_cmd_path = format!("{}/.bin/{}.{}", npm_root, cmd, if cfg!(windows) { "cmd" } else { "" });
        let npm_cmd_path2 = format!("{}/.bin/{}", npm_root, cmd);
        for p in [npm_cmd_path, npm_cmd_path2] {
            let p_clean = p.trim_end_matches('.');
            if std::path::Path::new(p_clean).exists() && !items.iter().any(|i| i.path == p_clean) {
                let runnable = std::process::Command::new("cmd")
                    .args(["/c", p_clean, "--version"])
                    .creation_flags(0x08000000)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                let version = if runnable {
                    std::process::Command::new("cmd")
                        .args(["/c", p_clean, "--version"])
                        .creation_flags(0x08000000)
                        .output()
                        .ok()
                        .and_then(|o| {
                            let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                            if !out.is_empty() { Some(out) } else if !err.is_empty() { Some(err) } else { None }
                        })
                        .unwrap_or_else(|| "未知".to_string())
                } else {
                    "无法运行".to_string()
                };
                items.push(ConflictItem {
                    source: "npm".to_string(),
                    path: p_clean.to_string(),
                    version,
                    is_default: false,
                    runnable,
                });
            }
        }
    }

    let has_conflict = items.len() > 1 || items.iter().any(|i| !i.runnable);

    Ok(DiagnoseResult {
        has_conflict,
        items,
        default_path,
    })
}

/// 检查工具是否需要升级（统一在 Rust 端比对，避免前端字符串直接比对出错）
/// 返回 (local_version, npm_version, can_upgrade)
pub async fn check_tool_upgrade(tool_id: &str) -> Result<(String, String, bool), String> {
    let local = get_local_version(tool_id).ok();
    let npm = get_npm_latest_version(tool_id).await.ok();
    // 用语义化版本号比较：local < npm 才视为可升级
    let can_upgrade = match (&local, &npm) {
        (Some(l), Some(n)) => compare_versions(l, n) < 0,
        _ => false,
    };
    Ok((local.unwrap_or_default(), npm.unwrap_or_default(), can_upgrade))
}
