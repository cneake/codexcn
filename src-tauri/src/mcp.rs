use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport: String,       // "stdio" | "sse" | "http"
    pub command: Option<String>, // stdio 模式的命令
    pub args: Option<String>,    // JSON 数组字符串
    pub url: Option<String>,    // sse/http 模式的 URL
    pub env: Option<String>,    // JSON 对象字符串，环境变量
    pub headers: Option<String>, // JSON 对象字符串，HTTP 头
    pub enabled: bool,
    pub pid: Option<u32>,       // 运行时进程 PID
    pub running: bool,          // 是否正在运行
    pub created_at: String,
    pub updated_at: String,
}

/// MCP 服务器与工具的关联
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerTool {
    pub mcp_server_id: String,
    pub tool_id: String,
    pub enabled: bool,
}

/// 各工具的 MCP 配置文件路径
fn mcp_config_path(tool_id: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match tool_id {
        "claude-code" => Some(home.join(".claude.json")),
        "codex" => Some(home.join(".codex").join("config.json")),
        "opencode" => Some(home.join(".opencode").join("config.json")),
        "openclaw" => Some(home.join(".openclaw").join("config.json")),
        _ => None,
    }
}

/// 将 MCP 服务器配置写入工具的配置文件
pub fn write_mcp_config_for_tool(tool_id: &str, servers: &[McpServer]) -> Result<(), String> {
    let path =
        mcp_config_path(tool_id).ok_or_else(|| format!("工具 {} 不支持 MCP 配置", tool_id))?;

    // 读取现有配置
    let existing: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));

    // 构建 mcpServers 对象
    let mut mcp_servers = serde_json::Map::new();
    for server in servers {
        let mut server_config = serde_json::Map::new();
        match server.transport.as_str() {
            "stdio" => {
                server_config.insert(
                    "command".into(),
                    serde_json::Value::String(server.command.clone().unwrap_or_default()),
                );
                if let Some(ref args_str) = server.args {
                    if let Ok(args_val) = serde_json::from_str::<serde_json::Value>(args_str) {
                        server_config.insert("args".into(), args_val);
                    }
                }
                if let Some(ref env_str) = server.env {
                    if let Ok(env_val) = serde_json::from_str::<serde_json::Value>(env_str) {
                        server_config.insert("env".into(), env_val);
                    }
                }
            }
            "sse" => {
                server_config.insert(
                    "type".into(),
                    serde_json::Value::String("sse".into()),
                );
                server_config.insert(
                    "url".into(),
                    serde_json::Value::String(server.url.clone().unwrap_or_default()),
                );
            }
            "http" | "streamable-http" => {
                server_config.insert(
                    "type".into(),
                    serde_json::Value::String("streamable-http".into()),
                );
                server_config.insert(
                    "url".into(),
                    serde_json::Value::String(server.url.clone().unwrap_or_default()),
                );
                if let Some(ref headers_str) = server.headers {
                    if let Ok(headers_val) = serde_json::from_str::<serde_json::Value>(headers_str)
                    {
                        server_config.insert("headers".into(), headers_val);
                    }
                }
            }
            _ => continue,
        }
        mcp_servers.insert(
            server.id.clone(),
            serde_json::Value::Object(server_config),
        );
    }

    // 合并到现有配置
    let config = match existing {
        serde_json::Value::Object(mut map) => {
            map.insert(
                "mcpServers".into(),
                serde_json::Value::Object(mcp_servers),
            );
            serde_json::Value::Object(map)
        }
        _ => {
            let mut map = serde_json::Map::new();
            map.insert(
                "mcpServers".into(),
                serde_json::Value::Object(mcp_servers),
            );
            serde_json::Value::Object(map)
        }
    };

    // Claude Code 双写 .claude/settings.json
    if tool_id == "claude-code" {
        let settings_path = dirs::home_dir()
            .ok_or("无 home 目录")?
            .join(".claude")
            .join("settings.json");
        if settings_path.exists() {
            let settings: serde_json::Value = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!({}));
            let mut settings_map = match settings {
                serde_json::Value::Object(m) => m,
                _ => serde_json::Map::new(),
            };
            if let Some(mcp) = config.get("mcpServers").cloned() {
                settings_map.insert("mcpServers".into(), mcp);
            }
            let settings_content = serde_json::to_string_pretty(&serde_json::Value::Object(
                settings_map,
            ))
            .map_err(|e| e.to_string())?;
            atomic_write_file(&settings_path, &settings_content)?;
        }
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write_file(&path, &content)?;
    Ok(())
}

fn atomic_write_file(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let tmp_path = path.with_extension("tmp");
    std::fs::write(&tmp_path, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    std::fs::rename(&tmp_path, path).map_err(|e| format!("重命名文件失败: {}", e))?;
    Ok(())
}

/// 读取工具当前的 MCP 配置
pub fn read_mcp_config_for_tool(tool_id: &str) -> Result<serde_json::Value, String> {
    let path =
        mcp_config_path(tool_id).ok_or_else(|| format!("工具 {} 不支持 MCP 配置", tool_id))?;
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析配置失败: {}", e))?;
    Ok(config.get("mcpServers").cloned().unwrap_or(serde_json::json!({})))
}
