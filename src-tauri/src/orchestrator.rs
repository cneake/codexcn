use std::time::Duration;

use futures_util::future::join_all;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{Database, MultiAgentSession, MultiAgentResult};

/// 单个子Agent的执行结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubAgentResult {
    pub tool_id: String,
    pub agent_name: String,
    pub content: String,
    pub error: Option<String>,
}

/// 工具ID → 友好显示名
fn agent_display_name(tool_id: &str) -> String {
    match tool_id {
        "claude-code" => "Claude Code",
        "codex" => "Codex",
        "gemini-cli" => "Gemini",
        "deepseek-cli" => "DeepSeek",
        "openclaw" => "OpenClaw",
        "hermes-agent" => "Hermes",
        "qoder-cli" => "Qoder",
        "opencode" => "OpenCode",
        "claude-desktop" => "Claude Desktop",
        other => other,
    }
    .to_string()
}

/// 调用单个 Agent 的 OpenAI 兼容 API，收集完整回复（非流式推送，直接返回文本）
async fn call_agent(db: Database, tool_id: &str, system: &str, user_msg: &str) -> SubAgentResult {
    let name = agent_display_name(tool_id);

    let config: serde_json::Value = match db.get_tool_api_config(tool_id) {
        Ok(c) => c,
        Err(e) => {
            return SubAgentResult {
                tool_id: tool_id.to_string(),
                agent_name: name,
                content: String::new(),
                error: Some(e),
            }
        }
    };

    let api_key = config["api_key"].as_str().unwrap_or("").to_string();
    let base_url = config["base_url"].as_str().unwrap_or("").to_string();
    let model = config["model"].as_str().unwrap_or("").to_string();

    if api_key.is_empty() || model.is_empty() {
        return SubAgentResult {
            tool_id: tool_id.to_string(),
            agent_name: name,
            content: String::new(),
            error: Some("该工具未配置 API Key 或默认模型".to_string()),
        };
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg}
        ],
        "stream": true,
        "stream_options": {"include_usage": true}
    });

    let client: reqwest::Client = match Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return SubAgentResult {
                tool_id: tool_id.to_string(),
                agent_name: name,
                content: String::new(),
                error: Some(format!("创建 HTTP 客户端失败: {}", e)),
            }
        }
    };

    let resp: reqwest::Response = match client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return SubAgentResult {
                tool_id: tool_id.to_string(),
                agent_name: name,
                content: String::new(),
                error: Some(format!("请求 API 失败: {}", e)),
            }
        }
    };

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        return SubAgentResult {
            tool_id: tool_id.to_string(),
            agent_name: name,
            content: String::new(),
            error: Some(format!("API 返回错误: {}", err)),
        };
    }

    let mut stream = resp.bytes_stream();
    let mut content = String::new();
    let mut current_data = String::new();

    while let Some(chunk_result) = stream.next().await {
        if let Err(_) = chunk_result {
            continue;
        }
        let chunk = chunk_result.unwrap();
        let text = String::from_utf8_lossy(&chunk);
        for ch in text.chars() {
            if ch == '\n' {
                let line = current_data.trim().to_string();
                current_data.clear();
                if line.starts_with("data:") {
                    let data = line[5..].trim();
                    if !data.is_empty() && data != "[DONE]" {
                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(delta) = j
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                            {
                                let piece = delta
                                    .get("content")
                                    .and_then(|c| c.as_str())
                                    .or_else(|| delta.get("reasoning_content").and_then(|c| c.as_str()));
                                if let Some(p) = piece {
                                    content.push_str(p);
                                }
                            }
                        }
                    }
                }
            } else {
                current_data.push(ch);
            }
        }
    }

    SubAgentResult {
        tool_id: tool_id.to_string(),
        agent_name: name,
        content,
        error: None,
    }
}

/// 主命令：并行派发任务给多个子Agent，收集各自独立回答
#[tauri::command]
pub async fn run_subagents(
    task: String,
    tool_ids: Vec<String>,
    db: State<'_, Database>,
) -> Result<Vec<SubAgentResult>, String> {
    let system = "你是 GenHub AI 助手，作为子Agent参与一个多Agent协作任务。请针对用户给出的任务，给出你独立、专业的分析与回答。不要等待其他Agent，直接输出你的见解，保持简洁有条理。";

    let mut handles = Vec::new();
    for tid in &tool_ids {
        let db_clone = db.inner().clone();
        let tid_owned = tid.clone();
        let task_owned = task.clone();
        let system_owned = system.to_string();
        handles.push(async move {
            call_agent(db_clone, &tid_owned, &system_owned, &task_owned).await
        });
    }

    let results = join_all(handles).await;
    Ok(results)
}

/// 主命令：主Agent综合所有子Agent回答，产出最终方案
#[tauri::command]
pub async fn summarize_discussion(
    task: String,
    results: Vec<SubAgentResult>,
    main_tool_id: String,
    db: State<'_, Database>,
) -> Result<String, String> {
    let combined = results
        .iter()
        .map(|r| format!("### Agent: {}\n{}\n", r.agent_name, r.content))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "你是一个多Agent协作系统的最终汇总Agent。下面是多个子Agent对同一个任务给出的独立回答。\n\n任务：{}\n\n各子Agent回答如下：\n{}\n\n请综合以上所有回答，去重、补充、权衡，给出一份最终的综合方案/结论。要求：结构清晰、可直接落地执行、直接给结论，不要重复罗列各Agent原话。",
        task, combined
    );

    let res = call_agent(
        db.inner().clone(),
        &main_tool_id,
        "你是 GenHub 多Agent协作系统的最终汇总Agent，负责综合多个子Agent的回答，产出最终结论。",
        &prompt,
    )
    .await;

    if let Some(e) = res.error {
        return Err(e);
    }
    Ok(res.content)
}

/// 持久化：保存多Agent协作会话和结果
#[tauri::command]
pub async fn save_multiagent_session(
    session: MultiAgentSession,
    results: Vec<MultiAgentResult>,
    db: State<'_, Database>,
) -> Result<(), String> {
    db.save_multiagent_session(&session, &results)
}

/// 持久化：获取历史会话列表
#[tauri::command]
pub async fn get_multiagent_sessions(
    limit: i32,
    db: State<'_, Database>,
) -> Result<Vec<MultiAgentSession>, String> {
    db.get_multiagent_sessions(limit)
}

/// 持久化：获取会话的所有结果
#[tauri::command]
pub async fn get_multiagent_results(
    session_id: String,
    db: State<'_, Database>,
) -> Result<Vec<MultiAgentResult>, String> {
    db.get_multiagent_results(&session_id)
}

/// 持久化：删除会话（级联删除结果）
#[tauri::command]
pub async fn delete_multiagent_session(
    session_id: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    db.delete_multiagent_session(&session_id)
}
