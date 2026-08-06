use log::info;
use serde::{Deserialize, Serialize};

const ANNOUNCEMENT_API_URL: &str =
    "https://agent.eake.cn/wp-json/ylan/v1/announcements/current";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Announcement {
    #[serde(default)]
    pub enabled: bool,
    #[serde(rename = "id", default)]
    pub id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub link: String,
    #[serde(rename = "external_link", default)]
    pub external_link: String,
    #[serde(default = "default_level")]
    pub level: String,
    #[serde(default)]
    pub category: String,
    #[serde(rename = "start_date", default)]
    pub start_date: String,
    #[serde(rename = "end_date", default)]
    pub end_date: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_level() -> String {
    "info".to_string()
}

/// Fetch current active announcement from WordPress CPT
#[tauri::command]
pub fn get_announcement() -> Result<Announcement, String> {
    info!("[announcement] Fetching from {}", ANNOUNCEMENT_API_URL);

    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            info!("[announcement] Failed to build client: {}", e);
            return Ok(Announcement::default());
        }
    };

    let resp = match client
        .get(ANNOUNCEMENT_API_URL)
        .header("User-Agent", "CodexHub/1.0")
        .send()
    {
        Ok(r) => r,
        Err(e) => {
            info!("[announcement] Request failed: {}", e);
            return Ok(Announcement::default());
        }
    };

    if !resp.status().is_success() {
        info!("[announcement] Bad status: {}", resp.status());
        return Ok(Announcement::default());
    }

    match resp.json::<Announcement>() {
        Ok(a) => {
            info!(
                "[announcement] Fetched: id={}, enabled={}, title='{}', content_len={}",
                a.id,
                a.enabled,
                a.title,
                a.content.len()
            );
            Ok(a)
        }
        Err(e) => {
            info!("[announcement] Parse error: {}", e);
            Ok(Announcement::default())
        }
    }
}
