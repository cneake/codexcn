use log::info;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;
use std::io::Write;

const SKILLS_INDEX_URL: &str =
    "https://agent.eake.cn/wp-content/downloads/skills.json";
const SEARCH_API_URL: &str = "https://lightmake.site/api/v1/search";
const DOWNLOAD_API_URL: &str = "https://lightmake.site/api/v1/download";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillInfo {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(rename = "download_url", default)]
    pub download_url: String,
    #[serde(default)]
    pub downloadable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct SkillsIndex {
    #[serde(default)]
    total: usize,
    #[serde(default)]
    skills: Vec<SkillInfo>,
}

#[derive(Debug, Serialize)]
pub struct SkillhubStatus {
    pub api_reachable: bool,
    pub cli_available: bool,
    pub installed_skills: Vec<String>,
}

fn get_skills_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("skills")
}

fn get_cli_path() -> Option<PathBuf> {
    // 优先 .exe（直接可执行，比 .cmd shim 稳定）
    let exe_candidates = [
        Some(PathBuf::from("E:\\Python\\Python312\\Scripts\\skillhub.exe")),
        Some(PathBuf::from("C:\\Python312\\Scripts\\skillhub.exe")),
        std::env::var("USERPROFILE")
            .map(|p| PathBuf::from(p).join(".local\\bin\\skillhub.exe"))
            .ok(),
        which::which("skillhub.exe").ok(),
    ];
    for c in exe_candidates.into_iter().flatten() {
        if c.exists() {
            return Some(c);
        }
    }
    // 退而求其次 .cmd
    let cmd_candidates = [
        std::env::var("USERPROFILE")
            .map(|p| PathBuf::from(p).join(".local\\bin\\skillhub.cmd"))
            .ok(),
        which::which("skillhub.cmd").ok(),
    ];
    for c in cmd_candidates.into_iter().flatten() {
        if c.exists() {
            return Some(c);
        }
    }
    None
}

/// Simple ping to test network connectivity (sync to avoid async issues)
#[tauri::command]
pub fn ping_skillhub() -> String {
    // Try a simple HTTP GET
    match reqwest::blocking::Client::new()
        .get(SKILLS_INDEX_URL)
        .timeout(std::time::Duration::from_secs(5))
        .header("User-Agent", "CodexHub/1.0")
        .send()
    {
        Ok(resp) => format!("OK: {}", resp.status()),
        Err(e) => format!("FAIL: {}", e),
    }
}

/// Check API reachability (async) - tries multiple endpoints
#[tauri::command]
pub async fn get_skillhub_status(app: AppHandle) -> SkillhubStatus {
    // Try building client with explicit settings
    let client_result = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .danger_accept_invalid_certs(false)
        .build();

    let api_reachable = if let Ok(client) = client_result {
        info!("[skills] Testing COS API: {}", SKILLS_INDEX_URL);
        let cos_result = client
            .get(SKILLS_INDEX_URL)
            .timeout(std::time::Duration::from_secs(5))
            .header("User-Agent", "CodexHub/1.0")
            .send()
            .await;
        
        match &cos_result {
            Ok(resp) => {
                info!("[skills] COS response status: {}", resp.status());
                resp.status().is_success()
            }
            Err(e) => {
                info!("[skills] COS request failed: {}", e);
                // Fallback: try search API
                info!("[skills] Trying fallback search API");
                client
                    .get(&format!("{}?q=test&limit=1", SEARCH_API_URL))
                    .timeout(std::time::Duration::from_secs(5))
                    .header("User-Agent", "CodexHub/1.0")
                    .send()
                    .await
                    .map(|r| { info!("[skills] Search API response: {}", r.status()); r.status().is_success() })
                    .unwrap_or_else(|e| { info!("[skills] Search API also failed: {}", e); false })
            }
        }
    } else {
        info!("[skills] Failed to create reqwest client: {:?}", client_result.err());
        false
    };

    let cli_available = get_cli_path().is_some();

    let skills_dir = get_skills_dir(&app);
    let installed_skills: Vec<String> = if skills_dir.exists() {
        fs::read_dir(&skills_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .filter_map(|e| e.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    SkillhubStatus {
        api_reachable,
        cli_available,
        installed_skills,
    }
}

/// Fetch skills index from remote (async)
#[tauri::command]
pub async fn get_skills_index() -> Result<Vec<SkillInfo>, String> {
    let client = reqwest::Client::new();

    let resp = client
        .get(SKILLS_INDEX_URL)
        .header("User-Agent", "CodexHub/1.0")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("无法连接: {}", e))?;

    let index: SkillsIndex = resp
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;
    Ok(index.skills)
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<RawSearchItem>,
}

#[derive(Debug, Deserialize)]
struct RawSearchItem {
    slug: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    source: String,
}

/// Search skills via API (async)
#[tauri::command]
pub async fn search_skills(query: String, limit: Option<u32>) -> Result<Vec<SkillInfo>, String> {
    let limit = limit.unwrap_or(20);
    let url = format!(
        "{}?q={}&limit={}",
        SEARCH_API_URL,
        urlencoding::encode(&query),
        limit
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "CodexHub/1.0")
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("搜索失败: {}", e))?;

    let search_resp: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析搜索结果失败: {}", e))?;

    // Only include non-clawhub skills (clawhub ZIPs are not on lightmake.site → 404)
        let skip_sources = ["clawhub"];
        Ok(search_resp
        .results
        .into_iter()
        .filter(|i| !skip_sources.contains(&i.source.to_lowercase().as_str()))
        .map(|i| SkillInfo {
            slug: i.slug.clone(),
            name: i.name,
            description: i.description,
            category: i.category,
            author: i.author,
            version: i.version,
            download_url: format!("{}?slug={}", DOWNLOAD_API_URL, i.slug),
            downloadable: true,
        })
        .collect())
}

/// Install a skill by slug (async download + blocking unzip is OK in async command)
#[tauri::command]
pub async fn install_skill(app: AppHandle, slug: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let download_url = format!("{}?slug={}", DOWNLOAD_API_URL, slug);

    let resp = client
        .get(&download_url)
        .header("User-Agent", "CodexHub/1.0")
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取失败: {}", e))?;

    // Write zip to disk (blocking IO is fine here, it's a small file)
    let skills_dir = get_skills_dir(&app);
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;

    let temp_zip = skills_dir.join(format!("{}.zip", slug));
    {
        let mut file = fs::File::create(&temp_zip).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    // Unzip
    let skill_extract_dir = skills_dir.join(&slug);
    if skill_extract_dir.exists() {
        fs::remove_dir_all(&skill_extract_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&skill_extract_dir).map_err(|e| e.to_string())?;

    let file = fs::File::open(&temp_zip).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("解压失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = skill_extract_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    // Cleanup
    let _ = fs::remove_file(&temp_zip);

    Ok(format!("已安装: {}", slug))
}

/// Uninstall a skill (sync is fine — pure filesystem, no blocking HTTP)
#[tauri::command]
pub fn uninstall_skill(app: AppHandle, slug: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let skill_path = skills_dir.join(&slug);

    if !skill_path.exists() {
        return Err(format!("Skill '{}' 未安装", slug));
    }

    fs::remove_dir_all(&skill_path).map_err(|e| format!("删除失败: {}", e))?;
    Ok(format!("已卸载: {}", slug))
}

/// Get skills for a specific tool (returns installed skills that are compatible with the tool)
#[tauri::command]
pub fn get_tool_skills(app: AppHandle, _tool_id: String) -> Result<Vec<ToolSkill>, String> {
    let skills_dir = get_skills_dir(&app);
    let mut skills = Vec::new();
    
    if !skills_dir.exists() {
        return Ok(skills);
    }
    
    // Read all installed skills
    let entries = fs::read_dir(&skills_dir).map_err(|e| format!("读取技能目录失败: {}", e))?;
    
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        
        let slug = entry.file_name().to_string_lossy().to_string();
        let skill_file = path.join("SKILL.md");
        
        // Parse SKILL.md if exists
        let (name, description) = if skill_file.exists() {
            if let Ok(content) = fs::read_to_string(&skill_file) {
                let name = content.lines()
                    .find(|l| l.starts_with("# "))
                    .map(|l| l.trim_start_matches('#').trim().to_string())
                    .unwrap_or_else(|| slug.clone());
                let desc = content.lines()
                    .skip(1)
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string())
                    .unwrap_or_default();
                (name, desc)
            } else {
                (slug.clone(), String::new())
            }
        } else {
            (slug.clone(), String::new())
        };
        
        skills.push(ToolSkill {
            name,
            slug,
            description,
            source: "market".to_string(),
            category: String::new(),
            author: String::new(),
            version: String::new(),
        });
    }
    
    Ok(skills)
}

/// Tool skill info
#[derive(Debug, Serialize, Deserialize)]
pub struct ToolSkill {
    pub name: String,
    pub slug: String,
    pub description: String,
    pub source: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
}

/// CodexHub 内置技能清单（来自 skills.json，硬编码兜底）
/// 包含 11 个开箱即用技能，所有用户均可见。
const BUNDLED_SKILLS: &[(&str, &str, &str, &str, &str, &str)] = &[
    (
        "agent-email", "Agent Email", "邮件",
        "通过 QQ Agent 邮箱（OAuth 2.1）专用 CLI 工具操作邮件：发送、回复、转发、搜索、读取、下载附件、管理收件箱",
        "QClaw", "1.0.0",
    ),
    (
        "pdf", "PDF 处理", "文档",
        "PDF 文件读取、合并、拆分、旋转、加水印、提取图片、OCR 识别",
        "OpenClaw", "1.0.0",
    ),
    (
        "xlsx", "Excel 处理", "表格",
        "Excel 文件读取、编辑、格式化、图表生成、数据清洗",
        "OpenClaw", "1.0.0",
    ),
    (
        "docx", "Word 处理", "文档",
        "Word 文档创建、读取、编辑、格式化、模板生成",
        "OpenClaw", "1.0.0",
    ),
    (
        "qclaw-rules", "QClaw 运行规则", "系统",
        "OpenClaw 系统基础运行规则，强制加载，不可卸载",
        "OpenClaw", "1.0.0",
    ),
    (
        "qclaw-env", "环境诊断工具", "系统",
        "OpenClaw skill 全链路环境诊断与安装工具",
        "OpenClaw", "1.0.0",
    ),
    (
        "find-skills", "技能发现助手", "系统",
        "帮助用户发现和安装 Agent 技能",
        "OpenClaw", "1.0.0",
    ),
    (
        "multi-search-engine", "多搜索引擎聚合", "搜索",
        "集成 17 个搜索引擎（8 个国内 + 9 个国际），支持高级搜索语法",
        "OpenClaw", "1.0.0",
    ),
    (
        "xbrowser", "浏览器自动化", "浏览器",
        "控制真实 Chrome/Edge/QQ 浏览器，支持登录态复用、截图、表单填写",
        "OpenClaw", "1.0.0",
    ),
    (
        "persona-switch", "人设切换", "系统",
        "切换 Agent 人设（赛博朋友/温柔伴侣/创始人龙虾）",
        "OpenClaw", "1.0.0",
    ),
    (
        "hermes", "Hermès 信息助手", "信息",
        "爱马仕产品、新闻、财务、官网资源查询",
        "OpenClaw", "1.0.0",
    ),
];

/// 返回 CodexHub 内置技能列表（11 个）
/// 优先尝试读取项目根目录的 skills.json，失败时回退到硬编码清单。
#[tauri::command]
pub fn get_bundled_skills(app: AppHandle) -> Result<Vec<ToolSkill>, String> {
    // 1) 尝试从 resources/skills.json 读取（打包后路径）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("skills.json");
        if let Ok(content) = fs::read_to_string(&p) {
            if let Ok(parsed) = parse_bundled_skills(&content) {
                return Ok(parsed);
            }
        }
    }
    // 2) 尝试从应用数据目录读取（开发模式或下载缓存）
    if let Ok(data_dir) = app.path().app_data_dir() {
        let p = data_dir.join("skills.json");
        if let Ok(content) = fs::read_to_string(&p) {
            if let Ok(parsed) = parse_bundled_skills(&content) {
                return Ok(parsed);
            }
        }
    }
    // 3) 兜底：硬编码清单
    Ok(BUNDLED_SKILLS
        .iter()
        .map(|(slug, name, category, desc, author, version)| ToolSkill {
            name: name.to_string(),
            slug: slug.to_string(),
            description: desc.to_string(),
            source: "bundled".to_string(),
            category: category.to_string(),
            author: author.to_string(),
            version: version.to_string(),
        })
        .collect())
}

fn parse_bundled_skills(content: &str) -> Result<Vec<ToolSkill>, String> {
    #[derive(Deserialize)]
    struct SkillsFile {
        skills: Vec<BundledSkill>,
    }
    #[derive(Deserialize)]
    struct BundledSkill {
        slug: String,
        name: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        category: String,
        #[serde(default)]
        author: String,
        #[serde(default)]
        version: String,
    }
    let parsed: SkillsFile = serde_json::from_str(content)
        .map_err(|e| format!("解析 skills.json 失败: {}", e))?;
    Ok(parsed
        .skills
        .into_iter()
        .map(|s| ToolSkill {
            name: s.name,
            slug: s.slug,
            description: s.description,
            source: "bundled".to_string(),
            category: s.category,
            author: s.author,
            version: s.version,
        })
        .collect())
}

/// Add a skill to the remote skills.json index
#[tauri::command]
pub async fn add_skill_to_index(app: AppHandle, skill: SkillInfo) -> Result<String, String> {
    // 1. Download current skills.json
    let client = reqwest::Client::new();
    let response = client
        .get(SKILLS_INDEX_URL)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("下载技能列表失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取失败: {}", e))?
        ;
    
    let mut index: SkillsIndex = serde_json::from_str(&response)
        .map_err(|e| format!("解析失败: {}", e))?
        ;
    
    // 2. Check if already exists
    if index.skills.iter().any(|s| s.slug == skill.slug) {
        return Err(format!("技能 '{}' 已存在", skill.slug));
    }
    
    // 3. Add new skill
    index.skills.push(skill.clone());
    index.total = index.skills.len();
    
    // 4. Save locally for manual upload
    let app_dir = app.path().app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {}", e))?
        ;
    let temp_file = app_dir.join("skills_upload.json");
    let json_data = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("序列化失败: {}", e))?
        ;
    std::fs::write(&temp_file, &json_data)
        .map_err(|e| format!("写入临时文件失败: {}", e))?
        ;
    
    Ok(format!("已添加 {} 到列表（共 {} 个技能），文件已保存到 {:?}", skill.name, index.total, temp_file))
}

/// Remove a skill from the remote skills.json index
#[tauri::command]
pub async fn remove_skill_from_index(app: AppHandle, slug: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(SKILLS_INDEX_URL)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("下载技能列表失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取失败: {}", e))?
        ;
    
    let mut index: SkillsIndex = serde_json::from_str(&response)
        .map_err(|e| format!("解析失败: {}", e))?
        ;
    
    let original_len = index.skills.len();
    index.skills.retain(|s| s.slug != slug);
    
    if index.skills.len() == original_len {
        return Err(format!("未找到技能 '{}'", slug));
    }
    
    index.total = index.skills.len();
    
    // Save locally
    let app_dir = app.path().app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {}", e))?
        ;
    let temp_file = app_dir.join("skills_upload.json");
    let json_data = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("序列化失败: {}", e))?
        ;
    std::fs::write(&temp_file, &json_data)
        .map_err(|e| format!("写入临时文件失败: {}", e))?
        ;
    
    Ok(format!("已从列表删除 {}（剩余 {} 个技能），文件已保存到 {:?}", slug, index.total, temp_file))
}

/// Upload skills_upload.json to server via SFTP
#[tauri::command]
pub async fn upload_skills_json(app: AppHandle) -> Result<String, String> {
    use ssh2::Session;
    use std::net::TcpStream;
    
    let app_dir = app.path().app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {}", e))?
        ;
    let skills_file = app_dir.join("skills_upload.json");
    
    if !skills_file.exists() {
        return Err("未找到 skills_upload.json，请先添加/删除技能".to_string());
    }
    
    // Connect to SSH server
    let tcp = TcpStream::connect("103.52.153.201:22")
        .map_err(|e| format!("连接服务器失败: {}", e))?
        ;
    let mut sess = Session::new().map_err(|e| format!("创建SSH会话失败: {}", e))?
        ;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH握手失败: {}", e))?
        ;
    sess.userauth_password("root", "Ea61091793")
        .map_err(|e| format!("SSH认证失败: {}", e))?
        ;
    
    // Upload via SFTP
    let sftp = sess.sftp().map_err(|e| format!("创建SFTP失败: {}", e))?
        ;
    let local_data = std::fs::read(&skills_file)
        .map_err(|e| format!("读取本地文件失败: {}", e))?
        ;
    
    let remote_path = std::path::Path::new("/www/wwwroot/agent.eake.cn/wp-content/downloads/skills.json");
    let mut remote_file = sftp.create(remote_path)
        .map_err(|e| format!("创建远程文件失败: {}", e))?
        ;
    remote_file.write_all(&local_data)
        .map_err(|e| format!("上传失败: {}", e))?
        ;
    
    // Cleanup
    std::fs::remove_file(&skills_file).ok();
    
    Ok("上传成功！".to_string())
}

/// Info about a skill directory under skills/.
#[derive(Debug, Serialize, Clone)]
pub struct InstalledSkillInfo {
    pub slug: String,
    /// true = saved via "仅保存" (extracted but not installed); false = fully installed
    #[serde(rename = "savedOnly")]
    pub saved_only: bool,
}

/// Get list of installed (or saved-only) skill directories.
#[tauri::command]
pub fn get_installed_skills(app: AppHandle) -> Result<Vec<InstalledSkillInfo>, String> {
    let skills_dir = get_skills_dir(&app);
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut skills: Vec<InstalledSkillInfo> = fs::read_dir(&skills_dir)
        .map_err(|e| format!("读取失败: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let saved_only = e.path().join(".saved_only").exists() || !e.path().join("SKILL.md").exists();
            Some(InstalledSkillInfo { slug: name, saved_only })
        })
        .collect();
    skills.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(skills)
}

/// Preview a local ZIP skill: extract SKILL.md, return metadata
#[tauri::command]
pub fn preview_local_skill(zip_path: String) -> Result<SkillInfo, String> {
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("无法打开文件: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("无效的 ZIP 文件: {}", e))?;

    // Check SKILL.md exists
    let has_skill_md = (0..archive.len())
        .any(|i| archive.by_index(i).map(|f| f.name().ends_with("SKILL.md")).unwrap_or(false));
    if !has_skill_md {
        return Err("ZIP 内未找到 SKILL.md，不是有效的技能包".to_string());
    }

    // Find root-level SKILL.md content
    let mut skill_md_content = String::new();
    let mut _found_root = false;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)
            .map_err(|e| format!("读取失败: {}", e))?;
        let name = f.name().to_string();
        if name == "SKILL.md" || name == "skill/SKILL.md" || name == "src/SKILL.md" {
            skill_md_content = std::io::read_to_string(&mut f)
                .map_err(|e| format!("读取 SKILL.md 失败: {}", e))?;
            _found_root = true;
            break;
        }
    }

    // Also check nested SKILL.md if root not found
    if !_found_root {
        for i in 0..archive.len() {
            let mut f = archive.by_index(i)
                .map_err(|e| format!("读取失败: {}", e))?;
            let name = f.name().to_string();
            if name.ends_with("SKILL.md") && name.chars().filter(|&c| c == '/').count() == 1 {
                skill_md_content = std::io::read_to_string(&mut f)
                    .map_err(|e| format!("读取 SKILL.md 失败: {}", e))?;
                _found_root = true;
                break;
            }
        }
    }

    let name = skill_md_content
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l.trim_start_matches("# ").trim().to_string())
        .unwrap_or_else(|| {
            std::path::Path::new(&zip_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

    let slug = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();

    let description = skill_md_content
        .lines()
        .skip(1)
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .unwrap_or_default();

    Ok(SkillInfo {
        slug: slug.clone(),
        name,
        description,
        category: String::new(),
        author: String::new(),
        version: String::new(),
        download_url: String::new(),
        downloadable: false,
    })
}

/// Install a local ZIP skill to skills_dir/{slug}/
#[tauri::command]
pub fn install_local_skill(app: AppHandle, zip_path: String, slug: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let log_path = skills_dir.parent().unwrap_or(&skills_dir).join("install_debug.log");
    let _ = std::fs::write(&log_path, format!("skills_dir = {:?}\nzip_path = {}\nslug = {}\n", skills_dir, zip_path, slug));
    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("创建 skills 目录失败 ({:?}): {}", skills_dir, e))?;

    // Check if already installed
    let skill_dir = skills_dir.join(&slug);
    if skill_dir.exists() {
        return Err(format!("技能 '{}' 已存在，请先卸载或换一个 slug", slug));
    }

    // Extract ZIP
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("无法打开文件: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("无效的 ZIP 文件: {}", e))?;

    // Find the root prefix to strip (e.g. "my-skill/" in ZIP).
    // Normalize both / and \ separators (Windows-created ZIPs may use \).
    let mut root_prefix: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().to_string();
            if !name.is_empty() && !name.ends_with('/') && !name.ends_with('\\') {
                if let Some(first_part) = name.split(['/', '\\']).next() {
                    if !first_part.is_empty() {
                        root_prefix = Some(first_part.to_string());
                        break;
                    }
                }
            }
        }
    }

    let prefix = root_prefix.unwrap_or_default();

    // Debug log: write prefix detection result to TEMP for diagnosis
    let debug_log = std::env::temp_dir().join("codexhub_install_debug.log");
    let _ = std::fs::write(
        &debug_log,
        format!("[install_local_skill] zip={} slug={} prefix={:?} skill_dir={:?}\n",
            zip_path, slug, prefix, skill_dir),
    );

    fs::create_dir_all(&skill_dir)
        .map_err(|e| {
            let _ = std::fs::write(
                &debug_log,
                format!("[install_local_skill] FAIL at create skill_dir: {:?} err={}\n", skill_dir, e),
            );
            format!("创建技能目录失败 ({:?}): {}", skill_dir, e)
        })?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取失败: {}", e))?;
        let raw_name = file.name();

        // Strip root prefix, trim both / and \
        let out_name = if !prefix.is_empty() && raw_name.starts_with(&prefix) {
            raw_name[prefix.len()..]
                .trim_start_matches(|c: char| c == '/' || c == '\\')
        } else {
            raw_name
        };

        let outpath = skill_dir.join(out_name);

        let _ = std::fs::write(
            &debug_log,
            format!("[install_local_skill] entry[{}] raw_name={:?} out_name={:?} outpath={:?}\n",
                i, raw_name, out_name, outpath),
        );

        if out_name.is_empty() {
            // Skip root directory entry
            continue;
        }

        if file.name().ends_with('/') || file.name().ends_with('\\') {
            fs::create_dir_all(&outpath)
                .map_err(|e| {
                    let _ = std::fs::write(
                        &debug_log,
                        format!("[install_local_skill] FAIL at create outpath dir: {:?} err={}\n", outpath, e),
                    );
                    format!("创建目录失败 ({:?}): {}", outpath, e)
                })?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| {
                            let _ = std::fs::write(
                                &debug_log,
                                format!("[install_local_skill] FAIL at create parent: {:?} err={}\n", p, e),
                            );
                            format!("创建父目录失败 ({:?}): {}", p, e)
                        })?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| {
                    let _ = std::fs::write(
                        &debug_log,
                        format!("[install_local_skill] FAIL at create file: {:?} err={}\n", outpath, e),
                    );
                    format!("创建文件失败 ({:?}): {}", outpath, e)
                })?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("写入失败: {}", e))?;
        }
    }

    // Validate SKILL.md exists
    if !skill_dir.join("SKILL.md").exists() {
        fs::remove_dir_all(&skill_dir).ok();
        return Err("解压后未找到 SKILL.md，技能包无效".to_string());
    }

    info!("Installed local skill: {} at {:?}", slug, skill_dir);
    Ok(format!("技能 '{}' 安装成功", slug))
}

/// Upload (extract) a skill ZIP to skills/ folder without validation/cleanup.
/// Returns the extracted path so caller can decide next step.
pub fn upload_skill_local(app: AppHandle, zip_path: String, slug: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let skill_dir = skills_dir.join(&slug);
    if skill_dir.exists() {
        return Err(format!("技能 '{}' 已存在，请先卸载或换一个 slug", slug));
    }

    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("无法打开文件: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("无效的 ZIP 文件: {}", e))?;

    let mut root_prefix: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().to_string();
            if !name.is_empty() && !name.ends_with('/') && !name.ends_with('\\') {
                if let Some(first_part) = name.split(['/', '\\']).next() {
                    if !first_part.is_empty() {
                        root_prefix = Some(first_part.to_string());
                        break;
                    }
                }
            }
        }
    }

    let prefix = root_prefix.unwrap_or_default();

    let debug_log = std::env::temp_dir().join("codexhub_install_debug.log");
    let _ = std::fs::write(
        &debug_log,
        format!("[upload_skill_local] zip={} slug={} prefix={:?} skill_dir={:?}\n",
            zip_path, slug, prefix, skill_dir),
    );

    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("创建技能目录失败 ({:?}): {}", skill_dir, e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取失败: {}", e))?;
        let raw_name = file.name();

        let out_name = if !prefix.is_empty() && raw_name.starts_with(&prefix) {
            raw_name[prefix.len()..]
                .trim_start_matches(|c: char| c == '/' || c == '\\')
        } else {
            raw_name
        };

        let outpath = skill_dir.join(out_name);

        if out_name.is_empty() {
            continue;
        }

        if file.name().ends_with('/') || file.name().ends_with('\\') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("创建目录失败 ({:?}): {}", outpath, e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("创建父目录失败 ({:?}): {}", p, e))?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("创建文件失败 ({:?}): {}", outpath, e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("写入失败: {}", e))?;
        }
    }

    // Mark as "saved only" (not installed) so the UI can offer a "去安装" action.
    let _ = fs::write(skill_dir.join(".saved_only"), "1");

    info!("Uploaded local skill: {} to {:?}", slug, skill_dir);
    Ok(format!("技能 '{}' 已保存到本地 skills 目录", slug))
}

/// Install a previously "仅保存" (saved-only) skill: validate SKILL.md and
/// clear the .saved_only marker so it becomes a fully installed skill.
#[tauri::command]
pub fn install_saved_skill(app: AppHandle, slug: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&slug);
    if !skill_dir.exists() {
        return Err(format!("技能 '{}' 不存在", slug));
    }
    if !skill_dir.join("SKILL.md").exists() {
        return Err(format!("技能 '{}' 缺少 SKILL.md，无法安装", slug));
    }
    // Remove the "saved only" marker -> now fully installed.
    let _ = fs::remove_file(skill_dir.join(".saved_only"));
    info!("Installed saved skill: {} at {:?}", slug, skill_dir);
    Ok(format!("技能 '{}' 安装成功", slug))
}

/// Install skill from market URL (COS or direct link)
/// Strategy: try `download_url` first; if response is not a valid ZIP
/// (size, content-type, or magic-number check fails), fall back to
/// the `lightmake.site` redirect endpoint which we know serves the
/// real ZIP from the accelerated COS bucket.
#[tauri::command]
pub async fn install_skill_from_market(
    app: AppHandle,
    slug: String,
    name: String,
    download_url: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    
    // Build candidate URL list (in priority order):
    //   1. The download_url passed in (only if it looks like an http(s) URL)
    //   2. lightmake.site redirect (always — known to work, redirects to
    //      https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/{slug}/{version}.zip)
    let mut candidates: Vec<String> = Vec::new();
    if download_url.starts_with("http://") || download_url.starts_with("https://") {
        candidates.push(download_url.clone());
    }
    candidates.push(format!("{}?slug={}", DOWNLOAD_API_URL, slug));
    
    let mut last_err: Option<String> = None;
    let mut bytes: Vec<u8> = Vec::new();
    let mut used_url = String::new();
    
    for url in &candidates {
        info!("[skills] Trying: {}", url);
        let resp = match client
            .get(url)
            .header("User-Agent", "CodexHub/1.0")
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(format!("下载失败 ({}): {}", url, e));
                continue;
            }
        };
        
        if !resp.status().is_success() {
            last_err = Some(format!("下载失败 ({}): HTTP {}", url, resp.status()));
            continue;
        }
        
        // Check Content-Type — must look like a zip / octet-stream
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let ct_ok = ct.is_empty() // some servers don't set it
            || ct.contains("zip")
            || ct.contains("octet-stream")
            || ct.contains("application/x-zip");
        if !ct_ok {
            last_err = Some(format!(
                "下载失败 ({}): 非 ZIP 响应 (Content-Type: {})",
                url, ct
            ));
            continue;
        }
        
        let buf = match resp.bytes().await {
            Ok(b) => b.to_vec(),
            Err(e) => {
                last_err = Some(format!("读取失败 ({}): {}", url, e));
                continue;
            }
        };
        
        // Reject if too small to be a real ZIP (smallest valid ZIP ~ 22 bytes)
        if buf.len() < 22 {
            last_err = Some(format!(
                "下载失败 ({}): 响应过小 ({} bytes)",
                url,
                buf.len()
            ));
            continue;
        }
        
        // Check ZIP magic number (PK\x03\x04 = 50 4B 03 04)
        if buf.len() < 4 || buf[0] != 0x50 || buf[1] != 0x4B || buf[2] != 0x03 || buf[3] != 0x04 {
            last_err = Some(format!(
                "下载失败 ({}): 响应不是 ZIP (前 4 字节: {:02X?})",
                url,
                &buf[..4.min(buf.len())]
            ));
            continue;
        }
        
        bytes = buf;
        used_url = url.clone();
        last_err = None;
        break;
    }
    
    if bytes.is_empty() {
        // ZIP download failed — try skillhub CLI as fallback
        info!("[skills] ZIP download failed, trying skillhub CLI fallback for: {}", slug);
        if let Some(cli_path) = get_cli_path() {
            info!("[skills] Using skillhub CLI at: {:?}", cli_path);
            // Run: skillhub pull {slug}
            // 直接用 Command::new(cli_path)，Rust 在 Windows 上会自动通过 cmd.exe 处理 .cmd/.bat 扩展
            let output = std::process::Command::new(&cli_path)
                .arg("pull")
                .arg(&slug)
                .output();
            
            let output = match output {
                Ok(o) => o,
                Err(e) => {
                    return Err(format!("skillhub CLI 调用失败: {}", e));
                }
            };
            
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            
            if output.status.success() {
                info!("[skills] skillhub pull {} succeeded", slug);
                return Ok(format!("已安装: {} (via skillhub CLI)", name));
            } else {
                // CLI also failed — return combined error
                let cli_err = format!(
                    "skillhub pull {} 失败: {}",
                    slug,
                    if stderr.is_empty() { stdout.trim().to_string() } else { stderr.trim().to_string() }
                );
                info!("[skills] {}", cli_err);
                return Err(cli_err);
            }
        } else {
            return Err(format!(
                "下载失败: {} (且未找到 skillhub CLI，无法自动安装)",
                last_err.unwrap_or_else(|| "未知错误".to_string())
            ));
        }
    }
    
    info!(
        "[skills] Downloaded {} bytes from {} (valid ZIP)",
        bytes.len(),
        used_url
    );
    
    // Write zip to disk
    let skills_dir = get_skills_dir(&app);
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    
    let temp_zip = skills_dir.join(format!("{}.zip", slug));
    {
        let mut file = fs::File::create(&temp_zip).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    
    // Unzip
    let skill_extract_dir = skills_dir.join(&slug);
    if skill_extract_dir.exists() {
        fs::remove_dir_all(&skill_extract_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&skill_extract_dir).map_err(|e| e.to_string())?;
    
    let file = fs::File::open(&temp_zip).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("解压失败: {}", e))?;
    
    for i in 0..archive.len() {
        let mut zip_file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = skill_extract_dir.join(zip_file.mangled_name());
        
        if zip_file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut zip_file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    
    // Cleanup
    let _ = fs::remove_file(&temp_zip);
    
    Ok(format!("已安装: {}", name))
}

/// Execute: npm install -g {package_name}
/// Falls back to cmd.exe on Windows to handle .cmd/.bat shims automatically.
#[tauri::command]
pub async fn install_skill_via_npm(
    app: tauri::AppHandle,
    package_name: String,
    slug: String,
    name: String,
) -> Result<String, String> {
    info!("[skills] npm install -g {}", package_name);
    
    let output = std::process::Command::new("cmd")
        .args(["/c", "npm", "install", "-g", &package_name])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("npm 命令执行失败: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    if output.status.success() {
        info!("[skills] npm install -g {} succeeded", package_name);
        // 创建 .npm 标记文件，使 get_installed_skills 能识别已安装
        let skills_dir = get_skills_dir(&app);
        let marker_dir = skills_dir.join(&slug);
        if std::fs::create_dir_all(&marker_dir).is_ok() {
            let marker = marker_dir.join(".npm");
            let _ = std::fs::write(&marker, &package_name);
        }
        Ok(format!("已安装: {} (via npm)", name))
    } else {
        let err_msg = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        info!("[skills] npm install -g {} failed: {}", package_name, err_msg);
        Err(format!("npm 安装失败: {}", err_msg))
    }
}
/// Read a skill's SKILL.md content for frontend preview.
pub fn get_skill_readme(app: tauri::AppHandle, slug: String) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let skill_path = skills_dir.join(&slug);
    let readme_path = skill_path.join("SKILL.md");
    if !readme_path.exists() {
        return Err(format!("未找到 SKILL.md ({} 可能未正确安装)", slug));
    }
    std::fs::read_to_string(&readme_path)
        .map_err(|e| format!("读取失败: {}", e))
}

/// Reinstall a local skill from a ZIP, overwriting the existing folder.
pub fn reinstall_skill_local(
    app: tauri::AppHandle,
    slug: String,
    zip_path: String,
) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&slug);

    // Remove existing folder to ensure clean overwrite
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| format!("清理旧技能失败: {}", e))?;
    }

    // Reuse upload logic (no validation, just extract)
    upload_skill_local(app, zip_path, slug)
}

/// Export an installed skill folder to a ZIP file.
pub fn export_skill_zip(
    app: tauri::AppHandle,
    slug: String,
    save_path: String,
) -> Result<String, String> {
    let skills_dir = get_skills_dir(&app);
    let skill_dir = skills_dir.join(&slug);
    if !skill_dir.exists() {
        return Err(format!("技能 '{}' 未安装", slug));
    }

    let file = std::fs::File::create(&save_path)
        .map_err(|e| format!("创建文件失败 ({}): {}", save_path, e))?;
    let mut writer = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut paths: Vec<std::path::PathBuf> = Vec::new();
    collect_files(&skill_dir, &mut paths);

    for p in paths {
        let rel = p.strip_prefix(&skill_dir)
            .map_err(|e| format!("路径错误: {}", e))?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if p.is_dir() {
            writer.add_directory(format!("{}/", rel_str), options)
                .map_err(|e| format!("添加目录失败: {}", e))?;
        } else {
            let data = std::fs::read(&p)
                .map_err(|e| format!("读取 {} 失败: {}", rel_str, e))?;
            writer.start_file(rel_str.as_str(), options)
                .map_err(|e| format!("写入 {} 失败: {}", rel_str, e))?;
            writer.write_all(&data)
                .map_err(|e| format!("写入 {} 失败: {}", rel_str, e))?;
        }
    }

    writer.finish().map_err(|e| format!("打包失败: {}", e))?;
    Ok(format!("技能 '{}' 已导出到 {}", slug, save_path))
}

/// Recursively collect all files under a directory.
fn collect_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.push(path.clone());
                collect_files(&path, out);
            } else {
                out.push(path);
            }
        }
    }
}
