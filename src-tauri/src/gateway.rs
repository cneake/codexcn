//! 本地反向代理网关
//! 
//! 架构：
//! - 监听 127.0.0.1:PORT，接收所有工具的 API 请求
//! - 转发到配置的 upstream origin，注入真实 provider API key
//! - 工具配置中不再存储真实 key，改为 placeholder → 真正的 key 只在网关内存中
//! 
//! 路径规则：
//! - upstream_base = provider base_url 去掉路径后缀，例: https://api.eake.cn/v1 → https://api.eake.cn
//! - upstream_path_prefix = provider base_url 的路径部分，例: /v1
//! - tool base_url = http://127.0.0.1:PORT/upstream_path_prefix
//! - gateway 接收 /upstream_path_prefix/...，转发到 upstream_origin/upstream_path_prefix/...

use std::sync::Arc;
use parking_lot::RwLock;
use axum::{
    Router,
    body::Body,
    extract::Request,
    response::Response,
    routing::any,
};
use http_body_util::BodyExt;
use bytes::Bytes;

use crate::api_logger::log_api_call;

/// 从 base_url 提取 origin（scheme://host[:port]），去掉路径后缀
fn extract_origin(base_url: &str) -> String {
    let base = base_url.split('?').next().unwrap_or(base_url);
    if let Some(idx) = base.find("://") {
        let rest = &base[idx + 3..];
        if let Some(slash) = rest.find('/') {
            return format!("{}{}", &base[..idx + 3], &rest[..slash]);
        } else {
            return base.to_string();
        }
    }
    base.to_string()
}

/// 从 base_url 提取路径前缀（第一个 / 之后的内容）
fn extract_path_prefix(base_url: &str) -> String {
    let base = base_url.split('?').next().unwrap_or(base_url);
    if let Some(idx) = base.find("://") {
        let rest = &base[idx + 3..];
        if let Some(slash) = rest.find('/') {
            let p = &rest[slash..];
            if p.ends_with('/') { p[..p.len() - 1].to_string() } else { p.to_string() }
        } else {
            String::new()
        }
    } else {
        String::new()
    }
}

/// 解析 upstream base_url → (origin, path_prefix)
pub fn parse_upstream(base_url: &str) -> (String, String) {
    (extract_origin(base_url), extract_path_prefix(base_url))
}

// ===== Gateway State =====

pub struct GatewayState {
    pub client: reqwest::Client,
    pub upstream_origin: RwLock<String>,
    pub upstream_path_prefix: RwLock<String>,
    pub api_key: RwLock<String>,
    pub port: RwLock<u16>,
    pub running: RwLock<bool>,
    /// JoinHandle of the running server task (for abort)
    pub handle: RwLock<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub app_data_dir: RwLock<String>,
}

impl GatewayState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            client: reqwest::Client::builder()
                .use_native_tls()
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            upstream_origin: RwLock::new(String::new()),
            upstream_path_prefix: RwLock::new(String::new()),
            api_key: RwLock::new(String::new()),
            port: RwLock::new(7899),
            running: RwLock::new(false),
            handle: RwLock::new(None),
            app_data_dir: RwLock::new(String::new()),
        })
    }
}

// ===== Proxy Handler =====

async fn proxy_handler(
    state: axum::extract::State<Arc<GatewayState>>,
    req: Request,
) -> Response {
    let state = state.clone();

    let method_str = req.method().clone();
    let start = std::time::Instant::now();
    let upstream_url = {
        let origin = state.upstream_origin.read().clone();
        let prefix = state.upstream_path_prefix.read().clone();
        // 防御：如果 path 看起来像完整 URL（工具配置错误时），提取其中 path 部分
        let raw_path = req.uri().path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or(req.uri().path());
        eprintln!("[gateway DEBUG] raw_path={}", raw_path);
        let path = if raw_path.starts_with("http://") || raw_path.starts_with("https://") {
            // 提取 //host:port 之后的部分
            if let Some(slash_slash) = raw_path.find("://") {
                let after = &raw_path[slash_slash + 3..];
                if let Some(next_slash) = after.find('/') {
                    &after[next_slash..]
                } else {
                    "/"
                }
            } else {
                raw_path
            }
        } else {
            raw_path
        };

        // 确保 path 以 upstream_path_prefix 开头
        let final_path = if prefix.is_empty() || path.starts_with(&prefix) {
            path.to_string()
        } else {
            let sep = if path.starts_with('/') { "" } else { "/" };
            format!("{}{}{}", prefix, sep, path)
        };

        format!("{}{}", origin, final_path)
    };

    let api_key = state.api_key.read().clone();

    // 复制 headers（除 host 和 authorization）
    let mut headers = reqwest::header::HeaderMap::new();
    for (k, v) in req.headers() {
        let kn = k.as_str();
        if kn.eq_ignore_ascii_case("host") || kn.eq_ignore_ascii_case("authorization") {
            continue;
        }
        if let Ok(val_str) = v.to_str() {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::try_from(kn),
                reqwest::header::HeaderValue::from_str(val_str),
            ) {
                headers.insert(name, val);
            }
        }
    }

    // 注入真实 api key
    if let (Ok(name), Ok(val)) = (
        reqwest::header::HeaderName::try_from("authorization"),
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key)),
    ) {
        headers.insert(name, val);
    }

    // 读取 body
    let body_bytes: Bytes = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => {
            return Response::builder()
                .status(400)
                .body(Body::from("failed to read body"))
                .unwrap();
        }
    };

    // 构建并发送 reqwest 请求
    let method = reqwest::Method::from_bytes(method_str.as_str().as_bytes())
        .unwrap_or(reqwest::Method::POST);

    let resp = match state.client
        .request(method, &upstream_url)
        .headers(headers)
        .body(body_bytes.to_vec())
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[gateway] upstream error: {}", e);
            return Response::builder()
                .status(502)
                .body(Body::from(format!("gateway error: {}", e)))
                .unwrap();
        }
    };

    let elapsed = start.elapsed().as_millis() as u64;
    let status = resp.status().as_u16();

    // 构建响应
    let mut builder = Response::builder().status(resp.status());
    for (k, v) in resp.headers() {
        builder = builder.header(k, v);
    }
    let resp_body = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => Bytes::new(),
    };
    let resp_len = resp_body.len();

    // 记录日志
    let app_data = state.app_data_dir.read().clone();
    if !app_data.is_empty() {
        log_api_call(
            &app_data,
            "local-gateway",
            "proxy",
            0,
            status,
            resp_len,
            elapsed,
            status < 400,
            None,
        );
    }

    builder.body(Body::from(resp_body)).unwrap_or_else(|_| Response::new(Body::empty()))
}

// ===== Background Server =====

/// 启动 HTTP 服务器（spawn 后立即返回 JoinHandle，不阻塞）
pub fn run_server(state: Arc<GatewayState>) -> tauri::async_runtime::JoinHandle<()> {
    let port = *state.port.read();
    let addr = format!("127.0.0.1:{}", port);

    tauri::async_runtime::spawn(async move {
        eprintln!("[gateway] listening on {}", addr);

        let app = Router::new()
            .fallback(any(proxy_handler))
            .with_state(state.clone());

        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[gateway] bind error on {}: {}", addr, e);
                *state.running.write() = false;
                return;
            }
        };

        eprintln!("[gateway] started, proxying to upstream");
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[gateway] serve error: {}", e);
        }
        *state.running.write() = false;
        eprintln!("[gateway] stopped");
    })
}

// ===== Tauri Commands =====

#[tauri::command]
pub async fn start_local_gateway(
    state: tauri::State<'_, Arc<GatewayState>>,
    upstream_base_url: String,
    api_key: String,
    port: u16,
) -> Result<String, String> {
    if *state.running.read() {
        return Ok("already running".to_string());
    }

    let (origin, path_prefix) = parse_upstream(&upstream_base_url);
    eprintln!("[gateway] upstream_origin={}, path_prefix={}", origin, path_prefix);

    *state.upstream_origin.write() = origin;
    *state.upstream_path_prefix.write() = path_prefix;
    *state.api_key.write() = api_key;
    *state.port.write() = port;
    *state.running.write() = true;

    let state_arc = (*state).clone();
    let handle = run_server(state_arc);
    *state.handle.write() = Some(handle);

    Ok(format!("gateway started on 127.0.0.1:{}", port))
}

#[tauri::command]
pub async fn stop_local_gateway(
    state: tauri::State<'_, Arc<GatewayState>>,
) -> Result<(), String> {
    if let Some(h) = state.handle.write().take() {
        h.abort();
    }
    *state.running.write() = false;
    Ok(())
}

#[tauri::command]
pub fn local_gateway_status(
    state: tauri::State<'_, Arc<GatewayState>>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": *state.running.read(),
        "port": *state.port.read(),
        "upstream_origin": state.upstream_origin.read().clone(),
        "upstream_path_prefix": state.upstream_path_prefix.read().clone(),
    }))
}

/// 获取本地网关的 base URL（供 config_writer 使用）
#[tauri::command]
pub fn get_gateway_local_url(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

/// 计算 provider base_url 对应的 gateway URL
/// upstream_base_url: https://api.eake.cn/v1, gateway_port: 7899
/// 返回 (tool_base_url, upstream_origin)
#[tauri::command]
pub fn build_gateway_url(upstream_base_url: String, port: u16) -> (String, String) {
    let (origin, path_prefix) = parse_upstream(&upstream_base_url);
    let local_url = format!("http://127.0.0.1:{}", port);
    let tool_base_url = if path_prefix.is_empty() {
        local_url.clone()
    } else {
        let sep = if path_prefix.starts_with('/') { "" } else { "/" };
        format!("{}{}{}", local_url, sep, path_prefix)
    };
    (tool_base_url, origin)
}
