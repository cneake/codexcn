// Tool installer: install/uninstall/upgrade npm CLI tools
// Tools will be installed to {InstallDir}\tools\ directory

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::process::Command;

use crate::install_dir;

#[derive(Debug, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    pub tool_id: String,
}

/// Get npm global prefix path
/// This should point to {InstallDir}\tools\
fn get_npm_prefix() -> PathBuf {
    install_dir::get_tools_dir()
}

/// Install a npm package globally
#[tauri::command]
pub async fn install_npm_tool(_tool_id: String, npm_package: String) -> Result<String, String> {
    let prefix = get_npm_prefix();

    // 确保工具目录存在
    if !prefix.exists() {
        std::fs::create_dir_all(&prefix)
            .map_err(|e| format!("创建工具目录失败: {}", e))?;
    }

    let prefix_str = prefix.to_string_lossy().to_string();

    // 第一次尝试
    let result = run_npm_install(&prefix_str, &npm_package).await;
    match result {
        Ok(msg) => Ok(msg),
        Err(err) if err.contains("EBUSY") || err.contains("resource busy") || err.contains("rename") => {
            // EBUSY：清理 npm 全局 shim 后重试
            eprintln!("[install_npm_tool] EBUSY detected, clearing npm shim files and retrying...");
            clear_npm_global_shim_files(&npm_package);
            run_npm_install(&prefix_str, &npm_package).await
        }
        Err(err) => Err(err),
    }
}

async fn run_npm_install(prefix: &str, npm_package: &str) -> Result<String, String> {
    // 用 --prefix 参数把包和 shim 都安装到 {InstallDir}\tools\ 下
    // 不依赖 npm 全局配置（AppData），不写注册表
    let mut cmd = Command::new("npm");
    cmd.args(&["install", "-g", npm_package])
        .arg("--prefix")
        .arg(prefix)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await
        .map_err(|e| format!("安装失败: {}", e))?;

    if output.status.success() {
        Ok(format!("安装成功: {}", npm_package))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        // npm install 有时把警告写到 stdout
        let out = String::from_utf8_lossy(&output.stdout);
        if out.contains("warn") && !err.contains("error") {
            // 只有警告但实际装上了，算成功
            Ok(format!("安装成功: {} ({})", npm_package, out.lines().last().unwrap_or("").trim()))
        } else {
            Err(format!("安装失败: {}", if err.is_empty() { out.as_ref() } else { &err }))
        }
    }
}

/// 清理 npm 全局目录（AppData\QClaw\npm-global）下的 shim 文件，解决文件锁冲突
fn clear_npm_global_shim_files(npm_package: &str) {
    let last = npm_package.rsplit('/').next().unwrap_or(npm_package);
    let known_bins = ["hermes", "hermes-agent", "codex", "claude", "opencode", "openclaw", "gemini", "qodercli", "deepseek"];
    for name in &[npm_package, last].iter().chain(known_bins.iter()) {
        for ext in ["cmd", "ps1"] {
            let path = std::path::Path::new(&std::env::var("APPDATA").unwrap_or_default())
                .join("QClaw")
                .join("npm-global")
                .join(format!("{}.{}", name, ext));
            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// Uninstall a npm package
#[tauri::command]
pub async fn uninstall_npm_tool(tool_id: String) -> Result<String, String> {
    let prefix = get_npm_prefix();

    let npm_package = match tool_id.as_str() {
        "claude-code" => "claude",
        "codex" => "@openai/codex-cli",
        "gemini-cli" => "@google/gemini-cli",
        "opencode" => "opencode-ai",
        "openclaw" => "openclaw",
        "hermes-agent" => "hermes-agent",
        "qoder-cli" => "@qoder-ai/qodercli",
        "deepseek-cli" => "deepseek-cli",
        _ => return Err(format!("未知工具: {}", tool_id)),
    };

    let prefix_str = prefix.to_string_lossy().to_string();
    let mut cmd = Command::new("npm");
    cmd.args(&["uninstall", "-g", npm_package])
        .arg("--prefix")
        .arg(&prefix_str)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().await
        .map_err(|e| format!("卸载失败: {}", e))?;

    if output.status.success() {
        Ok(format!("卸载成功: {}", npm_package))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("卸载失败: {}", err))
    }
}

/// Upgrade a npm package to latest version
#[tauri::command]
pub async fn upgrade_npm_tool(tool_id: String) -> Result<String, String> {
    // Upgrade is same as install (npm will update to latest)
    let npm_package = match tool_id.as_str() {
        "claude-code" => "claude",
        "codex" => "@openai/codex-cli",
        "gemini-cli" => "@google/gemini-cli",
        "opencode" => "opencode-ai",
        "openclaw" => "openclaw",
        "hermes-agent" => "hermes-agent",
        "qoder-cli" => "@qoder-ai/qodercli",
        "deepseek-cli" => "deepseek-cli",
        _ => return Err(format!("未知工具: {}", tool_id)),
    };
    
    install_npm_tool(tool_id, npm_package.to_string()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_npm_prefix() {
        let prefix = get_npm_prefix();
        assert!(prefix.exists() || std::path::Path::new(&prefix).parent().is_some());
    }
}

/// 在系统默认浏览器中打开 URL（用于 download 类型工具的安装页）
#[tauri::command]
pub async fn open_install_page(url: String) -> Result<String, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new("cmd");
    cmd.args(&["/c", "start", "", &url])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.output().await
        .map_err(|e| format!("打开页面失败: {}", e))?;
    if output.status.success() {
        Ok(format!("已打开: {}", url))
    } else {
        Err(format!("打开失败: {}", String::from_utf8_lossy(&output.stderr)))
    }
}
