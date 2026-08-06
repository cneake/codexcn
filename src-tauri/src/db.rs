use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

fn debug_log(msg: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(std::env::temp_dir().join("codexhub_debug.log"))
    {
        let _ = writeln!(f, "{}", msg);
    }
}

// ===== 数据模型 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub api_key_signup_url: Option<String>,
    pub icon: String,
    pub category: String, // "domestic" | "overseas" | "relay" | "official"
    pub enabled: bool,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    pub input_price: Option<f64>,  // 输入单价（¥/万 tokens）
    pub output_price: Option<f64>, // 输出单价（¥/万 tokens）
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliTool {
    pub id: String,
    pub name: String,
    pub config_type: String, // "json" | "toml" | "env"
    pub config_path: String, // 配置文件路径模板
    pub active_provider_id: Option<String>,
    pub enabled: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tool_provider_map: std::collections::HashMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 用量告警配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageAlert {
    pub tool_id: String,
    pub threshold_percent: i32,
    pub monthly_limit_tokens: i64,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ===== 聊天数据模型 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub tool_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    pub preview: String,  // 第一条用户消息预览（60字以内）
    pub user_id: Option<i64>,  // NULL=未登录(临时), 有值=已登录(持久)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub user_id: Option<i64>,
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub id: String,
    pub tool_id: String,
    pub name: String,
    pub cron_expr: String,
    pub message: String,
    pub enabled: bool,
    pub created_at: i64,
    pub last_run: Option<i64>,
    pub next_run: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentSession {
    pub id: String,
    pub task: String,
    pub main_tool_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentResult {
    pub id: String,
    pub session_id: String,
    pub tool_id: String,
    pub agent_name: String,
    pub content: String,
    pub error: Option<String>,
    pub is_summary: bool,
    pub created_at: i64,
}

impl Database {
    pub fn init(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;

        let db_path = app_data_dir.join("codexhub.db");
        debug_log(&format!("[Database::init] db_path={:?}", db_path));
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        // V1: 核心表
        db.exec_migration(1, &[
            "CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT, icon TEXT DEFAULT '', category TEXT DEFAULT 'domestic', enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS cli_tools (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_type TEXT NOT NULL, config_path TEXT NOT NULL, active_provider_id TEXT, enabled INTEGER DEFAULT 1, description TEXT DEFAULT '', FOREIGN KEY (active_provider_id) REFERENCES providers(id))",
            "CREATE TABLE IF NOT EXISTS tool_provider_configs (tool_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_mapping TEXT DEFAULT '{}', active INTEGER DEFAULT 0, PRIMARY KEY (tool_id, provider_id), FOREIGN KEY (tool_id) REFERENCES cli_tools(id), FOREIGN KEY (provider_id) REFERENCES providers(id))",
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, updated_at TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_providers_category ON providers(category)",
            "CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled)",
            "CREATE INDEX IF NOT EXISTS idx_tpc_active ON tool_provider_configs(active)",
        ])?;

        // V2: 检测缓存
        db.exec_migration(2, &[
            "CREATE TABLE IF NOT EXISTS detection_cache (tool_id TEXT PRIMARY KEY, installed INTEGER DEFAULT 0, detected_at TEXT DEFAULT (datetime('now')))",
        ])?;

        // V3: MCP 服务器
        db.exec_migration(3, &[
            "CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT NOT NULL DEFAULT 'stdio', command TEXT, args TEXT, url TEXT, env TEXT, headers TEXT, enabled INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
            "CREATE TABLE IF NOT EXISTS mcp_server_tools (mcp_server_id TEXT NOT NULL, tool_id TEXT NOT NULL, enabled INTEGER DEFAULT 1, PRIMARY KEY (mcp_server_id, tool_id), FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE, FOREIGN KEY (tool_id) REFERENCES cli_tools(id))",
            "CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled)",
        ])?;

        // V4: 配置文件模板
        db.exec_migration(4, &[
            "CREATE TABLE IF NOT EXISTS config_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', tool_provider_map TEXT NOT NULL DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
        ])?;

        // V5: 用量告警设置
        db.exec_migration(5, &[
            "CREATE TABLE IF NOT EXISTS usage_alerts (tool_id TEXT PRIMARY KEY, threshold_percent INTEGER DEFAULT 80, monthly_limit_tokens INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
        ])?;

        // V6: Provider 加 api_key_signup_url 字段
        db.exec_migration(6, &[
            "ALTER TABLE providers ADD COLUMN api_key_signup_url TEXT DEFAULT NULL",
        ])?;

        // V7: mcp_servers 加 pid/running 字段
        db.exec_migration(7, &[
            "ALTER TABLE mcp_servers ADD COLUMN pid INTEGER DEFAULT NULL",
            "ALTER TABLE mcp_servers ADD COLUMN running INTEGER DEFAULT 0",
        ])?;

        // V8: 聊天会话和消息表
        db.exec_migration(8, &[
            "CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '新对话', created_at INTEGER DEFAULT (strftime('%s','now')), updated_at INTEGER DEFAULT (strftime('%s','now')))",
            "CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER DEFAULT (strftime('%s','now')), FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE)",
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_tool ON chat_sessions(tool_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)",
        ])?;


        // V11: 新增 eaKe API Provider（统一中转）
        db.exec_migration(11, &[
            "INSERT OR IGNORE INTO providers (id, name, base_url, icon, category, sort_order, api_key_signup_url) VALUES ('eake-api', 'eaKe API (统一中转)', 'https://api.eake.cn/v1', '🔑', 'relay', 0, 'https://api.eake.cn/')",
        ])?;

        // V13: Token 用量记录表
        db.exec_migration(13, &[
            "CREATE TABLE IF NOT EXISTS token_usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id TEXT NOT NULL, session_id TEXT, model TEXT, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s','now')))",
            "CREATE INDEX IF NOT EXISTS idx_token_usage_tool ON token_usage_log(tool_id)",
            "CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage_log(created_at)",
        ])?;

        // V14: 新增火山引擎 Provider
        db.exec_migration(14, &[
            "INSERT OR IGNORE INTO providers (id, name, base_url, icon, category, sort_order, api_key_signup_url) VALUES ('volcengine', '火山引擎', 'https://ark.cn-beijing.volces.com/api/v3', '🔥', 'domestic', 1, 'https://console.volcengine.com/')",
        ])?;

        // V15: Provider 加单价字段（用于费用计算）
        db.exec_migration(15, &[
            "ALTER TABLE providers ADD COLUMN input_price REAL DEFAULT NULL",
            "ALTER TABLE providers ADD COLUMN output_price REAL DEFAULT NULL",
        ])?;

        // V16: 技能调用日志表
        db.exec_migration(16, &[
            "CREATE TABLE IF NOT EXISTS skill_invoke_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id TEXT NOT NULL, skill_slug TEXT NOT NULL, skill_name TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')))",
            "CREATE INDEX IF NOT EXISTS idx_skill_invoke_created ON skill_invoke_log(created_at)",
        ])?;

        // V17: chat_sessions 补 preview 列 + 修复旧会话标题（"新对话" → 首条用户消息）
        db.exec_migration(17, &[
            "ALTER TABLE chat_sessions ADD COLUMN preview TEXT DEFAULT ''",
        ])?;
        // 一次性修复：所有标题仍为"新对话"的会话，取首条用户消息截断30字作为标题
        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "UPDATE chat_sessions SET title = COALESCE(
                    (SELECT substr(content, 1, 30) FROM chat_messages WHERE session_id = chat_sessions.id AND role = 'user' ORDER BY id ASC LIMIT 1),
                    '新对话'
                ) || CASE WHEN (SELECT COUNT(*) FROM chat_messages WHERE session_id = chat_sessions.id AND role = 'user') > 30 THEN '…' ELSE '' END
                WHERE title = '新对话'",
                [],
            );
            // 同时回填 preview 字段
            let _ = conn.execute(
                "UPDATE chat_sessions SET preview = COALESCE(
                    (SELECT substr(content, 1, 60) FROM chat_messages WHERE session_id = chat_sessions.id AND role = 'user' ORDER BY id ASC LIMIT 1),
                    ''
                )",
                [],
            );
        }

        // V18: 定时任务系统 (cron_jobs 表)
        db.exec_migration(18, &[
            "CREATE TABLE IF NOT EXISTS cron_jobs (
                id TEXT PRIMARY KEY,
                tool_id TEXT NOT NULL,
                name TEXT NOT NULL,
                cron_expr TEXT NOT NULL,
                message TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                last_run INTEGER,
                next_run INTEGER
            )",
            "CREATE INDEX IF NOT EXISTS idx_cron_jobs_tool ON cron_jobs(tool_id)",
        ])?;

        // V19: 多Agent协作历史表
        db.exec_migration(19, &[
            "CREATE TABLE IF NOT EXISTS multiagent_sessions (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                main_tool_id TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )",
            "CREATE TABLE IF NOT EXISTS multiagent_results (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                tool_id TEXT NOT NULL DEFAULT '',
                agent_name TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                error TEXT,
                is_summary INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            )",
            "CREATE INDEX IF NOT EXISTS idx_ma_results_session ON multiagent_results(session_id)",
        ])?;

        // V20: 会话关联用户ID（登录=持久化，未登录=本地临时）
        db.exec_migration(20, &[
            "ALTER TABLE chat_sessions ADD COLUMN user_id BIGINT",
            "ALTER TABLE chat_messages ADD COLUMN user_id BIGINT",
        ])?;

        // 种子数据：补全缺失的工具和 Provider
        db.seed_defaults()?;
        Ok(db)
    }

    /// 按 schema_version 增量迁移：只执行未记录的版本
    fn exec_migration(&self, version: i32, sqls: &[&str]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let applied: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM schema_version WHERE version = ?1",
                params![version],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if applied {
            return Ok(());
        }
        for sql in sqls {
            conn.execute(sql, [])
                .map(|_| ()).map_err(|e| format!("Migration v{} error: {}", version, e))?;
        }
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            params![version],
        )
        .map(|_| ()).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 种子数据：INSERT OR IGNORE 确保不覆盖已有数据
    fn seed_defaults(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        let tools = [
            ("claude-code", "Claude Code", "json", "AI 编程助手 - Anthropic"),
            ("claude-desktop", "Claude Desktop", "json", "Claude 桌面客户端"),
            ("codex", "Codex", "json", "AI 编程助手 - OpenAI"),
            ("gemini-cli", "Gemini CLI", "toml", "AI 编程助手 - Google"),
            ("opencode", "OpenCode", "json", "开源 AI 编程助手"),
            ("deepseek-cli", "DeepSeek CLI", "json", "AI 编程助手 - DeepSeek"),
            ("openclaw", "OpenClaw", "json", "开源 AI 编程助手"),
            ("hermes-agent", "Hermes Agent", "yaml", "自主 AI 编程助手"),
            ("grok-build", "Grok Build", "json", "AI 编程助手 - xAI"),
            ("qoder-cli", "Qoder CLI", "json", "AI 编程助手 - 阿里云"),
        ];
        for (id, name, config_type, desc) in tools {
            conn.execute(
                "INSERT OR IGNORE INTO cli_tools (id, name, config_type, config_path, enabled, description) VALUES (?1,?2,?3,'',1,?4)",
                params![id, name, config_type, desc],
            ).map(|_| ()).map_err(|e| e.to_string())?;
        }

        let providers = [
            ("eake-api", "eaKe API (统一中转)", "https://api.eake.cn/v1", "🔑", "relay", 0, "https://api.eake.cn/"),
            ("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "🟢", "domestic", 1, "https://platform.deepseek.com/"),
            ("zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "🔵", "domestic", 2, "https://open.bigmodel.cn/"),
            ("minimax", "MiniMax", "https://api.minimax.chat/v1", "🟡", "domestic", 3, "https://www.minimaxi.com/"),
            ("kimi", "Kimi (月之暗面)", "https://api.moonshot.cn/v1", "🌙", "domestic", 4, "https://platform.moonshot.cn/"),
            ("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", "⚡", "domestic", 6, "https://cloud.siliconflow.cn/"),
            ("qwen", "通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", "☁️", "domestic", 7, "https://dashscope.aliyun.com/"),
            ("wenxin", "文心一言", "https://qianfan.baidubce.com/v2", "💬", "domestic", 8, "https://console.bce.baidu.com/"),
            ("hunyuan", "混元(Tencent)", "https://api.hunyuan.cloud.tencent.com/v1", "🐉", "domestic", 9, "https://console.cloud.tencent.com/hunyuan/"),
            ("stepfun", "阶跃星辰", "https://api.stepfun.com/v1", "🪜", "domestic", 10, "https://stepfun.com/"),
            ("baidu", "百度千帆", "https://aip.baidubce.com/rpc/2.0/ai_custom/v1", "🐻", "domestic", 11, "https://console.bce.baidu.com/"),
            ("openai", "OpenAI", "https://api.openai.com/v1", "🤖", "official", 20, "https://platform.openai.com/"),
            ("anthropic", "Anthropic(Claude)", "https://api.anthropic.com/v1", "🧠", "official", 21, "https://console.anthropic.com/"),
            ("google", "Google(Gemini)", "https://generativelanguage.googleapis.com/v1beta", "✨", "official", 22, "https://aistudio.google.com/"),
            ("mistral", "Mistral AI", "https://api.mistral.ai/v1", "🌊", "overseas", 23, "https://console.mistral.ai/"),
            ("groq", "Groq", "https://api.groq.com/openai/v1", "⚡", "overseas", 24, "https://console.groq.com/"),
            ("cohere", "Cohere", "https://api.cohere.com/v1", "🔷", "overseas", 25, "https://dashboard.cohere.com/"),
            ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "🔀", "relay", 26, "https://openrouter.ai/"),
            ("ollama", "Ollama(本地)", "http://localhost:11434/v1", "🦙", "official", 27, ""),
            ("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "🟩", "overseas", 28, "https://build.nvidia.com/"),
        ];
        for (id, name, url, icon, cat, order, signup_url) in providers {
            conn.execute(
                "INSERT OR IGNORE INTO providers (id, name, base_url, icon, category, sort_order, api_key_signup_url) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id, name, url, icon, cat, order, if signup_url.is_empty() { None } else { Some(signup_url) }],
            ).map(|_| ()).map_err(|e| e.to_string())?;
        }

        // 种子数据：预设 MCP 服务器（11个常用模板）
        let mcp_presets = [
            ("filesystem", "文件系统访问", "npx", "[\"-y\", \"@modelcontextprotocol/server-filesystem\", \"%USERPROFILE%\"]", None),
            ("git", "Git 操作", "npx", "[\"-y\", \"@modelcontextprotocol/server-git\"]", None),
            ("sqlite", "SQLite 数据库", "npx", "[\"-y\", \"@modelcontextprotocol/server-sqlite\", \":memory:\"]", None),
            ("postgres", "PostgreSQL 数据库", "npx", "[\"-y\", \"@modelcontextprotocol/server-postgres\"]", Some("{\"DATABASE_URL\": \"postgresql://localhost:5432/test\"}")),
            ("brave-search", "Brave 搜索", "npx", "[\"-y\", \"@modelcontextprotocol/server-brave-search\"]", Some("{\"BRAVE_API_KEY\": \"\"}")),
            ("google-maps", "Google 地图", "npx", "[\"-y\", \"@modelcontextprotocol/server-google-maps\"]", Some("{\"GOOGLE_MAPS_API_KEY\": \"\"}")),
            ("everart", "EverArt 图像生成", "npx", "[\"-y\", \"everart\"]", Some("{\"EVERART_API_KEY\": \"\"}")),
            ("fetch", "网页抓取", "npx", "[\"-y\", \"@modelcontextprotocol/server-fetch\"]", None),
            ("memory", "内存/知识图谱", "npx", "[\"-y\", \"@modelcontextprotocol/server-memory\"]", None),
            ("puppeteer", "浏览器自动化", "npx", "[\"-y\", \"@modelcontextprotocol/server-puppeteer\"]", None),
            ("slack", "Slack 通知", "npx", "[\"-y\", \"@modelcontextprotocol/server-slack\"]", Some("{\"SLACK_BOT_TOKEN\": \"\", \"SLACK_TEAM_ID\": \"\"}")),
        ];
        for (id, name, command, args, env) in mcp_presets {
            conn.execute(
                "INSERT OR IGNORE INTO mcp_servers (id, name, transport, command, args, env, url, enabled) VALUES (?1, ?2, 'stdio', ?3, ?4, ?5, NULL, 1)",
                params![id, name, command, args, env],
            ).map(|_| ()).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    // ===== Provider CRUD =====

    pub fn get_providers(&self) -> Result<Vec<Provider>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, base_url, api_key, api_key_signup_url, icon, category, enabled, sort_order, created_at, updated_at, input_price, output_price FROM providers ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Provider {
                    id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?,
                    api_key: row.get(3)?, api_key_signup_url: row.get(4)?, icon: row.get(5)?, category: row.get(6)?,
                    enabled: row.get::<_, i32>(7)? == 1, sort_order: row.get(8)?,
                    created_at: row.get(9)?, updated_at: row.get(10)?,
                    input_price: row.get(11)?, output_price: row.get(12)?,
                })
            }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_provider(&self, id: &str) -> Result<Option<Provider>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, name, base_url, api_key, api_key_signup_url, icon, category, enabled, sort_order, created_at, updated_at, input_price, output_price FROM providers WHERE id = ?1",
            params![id],
            |row| Ok(Provider {
                id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?,
                api_key: row.get(3)?, api_key_signup_url: row.get(4)?, icon: row.get(5)?, category: row.get(6)?,
                enabled: row.get::<_, i32>(7)? == 1, sort_order: row.get(8)?,
                created_at: row.get(9)?, updated_at: row.get(10)?,
                input_price: row.get(11)?, output_price: row.get(12)?,
            }),
        ).optional().map_err(|e| e.to_string())
    }
    pub fn get_provider_by_id(&self, id: &str) -> Result<Provider, String> {
        self.get_provider(id)?.ok_or_else(|| format!("Provider '{}' not found", id))
    }


    pub fn add_provider(&self, id: String, name: String, base_url: String, icon: String, category: String) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO providers (id, name, base_url, icon, category) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, base_url, icon, category],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn set_provider_api_key(&self, provider_id: &str, api_key: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE providers SET api_key = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![api_key, provider_id],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn set_provider_model(&self, provider_id: &str, model_name: &str) -> Result<(), String> {
        debug_log(&format!("[set_provider_model] provider_id={}, model_name={}", provider_id, model_name));
        let conn = self.conn.lock().unwrap();
        // 为所有使用此 provider 的工具设置 model_mapping（保留原 active 状态）
        let model_mapping = serde_json::json!({"default": model_name}).to_string();
        debug_log(&format!("[set_provider_model] model_mapping={}", model_mapping));
        // 用 UPDATE 配合子查询，避免 INSERT OR REPLACE 覆盖 active 标志
        let result = conn.execute(
            "UPDATE tool_provider_configs 
             SET model_mapping = ?2 
             WHERE provider_id = ?1",
            params![provider_id, model_mapping],
        );
        debug_log(&format!("[set_provider_model] result={:?}", result));
        // 如果没有任何行被更新（该 provider 还没有任何 tool 配置），为所有工具插入新行
        if result.as_ref().map(|n| *n == 0).unwrap_or(false) {
            let insert_result = conn.execute(
                "INSERT OR IGNORE INTO tool_provider_configs (tool_id, provider_id, model_mapping, active) 
                 SELECT id, ?1, ?2, 0 FROM cli_tools",
                params![provider_id, model_mapping],
            );
            debug_log(&format!("[set_provider_model] insert_result={:?}", insert_result));
        }
        result.map(|_| ()).map_err(|e| e.to_string())
    }

    /// 设置 Provider 单价（用于费用计算）
    pub fn set_provider_pricing(&self, provider_id: &str, input_price: Option<f64>, output_price: Option<f64>) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE providers SET input_price = ?1, output_price = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![input_price, output_price, provider_id],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    /// 获取 provider 的默认模型名称（从 tool_provider_configs 表读取）
    pub fn get_provider_default_model(&self, provider_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT model_mapping FROM tool_provider_configs WHERE provider_id = ?1 LIMIT 1",
            params![provider_id],
            |row| row.get::<_, String>(0),
        ).ok()
        .and_then(|json| {
            serde_json::from_str::<serde_json::Value>(&json).ok()
                .and_then(|v| v.get("default")?.as_str().map(|s| s.to_string()))
        })
    }

    pub fn delete_provider(&self, provider_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM tool_provider_configs WHERE provider_id = ?1", params![provider_id]).map(|_| ()).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM providers WHERE id = ?1", params![provider_id]).map(|_| ()).map_err(|e| e.to_string())
    }

    // ===== CLI Tools =====

    pub fn get_cli_tools(&self) -> Result<Vec<CliTool>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, config_type, config_path, active_provider_id, enabled, description FROM cli_tools ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok(CliTool {
                id: row.get(0)?, name: row.get(1)?, config_type: row.get(2)?,
                config_path: row.get(3)?, active_provider_id: row.get(4)?,
                enabled: row.get::<_, i32>(5)? == 1, description: row.get(6)?,
            })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_active_provider_for_tool(&self, tool_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn
            .query_row("SELECT active_provider_id FROM cli_tools WHERE id = ?1", params![tool_id], |row| row.get::<_, Option<String>>(0))
            .optional().map_err(|e| e.to_string())?;
        Ok(result.flatten())
    }

    pub fn activate_provider_for_tool(&self, tool_id: &str, provider_id: &str) -> Result<String, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE cli_tools SET active_provider_id = ?1 WHERE id = ?2", params![provider_id, tool_id]).map_err(|e| e.to_string())?;
        let provider: Provider = conn.query_row(
            "SELECT id, name, base_url, api_key, api_key_signup_url, icon, category, enabled, sort_order, created_at, updated_at, input_price, output_price FROM providers WHERE id = ?1",
            params![provider_id],
            |row| Ok(Provider {
                id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?,
                api_key: row.get(3)?, api_key_signup_url: row.get(4)?, icon: row.get(5)?, category: row.get(6)?,
                enabled: row.get::<_, i32>(7)? == 1, sort_order: row.get(8)?,
                created_at: row.get(9)?, updated_at: row.get(10)?,
                input_price: row.get(11)?, output_price: row.get(12)?,
            }),
        ).map_err(|e| format!("Provider {} not found: {}", provider_id, e))?;
        let tool_name: String = conn.query_row("SELECT name FROM cli_tools WHERE id = ?1", params![tool_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let api_key = provider.api_key.unwrap_or_default();

        // 确保 tool_provider_configs 中有记录，设置默认 model_mapping
        let default_models: std::collections::HashMap<&str, &str> = [
            ("deepseek", "deepseek-chat"),
            ("zhipu", "glm-4"),
            ("minimax", "abab6.5-chat"),
            ("kimi", "moonshot-v1-8k"),
            ("siliconflow", "deepseek-ai/DeepSeek-V2"),
            ("qwen", "qwen-turbo"),
            ("wenxin", "ernie-bot"),
            ("hunyuan", "hunyuan-lite"),
            ("stepfun", "step-1-8k"),
            ("openai", "gpt-3.5-turbo"),
            ("anthropic", "claude-3-haiku"),
            ("google", "gemini-pro"),
            ("mistral", "mistral-small"),
            ("groq", "llama3-8b-8192"),
            ("cohere", "command-r"),
            ("openrouter", "openai/gpt-3.5-turbo"),
            ("ollama", "llama2"),
            ("nvidia", "meta/llama3-8b-instruct"),
        ].iter().cloned().collect();

        let model = default_models.get(provider_id).unwrap_or(&"gpt-3.5-turbo");
        let model_mapping = serde_json::json!({"default": model}).to_string();

        conn.execute(
            "INSERT OR REPLACE INTO tool_provider_configs (tool_id, provider_id, model_mapping, active) VALUES (?1, ?2, ?3, 1)",
            params![tool_id, provider_id, model_mapping],
        ).map_err(|e| e.to_string())?;

        drop(conn);
        super::config_writer::write_config(tool_id, &provider.base_url, &api_key).map_err(|e| format!("写入配置失败: {}", e))?;
        log::info!("切换 {} 的 Provider 为: {}", tool_name, provider.name);
        Ok(provider.name)
    }


    // ===== Settings =====

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional().map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))", params![key, value]).map(|_| ()).map_err(|e| e.to_string())
    }

    // ===== 工具检测 =====

    pub fn has_detected_before(&self) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT 1 FROM detection_cache LIMIT 1", [], |_| Ok(true))
            .optional().unwrap_or(None).is_some()
    }

    pub fn save_detection_cache(&self, results: &[(String, bool)]) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        for (tool_id, installed) in results {
            conn.execute(
                "INSERT OR REPLACE INTO detection_cache (tool_id, installed, detected_at) VALUES (?1, ?2, datetime('now'))",
                params![tool_id, *installed as i32],
            ).map(|_| ()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn load_detection_cache(&self) -> Result<Vec<(String, bool)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT tool_id, installed FROM detection_cache").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)? == 1))).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_cli_tools_with_installed(&self) -> Result<Vec<(CliTool, bool)>, String> {
        let tools = self.get_cli_tools()?;
        let installed = super::config_writer::detect_installed_tools();
        Ok(tools.into_iter().map(|t| {
            let is_installed = installed.contains(&t.id);
            (t, is_installed)
        }).collect())
    }

    // ===== MCP 服务器 CRUD =====

    pub fn get_mcp_servers(&self) -> Result<Vec<crate::mcp::McpServer>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, transport, command, args, url, env, headers, enabled, created_at, updated_at, pid, running FROM mcp_servers ORDER BY created_at")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok(crate::mcp::McpServer {
            id: row.get(0)?, name: row.get(1)?, transport: row.get(2)?,
            command: row.get(3)?, args: row.get(4)?, url: row.get(5)?,
            env: row.get(6)?, headers: row.get(7)?, enabled: row.get::<_, i32>(8)? != 0,
            pid: row.get::<_, Option<u32>>(11)?,
            running: row.get::<_, i32>(12)? != 0,
            created_at: row.get(9)?, updated_at: row.get(10)?,
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_mcp_server(&self, id: &str) -> Result<Option<crate::mcp::McpServer>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, transport, command, args, url, env, headers, enabled, created_at, updated_at, pid, running FROM mcp_servers WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |row| Ok(crate::mcp::McpServer {
            id: row.get(0)?, name: row.get(1)?, transport: row.get(2)?,
            command: row.get(3)?, args: row.get(4)?, url: row.get(5)?,
            env: row.get(6)?, headers: row.get(7)?, enabled: row.get::<_, i32>(8)? != 0,
            pid: row.get::<_, Option<u32>>(11)?,
            running: row.get::<_, i32>(12)? != 0,
            created_at: row.get(9)?, updated_at: row.get(10)?,
        })).optional().map_err(|e| e.to_string())
    }

    pub fn add_mcp_server(&self, id: String, name: String, transport: String, command: Option<String>, args: Option<String>, url: Option<String>, env: Option<String>, headers: Option<String>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO mcp_servers (id, name, transport, command, args, url, env, headers) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, name, transport, command, args, url, env, headers],
        ).map(|_| ()).map_err(|e| format!("添加 MCP 服务器失败: {}", e))
    }

    pub fn update_mcp_server(&self, id: &str, name: String, transport: String, command: Option<String>, args: Option<String>, url: Option<String>, env: Option<String>, headers: Option<String>, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE mcp_servers SET name=?1, transport=?2, command=?3, args=?4, url=?5, env=?6, headers=?7, enabled=?8, updated_at=datetime('now') WHERE id=?9",
            params![name, transport, command, args, url, env, headers, enabled as i32, id],
        ).map(|_| ()).map_err(|e| format!("更新 MCP 服务器失败: {}", e))
    }

    pub fn delete_mcp_server(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM mcp_server_tools WHERE mcp_server_id = ?1", params![id]).map(|_| ()).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id]).map(|_| ()).map_err(|e| format!("删除 MCP 服务器失败: {}", e))
    }

    /// 批量设置所有 MCP 服务器 enabled 状态
    pub fn set_all_mcp_enabled(&self, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE mcp_servers SET enabled = ?1, updated_at = datetime('now')", params![enabled as i32])
            .map(|_| ()).map_err(|e| format!("批量更新 MCP 状态失败: {}", e))
    }

    /// 设置 MCP 服务器的 PID 和运行状态
    pub fn set_mcp_process(&self, server_id: &str, pid: i64, running: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE mcp_servers SET pid = ?1, running = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![pid, running as i32, server_id],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    /// 清除 MCP 服务器的 PID（进程退出时调用）
    pub fn clear_mcp_process(&self, server_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE mcp_servers SET pid = NULL, running = 0, updated_at = datetime('now') WHERE id = ?1",
            params![server_id],
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    // ===== MCP 服务器-工具关联 =====

    pub fn get_mcp_server_tools(&self, mcp_server_id: &str) -> Result<Vec<crate::mcp::McpServerTool>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT mcp_server_id, tool_id, enabled FROM mcp_server_tools WHERE mcp_server_id = ?1").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![mcp_server_id], |row| Ok(crate::mcp::McpServerTool {
            mcp_server_id: row.get(0)?, tool_id: row.get(1)?, enabled: row.get::<_, i32>(2)? != 0,
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_tool_mcp_servers(&self, tool_id: &str) -> Result<Vec<crate::mcp::McpServer>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.transport, s.command, s.args, s.url, s.env, s.headers, s.enabled, s.created_at, s.updated_at, s.pid, s.running \
             FROM mcp_servers s JOIN mcp_server_tools st ON s.id = st.mcp_server_id \
             WHERE st.tool_id = ?1 AND st.enabled = 1 AND s.enabled = 1",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![tool_id], |row| Ok(crate::mcp::McpServer {
            id: row.get(0)?, name: row.get(1)?, transport: row.get(2)?,
            command: row.get(3)?, args: row.get(4)?, url: row.get(5)?,
            env: row.get(6)?, headers: row.get(7)?, enabled: row.get::<_, i32>(8)? != 0,
            pid: row.get::<_, Option<u32>>(11)?,
            running: row.get::<_, i32>(12)? != 0,
            created_at: row.get(9)?, updated_at: row.get(10)?,
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn toggle_mcp_server_tool(&self, mcp_server_id: &str, tool_id: &str, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO mcp_server_tools (mcp_server_id, tool_id, enabled) VALUES (?1, ?2, ?3) \
             ON CONFLICT(mcp_server_id, tool_id) DO UPDATE SET enabled = ?3",
            params![mcp_server_id, tool_id, enabled as i32],
        ).map(|_| ()).map_err(|e| format!("设置 MCP 服务器关联失败: {}", e))
    }

    /// 获取 MCP 拓扑数据（Server ↔ Tool 连接关系可视化）
    pub fn get_mcp_topology(&self) -> Result<serde_json::Value, String> {
        let servers = self.get_mcp_servers()?;
        let tools = self.get_cli_tools()?;

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT mcp_server_id, tool_id, enabled FROM mcp_server_tools").map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, bool)> = stmt.query_map([], |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i32>(2)? != 0,
        ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        drop(stmt);

        let server_nodes: Vec<serde_json::Value> = servers.into_iter().map(|s| {
            let tool_ids: Vec<serde_json::Value> = rows.iter()
                .filter(|r| r.0 == s.id)
                .map(|r| serde_json::json!({"tool_id": r.1.clone(), "enabled": r.2}))
                .collect();
            serde_json::json!({
                "id": s.id, "name": s.name, "transport": s.transport,
                "enabled": s.enabled, "tool_ids": tool_ids
            })
        }).collect();

        let tool_nodes: Vec<serde_json::Value> = tools.into_iter().map(|t| {
            serde_json::json!({
                "id": t.id, "name": t.name, "description": t.description,
                "has_mcp": rows.iter().any(|r| &r.1 == &t.id && r.2)
            })
        }).collect();

        let connections: Vec<[String; 2]> = rows.iter()
            .filter(|r| r.2)
            .map(|r| [r.0.clone(), r.1.clone()])
            .collect();

        Ok(serde_json::json!({
            "servers": server_nodes,
            "tools": tool_nodes,
            "connections": connections
        }))
    }

    // ===== 导入/导出 =====

    pub fn export_all(&self) -> Result<serde_json::Value, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // providers
        let providers: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT id, name, base_url, api_key, api_key_signup_url, icon, category, enabled, sort_order FROM providers").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_,String>(0)?,
                    "name": row.get::<_,String>(1)?,
                    "base_url": row.get::<_,String>(2)?,
                    "api_key": row.get::<_,Option<String>>(3)?,
                    "api_key_signup_url": row.get::<_,Option<String>>(4)?,
                    "icon": row.get::<_,String>(5)?,
                    "category": row.get::<_,String>(6)?,
                    "enabled": row.get::<_,bool>(7)?,
                    "sort_order": row.get::<_,i32>(8)?,
                }))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // tool_provider_configs
        let tpc: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT tool_id, provider_id, model_mapping, active FROM tool_provider_configs").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "tool_id": row.get::<_,String>(0)?,
                    "provider_id": row.get::<_,String>(1)?,
                    "model_mapping": row.get::<_,String>(2)?,
                    "active": row.get::<_,bool>(3)?,
                }))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // cli_tools active provider
        let tool_active: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT id, active_provider_id FROM cli_tools WHERE active_provider_id IS NOT NULL").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "tool_id": row.get::<_,String>(0)?,
                    "active_provider_id": row.get::<_,String>(1)?,
                }))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // mcp_servers
        let mcp_servers: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT id, name, transport, command, args, url, env, headers, enabled FROM mcp_servers").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_,String>(0)?,
                    "name": row.get::<_,String>(1)?,
                    "transport": row.get::<_,String>(2)?,
                    "command": row.get::<_,Option<String>>(3)?,
                    "args": row.get::<_,Option<String>>(4)?,
                    "url": row.get::<_,Option<String>>(5)?,
                    "env": row.get::<_,Option<String>>(6)?,
                    "headers": row.get::<_,Option<String>>(7)?,
                    "enabled": row.get::<_,bool>(8)?,
                }))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // mcp_server_tools
        let mcp_tools: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT mcp_server_id, tool_id, enabled FROM mcp_server_tools").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "mcp_server_id": row.get::<_,String>(0)?,
                    "tool_id": row.get::<_,String>(1)?,
                    "enabled": row.get::<_,bool>(2)?,
                }))
            }).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        Ok(serde_json::json!({
            "version": "1.0",
            "app": "codexhub-cn",
            "exported_at": chrono::Utc::now().to_rfc3339(),
            "providers": providers,
            "tool_provider_configs": tpc,
            "tool_active_providers": tool_active,
            "mcp_servers": mcp_servers,
            "mcp_server_tools": mcp_tools,
        }))
    }

    pub fn import_all(&self, data: &serde_json::Value, merge: bool) -> Result<serde_json::Value, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // 兼容旧版格式：如果是数组，转换为对象结构
        let normalized = if data.is_array() {
            // 旧版格式：[{tool_id, tool_name, config_path, ...}, ...]
            // 转换为 {tool_configs: [...]}
            let mut obj = serde_json::Map::new();
            obj.insert("tool_configs".to_string(), data.clone());
            serde_json::Value::Object(obj)
        } else {
            data.clone()
        };
        let data = &normalized;

        // 关闭外键检查，避免导入顺序导致约束失败
        conn.execute("PRAGMA foreign_keys = OFF", []).map(|_| ()).map_err(|e| e.to_string())?;

        if !merge {
            // 清空现有数据（按外键依赖顺序）
            conn.execute("DELETE FROM mcp_server_tools", []).map(|_| ()).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM mcp_servers", []).map(|_| ()).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM tool_provider_configs", []).map(|_| ()).map_err(|e| e.to_string())?;
            conn.execute("UPDATE cli_tools SET active_provider_id = NULL", []).map(|_| ()).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM providers WHERE id NOT IN ('deepseek','zhipu','minimax','kimi','volcengine','siliconflow','openai','anthropic','google','groq','openrouter','together','fireworks','one-api','new-api','custom')", []).map(|_| ()).map_err(|e| e.to_string())?;
        }

        let mut counts = (0u32, 0u32, 0u32, 0u32, 0u32);

        // providers
        if let Some(providers) = data.get("providers").and_then(|v| v.as_array()) {
            for p in providers {
                let id = p["id"].as_str().unwrap_or("");
                let name = p["name"].as_str().unwrap_or("");
                let base_url = p["base_url"].as_str().unwrap_or("");
                let api_key = p["api_key"].as_str();
                let icon = p["icon"].as_str().unwrap_or("");
                let category = p["category"].as_str().unwrap_or("custom");
                let enabled = p["enabled"].as_bool().unwrap_or(true) as i32;
                let sort_order = p["sort_order"].as_i64().unwrap_or(0) as i32;
                conn.execute(
                    "INSERT OR REPLACE INTO providers (id, name, base_url, api_key, icon, category, enabled, sort_order, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,datetime('now'))",
                    params![id, name, base_url, api_key, icon, category, enabled, sort_order],
                ).map(|_| ()).map_err(|e| format!("导入 provider {} 失败: {}", id, e))?;
                counts.0 += 1;
            }
        }

        // tool_provider_configs
        if let Some(tpc) = data.get("tool_provider_configs").and_then(|v| v.as_array()) {
            for t in tpc {
                let tool_id = t["tool_id"].as_str().unwrap_or("");
                let provider_id = t["provider_id"].as_str().unwrap_or("");
                let model_mapping = t["model_mapping"].as_str().unwrap_or("{}");
                let active = t["active"].as_bool().unwrap_or(false) as i32;
                conn.execute(
                    "INSERT OR REPLACE INTO tool_provider_configs (tool_id, provider_id, model_mapping, active) VALUES (?1,?2,?3,?4)",
                    params![tool_id, provider_id, model_mapping, active],
                ).map(|_| ()).map_err(|e| format!("导入 tool_provider_config 失败: {}", e))?;
                counts.1 += 1;
            }
        }

        // tool active providers
        if let Some(ta) = data.get("tool_active_providers").and_then(|v| v.as_array()) {
            for t in ta {
                let tool_id = t["tool_id"].as_str().unwrap_or("");
                let ap = t["active_provider_id"].as_str().unwrap_or("");
                conn.execute(
                    "UPDATE cli_tools SET active_provider_id = ?1 WHERE id = ?2",
                    params![ap, tool_id],
                ).map(|_| ()).map_err(|e| format!("导入 active_provider 失败: {}", e))?;
                counts.2 += 1;
            }
        }

        // mcp_servers
        if let Some(servers) = data.get("mcp_servers").and_then(|v| v.as_array()) {
            for s in servers {
                let id = s["id"].as_str().unwrap_or("");
                let name = s["name"].as_str().unwrap_or("");
                let transport = s["transport"].as_str().unwrap_or("stdio");
                let command = s["command"].as_str();
                let args = s["args"].as_str();
                let url = s["url"].as_str();
                let env = s["env"].as_str();
                let headers = s["headers"].as_str();
                let enabled = s["enabled"].as_bool().unwrap_or(true) as i32;
                conn.execute(
                    "INSERT OR REPLACE INTO mcp_servers (id, name, transport, command, args, url, env, headers, enabled, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,datetime('now'))",
                    params![id, name, transport, command, args, url, env, headers, enabled],
                ).map(|_| ()).map_err(|e| format!("导入 mcp_server {} 失败: {}", id, e))?;
                counts.3 += 1;
            }
        }

        // 旧版格式兼容：tool_configs (数组形式导出)
        if let Some(tcs) = data.get("tool_configs").and_then(|v| v.as_array()) {
            for t in tcs {
                let tool_id = t["tool_id"].as_str().unwrap_or("");
                let active_provider = t["active_provider_id"].as_str();
                if let Some(ap) = active_provider {
                    conn.execute(
                        "UPDATE cli_tools SET active_provider_id = ?1 WHERE id = ?2",
                        params![ap, tool_id],
                    ).map(|_| ()).map_err(|e| format!("导入旧版 active_provider 失败: {}", e))?;
                    counts.2 += 1;
                }
                counts.1 += 1; // 工具配置计数
            }
        }

        // mcp_server_tools
        if let Some(mcp_tools) = data.get("mcp_server_tools").and_then(|v| v.as_array()) {
            for m in mcp_tools {
                let sid = m["mcp_server_id"].as_str().unwrap_or("");
                let tid = m["tool_id"].as_str().unwrap_or("");
                let enabled = m["enabled"].as_bool().unwrap_or(true) as i32;
                conn.execute(
                    "INSERT OR REPLACE INTO mcp_server_tools (mcp_server_id, tool_id, enabled) VALUES (?1,?2,?3)",
                    params![sid, tid, enabled],
                ).map(|_| ()).map_err(|e| format!("导入 mcp_server_tool 失败: {}", e))?;
                counts.4 += 1;
            }
        }

        // 重新开启外键检查
        conn.execute("PRAGMA foreign_keys = ON", []).map(|_| ()).map_err(|e| e.to_string())?;

        Ok(serde_json::json!({
            "ok": true,
            "providers": counts.0,
            "configs": counts.1,
            "active_mappings": counts.2,
            "mcp_servers": counts.3,
            "mcp_tools": counts.4,
            "message": format!("导入完成: {} 个供应商, {} 个工具配置, {} 个激活映射, {} 个 MCP 服务器, {} 个 MCP 工具", counts.0, counts.1, counts.2, counts.3, counts.4),
        }))
    }

    // ===== 配置文件模板 =====

    pub fn get_config_templates(&self) -> Result<Vec<ConfigTemplate>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, tool_provider_map, created_at, updated_at FROM config_templates ORDER BY updated_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            let map_json: String = row.get(3)?;
            let map: std::collections::HashMap<String, String> =
                serde_json::from_str(&map_json).unwrap_or_default();
            Ok(ConfigTemplate {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                tool_provider_map: map,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save_config_template(&self, name: &str, description: &str, tool_provider_map: &std::collections::HashMap<String, String>) -> Result<ConfigTemplate, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = format!("tpl_{}", uuid_simple());
        let map_json = serde_json::to_string(tool_provider_map).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO config_templates (id, name, description, tool_provider_map) VALUES (?1,?2,?3,?4)",
            params![id, name, description, map_json],
        ).map_err(|e| e.to_string())?;
        drop(conn);
        self.get_config_templates()?.into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| "创建模板失败".to_string())
    }

    pub fn update_config_template(&self, id: &str, name: &str, description: &str, tool_provider_map: &std::collections::HashMap<String, String>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let map_json = serde_json::to_string(tool_provider_map).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE config_templates SET name=?1, description=?2, tool_provider_map=?3, updated_at=datetime('now') WHERE id=?4",
            params![name, description, map_json, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_config_template(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM config_templates WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ===== 用量告警 =====

    pub fn get_usage_alerts(&self) -> Result<Vec<UsageAlert>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT tool_id, threshold_percent, monthly_limit_tokens, enabled, created_at, updated_at FROM usage_alerts ORDER BY tool_id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok(UsageAlert {
                tool_id: row.get(0)?,
                threshold_percent: row.get(1)?,
                monthly_limit_tokens: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn save_usage_alert(&self, tool_id: &str, threshold_percent: i32, monthly_limit_tokens: i64, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO usage_alerts (tool_id, threshold_percent, monthly_limit_tokens, enabled) VALUES (?1,?2,?3,?4) \
             ON CONFLICT(tool_id) DO UPDATE SET threshold_percent=?2, monthly_limit_tokens=?3, enabled=?4, updated_at=datetime('now')",
            params![tool_id, threshold_percent, monthly_limit_tokens, enabled as i32],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_usage_alert(&self, tool_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM usage_alerts WHERE tool_id=?1", params![tool_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ===== 聊天功能 =====

    pub fn get_tool_api_config(&self, tool_id: &str) -> Result<serde_json::Value, String> {
        debug_log(&format!("[get_tool_api_config] tool_id={}", tool_id));
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // 获取活跃 provider_id
        let provider_id: Option<String> = conn
            .query_row("SELECT active_provider_id FROM cli_tools WHERE id = ?1", params![tool_id], |row| row.get(0))
            .optional().map_err(|e| e.to_string())?
            .flatten();
        debug_log(&format!("[get_tool_api_config] provider_id={:?}", provider_id));
        let pid = match provider_id {
            Some(p) => p,
            None => return Err(format!("工具 '{}' 未配置活跃 Provider", tool_id)),
        };
        debug_log(&format!("[get_tool_api_config] pid={}", pid));
        // 获取 provider 信息
        let (api_key, base_url): (String, String) = conn.query_row(
            "SELECT COALESCE(api_key, ''), base_url FROM providers WHERE id = ?1",
            params![pid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| format!("Provider '{}' 不存在: {}", pid, e))?;
        debug_log(&format!("[get_tool_api_config] api_key len={}, base_url={}", api_key.len(), base_url));
        if api_key.is_empty() {
            return Err(format!("Provider '{}' 未配置 API Key", pid));
        }
        // 获取 model_mapping 中的 default model
        debug_log(&format!("[get_tool_api_config] querying tool_id={}, provider_id={}", tool_id, pid));
        let mm_result = conn.query_row(
            "SELECT COALESCE(model_mapping, '{}') FROM tool_provider_configs WHERE tool_id = ?1 AND provider_id = ?2 LIMIT 1",
            params![tool_id, pid.as_str()],
            |row| row.get::<_, String>(0),
        ).optional();
        debug_log(&format!("[get_tool_api_config] mm_result={:?}", mm_result));
        let mm_json: String = mm_result.map_err(|e| e.to_string())?.unwrap_or_else(|| "{}".to_string());
        debug_log(&format!("[get_tool_api_config] mm_json={}", mm_json));
        let model = match serde_json::from_str::<serde_json::Value>(&mm_json) {
            Ok(v) => {
                let m = v.get("default").and_then(|m| m.as_str()).unwrap_or("").to_string();
                debug_log(&format!("[get_tool_api_config] parsed model='{}'", m));
                m
            },
            Err(e) => {
                debug_log(&format!("[get_tool_api_config] parse error: {}", e));
                String::new()
            },
        };
        debug_log(&format!("[get_tool_api_config] returning model='{}'", model));
        Ok(serde_json::json!({
            "api_key": api_key,
            "base_url": base_url,
            "model": model,
        }))
    }

    pub fn get_chat_sessions(&self, tool_id: &str, user_id: Option<i64>) -> Result<Vec<ChatSession>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT s.id, s.tool_id, s.title, s.created_at, s.updated_at, COALESCE((SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id), 0) as msg_count, COALESCE((SELECT substr(content, 1, 60) FROM chat_messages WHERE session_id = s.id AND role = 'user' ORDER BY id ASC LIMIT 1), '') as preview, s.user_id FROM chat_sessions s WHERE s.tool_id = ?1 AND (s.user_id IS NULL AND ?2 IS NULL OR s.user_id = ?2) ORDER BY s.updated_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![tool_id, user_id], |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                tool_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
                preview: row.get(6)?,
                user_id: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn create_chat_session(&self, tool_id: &str, user_id: Option<i64>) -> Result<ChatSession, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = format!("sess_{}", uuid_simple());
        conn.execute(
            "INSERT INTO chat_sessions (id, tool_id, title, user_id) VALUES (?1, ?2, '新对话', ?3)",
            params![id, tool_id, user_id],
        ).map_err(|e| e.to_string())?;
        drop(conn);
        self.get_chat_sessions(tool_id, user_id)?.into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| "创建会话失败".to_string())
    }

    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, timestamp, user_id FROM chat_messages WHERE session_id = ?1 ORDER BY id ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                timestamp: row.get(4)?,
                user_id: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn send_chat_message(&self, session_id: &str, role: &str, content: &str, user_id: Option<i64>) -> Result<ChatMessage, String> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // 自动标题：若标题仍为"新对话"且发的是用户消息，取内容前30字作为标题
        if role == "user" {
            let title: String = conn.query_row(
                "SELECT title FROM chat_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            ).unwrap_or_default();
            if title == "新对话" {
                let auto_title = if content.chars().count() > 60 {
                    content.chars().take(60).collect::<String>() + "…"
                } else {
                    content.to_string()
                };
                conn.execute(
                    "UPDATE chat_sessions SET title = ?1 WHERE id = ?2",
                    params![auto_title, session_id],
                ).ok();
            }
            // 若会话未关联用户但当前已登录，认领会话
            if user_id.is_some() {
                conn.execute(
                    "UPDATE chat_sessions SET user_id = ?1 WHERE id = ?2 AND user_id IS NULL",
                    params![user_id, session_id],
                ).ok();
            }
        }
        conn.execute(
            "UPDATE chat_sessions SET updated_at = strftime('%s','now') WHERE id = ?1",
            params![session_id],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, timestamp, user_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, role, content, now, user_id],
        ).map_err(|e| e.to_string())?;
        let msg_id = conn.last_insert_rowid();
        debug_log(&format!("[send_chat_message] msg_id={}, session_id={}, user_id={:?}", msg_id, session_id, user_id));
        Ok(ChatMessage {
            id: msg_id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            timestamp: now,
            user_id,
        })
    }

    pub fn rename_chat_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
            params![title, session_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_chat_session(&self, session_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn log_token_usage(&self, tool_id: &str, session_id: &str, model: &str, input_tokens: i64, output_tokens: i64, total_tokens: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO token_usage_log (tool_id, session_id, model, input_tokens, output_tokens, total_tokens) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![tool_id, session_id, model, input_tokens, output_tokens, total_tokens],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_token_usage_by_tool(&self, tool_id: &str) -> Result<(i64, i64, i64), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let result = conn.query_row(
            "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(total_tokens),0) FROM token_usage_log WHERE tool_id = ?1",
            params![tool_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap_or((0i64, 0i64, 0i64));
        Ok(result)
    }

    pub fn get_aggregated_usage(&self) -> Result<(i64, i64, i64, Vec<(String, i64)>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let total_in: i64 = conn.query_row(
            "SELECT COALESCE(SUM(input_tokens),0) FROM token_usage_log",
            [], |row| row.get(0),
        ).unwrap_or(0);
        let total_out: i64 = conn.query_row(
            "SELECT COALESCE(SUM(output_tokens),0) FROM token_usage_log",
            [], |row| row.get(0),
        ).unwrap_or(0);
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_tokens),0) FROM token_usage_log",
            [], |row| row.get(0),
        ).unwrap_or(0);
        let mut stmt = conn.prepare(
            "SELECT tool_id, COALESCE(SUM(total_tokens),0) FROM token_usage_log GROUP BY tool_id ORDER BY SUM(total_tokens) DESC"
        ).map_err(|e| e.to_string())?;
        let by_tool: Vec<(String, i64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok()).collect();
        Ok((total_in, total_out, total, by_tool))
    }

    pub fn clear_detection_cache(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM detection_cache", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 获取指定工具最近 N 天的每日 token 用量
    /// 获取每个工具的模型级用量明细（按模型聚合）
    pub fn get_model_breakdown(&self, tool_id: &str) -> Result<Vec<(String, i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(model, ''), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)
             FROM token_usage_log
             WHERE tool_id = ?1 AND model IS NOT NULL AND model != ''
             GROUP BY model ORDER BY SUM(total_tokens) DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![tool_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn get_daily_token_usage(&self, tool_id: &str, days: u64) -> Result<Vec<(String, i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT date(created_at, 'unixepoch') as day,
                    COALESCE(SUM(input_tokens),0),
                    COALESCE(SUM(output_tokens),0)
             FROM token_usage_log
             WHERE tool_id = ?1 AND created_at >= strftime('%s','now','-' || ?2 || ' days')
             GROUP BY day ORDER BY day ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![tool_id, days], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }


    /// 去重插入：N 秒内同一 tool+slug 重复调用则跳过
    /// 返回新插入的 id，重复返回 0
    pub fn log_skill_invoke_dedup(&self, tool_id: &str, skill_slug: &str, skill_name: &str, window_secs: i64) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // 检查 N 秒内是否已存在
        let recent_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skill_invoke_log WHERE tool_id = ?1 AND skill_slug = ?2 AND created_at >= datetime('now', ?3)",
            params![tool_id, skill_slug, format!("-{} seconds", window_secs)],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if recent_count > 0 {
            return Ok(0);
        }
        conn.execute(
            "INSERT INTO skill_invoke_log (tool_id, skill_slug, skill_name) VALUES (?1, ?2, ?3)",
            params![tool_id, skill_slug, skill_name],
        ).map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_recent_skill_invokes(&self, limit: u32) -> Result<Vec<(i64, String, String, String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, tool_id, skill_slug, skill_name, created_at FROM skill_invoke_log ORDER BY id DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        }).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn clear_all_cache(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM detection_cache", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 清理重复记录：N 秒内同一 tool+slug 只保留最新一条
    pub fn dedup_skill_invoke_log(&self, window_secs: i64) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn.execute(
            "DELETE FROM skill_invoke_log WHERE id NOT IN (
                SELECT MAX(id) FROM skill_invoke_log
                GROUP BY tool_id, skill_slug
                HAVING MAX(created_at) >= datetime('now', ?1)
             ) AND created_at >= datetime('now', ?1)",
            params![format!("-{} seconds", window_secs)],
        ).map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    /// 全表去重：保留每个 tool+slug 最新一条，其余全删
    pub fn dedup_skill_invoke_log_all(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn.execute(
            "DELETE FROM skill_invoke_log WHERE id NOT IN (
                SELECT MAX(id) FROM skill_invoke_log GROUP BY tool_id, skill_slug
            )",
            [],
        ).map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    // ============ 定时任务 (cron) ============
    pub fn get_cron_jobs(&self, tool_id: &str) -> Result<Vec<CronJob>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut bind: Vec<String> = Vec::new();
        let sql = if tool_id.is_empty() {
            "SELECT id, tool_id, name, cron_expr, message, enabled, created_at, last_run, next_run FROM cron_jobs ORDER BY created_at DESC"
        } else {
            bind.push(tool_id.to_string());
            "SELECT id, tool_id, name, cron_expr, message, enabled, created_at, last_run, next_run FROM cron_jobs WHERE tool_id = ?1 ORDER BY created_at DESC"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let mapper = |row: &rusqlite::Row| Ok(CronJob {
            id: row.get(0)?,
            tool_id: row.get(1)?,
            name: row.get(2)?,
            cron_expr: row.get(3)?,
            message: row.get(4)?,
            enabled: row.get::<_, i64>(5)? != 0,
            created_at: row.get(6)?,
            last_run: row.get(7)?,
            next_run: row.get(8)?,
        });
        let rows = stmt.query_map(rusqlite::params_from_iter(bind.iter()), mapper).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn add_cron_job(&self, job: &CronJob) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO cron_jobs (id, tool_id, name, cron_expr, message, enabled, created_at, last_run, next_run) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                job.id, job.tool_id, job.name, job.cron_expr, job.message,
                job.enabled as i64, job.created_at, job.last_run, job.next_run,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn toggle_cron_job(&self, job_id: &str, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cron_jobs SET enabled = ?1 WHERE id = ?2",
            params![enabled as i64, job_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_cron_job(&self, job_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM cron_jobs WHERE id = ?1", params![job_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_cron_job_next_run(&self, job_id: &str, next_run: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cron_jobs SET next_run = ?1 WHERE id = ?2",
            params![next_run, job_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_cron_job_last_run(&self, job_id: &str, last_run: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cron_jobs SET last_run = ?1 WHERE id = ?2",
            params![last_run, job_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ============ 多Agent协作历史 ============
    pub fn save_multiagent_session(&self, session: &MultiAgentSession, results: &[MultiAgentResult]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO multiagent_sessions (id, task, main_tool_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session.id, session.task, session.main_tool_id, session.created_at, session.updated_at],
        ).map_err(|e| e.to_string())?;
        for r in results {
            conn.execute(
                "INSERT OR REPLACE INTO multiagent_results (id, session_id, tool_id, agent_name, content, error, is_summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    r.id, r.session_id, r.tool_id, r.agent_name, r.content, r.error,
                    r.is_summary as i64, r.created_at,
                ],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get_multiagent_sessions(&self, limit: i32) -> Result<Vec<MultiAgentSession>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, task, main_tool_id, created_at, updated_at FROM multiagent_sessions ORDER BY created_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| Ok(MultiAgentSession {
            id: row.get(0)?,
            task: row.get(1)?,
            main_tool_id: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows { results.push(row.map_err(|e| e.to_string())?); }
        Ok(results)
    }

    pub fn get_multiagent_results(&self, session_id: &str) -> Result<Vec<MultiAgentResult>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, tool_id, agent_name, content, error, is_summary, created_at FROM multiagent_results WHERE session_id = ?1 ORDER BY created_at ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![session_id], |row| Ok(MultiAgentResult {
            id: row.get(0)?,
            session_id: row.get(1)?,
            tool_id: row.get(2)?,
            agent_name: row.get(3)?,
            content: row.get(4)?,
            error: row.get(5)?,
            is_summary: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
        })).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows { results.push(row.map_err(|e| e.to_string())?); }
        Ok(results)
    }

    pub fn delete_multiagent_session(&self, session_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM multiagent_results WHERE session_id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM multiagent_sessions WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!("{:x}{:x}", now.as_secs(), now.subsec_nanos())
}
