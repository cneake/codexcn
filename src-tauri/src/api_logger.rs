// CodexHub CN API 调用日志记录
// 写入 JSONL 格式，路径: {app_data_dir}/logs/api_log.jsonl

use std::io::Write;

const LOG_FILE: &str = "api_log.jsonl";

/// 日志条目结构
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct ApiLogEntry {
    pub timestamp: String,          // ISO 8601
    pub tool_id: String,
    pub model: String,
    pub request_length: usize,      // 输入字符数
    pub response_status: u16,
    pub response_length: usize,     // 输出字符数
    pub duration_ms: u64,           // 请求耗时
    pub success: bool,
    pub error: Option<String>,
}

/// 写入一条 API 日志
pub fn log_api_call(
    app_data_dir: &str,
    tool_id: &str,
    model: &str,
    request_length: usize,
    response_status: u16,
    response_length: usize,
    duration_ms: u64,
    success: bool,
    error: Option<String>,
) {
    let entry = ApiLogEntry {
        timestamp: chrono_now(),
        tool_id: tool_id.to_string(),
        model: model.to_string(),
        request_length,
        response_status,
        response_length,
        duration_ms,
        success,
        error,
    };

    let logs_dir = format!("{}/logs", app_data_dir);
    let _ = std::fs::create_dir_all(&logs_dir);
    
    let path = format!("{}/{}", logs_dir, LOG_FILE);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        if let Ok(line) = serde_json::to_string(&entry) {
            let _ = writeln!(file, "{}", line);
        }
    }
}

fn chrono_now() -> String {
    let now: chrono::DateTime<chrono::Local> = chrono::Local::now();
    now.format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// 读取最近 N 条日志
pub fn get_recent_logs(
    app_data_dir: &str,
    limit: usize,
) -> Vec<ApiLogEntry> {
    let path = format!("{}/logs/{}", app_data_dir, LOG_FILE);
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut entries: Vec<ApiLogEntry> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    entries.reverse();
    entries.truncate(limit);
    entries
}

/// 获取日志数量（总条数）
pub fn get_log_count(app_data_dir: &str) -> usize {
    let path = format!("{}/logs/{}", app_data_dir, LOG_FILE);
    match std::fs::read_to_string(&path) {
        Ok(c) => c.lines().count(),
        Err(_) => 0,
    }
}
