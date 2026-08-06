use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUsage {
    pub tool_id: String,
    pub tool_name: String,
    pub supported: bool,
    pub total_sessions: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cache_creation_tokens: u64,
    /// 最近7天每天的用量
    pub daily: Vec<DailyUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String,
    pub sessions: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotalUsage {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub tool_count: u64,
}





/// 获取所有工具的 usage 统计
#[allow(dead_code)]
pub fn get_all_usage() -> Vec<ToolUsage> {
    let unsupported = vec![
        ("codex", "Codex"),
        ("gemini-cli", "Gemini CLI"),
        ("opencode", "OpenCode"),
        ("openclaw", "OpenClaw"),
        ("hermes-agent", "Hermes Agent"),
        ("grok-build", "Grok Build"),
        ("qoder-cli", "Qoder CLI"),
        ("claude-desktop", "Claude Desktop"),
        ("deepseek-cli", "DeepSeek CLI"),
        ("claude-code", "Claude Code"),
    ];

    let mut results = vec![];
    for (id, name) in unsupported {
        results.push(ToolUsage {
            tool_id: id.into(),
            tool_name: name.into(),
            supported: false,
            total_sessions: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_read_tokens: 0,
            total_cache_creation_tokens: 0,
            daily: vec![],
        });
    }
    results
}
