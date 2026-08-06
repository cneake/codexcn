// wechat.rs - WeChat iLink protocol (QR login + messaging)
// Plan B: CodexHub CN desktop app connects directly to WeChat

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

// ====== Types ======

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeixinAccount {
    pub account_id: String,
    pub bot_token: String,
    pub base_url: String,
    pub user_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QrStatus {
    Wait,
    Scaned,
    Confirmed,
    Expired,
    NeedVerifycode,
    VerifyCodeBlocked,
    ScanedButRedirect,
    BindedRedirect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrStartResult {
    pub success: bool,
    pub qrcode_url: Option<String>,
    pub session_key: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrWaitResult {
    pub connected: bool,
    pub bot_token: Option<String>,
    pub account_id: Option<String>,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundMessage {
    pub from_user_id: String,
    pub text: String,
    pub message_id: String,
    pub context_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageResult {
    pub success: bool,
    pub message: String,
}

// ====== API Constants ======

const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const BOT_TYPE: &str = "3";
const QR_LONG_POLL_TIMEOUT_MS: u64 = 35_000;
const LONG_POLL_TIMEOUT_MS: u64 = 35_000;

// ====== Active Login Session ======

struct ActiveLogin {
    qrcode: String,
    qrcode_url: String,
    started_at: std::time::Instant,
    status: Option<QrStatus>,
    current_api_base_url: String,
    pending_verify_code: Option<String>,
}

struct WeixinState {
    pub active_logins: HashMap<String, ActiveLogin>,
    pub connected_accounts: HashMap<String, WeixinAccount>,
    pub update_buf: HashMap<String, String>,
}

pub fn global_state() -> &'static Mutex<WeixinState> {
    use std::sync::LazyLock;
    static STATE: LazyLock<Mutex<WeixinState>> = LazyLock::new(|| {
        Mutex::new(WeixinState {
            active_logins: HashMap::new(),
            connected_accounts: HashMap::new(),
            update_buf: HashMap::new(),
        })
    });
    &STATE
}

// ====== Helpers ======

fn random_uin() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let val = (now.as_nanos() % 1_000_000_000) as u32;
    let s = val.to_string();
    base64_encode(&s)
}

fn base64_encode(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

fn build_common_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("Content-Type", "application/json".parse().unwrap());
    h.insert("iLink-App-Id", "wx".parse().unwrap());
    h.insert("iLink-App-ClientVersion", "0".parse().unwrap());
    h.insert("X-WECHAT-UIN", random_uin().parse().unwrap());
    h
}

fn build_auth_headers(token: &str) -> reqwest::header::HeaderMap {
    let mut h = build_common_headers();
    h.insert("AuthorizationType", "ilink_bot_token".parse().unwrap());
    h.insert("Authorization", format!("Bearer {}", token).parse().unwrap());
    h
}

// ====== QR Login ======

pub async fn start_qr_login(session_key: String) -> Result<QrStartResult, String> {
    let session_key_clone = session_key.clone();
    let result = tokio::task::spawn_blocking(move || {
        _start_qr_login_inner(session_key_clone)
    }).await.map_err(|e| format!("Task join error: {}", e))?;
    result
}

fn _start_qr_login_inner(session_key: String) -> Result<QrStartResult, String> {
    let url = format!("{}/ilink/bot/get_bot_qrcode?bot_type={}", ILINK_BASE_URL, BOT_TYPE);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({ "local_token_list": [] });
    let resp = match client.post(&url)
        .headers(build_common_headers())
        .json(&body)
        .send() {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("QR API network error: {} | url={}", e, url);
            eprintln!("{}", msg);
            let _ = std::fs::write("C:\\temp\\qr_error.log", &msg);
            return Err(format!("网络错误: {}", e));
        }
    };

    let text = resp.text().map_err(|e| e.to_string())?;
    eprintln!("[WeChat] QR API raw response: {}", &text);
    let data: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse QR response: {}", e))?;

    let qrcode = data.get("qrcode").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let qrcode_url = data.get("qrcode_img_content").and_then(|v| v.as_str()).unwrap_or("").to_string();

    eprintln!("[WeChat] qrcode field len={}, value={}", qrcode.len(), if qrcode.len() > 80 { &qrcode[..80] } else { &qrcode });
    eprintln!("[WeChat] qrcode_img_content len={}, value={}", qrcode_url.len(), if qrcode_url.len() > 80 { &qrcode_url[..80] } else { &qrcode_url });

    if qrcode.is_empty() {
        return Ok(QrStartResult {
            success: false,
            qrcode_url: None,
            session_key: session_key.clone(),
            message: format!("获取二维码失败：{}", text),
        });
    }

    // Generate QR code SVG from qrcode string (the URL from API is HTML, not an image)
    // Try both: the full URL (qrcode_img_content) and the short token (qrcode)
    let qr_data = if !qrcode_url.is_empty() { &qrcode_url } else { &qrcode };
    eprintln!("[WeChat] Generating QR code from: {} (len={})", qr_data, qr_data.len());
    let qr_base64 = match qrcode::QrCode::new(qr_data) {
        Ok(code) => {
            let width = code.width();
            let pixels = code.to_colors();
            let module_size = 10u32;
            let size = width as u32 * module_size;
            let mut svg = String::with_capacity(4096);
            svg.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\" ");
            svg.push_str(&format!("viewBox=\"0 0 {} {}\" width=\"{}\" height=\"{}\">", size, size, size, size));
            svg.push_str("<rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>");
            for (y, row) in pixels.chunks(width).enumerate() {
                for (x, &color) in row.iter().enumerate() {
                    use qrcode::Color;
                    if color == Color::Dark {
                        svg.push_str(&format!(
                            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"#000\"/>",
                            x as u32 * module_size, y as u32 * module_size, module_size, module_size
                        ));
                    }
                }
            }
            svg.push_str("</svg>");
            let b64 = base64::encode(svg.as_bytes());
            Some(format!("data:image/svg+xml;base64,{}", b64))
        },
        Err(e) => {
            let msg = format!("[WeChat] QR gen failed: {} | input_len={} | input_preview={}", e, qr_data.len(), &qr_data[..qr_data.len().min(80)]);
            eprintln!("{}", msg);
            // Write error to file for debugging
            let _ = std::fs::write("C:\\temp\\qr_error.log", &msg);
            None
        }
    };

    let qr_url_result = qr_base64.clone();

    {
        let mut state = global_state().lock().map_err(|e| e.to_string())?;
        state.active_logins.insert(session_key.clone(), ActiveLogin {
            qrcode: qrcode.clone(),
            qrcode_url: qr_base64.clone().unwrap_or(qrcode_url.clone()),
            started_at: std::time::Instant::now(),
            status: None,
            current_api_base_url: ILINK_BASE_URL.to_string(),
            pending_verify_code: None,
        });
    }

    // Only return success if we have a valid data: URI QR code
    match &qr_url_result {
        Some(url) if url.starts_with("data:") => {
            Ok(QrStartResult {
                success: true,
                qrcode_url: Some(url.clone()),
                session_key,
                message: "二维码已就绪，请使用微信扫码".to_string(),
            })
        },
        _ => {
            eprintln!("[WeChat] QR code generation failed, raw qrcode: {}", &qrcode);
            Ok(QrStartResult {
                success: false,
                qrcode_url: None,
                session_key,
                message: "二维码生成失败，请重试".to_string(),
            })
        }
    }
}

pub fn poll_qr_status(session_key: String) -> Result<QrWaitResult, String> {
    let (qrcode, current_base_url, pending_code) = {
        let state = global_state().lock().map_err(|e| e.to_string())?;
        let login = state.active_logins.get(&session_key)
            .ok_or("No active login session")?;
        if login.started_at.elapsed() > Duration::from_secs(300) {
            drop(state);
            let mut state2 = global_state().lock().map_err(|e| e.to_string())?;
            state2.active_logins.remove(&session_key);
            return Ok(QrWaitResult {
                connected: false,
                bot_token: None,
                account_id: None,
                base_url: None,
                user_id: None,
                message: "二维码已过期".into(),
            });
        }
        (login.qrcode.clone(), login.current_api_base_url.clone(), login.pending_verify_code.clone())
    };

    let mut endpoint = format!(
        "/ilink/bot/get_qrcode_status?qrcode={}",
        urlencoding::encode(&qrcode)
    );
    if let Some(code) = &pending_code {
        endpoint.push_str(&format!("&verify_code={}", urlencoding::encode(code)));
    }

    let url = format!("{}{}", current_base_url, endpoint);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(QR_LONG_POLL_TIMEOUT_MS))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url)
        .headers(build_common_headers())
        .send();

    let resp = match resp {
        Ok(r) => r,
        Err(_e) => {
            return Ok(QrWaitResult {
                connected: false,
                bot_token: None,
                account_id: None,
                base_url: None,
                user_id: None,
                message: "等待扫码...".into(),
            });
        }
    };

    let text = resp.text().unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();

    let status_str = data.get("status").and_then(|v| v.as_str()).unwrap_or("wait");
    let status = match status_str {
        "wait" => QrStatus::Wait,
        "scaned" => QrStatus::Scaned,
        "confirmed" => QrStatus::Confirmed,
        "expired" => QrStatus::Expired,
        "需要验证码" => QrStatus::NeedVerifycode,
        "verify_code_blocked" => QrStatus::VerifyCodeBlocked,
        "scaned_but_redirect" => QrStatus::ScanedButRedirect,
        "binded_redirect" => QrStatus::BindedRedirect,
        _ => QrStatus::Wait,
    };

    if matches!(status, QrStatus::ScanedButRedirect) {
        if let Some(host) = data.get("redirect_host").and_then(|v| v.as_str()) {
            let mut state = global_state().lock().map_err(|e| e.to_string())?;
            if let Some(login) = state.active_logins.get_mut(&session_key) {
                login.current_api_base_url = format!("https://{}", host);
            }
        }
    }

    {
        let mut state = global_state().lock().map_err(|e| e.to_string())?;
        if let Some(login) = state.active_logins.get_mut(&session_key) {
            login.status = Some(status.clone());
        }
    }

    match status {
        QrStatus::Confirmed => {
            let bot_token = data.get("bot_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ilink_bot_id = data.get("ilink_bot_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let base_url = data.get("baseurl").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ilink_user_id = data.get("ilink_user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();

            if ilink_bot_id.is_empty() {
                return Ok(QrWaitResult {
                    connected: false,
                    bot_token: None,
                    account_id: None,
                    base_url: None,
                    user_id: None,
                    message: "登录失败：服务器未返回机器人ID".into(),
                });
            }

            {
                let mut state = global_state().lock().map_err(|e| e.to_string())?;
                state.active_logins.remove(&session_key);
                state.connected_accounts.insert(ilink_bot_id.clone(), WeixinAccount {
                    account_id: ilink_bot_id.clone(),
                    bot_token: bot_token.clone(),
                    base_url: base_url.clone(),
                    user_id: ilink_user_id.clone(),
                    created_at: crate::unix_ts(),
                });
                state.update_buf.insert(ilink_bot_id.clone(), String::new());
            }

            Ok(QrWaitResult {
                connected: true,
                bot_token: Some(bot_token),
                account_id: Some(ilink_bot_id),
                base_url: Some(base_url),
                user_id: Some(ilink_user_id),
                message: "微信已连接".into(),
            })
        }
        QrStatus::Expired => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "二维码已过期，请重试".into(),
        }),
        QrStatus::NeedVerifycode => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "需要验证码".into(),
        }),
        QrStatus::VerifyCodeBlocked => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "验证码错误次数过多，请稍后再试".into(),
        }),
        QrStatus::Scaned => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "已扫描，正在验证...".into(),
        }),
        QrStatus::ScanedButRedirect => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "正在跳转...".into(),
        }),
        QrStatus::BindedRedirect => {
            let mut state = global_state().lock().map_err(|e| e.to_string())?;
            state.active_logins.remove(&session_key);
            Ok(QrWaitResult {
                connected: false, bot_token: None, account_id: None,
                base_url: None, user_id: None,
                message: "已绑定，无需重复绑定".into(),
            })
        }
        QrStatus::Wait => Ok(QrWaitResult {
            connected: false, bot_token: None, account_id: None,
            base_url: None, user_id: None,
            message: "等待扫码...".into(),
        }),
    }
}

pub fn submit_verify_code(session_key: String, code: String) -> Result<(), String> {
    let mut state = global_state().lock().map_err(|e| e.to_string())?;
    let login = state.active_logins.get_mut(&session_key)
        .ok_or("No active login session")?;
    login.pending_verify_code = Some(code);
    Ok(())
}

pub fn cancel_qr_login(session_key: String) {
    let mut state = global_state().lock().ok();
    if let Some(s) = &mut state {
        s.active_logins.remove(&session_key);
    }
}

// ====== Messaging ======

pub fn get_connected_accounts() -> Vec<WeixinAccount> {
    let state = global_state().lock().ok();
    match state {
        Some(s) => s.connected_accounts.values().cloned().collect(),
        None => vec![],
    }
}

pub fn load_weixin_account(db: &crate::db::Database, account_id: &str) -> Result<Option<WeixinAccount>, String> {
    db.get_weixin_account(account_id)
}

pub fn save_weixin_account(db: &crate::db::Database, account: &WeixinAccount) -> Result<(), String> {
    db.save_weixin_account(account)
}

pub fn restore_accounts(db: &crate::db::Database) -> Result<Vec<WeixinAccount>, String> {
    let accounts = db.get_all_weixin_accounts()?;
    let mut state = global_state().lock().map_err(|e| e.to_string())?;
    for acc in &accounts {
        state.connected_accounts.insert(acc.account_id.clone(), acc.clone());
        state.update_buf.insert(acc.account_id.clone(), String::new());
    }
    Ok(accounts)
}

pub fn get_updates(account_id: String) -> Result<Vec<InboundMessage>, String> {
    let (base_url, token, buf) = {
        let state = global_state().lock().map_err(|e| e.to_string())?;
        let acc = state.connected_accounts.get(&account_id)
            .ok_or("WeChat account not connected")?;
        let current_buf = state.update_buf.get(&account_id).cloned().unwrap_or_default();
        (acc.base_url.clone(), acc.bot_token.clone(), current_buf)
    };

    let url = format!("{}/ilink/bot/getupdates", base_url);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(LONG_POLL_TIMEOUT_MS))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "get_updates_buf": buf,
        "base_info": {
            "channel_version": "0.0.2",
            "bot_agent": "CodexHub CN/0.0.2"
        }
    });

    let resp = match client.post(&url)
        .headers(build_auth_headers(&token))
        .json(&body)
        .send()
    {
        Ok(r) => r,
        Err(_e) => return Ok(vec![]),
    };

    let text = resp.text().unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();

    if let Some(new_buf) = data.get("get_updates_buf").and_then(|v| v.as_str()) {
        let mut state = global_state().lock().map_err(|e| e.to_string())?;
        state.update_buf.insert(account_id.clone(), new_buf.to_string());
    }

    let msgs = data.get("msgs").and_then(|v| v.as_array());
    let mut result = vec![];
    if let Some(msgs_arr) = msgs {
        for msg_val in msgs_arr {
            let from = msg_val.get("from_user_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let items = msg_val.get("item_list").and_then(|v| v.as_array());
            let ctx_token = msg_val.get("context_token").and_then(|v| v.as_str()).map(|s| s.to_string());
            let msg_id = msg_val.get("message_id").and_then(|v| v.as_i64())
                .map(|i| i.to_string())
                .unwrap_or_else(|| crate::uuid_simple());

            if let Some(items_arr) = items {
                for item in items_arr {
                    let item_type = item.get("type").and_then(|v| v.as_i64()).unwrap_or(0);
                    if item_type == 1 {
                        let text = item.get("text_item")
                            .and_then(|t| t.get("text"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if !text.is_empty() {
                            result.push(InboundMessage {
                                from_user_id: from.clone(),
                                text,
                                message_id: msg_id.clone(),
                                context_token: ctx_token.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

pub fn send_wechat_message(account_id: String, to_user_id: String, text: String) -> Result<SendMessageResult, String> {
    let (base_url, token) = {
        let state = global_state().lock().map_err(|e| e.to_string())?;
        let acc = state.connected_accounts.get(&account_id)
            .ok_or("WeChat account not connected")?;
        (acc.base_url.clone(), acc.bot_token.clone())
    };

    let url = format!("{}/ilink/bot/sendmessage", base_url);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to_user_id,
            "client_id": crate::uuid_simple(),
            "message_type": 2,
            "message_state": 2,
            "item_list": [{
                "type": 1,
                "text_item": { "text": text }
            }]
        },
        "base_info": {
            "channel_version": "0.0.2",
            "bot_agent": "CodexHub CN/0.0.2"
        }
    });

    let resp = match client.post(&url)
        .headers(build_auth_headers(&token))
        .json(&body)
        .send()
    {
        Ok(r) => r,
        Err(e) => return Ok(SendMessageResult { success: false, message: format!("发送失败： {}", e) }),
    };

    if resp.status().is_success() {
        Ok(SendMessageResult { success: true, message: "发送成功".into() })
    } else {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        Ok(SendMessageResult { success: false, message: format!("发送失败 {}: {}", status, text) })
    }
}

pub fn notify_start(account_id: String) -> Result<(), String> {
    let (base_url, token) = {
        let state = global_state().lock().map_err(|e| e.to_string())?;
        let acc = state.connected_accounts.get(&account_id)
            .ok_or("WeChat account not connected")?;
        (acc.base_url.clone(), acc.bot_token.clone())
    };

    let url = format!("{}/ilink/bot/msg/notifystart", base_url);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "base_info": {
            "channel_version": "0.0.2",
            "bot_agent": "CodexHub CN/0.0.2"
        }
    });

    let _ = client.post(&url).headers(build_auth_headers(&token)).json(&body).send();
    Ok(())
}

pub fn notify_stop(account_id: String) -> Result<(), String> {
    let (base_url, token) = {
        let state = global_state().lock().map_err(|e| e.to_string())?;
        let acc = state.connected_accounts.get(&account_id)
            .ok_or("WeChat account not connected")?;
        (acc.base_url.clone(), acc.bot_token.clone())
    };

    let url = format!("{}/ilink/bot/msg/notifystop", base_url);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "base_info": {
            "channel_version": "0.0.2",
            "bot_agent": "CodexHub CN/0.0.2"
        }
    });

    let _ = client.post(&url).headers(build_auth_headers(&token)).json(&body).send();
    Ok(())
}

pub fn disconnect_account(account_id: &str) {
    let mut state = global_state().lock().ok();
    if let Some(s) = &mut state {
        s.connected_accounts.remove(account_id);
        s.update_buf.remove(account_id);
    }
}
