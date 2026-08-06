#![allow(dependency_on_unit_never_type_fallback)]
mod announcement;
mod api_logger;
mod code_runner;
mod config_writer;
mod cron_scheduler;
mod db;
mod gateway;
mod git_ops;
mod mcp;
mod process;
mod session_cleanup;
pub mod binary_parser;
mod skills;
mod terminal;
mod usage;
mod sandbox;
mod orchestrator;
use crate::orchestrator::{run_subagents, summarize_discussion, save_multiagent_session, get_multiagent_sessions, get_multiagent_results, delete_multiagent_session};

use mcp::{McpServer, write_mcp_config_for_tool, read_mcp_config_for_tool};
use gateway::{start_local_gateway, stop_local_gateway, local_gateway_status, get_gateway_local_url, build_gateway_url};
use skills::{get_skills_index, get_skillhub_status, install_skill, ping_skillhub, search_skills, uninstall_skill, get_tool_skills, add_skill_to_index, remove_skill_from_index, upload_skills_json, get_installed_skills, install_skill_from_market, install_skill_via_npm, get_bundled_skills, preview_local_skill, install_local_skill, install_saved_skill};
use session_cleanup::{cleanup_sessions_cache, estimate_cleanable_space};
use usage::ToolUsage;

use db::Database;
use tauri::Manager;
use tauri::Emitter;

use std::os::windows::process::CommandExt;
use std::panic::catch_unwind;
use serde::{Deserialize, Serialize};
use reqwest;

/* ── codexhub:// 自定义协议（Skills中心 一键安装） ── */
#[cfg(windows)]
fn register_codexhub_protocol() {
    let exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return,
    };
    if exe.is_empty() {
        return;
    }
    let command = format!("\"{}\" \"%1\"", exe);
    // HKCU（当前用户，免管理员）注册 codexhub:// 协议
    let _ = std::process::Command::new("cmd")
        .args(["/c", "reg", "add", "HKCU\\Software\\Classes\\codexhub", "/ve", "/t", "REG_SZ", "/d", "URL:codexhub Protocol", "/f"])
        .creation_flags(0x08000000)
        .status();
    let _ = std::process::Command::new("cmd")
        .args(["/c", "reg", "add", "HKCU\\Software\\Classes\\codexhub", "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"])
        .creation_flags(0x08000000)
        .status();
    let _ = std::process::Command::new("cmd")
        .args(["/c", "reg", "add", "HKCU\\Software\\Classes\\codexhub\\shell\\open\\command", "/ve", "/t", "REG_SZ", "/d", &command, "/f"])
        .creation_flags(0x08000000)
        .status();
}

#[derive(Deserialize)]
struct WordPressSkill {
    #[allow(dead_code)] slug: String,
    name: String,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    npm_package: String,
}

/// 从 WordPress Skills中心 拉取技能信息并按可用方式安装
async fn fetch_and_install_skill(app: tauri::AppHandle, slug: String) -> Result<String, String> {
    let url = format!("https://agent.eake.cn/wp-json/ylan/v1/skills/{}", slug);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => {
            let skill: WordPressSkill = r
                .json()
                .await
                .map_err(|e| format!("解析技能信息失败: {}", e))?;
            // 1) 优先 WordPress 自带 download_url
            if !skill.download_url.is_empty() {
                if let Ok(msg) = install_skill_from_market(
                    app.clone(),
                    slug.clone(),
                    skill.name.clone(),
                    skill.download_url.clone(),
                )
                .await
                {
                    return Ok(msg);
                }
            }
            // 2) WordPress 自带 npm_package
            if !skill.npm_package.is_empty() {
                if let Ok(msg) = install_skill_via_npm(
                    app.clone(),
                    skill.npm_package.clone(),
                    slug.clone(),
                    skill.name.clone(),
                )
                .await
                {
                    return Ok(msg);
                }
            }
            // 3) 兜底：从 CodexHub 自有市场（lightmake.site）安装
            install_skill_from_market(app, slug.clone(), skill.name.clone(), "".to_string()).await
        }
        // WordPress 无该技能 → 从 lightmake.site 兜底
        _ => install_skill_from_market(app, slug.clone(), slug.clone(), "".to_string()).await,
    }
}

/// 处理 codexhub://install?slug=xxx 深链
fn handle_codexhub_deeplink(app: tauri::AppHandle, url: String) {
    if !url.starts_with("codexhub://install") {
        return;
    }
    let slug = match url.split("slug=").nth(1) {
        Some(s) => s.split('&').next().unwrap_or("").to_string(),
        None => return,
    };
    if slug.is_empty() {
        return;
    }
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        match fetch_and_install_skill(app_clone.clone(), slug.clone()).await {
            Ok(msg) => {
                let _ = app_clone.emit(
                    "codexhub-toast",
                    serde_json::json!({"message": msg, "success": true}),
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "codexhub-toast",
                    serde_json::json!({"message": format!("安装失败: {}", e), "success": false}),
                );
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 捕获首次启动时的深链参数（codexhub://install?slug=xxx）
    let startup_args: Vec<String> = std::env::args().collect();
    let startup_url = startup_args.iter().find(|a| a.starts_with("codexhub://")).cloned();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app = app.clone();
            // 第二次启动时：根据参数决定行为
            if let Some(url) = args.iter().find(|a| a.starts_with("codexhub://install")) {
                handle_codexhub_deeplink(app.clone(), url.clone());
            } else {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            // z-order 跟随主窗口焦点：主窗口在前→浮窗置顶；切到其他 app→浮窗一起沉底
            if let tauri::WindowEvent::Focused(focused) = event {
                if let Some(overlay) = app.get_webview_window("skill-overlay") {
                    if window.label() == "main" {
                        let _ = overlay.set_always_on_top(*focused);
                    } else if window.label() == "skill-overlay" && *focused {
                        let _ = overlay.set_always_on_top(true);
                    }
                }
            }
            // 主窗口移动/缩放时，技能浮窗持续吸附到主窗口右侧、上下各缩进 5px
            if window.label() == "main" {
                if let tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) = event {
                    if let Some(overlay) = app.get_webview_window("skill-overlay") {
                        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                            let new_y = pos.y;
                            let new_h = size.height.saturating_sub(8);
                            let new_x = pos.x + size.width as i32 - 16;
                            let _ = overlay.set_position(tauri::PhysicalPosition::new(new_x, new_y));
                            let _ = overlay.set_size(tauri::PhysicalSize::new(184, new_h));
                        }
                    }
                }
            }
        })
        .setup(move |app| {
            // 注册 codexhub:// 协议（Windows），使 Skills中心 一键安装可用
            #[cfg(windows)]
            register_codexhub_protocol();
            // 处理首次启动时的深链（codexhub://install?slug=xxx）
            if let Some(url) = startup_url {
                handle_codexhub_deeplink(app.handle().clone(), url);
            }
            let database = Database::init(&app.handle())?;
            // auto-start 网关：在 manage 之前查询（manage 后 database 被 State 吞掉）
            let auto_start_provider = database.get_providers()
                .ok()
                .and_then(|ps| ps.into_iter().find(|p| p.enabled && p.api_key.is_some()));

            // [update-fix] 版本变化自动清理 WebView2 缓存，避免更新后显示旧版
            {
                let current_version = get_app_version();
                let last_version = database.get_setting("last_version").ok().flatten().unwrap_or_default();
                if last_version != current_version {
                    eprintln!("[cache] version changed {} -> {}, cleaning WebView2 cache", last_version, current_version);
                    if let Ok(local_dir) = app.path().app_local_data_dir() {
                        for sub in ["EBWebView", "Cache", "Code Cache", "GPUCache", "WebKit"] {
                            let p = local_dir.join(sub);
                            if p.exists() {
                                let _ = std::fs::remove_dir_all(&p);
                                eprintln!("[cache] removed {}", p.display());
                            }
                        }
                    }
                    let _ = database.set_setting("last_version", &current_version);
                }
            }

            let db_for_scheduler = database.clone();
            app.manage(database);

            // 启动 cron 定时任务调度器
            let scheduler = cron_scheduler::init_scheduler(
                std::sync::Arc::new(parking_lot::Mutex::new(db_for_scheduler)),
            );
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                scheduler.start_all(app_handle).await;
            });

            // 本地网关状态
            let gateway_state = gateway::GatewayState::new();
            // 初始化 app_data_dir
            if let Ok(data_dir) = app.path().app_data_dir() {
                *gateway_state.app_data_dir.write() = data_dir.to_string_lossy().to_string();
                eprintln!("[gateway] app_data_dir set to: {}", data_dir.to_string_lossy());
            } else {
                eprintln!("[gateway] app_data_dir FAILED to get path");
            }
            let gateway_state_arc = gateway_state.clone();
            app.manage(gateway_state);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 系统托盘
            use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                    .item(&tauri::menu::MenuItemBuilder::with_id("show", "显示 CodexHub").build(app)?)
                    .item(&tauri::menu::MenuItemBuilder::with_id("quit", "退出 CodexHub").build(app)?)
                    .build()?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => { app.exit(0); }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── 本地网关自动启动 ──
            if let Some(p) = auto_start_provider {
                let base_url = p.base_url.clone();
                let api_key = p.api_key.clone().unwrap_or_default();
                let port = 7899u16;
                // parse_upstream 直接从 provider base_url 解析出 origin 和 path_prefix
                let (origin, path_prefix) = gateway::parse_upstream(&base_url);
                *gateway_state_arc.upstream_origin.write() = origin.clone();
                *gateway_state_arc.upstream_path_prefix.write() = path_prefix.clone();
                *gateway_state_arc.api_key.write() = api_key;
                *gateway_state_arc.port.write() = port;
                *gateway_state_arc.running.write() = true; // 立即标记运行中
                eprintln!("[gateway] auto-starting on 127.0.0.1:{} (upstream: {}{})", port, origin, path_prefix);
                let gs = gateway_state_arc.clone();
                tauri::async_runtime::spawn(async move {
                    // run_server 内部 spawn 真正的 axum 服务器
                    let handle = gateway::run_server(gs.clone());
                    *gs.handle.write() = Some(handle);
                });
            } else {
                eprintln!("[gateway] no enabled provider found, skipping auto-start");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_providers,
            get_provider,
            add_provider,
            delete_provider,
            set_provider_api_key,
            get_cli_tools,
            get_cli_tools_with_installed,
            get_active_provider_for_tool,
            activate_provider_for_tool,
            get_setting,
            set_setting,
            detect_installed_tools_cmd,
            detect_tools_detail,
            get_all_tool_configs,
            export_all_configs,
            import_all_configs,
            open_url,
            launch_tool,
            // Terminal commands
            terminal::create_terminal_session,
            terminal::write_terminal,
            terminal::close_terminal,
            terminal::resize_terminal,
            terminal::list_terminals,
            // 检测缓存
            save_detection_cache,
            load_detection_cache,
            // Announcement command
            announcement::get_announcement,
            // Skill commands
            get_skillhub_status,
            ping_skillhub,
            get_skills_index,
            search_skills,
            install_skill,
            uninstall_skill,
            get_tool_skills,
            get_bundled_skills,
            add_skill_to_index,
            remove_skill_from_index,
            upload_skills_json,
            get_installed_skills,
            install_skill_from_market,
            install_skill_via_npm,
            preview_local_skill,
            install_local_skill,
            upload_skill_local,
            get_skill_readme,
            reinstall_skill_local,
            export_skill_zip,
            install_saved_skill,
            parse_binary_file,
            // Code runner
            code_runner::execute_code,
            code_runner::save_editor_file,
            code_runner::get_workspace_dir,
            // Sandbox
            sandbox::create_sandbox_session,
            sandbox::execute_sandbox_code,
            sandbox::stop_sandbox,
            sandbox::cleanup_sandbox,
            sandbox::get_sandbox_info,
            sandbox::list_sandbox_sessions,
            // Git operations
            git_ops::get_git_status,
            git_ops::git_commit,
            git_ops::get_git_log,
            git_ops::git_push,
            git_ops::git_pull,
            git_ops::get_git_branches,
            // GitHub commands
            git_ops::git_clone,
            git_ops::get_github_url,
            git_ops::git_init,
            git_ops::git_diff_file,
            // File commands
            read_file_content,
            write_file_content,
            // Workspace commands
            pick_folder,
            get_workspace_dir_config,
            set_workspace_dir,
            read_dir_entries,
            // MCP commands
            get_mcp_servers,
            get_mcp_server,
            add_mcp_server,
            update_mcp_server,
            delete_mcp_server,
            get_mcp_server_tools,
            get_tool_mcp_servers,
            toggle_mcp_server_tool,
            sync_mcp_config,
            read_mcp_config,
            get_mcp_topology,
            start_all_mcp,
            stop_all_mcp,
            start_mcp_server,
            stop_mcp_server,
            // Tool install (TODO: implement)
            // install_tool,
            // Usage stats
            get_usage_stats,
            get_total_usage,
            get_daily_usage,
            // Skill overlay
            get_main_window_rect,
            // 用量与成本
            get_cost_breakdown,
            get_usage_alerts,
            save_usage_alert,
            delete_usage_alert,
            get_current_tool_config,
            // 配置模板
            save_config_template,
            update_config_template,
            delete_config_template,
            apply_config_template,
            // 模型列表
            fetch_provider_models,
            fetch_all_provider_models,
            fetch_provider_models_with_key,
            fetch_provider_models_detailed,
            // 鎼存梻鏁ら幒褍鍩?            exit_app,
            hide_to_tray,
            bring_window_to_front,
            has_detected_before,
            clear_detection_cache,
            install_npm_package,
            get_tool_local_version,
            get_tool_npm_version,
            upgrade_npm_tool,
            upgrade_npm_tool_with_progress,
            install_npm_tool,
            install_npm_tool_with_progress,
            install_download_tool,
            open_install_page,
            diagnose_tool_conflicts,
            check_tool_upgrade,
            uninstall_npm_tool,
            get_app_version,
            check_latest_version,
            download_and_install,
            // Chat commands
            get_tool_api_config,
            get_chat_sessions,
            create_chat_session,
            get_chat_messages,
            send_chat_message,
            rename_chat_session,
            delete_chat_session,
            stream_chat,
            // ===== 定时任务 (cron) =====
            get_cron_jobs,
            add_cron_job,
            toggle_cron_job,
            delete_cron_job,
            // ===== 多Agent协作 (orchestrator) =====
            run_subagents,
            summarize_discussion,
            save_multiagent_session,
            get_multiagent_sessions,
            get_multiagent_results,
            delete_multiagent_session,
            // Provider model
            set_provider_model,
            set_provider_pricing,
            get_provider_default_model,
            // 缓存管理
            clear_all_cache,
            // Session cache cleanup
            estimate_cleanable_space,
            cleanup_sessions_cache,
            // Memory files
            get_memory_files,
            save_memory_file,
            read_file_base64,
            read_file_text,
            capture_screen,
            capture_immediate,
            get_visible_windows,
            delete_memory_file,
            summarize_memory_file,
            // App control
            exit_app,
            // Skill overlay
            toggle_skill_overlay,
            log_skill_invoke,
            get_recent_skill_invokes,
            dedup_skill_invoke_log,
            dedup_skill_invoke_log_all,
            // Local gateway
            start_local_gateway,
            stop_local_gateway,
            local_gateway_status,
            get_gateway_local_url,
            build_gateway_url,
            // GenHub 亚蓝账户
            genhub_login,
            genhub_report_usage,
            // Window control
            maximize_window,
            unmaximize_window,
            is_window_maximized,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


// ===== Settings =====
#[tauri::command]
fn get_setting(key: String, db: tauri::State<'_, Database>) -> Result<Option<String>, String> {
    db.get_setting(&key)
}
#[tauri::command]
fn set_setting(key: String, value: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.set_setting(&key, &value)
}


// ===== Config Import/Export =====
#[tauri::command]
fn export_all_configs(db: tauri::State<'_, Database>) -> Result<String, String> {
    let json: serde_json::Value = db.export_all()?;
    serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
}
#[tauri::command]
fn import_all_configs(data: serde_json::Value, merge: bool, db: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let result = catch_unwind(std::panic::AssertUnwindSafe(|| {
        db.import_all(&data, merge)
    }));
    match result {
        Ok(import_result) => import_result,
        Err(panic_err) => {
            let msg = if let Some(s) = panic_err.downcast_ref::<String>() {
                s.clone()
            } else if let Some(s) = panic_err.downcast_ref::<&str>() {
                s.to_string()
            } else {
                "未知panic".to_string()
            };
            Err(format!("导入时panic: {}", msg))
        }
    }
}

// ===== Provider Activation =====
#[tauri::command]
fn get_cli_tools(db: tauri::State<'_, Database>) -> Result<Vec<db::CliTool>, String> {
    db.get_cli_tools()
}
#[tauri::command]
fn get_cli_tools_with_installed(db: tauri::State<'_, Database>) -> Result<Vec<(db::CliTool, bool)>, String> {
    db.get_cli_tools_with_installed()
}
#[tauri::command]
fn get_active_provider_for_tool(tool_id: String, db: tauri::State<'_, Database>) -> Result<Option<String>, String> {
    db.get_active_provider_for_tool(&tool_id)
}
#[tauri::command]
fn activate_provider_for_tool(tool_id: String, provider_id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    db.activate_provider_for_tool(&tool_id, &provider_id)
}

// ===== Config Template =====
#[tauri::command]
fn save_config_template(name: String, description: String, tool_provider_map: std::collections::HashMap<String, String>, db: tauri::State<'_, Database>) -> Result<db::ConfigTemplate, String> {
    db.save_config_template(&name, &description, &tool_provider_map)
}
#[tauri::command]
fn update_config_template(id: String, name: String, description: String, tool_provider_map: std::collections::HashMap<String, String>, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.update_config_template(&id, &name, &description, &tool_provider_map)
}
#[tauri::command]
fn delete_config_template(id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_config_template(&id)
}
#[tauri::command]
fn apply_config_template(id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    let templates = db.get_config_templates()?;
    let t = templates.into_iter().find(|t| t.id == id).ok_or("template not found")?;
    let mut applied = 0u32;
    for (tool_id, provider_id) in &t.tool_provider_map {
        if db.activate_provider_for_tool(tool_id, provider_id).is_ok() {
            applied += 1;
        }
    }
    Ok(format!("已应用 {} 个工具配置", applied))
}

// ===== Detection Cache =====
#[tauri::command]
fn save_detection_cache(results: Vec<(String, bool)>, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.save_detection_cache(&results)
}
#[tauri::command]
fn load_detection_cache(db: tauri::State<'_, Database>) -> Result<Vec<(String, bool)>, String> {
    db.load_detection_cache()
}

// ===== Tool Management =====
#[tauri::command]
fn has_detected_before(db: tauri::State<'_, Database>) -> Result<bool, String> {
    Ok(db.has_detected_before())
}

#[tauri::command]
fn clear_detection_cache(db: tauri::State<'_, Database>) -> Result<(), String> {
    db.clear_detection_cache()
}

#[tauri::command]
fn install_npm_package(pkg: String) -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("cmd")
        .args(["/c", &format!("npm install -g {}", pkg)])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("执行失败: {}", e))?;
    if output.status.success() {
        Ok(format!("{} 安装成功", pkg))
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("安装失败: {}", err))
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    opener::open(&url).map_err(|e| e.to_string())
}
#[tauri::command]
fn launch_tool(tool_id: String) -> Result<(), String> {
    config_writer::launch_tool(tool_id)
}
#[tauri::command]
fn detect_installed_tools_cmd() -> Vec<String> {
    config_writer::detect_installed_tools()
}
#[tauri::command]
fn detect_tools_detail() -> Vec<config_writer::ToolDetectResult> {
    config_writer::detect_tools_detail()
}

// ===== Version & Upgrade =====
#[tauri::command]
fn get_tool_local_version(tool_id: String) -> Result<String, String> {
    config_writer::get_local_version(&tool_id)
}
#[tauri::command]
async fn get_tool_npm_version(tool_id: String) -> Result<String, String> {
    config_writer::get_npm_latest_version(&tool_id).await
}
#[tauri::command]
fn upgrade_npm_tool(tool_id: String) -> Result<String, String> {
    config_writer::upgrade_tool(&tool_id)
}

/// 带进度的升级
#[tauri::command]
async fn upgrade_npm_tool_with_progress(
    window: tauri::Window,
    tool_id: String,
) -> Result<String, String> {
    config_writer::upgrade_tool_with_progress(&tool_id, Some(&window))
}

#[tauri::command]
fn install_npm_tool(tool_id: String, npm_package: String) -> Result<String, String> {
    config_writer::install_tool(&tool_id, &npm_package)
}

/// 带进度的安装（会发出 tool_install_progress 事件）
#[tauri::command]
async fn install_npm_tool_with_progress(
    window: tauri::Window,
    tool_id: String,
    npm_package: String,
) -> Result<String, String> {
    config_writer::install_tool_with_progress(&tool_id, &npm_package, Some(&window))
}

/// 通过 PowerShell 静默安装 download 类型工具（如 Grok Build）
#[tauri::command]
async fn install_download_tool(
    window: tauri::Window,
    tool_id: String,
    install_url: String,
) -> Result<String, String> {
    config_writer::install_download_tool(&tool_id, &install_url, Some(&window))
}

#[tauri::command]
async fn open_install_page(url: String) -> Result<String, String> {
    use std::process::Stdio;
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(&["/c", "start", "", &url])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match cmd.output() {
        Ok(out) if out.status.success() => Ok(format!("已打开: {}", url)),
        Ok(out) => Err(format!("打开失败: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => Err(format!("打开失败: {}", e)),
    }
}
#[tauri::command]
fn uninstall_npm_tool(tool_id: String) -> Result<String, String> {
    config_writer::uninstall_tool(&tool_id)
}
#[tauri::command]
fn diagnose_tool_conflicts(tool_id: String) -> Result<config_writer::DiagnoseResult, String> {
    config_writer::diagnose_tool_conflicts(&tool_id)
}
#[tauri::command]
async fn check_tool_upgrade(tool_id: String) -> Result<(String, String, bool), String> {
    config_writer::check_tool_upgrade(&tool_id).await
}

#[tauri::command]
fn get_all_tool_configs() -> Vec<config_writer::ToolConfigEntry> {
    config_writer::get_all_tool_configs()
}
#[tauri::command]
fn get_current_tool_config(tool_id: String) -> Option<config_writer::CurrentToolConfig> {
    config_writer::get_current_config(&tool_id)
}

// ===== Provider 管理 =====

#[tauri::command]
fn get_providers(db: tauri::State<'_, Database>) -> Result<Vec<db::Provider>, String> {
    db.get_providers()
}

#[tauri::command]
fn get_provider(id: String, db: tauri::State<'_, Database>) -> Result<Option<db::Provider>, String> {
    db.get_provider(&id)
}

#[tauri::command]
fn add_provider(
    id: String,
    name: String,
    base_url: String,
    icon: String,
    category: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.add_provider(id, name, base_url, icon, category)
}

#[tauri::command]
fn delete_provider(id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_provider(&id)
}

#[tauri::command]
fn set_provider_api_key(
    provider_id: String,
    api_key: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.set_provider_api_key(&provider_id, &api_key)
}

#[tauri::command]
fn set_provider_model(
    provider_id: String,
    model_name: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.set_provider_model(&provider_id, &model_name)
}

#[tauri::command]
fn set_provider_pricing(
    provider_id: String,
    input_price: Option<f64>,
    output_price: Option<f64>,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.set_provider_pricing(&provider_id, input_price, output_price)
}

#[tauri::command]
fn get_provider_default_model(
    provider_id: String,
    db: tauri::State<'_, Database>,
) -> Result<Option<String>, String> {
    Ok(db.get_provider_default_model(&provider_id))
}

/// 从 Provider 的 /v1/models 端点获取模型列表
#[tauri::command]
async fn fetch_provider_models(
    provider_id: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<ModelCapability>, String> {
    let provider = db.get_provider_by_id(&provider_id)?;
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);

    let api_key = provider.api_key.ok_or("该 Provider 未配置 API Key")?;

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API 返回错误: {}", err_text));
    }

    #[derive(serde::Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelInfo>,
    }
    #[derive(serde::Deserialize)]
    struct ModelInfo {
        id: String,
        #[allow(dead_code)]
        name: Option<String>,
    }

    let models: ModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;

    Ok(models.data.into_iter().map(|m| ModelCapability {
        id: m.id,
        name: m.name,
        function_calling: None,
        context_window: None,
        input_modalities: Vec::new(),
        output_modalities: Vec::new(),
    }).collect())
}

/// 从 Provider 的 /v1/models 端点获取模型列表（直接传入 API Key，不依赖数据库）
#[tauri::command]
async fn fetch_provider_models_with_key(
    provider_id: String,
    api_key: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<String>, String> {
    let provider = db.get_provider_by_id(&provider_id)?;
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);
    
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API 返回错误: {}", err_text));
    }
    
    #[derive(serde::Deserialize)]
    struct ModelsResponse {
        data: Vec<ModelInfo>,
    }
    #[derive(serde::Deserialize)]
    struct ModelInfo {
        id: String,
    }
    
    let models: ModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;

    Ok(models.data.into_iter().map(|m| m.id).collect())
}

/// 批量拉取所有有 API Key 的 Provider 的模型列表
#[tauri::command]
async fn fetch_all_provider_models(
    db: tauri::State<'_, Database>,
) -> Result<Vec<ProviderModelsResult>, String> {
    use std::sync::mpsc;

    let providers = db.get_providers()?;
    let client = reqwest::Client::new();

    // 用 channel 收集结果，避免 Arc<Mutex> 的 Debug 问题
    let (tx, rx) = mpsc::channel();

    let handles: Vec<_> = providers
        .into_iter()
        .filter(|p| p.api_key.as_ref().is_some_and(|k| !k.is_empty()))
        .map(|provider| {
            let client = client.clone();
            let tx = tx.clone();
            let api_key = provider.api_key.clone().unwrap();

            std::thread::spawn(move || {
                let base_url = provider.base_url.trim_end_matches('/');
                let url = format!("{}/models", base_url);
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();

                let result = rt.block_on(async {
                    let resp = match client
                        .get(&url)
                        .header("Authorization", format!("Bearer {}", api_key))
                        .timeout(std::time::Duration::from_secs(10))
                        .send()
                        .await
                    {
                        Ok(r) => r,
                        Err(e) => {
                            return ProviderModelsResult {
                                provider_id: provider.id.clone(),
                                provider_name: provider.name.clone(),
                                success: false,
                                error: Some(format!("网络请求失败: {}", e)),
                                models: Vec::new(),
                            };
                        }
                    };

                    let status = resp.status();
                    if !status.is_success() {
                        let err_text = resp.text().await.unwrap_or_default();
                        return ProviderModelsResult {
                            provider_id: provider.id.clone(),
                            provider_name: provider.name.clone(),
                            success: false,
                            error: Some(format!("API {}: {}", status, err_text)),
                            models: Vec::new(),
                        };
                    }

                    #[derive(serde::Deserialize)]
                    struct ModelsResponse { data: Vec<ModelInfo> }
                    #[derive(serde::Deserialize)]
                    struct ModelInfo { id: String, name: Option<String> }

                    match resp.json::<ModelsResponse>().await {
                        Ok(data) => ProviderModelsResult {
                            provider_id: provider.id.clone(),
                            provider_name: provider.name.clone(),
                            success: true,
                            error: None,
                            models: data.data.into_iter().map(|m| ModelCapability {
                                id: m.id,
                                name: m.name,
                                function_calling: None,
                                context_window: None,
                                input_modalities: Vec::new(),
                                output_modalities: Vec::new(),
                            }).collect(),
                        },
                        Err(e) => ProviderModelsResult {
                            provider_id: provider.id.clone(),
                            provider_name: provider.name.clone(),
                            success: false,
                            error: Some(format!("解析失败: {}", e)),
                            models: Vec::new(),
                        },
                    }
                });
                let _ = tx.send(result);
            })
        })
        .collect();

    drop(tx); // 关闭 sender
    let results: Vec<ProviderModelsResult> = rx.into_iter().collect();

    // 按 sort_order 排序（与 providers 顺序一致）
    // handles 在 drop 前 join
    for h in handles {
        let _ = h.join();
    }

    Ok(results)
}

#[derive(serde::Serialize, Debug)]
struct ProviderModelsResult {
    provider_id: String,
    provider_name: String,
    success: bool,
    error: Option<String>,
    models: Vec<ModelCapability>,
}

/// 模型能力信息
#[derive(serde::Serialize, Clone, Debug)]
struct ModelCapability {
    id: String,
    /// 模型显示名称（从 API name 字段获取）
    name: Option<String>,
    /// 是否支持 function calling（从 API features.tools.function_calling 推断）
    function_calling: Option<bool>,
    /// 上下文窗口大小
    context_window: Option<u64>,
    /// 输入模态（text/image/audio/video）
    input_modalities: Vec<String>,
    /// 输出模态
    output_modalities: Vec<String>,
}

/// 从 Provider 获取详细模型列表（含能力信息）
/// 豆包 API 返回 features.tools.function_calling，OpenAI 标准 /v1/models 不返回
/// 能解析到则填，无法解析的为 None
#[tauri::command]
async fn fetch_provider_models_detailed(
    provider_id: String,
    api_key: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<ModelCapability>, String> {
    let provider = db.get_provider_by_id(&provider_id)?;
    let base_url = provider.base_url.trim_end_matches('/');
    let url = format!("{}/models", base_url);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API 返回错误: {}", err_text));
    }

    // 先用 Value 接住，灵活解析豆包/其他 provider
    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析失败: {}", e))?;

    let data = raw.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut out: Vec<ModelCapability> = Vec::with_capacity(data.len());
    for m in data {
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() { continue; }
        let name = m.get("name").and_then(|v| v.as_str()).map(String::from);

        // 豆包结构: features.tools.function_calling
        let function_calling = m
            .get("features")
            .and_then(|f| f.get("tools"))
            .and_then(|t| t.get("function_calling"))
            .and_then(|v| v.as_bool());

        // 备用：如果 features 不存在，但模型名包含 pro/plus/max 也默认标记 true
        let function_calling = function_calling.or_else(|| {
            let lower = id.to_lowercase();
            if lower.contains("-pro") || lower.contains("-plus") || lower.contains("-max")
                || lower.contains("seed-1.6") || lower.contains("seed-2-1") {
                Some(true)
            } else if lower.contains("-lite") || lower.contains("-mini") {
                Some(false)
            } else {
                None
            }
        });

        let context_window = m
            .get("token_limits")
            .and_then(|t| t.get("context_window"))
            .and_then(|v| v.as_u64());

        let input_modalities = m
            .get("modalities")
            .and_then(|m| m.get("input_modalities"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();

        let output_modalities = m
            .get("modalities")
            .and_then(|m| m.get("output_modalities"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();

        out.push(ModelCapability {
            id,
            name,
            function_calling,
            context_window,
            input_modalities,
            output_modalities,
        });
    }

    Ok(out)
}


#[tauri::command]
fn get_usage_stats(db: tauri::State<'_, Database>) -> Vec<ToolUsage> {
    // 从 token_usage_log 表聚合各工具用量
    let tool_ids = ["claude-code","claude-desktop","codex","gemini-cli","opencode","openclaw","hermes-agent","grok-build","qoder-cli","deepseek-cli"];
    let mut result = Vec::new();
    for tid in &tool_ids {
        let (input, output, total) = db.get_token_usage_by_tool(tid).unwrap_or((0,0,0));
        result.push(ToolUsage {
            tool_id: tid.to_string(),
            tool_name: tid.to_string(),
            supported: total > 0,
            total_sessions: 0,
            total_input_tokens: input as u64,
            total_output_tokens: output as u64,
            total_cache_read_tokens: 0,
            total_cache_creation_tokens: 0,
            daily: vec![],
        });
    }
    result
}

#[tauri::command]
fn get_total_usage(db: tauri::State<'_, Database>) -> usage::TotalUsage {
    let tool_ids = ["claude-code","claude-desktop","codex","gemini-cli","opencode","openclaw","hermes-agent","grok-build","qoder-cli","deepseek-cli"];
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut count = 0u64;
    
    for tid in &tool_ids {
        let (input, output, total) = db.get_token_usage_by_tool(tid).unwrap_or((0,0,0));
        if total > 0 {
            total_input += input as u64;
            total_output += output as u64;
            count += 1;
        }
    }
    
    usage::TotalUsage {
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        tool_count: count,
    }
}

#[tauri::command]
fn get_daily_usage(db: tauri::State<'_, Database>, tool_id: String, days: Option<u64>) -> Result<Vec<Vec<serde_json::Value>>, String> {
    let keep_days = days.unwrap_or(7);
    let rows = db.get_daily_token_usage(&tool_id, keep_days)?;
    // Return as array of [date, input_tokens, output_tokens]
    Ok(rows.into_iter().map(|(date, inp, out)| {
        vec![
            serde_json::Value::String(date),
            serde_json::Value::Number(serde_json::Number::from(inp)),
            serde_json::Value::Number(serde_json::Number::from(out)),
        ]
    }).collect())
}

/// 返回各工具的模型级用量明细（前端据此算费用）
#[derive(Serialize)]
struct ModelBreakdown {
    tool_id: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
}

#[tauri::command]
fn get_cost_breakdown(db: tauri::State<'_, Database>) -> Vec<ModelBreakdown> {
    let tool_ids = ["claude-code","claude-desktop","codex","gemini-cli","opencode","openclaw","hermes-agent","grok-build","qoder-cli","deepseek-cli"];
    let mut result = Vec::new();
    for tid in &tool_ids {
        if let Ok(rows) = db.get_model_breakdown(tid) {
            for (model, inp, out) in rows {
                result.push(ModelBreakdown {
                    tool_id: tid.to_string(),
                    model,
                    input_tokens: inp as u64,
                    output_tokens: out as u64,
                });
            }
        }
    }
    result
}

#[tauri::command]
fn toggle_skill_overlay(app: tauri::AppHandle) -> Result<(), String> {
    
    if let Some(window) = app.get_webview_window("skill-overlay") {
        let visible = window.is_visible().map_err(|e| e.to_string())?;
        if visible {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    
    // 创建新窗口
    let _window = tauri::webview::WebviewWindowBuilder::new(
        &app,
        "skill-overlay",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .initialization_script("window.__IS_SKILL_OVERLAY__ = true;")
    .title("技能调用")
    .inner_size(300.0, 500.0)
    .min_inner_size(240.0, 300.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .skip_taskbar(true)
    .background_color(tauri::webview::Color(18, 18, 30, 255))
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn log_skill_invoke(app: tauri::AppHandle, db: tauri::State<'_, Database>, tool_id: String, skill_slug: String, skill_name: String) -> Result<i64, String> {
    // 先插入/检查去重
    let id = match db.log_skill_invoke_dedup(&tool_id, &skill_slug, &skill_name, 5) {
        Ok(id) => id,
        Err(e) => return Err(format!("DB insert failed: {}", e)),
    };
    // 无论是否是重复调用，都要 emit skill-invoked 事件（触发前端高亮和通知）
    let created_at = if id > 0 {
        // 新插入：清理历史重复，获取真实时间
        let _ = db.dedup_skill_invoke_log_all();
        chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
    } else {
        // 重复调用：构造时间（前端不依赖此时间做高亮判断）
        chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
    };
    let payload = serde_json::json!({
        "id": id,
        "tool_id": tool_id.clone(),
        "skill_slug": skill_slug.clone(),
        "skill_name": skill_name.clone(),
        "created_at": created_at,
    });
    // DEBUG: emit 前写日志
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{}\\codexhub_skill_invoke_debug.log", std::env::temp_dir().display()))
        .map(|mut f| {
            use std::io::Write;
            let _ = writeln!(f, "[{}] about to emit skill-invoked, payload={}", chrono::Local::now().format("%H:%M:%S%.3f"), payload);
        });
    let emit_result = app.emit("skill-invoked", payload);
    // DEBUG: emit 后写日志
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{}\\codexhub_skill_invoke_debug.log", std::env::temp_dir().display()))
        .map(|mut f| {
            use std::io::Write;
            let _ = writeln!(f, "[{}] emit result: {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), emit_result);
        });
    // NOTE: 不再创建独立 overlay 窗口，由前端 ChatMain 监听 skill-invoked 事件在聊天区内部渲染通知
    Ok(id)
}



#[tauri::command]
fn get_recent_skill_invokes(db: tauri::State<'_, Database>, limit: Option<u32>) -> Result<Vec<serde_json::Value>, String> {
    let rows = db.get_recent_skill_invokes(limit.unwrap_or(50))?;
    Ok(rows.into_iter().map(|(id, tool_id, slug, name, ts)| {
        serde_json::json!({
            "id": id,
            "tool_id": tool_id,
            "skill_slug": slug,
            "skill_name": name,
            "created_at": ts,
        })
    }).collect())
}

#[tauri::command]
fn dedup_skill_invoke_log(db: tauri::State<'_, Database>, window_secs: Option<i64>) -> Result<usize, String> {
    db.dedup_skill_invoke_log(window_secs.unwrap_or(5))
}

#[tauri::command]
fn dedup_skill_invoke_log_all(db: tauri::State<'_, Database>) -> Result<usize, String> {
    db.dedup_skill_invoke_log_all()
}

#[tauri::command]
fn get_main_window_rect(app: tauri::AppHandle) -> Option<serde_json::Value> {
    app.get_webview_window("main").and_then(|w| {
        let pos = w.outer_position().ok()?;
        let size = w.outer_size().ok()?;
        let x = pos.x as f64;
        let y = pos.y as f64;
        let width = size.width as f64;
        let height = size.height as f64;
        eprintln!("[get_main_window_rect] x={} y={} w={} h={}", x, y, width, height);
        Some(serde_json::json!({
            "x": x,
            "y": y,
            "width": width,
            "height": height
        }))
    })
}

// ===== 用量告警 =====

#[tauri::command]
fn get_usage_alerts(db: tauri::State<'_, Database>) -> Result<Vec<db::UsageAlert>, String> {
    // UsageAlert is in db module, accessible as db::UsageAlert
    db.get_usage_alerts()
}

#[tauri::command]
fn save_usage_alert(
    tool_id: String,
    threshold_percent: i32,
    monthly_limit_tokens: i64,
    enabled: bool,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.save_usage_alert(&tool_id, threshold_percent, monthly_limit_tokens, enabled)
}

#[tauri::command]
fn delete_usage_alert(tool_id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_usage_alert(&tool_id)
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    eprintln!("[exit_app] invoked, calling app.exit(0)");
    app.exit(0);
}

/// WordPress page HTML parsing and version detection
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())
    } else {
        Err("Window not found".to_string())
    }
}

/// 将窗口带到前台
#[tauri::command]
fn bring_window_to_front(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        // 检查并聚焦窗口
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Window not found".to_string())
    }
}

/// 最大化窗口
#[tauri::command]
fn maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.maximize().map_err(|e| e.to_string())
    } else {
        Err("Window not found".to_string())
    }
}

/// 取消最大化窗口
#[tauri::command]
fn unmaximize_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        Err("Window not found".to_string())
    }
}

/// 检查窗口是否最大化
#[tauri::command]
fn is_window_maximized(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.is_maximized().map_err(|e| e.to_string())
    } else {
        Err("Window not found".to_string())
    }
}

// ===== MCP 缁狅紕鎮婇崨鎴掓姢 =====

#[tauri::command]
fn get_mcp_servers(db: tauri::State<'_, Database>) -> Result<Vec<McpServer>, String> {
    db.get_mcp_servers()
}

#[tauri::command]
fn get_mcp_server(id: String, db: tauri::State<'_, Database>) -> Result<Option<McpServer>, String> {
    db.get_mcp_server(&id)
}

#[tauri::command]
fn add_mcp_server(
    id: String,
    name: String,
    transport: String,
    command: Option<String>,
    args: Option<String>,
    url: Option<String>,
    env: Option<String>,
    headers: Option<String>,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.add_mcp_server(id, name, transport, command, args, url, env, headers)
}

#[tauri::command]
fn update_mcp_server(
    id: String,
    name: String,
    transport: String,
    command: Option<String>,
    args: Option<String>,
    url: Option<String>,
    env: Option<String>,
    headers: Option<String>,
    enabled: bool,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.update_mcp_server(&id, name, transport, command, args, url, env, headers, enabled)
}

#[tauri::command]
fn delete_mcp_server(id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_mcp_server(&id)
}

#[tauri::command]
fn get_mcp_server_tools(
    mcp_server_id: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<mcp::McpServerTool>, String> {
    db.get_mcp_server_tools(&mcp_server_id)
}

#[tauri::command]
fn get_tool_mcp_servers(
    tool_id: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<McpServer>, String> {
    db.get_tool_mcp_servers(&tool_id)
}

#[tauri::command]
fn toggle_mcp_server_tool(
    mcp_server_id: String,
    tool_id: String,
    enabled: bool,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.toggle_mcp_server_tool(&mcp_server_id, &tool_id, enabled)
}

/// 同步 MCP 配置到工具目录
#[tauri::command]
fn sync_mcp_config(
    tool_id: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    let servers = db.get_tool_mcp_servers(&tool_id)?;
    write_mcp_config_for_tool(&tool_id, &servers)
}

/// 获取 MCP 拓扑（Server → Tool 关联）
#[tauri::command]
fn get_mcp_topology(db: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    db.get_mcp_topology()
}

/// WordPress page HTML parsing and version detection
#[tauri::command]
fn read_mcp_config(tool_id: String) -> Result<serde_json::Value, String> {
    read_mcp_config_for_tool(&tool_id)
}

/// 一键启动所有 MCP 服务器(真正启动进程)
#[tauri::command]
async fn start_all_mcp(db: tauri::State<'_, Database>) -> Result<String, String> {
    use process::{start_all_enabled, stop_all_running};

    // 先清理旧的运行记录
    let existing = db.get_mcp_servers().unwrap_or_default();
    if existing.iter().any(|s| s.running || s.pid.is_some()) {
        let _ = stop_all_running(existing).await;
    }

    // npx 可用性检测（直接 node 跑 npx-cli.js，绕过 npx.cmd 的 cmd 8.0 解析 bug）
    use process::find_npx_cli_js;
    if let Err(e) = find_npx_cli_js() {
        return Err(format!("❌ npx 不可用 ({})", e));
    }

    let servers = db.get_mcp_servers().unwrap_or_default();
    let (success, failed) = start_all_enabled(servers.clone()).await;

    // 更新数据库中的 PID
    for s in &servers {
        if s.enabled {
            if let Some(pid) = process::MCP_PIDS.get(&s.id) {
                db.set_mcp_process(&s.id, *pid as i64, true).ok();
            }
        }
    }

    if success.is_empty() && failed.is_empty() {
        return Ok("📭 暂无启用的 MCP 服务器".to_string());
    }
    let mut msg = vec![];
    if !success.is_empty() { msg.push(format!("✅ 启动: {}", success.join(", "))); }
    if !failed.is_empty() { msg.push(format!("❌ 失败: {}", failed.join(", "))); }
    Ok(msg.join("\n"))
}

/// 启动单个 MCP 服务器
#[tauri::command]
async fn start_mcp_server(id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    use process::start_mcp_process;

    let servers = db.get_mcp_servers().unwrap_or_default();
    let server = servers.iter().find(|s| s.id == id)
        .ok_or_else(|| format!("MCP 服务器 {} 不存在", id))?;

    if server.transport != "stdio" {
        return Err("仅支持 stdio 类型的 MCP 服务器".to_string());
    }

    let command = server.command.as_ref().ok_or("缺少命令")?;
    let args_str = &server.args;
    let args: Vec<String> = match args_str {
        Some(s) if !s.is_empty() => {
            serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
        }
        _ => vec![],
    };

    let pid = start_mcp_process(&server.id, command, &args).await
        .map_err(|e| format!("启动失败: {}", e))?;

    db.set_mcp_process(&server.id, pid as i64, true).ok();

    Ok(format!("✅ {} 已启动 (PID {})", server.name, pid))
}

/// 停止单个 MCP 服务器
#[tauri::command]
async fn stop_mcp_server(id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    use process::{kill_pid, MCP_PIDS};

    // 1. 先查 in-memory MCP_PIDS；查不到再回退到 DB（处理 app 重启 / npx wrapper 退出等场景）
    let pid: u32 = match MCP_PIDS.get(&id).map(|p| *p) {
        Some(p) => p,
        None => match db.get_mcp_server(&id) {
            Ok(Some(s)) if s.running => match s.pid {
                Some(p) => p,
                None => return Err("进程未运行或 PID 未记录".to_string()),
            },
            _ => return Err("进程未运行或 PID 未记录".to_string()),
        },
    };

    // 2. taskkill 失败（npx wrapper 已退出 / 进程本来就不在了）也视为成功，清理状态
    let killed = kill_pid(pid).await;
    MCP_PIDS.remove(&id);
    db.set_mcp_process(&id, 0, false).ok();

    if killed {
        Ok(format!("✅ 已停止 (PID {})", pid))
    } else {
        Ok(format!("✅ 已停止 (PID {} 已退出)", pid))
    }
}

/// 一键停止所有 MCP 服务器(真正杀掉进程)
#[tauri::command]
async fn stop_all_mcp(db: tauri::State<'_, Database>) -> Result<String, String> {
    use process::stop_all_running;

    let servers = db.get_mcp_servers().unwrap_or_default();
    let stopped = stop_all_running(servers).await;

    // 清除所有 PID 记录
    db.set_all_mcp_enabled(false).ok();
    let all_servers = db.get_mcp_servers().unwrap_or_default();
    for s in all_servers {
        db.clear_mcp_process(&s.id).ok();
    }

    if stopped.is_empty() {
        return Ok("📭 没有正在运行的 MCP 服务器".to_string());
    }
    Ok(format!("⏹ 已停止: {}", stopped.join(", ")))
}

// ===== 聊天功能 =====

#[tauri::command]
fn get_tool_api_config(tool_id: String, db: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let _ = std::panic::catch_unwind(|| {
        eprintln!("[DEBUG] get_tool_api_config called with tool_id='{}'", tool_id);
    });
    db.get_tool_api_config(&tool_id)
}

#[tauri::command]
fn get_chat_sessions(tool_id: String, user_id: Option<i64>, db: tauri::State<'_, Database>) -> Result<Vec<db::ChatSession>, String> {
    db.get_chat_sessions(&tool_id, user_id)
}

#[tauri::command]
fn create_chat_session(tool_id: String, user_id: Option<i64>, db: tauri::State<'_, Database>) -> Result<db::ChatSession, String> {
    db.create_chat_session(&tool_id, user_id)
}

#[tauri::command]
fn get_chat_messages(session_id: String, db: tauri::State<'_, Database>) -> Result<Vec<db::ChatMessage>, String> {
    db.get_chat_messages(&session_id)
}

#[tauri::command]
fn send_chat_message(session_id: String, role: String, content: String, user_id: Option<i64>, db: tauri::State<'_, Database>) -> Result<db::ChatMessage, String> {
    db.send_chat_message(&session_id, &role, &content, user_id)
}

#[tauri::command]
fn rename_chat_session(session_id: String, title: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.rename_chat_session(&session_id, &title)
}

#[tauri::command]
fn delete_chat_session(session_id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_chat_session(&session_id)
}

/// 閼惧嘲褰囨惔鏃傛暏閻楀牊婀伴崣？
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// WordPress page HTML parsing and version detection
#[tauri::command]
async fn check_latest_version() -> Result<serde_json::Value, String> {
    use reqwest;
    let resp = reqwest::get("https://agent.eake.cn/genhub-cn/").await
        .map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;

    // 从产品页提取版本号和下载链接，支持空格/下划线/连字符/%20(URL编码)分隔
    // 关键:必须能匹配 `GenHub_0.1.3_x64-setup.exe` 这种新文件名（2026-07-19 品牌升级）
    // 保留旧名 `CodexHub%20CN_0.0.6_...` 兼容老版本
    // 支持 GenHub_0.1.3 和 CodexHub%20CN_0.1.2（URL编码空格）和 CodexHub CN_0.0.6（普通空格）
    let version_re = regex::Regex::new(r"(?:GenHub|CodexHub(?:[_\s-]|%20|%2D|%5F)+CN)[%_\s-]+v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)").unwrap();
    // 备用正则:匹配页面上 `v0.0.6` 这种显式版本号(hero-badge 里有)
    let v_re = regex::Regex::new(r"\bv([0-9]+\.[0-9]+\.[0-9]+)\b").unwrap();
    let full_url_re = regex::Regex::new(r#"https?://[^ "'<> ]+\.(?:exe|msi|zip)"#).unwrap();
    let rel_path_re = regex::Regex::new(r#"(wp-content/downloads/[^"'<>\s]+\.(?:exe|msi|zip))"#).unwrap();


    // ── BUG-A FIX: 规范化版本号(去掉 v/V  前缀)──
    // 优先匹配文件名(CodexHub%20CN_0.0.6_...),备用匹配页面里的 v0.0.6 文字
    let latest_version = version_re.captures(&body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .or_else(|| v_re.captures(&body).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()))
        .unwrap_or_default();

    let mut download_url = full_url_re.captures(&body)
        .map(|c| c.get(0).unwrap().as_str().to_string())
        .unwrap_or_default();

    // check download_url is empty
    if download_url.is_empty() {
        if let Some(m) = rel_path_re.captures(&body) {
            download_url = format!("https://agent.eake.cn/{}", &m[1]);
        }
    }

    // fallback_url
    let fallback_url = if download_url.is_empty() && !latest_version.is_empty() {
            // 使用新文件名 GenHub（2026-07-19 品牌升级）
            format!("https://agent.eake.cn/wp-content/downloads/GenHub_{}_x64-setup.exe", latest_version)
    } else {
        String::new()
    };

    // URL encode spaces in download_url
    if !download_url.is_empty() {
        download_url = urlencoding::encode(&download_url).into_owned();
    }

    Ok(serde_json::json!({
        "version": latest_version,
        "download_url": if download_url.is_empty() { fallback_url } else { download_url }
    }))
}

/// WordPress page HTML parsing and version detection
/// Downloads and installs a new version of the app.
#[tauri::command]
async fn download_and_install(window: tauri::Window, url: String) -> Result<String, String> {
    use std::process::Command;
    use futures_util::StreamExt;

    if url.is_empty() {
        return Err("Download URL is empty".to_string());
    }

    // 写入到系统临时目录（避免安装目录文件锁问题）
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let tmp_dir = std::env::temp_dir();
    let tmp = tmp_dir.join(format!("GenHub_update_{}.exe", timestamp));
    println!("[update] Downloading to: {}", tmp.display());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    // Emit start
    let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": 0, "status": "starting"}));

    let resp = client.get(&url).send().await.map_err(|e| {
        let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": e.to_string()}));
        e.to_string()
    })?;

    let total_size = resp.content_length().unwrap_or(0);
    println!("[update] Total size: {} bytes", total_size);

    // 先下载到内存，再一次写入文件（避免流式写入时的文件损坏）
    println!("[update] Downloading to memory...");
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut data = Vec::new();
    if total_size > 0 {
        data.reserve(total_size as usize);
    }

    // Emit progress: 0%
    let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": 0, "downloaded": 0, "total": total_size}));

    while let Some(item) = stream.next().await {
        let chunk = match item {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("下载中断: {} (已下载 {} bytes)", e, downloaded);
                let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
                return Err(err_msg);
            }
        };
        downloaded += chunk.len() as u64;
        data.extend_from_slice(&chunk);

        if total_size > 0 {
            let pct = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = window.emit("codexhub_download_progress", serde_json::json!({
                "progress": pct,
                "downloaded": downloaded,
                "total": total_size
            }));
        }
    }

    println!("[update] Downloaded {} bytes to memory, now writing to file...", data.len());

    // 一次写入文件
    if let Err(e) = std::fs::write(&tmp, &data) {
        let err_msg = format!("写入文件失败: {} (路径: {})", e, tmp.display());
        let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
        return Err(err_msg);
    }
    println!("[update] Download complete: {} bytes", downloaded);

    // 验证文件大小
    if total_size > 0 && downloaded != total_size {
        let err_msg = format!("下载不完整: 期望 {} bytes, 实际 {} bytes", total_size, downloaded);
        let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
        return Err(err_msg);
    }
    // 验证文件是否存在且可读
    match std::fs::metadata(&tmp) {
        Ok(meta) => {
            if meta.len() != downloaded {
                let err_msg = format!("文件大小不匹配: 期望 {} bytes, 文件系统显示 {} bytes", downloaded, meta.len());
                let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
                return Err(err_msg);
            }
            println!("[update] File verified: {} bytes on disk", meta.len());
        }
        Err(e) => {
            let err_msg = format!("无法读取下载文件: {}", e);
            let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
            return Err(err_msg);
        }
    }

    // [update-fix] SHA256 完整性校验（向后兼容：无 .sha256 文件则跳过）
    {
        let sha_url = format!("{}.sha256", url);
        println!("[update] Fetching checksum: {}", sha_url);
        if let Ok(sha_resp) = client.get(&sha_url).send().await {
            if let Ok(sha_body) = sha_resp.text().await {
                let expected = sha_body.split_whitespace().next().unwrap_or("").to_string();
                if !expected.is_empty() {
                    use sha2::{Digest, Sha256};
                    let mut hasher = Sha256::new();
                    hasher.update(&data);
                    let actual = hex::encode(hasher.finalize());
                    if actual.eq_ignore_ascii_case(&expected) {
                        println!("[update] SHA256 verified: {}", actual);
                    } else {
                        let err_msg = format!("SHA256 校验失败: 期望 {} 实际 {}", expected, actual);
                        let _ = std::fs::remove_file(&tmp);
                        let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
                        return Err(err_msg);
                    }
                }
            }
        } else {
            println!("[update] No .sha256 file, skip checksum (backward compatible)");
        }
    }

    // 验证 PE 头（合法可执行文件必须以 MZ 开头）
    match std::fs::read(&tmp) {
        Ok(bytes) if bytes.len() >= 2 && &bytes[0..2] == b"MZ" => {
            println!("[update] PE header verified");
        }
        Ok(bytes) => {
            let err_msg = format!("下载文件不是合法可执行文件（头部: {:?}），请重试", &bytes[..bytes.len().min(4)]);
            let _ = std::fs::remove_file(&tmp);
            let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
            return Err(err_msg);
        }
        Err(e) => {
            let err_msg = format!("读取下载文件失败（可能被 Defender 锁定）: {}", e);
            let _ = std::fs::remove_file(&tmp);
            let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
            return Err(err_msg);
        }
    }

    // Emit completion
    let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": 100, "status": "installing"}));

    // 启动安装程序 - 尝试直接启动，如果失败则提示用户手动安装
    println!("[update] Starting installer: {}", tmp.display());
    let ext = tmp.extension().and_then(|e| e.to_str()).unwrap_or("");
    // 尝试用 PowerShell 先解除文件锁定（如果 Defender 已标记）
    println!("[update] Attempting to unblock file...");
    let unblock_result = Command::new("powershell")
        .args(["-Command", &format!("Unblock-File -Path '{}' -ErrorAction SilentlyContinue", tmp.display())])
        .output();
    if let Ok(output) = unblock_result {
        println!("[update] Unblock output: {}", String::from_utf8_lossy(&output.stdout));
    }
    
    let result = if ext == "msi" {
        Command::new("msiexec")
            .args(["/i", tmp.to_str().unwrap(), "/quiet", "/qn"])
            .spawn()
    } else {
        // 尝试直接启动
        Command::new(&tmp)
            .spawn()
    };
    
    match result {
        Ok(child) => {
            println!("[update] Installer started successfully");
            let _ = child;
        }
        Err(e) => {
            let err_str = e.to_string();
            println!("[update] Failed to start installer: {}", err_str);
            // 如果是因为 Defender 锁定，提供手动安装选项
            if err_str.contains("1392") || err_str.contains("corrupted") {
                let manual_msg = format!(
                    "自动安装被 Windows Defender 阻止。请手动运行: {}",
                    tmp.display()
                );
                let _ = window.emit("codexhub_download_progress", serde_json::json!({
                    "progress": 100, 
                    "status": "manual_required",
                    "message": &manual_msg,
                    "path": tmp.to_str().unwrap()
                }));
                // 打开文件所在目录
                let _ = Command::new("explorer.exe")
                    .args(["/select,", tmp.to_str().unwrap()])
                    .spawn();
                return Ok(format!("下载完成。请手动运行: {}", tmp.display()));
            }
            let err_msg = format!("启动安装程序失败: {}", err_str);
            let _ = window.emit("codexhub_download_progress", serde_json::json!({"progress": -1, "error": &err_msg}));
            return Err(err_msg);
        }
    }
    // _child 故意不 .wait(),让安装包在后台跑

    println!("[update] Installer started, waiting 5s for installation to complete...");

    // 在子线程中:等5秒(给安装包足够时间完成)→ 启动新实例 → 等2秒确认 → 退出当前进程
    let exe_path = std::env::current_exe().unwrap();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        match std::process::Command::new(&exe_path).spawn() {
            Ok(_) => {
                println!("[update] New instance spawned successfully, exiting old in 2s...");
            }
            Err(e) => {
                println!("[update] Failed to spawn new instance: {}, trying again in 3s...", e);
                std::thread::sleep(std::time::Duration::from_secs(3));
                let _ = std::process::Command::new(&exe_path).spawn();
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
        std::process::exit(0);
    });

    Ok("Download complete. GenHub will restart shortly.".to_string())

}

#[tauri::command]
fn clear_all_cache(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Database>();
    db.clear_all_cache()
}

/// 解析消息内容中的 Markdown 图片(data URL)，转为 OpenAI 结构化格式
fn build_content_with_images(content: &str) -> serde_json::Value {
    use regex::Regex;
    let re = Regex::new(r"!\[.*?\]\((data:image/[^)]+)\)").unwrap();
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let mut last_end = 0;
    let mut has_images = false;

    for cap in re.captures_iter(content) {
        let m = cap.get(0).unwrap();
        let data_url = cap.get(1).unwrap().as_str();
        // 图片前的文本
        let text_before = &content[last_end..m.start()];
        let trimmed = text_before.trim();
        if !trimmed.is_empty() {
            parts.push(serde_json::json!({"type": "text", "text": trimmed}));
        }
        // 图片
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": data_url }
        }));
        last_end = m.end();
        has_images = true;
    }
    // 最后剩余的文本
    let text_after = &content[last_end..];
    let trimmed = text_after.trim();
    if !trimmed.is_empty() {
        parts.push(serde_json::json!({"type": "text", "text": trimmed}));
    }

    if has_images {
        serde_json::Value::Array(parts)
    } else {
        serde_json::Value::String(content.to_string())
    }
}

/// 推断模型是否支持 function calling
/// - 名称含 lite/mini: false（实测豆包 lite 忽略 tools 字段）
/// - 名称含 pro/plus/max/seed-1.6/seed-2-1: true
/// - 其他: 乐观默认 true（未明确不包含 lite 也不报错）
fn model_supports_function_calling(model: &str) -> bool {
    let lower = model.to_lowercase();
    if lower.contains("lite") || lower.contains("mini") || lower.contains("nano") {
        return false;
    }
    if lower.contains("pro")
        || lower.contains("plus")
        || lower.contains("max")
        || lower.contains("seed-1.6")
        || lower.contains("seed-2-1")
        || lower.contains("gpt-4")
        || lower.contains("claude-3")
        || lower.contains("claude-4")
    {
        return true;
    }
    // 未知模型: 乐观默认 true
    true
}

/// 流式聊天 - 通过 OpenClaw Gateway 调用 LLM API
#[tauri::command]
async fn stream_chat(
    window: tauri::Window,
    session_id: String,
    tool_id: String,
    new_message: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    use reqwest::Client;
    use futures_util::StreamExt;
    use tauri::Emitter;

    // 获取 API 配置
    let config = db.get_tool_api_config(&tool_id)?;
    let api_key = config["api_key"].as_str().ok_or("missing api_key")?.to_string();
    let base_url = config["base_url"].as_str().ok_or("missing base_url")?.to_string();
    let model = config["model"].as_str().ok_or("missing model")?.to_string();

    // 保存用户消息
    db.send_chat_message(&session_id, "user", &new_message, None)?;

    // 拼装系统提示：告知 AI 当前可用的 skill 列表，约定 <skill:slug> 标签表示调用
    let installed_skills = skills::get_installed_skills(window.app_handle().clone()).unwrap_or_default();
    let skills_list = installed_skills.iter()
        .filter(|s| !s.saved_only)
        .map(|s| format!("- slug=`{}`", s.slug))
        .collect::<Vec<_>>()
        .join("\n");
    let mut system_prompt = if !skills_list.is_empty() {
        format!(
            "你是 GenHub AI 助手。本地环境提供以下技能（按需调用，函数调用接口）：\n{}\n\n\
            【调用规则】\n\
            1. 当用户请求使用上述任何技能（例如「帮我查 polymarket」、「用 polymarket 查个市场」、「查一下 Polymarket」），\n\
               你**必须**通过 function calling 调用相应的 skill 函数（系统已自动为每个技能提供 function calling 工具）。\n\
            2. 调用完函数后，再用自然语言告诉用户调用结果或开始执行。\n\
            3. 如果用户的需求不需调用任何技能（只是问答/聊天），**不要**调用函数。\n\n\
            【示例】\n\
            - 用户：帮我用 polymarket 查个市场\n\
            - ✅ 正确：调用 skill_polymarket 函数，同时回复「好的，我帮你查询 polymarket 上的市场...」\n\
            - ❌ 错误：直接在文本中回复「已成功唤起 polymarket 技能」而不调用函数",
            skills_list
        )
    } else {
        "你是 GenHub AI 助手。当前没有安装任何本地技能，直接回答用户问题即可。".to_string()
    };

    // 追加记忆更新指令
    system_prompt.push_str("\n\n\
【记忆功能】\n\
当用户在对话中透露了值得长期记住的信息（技术偏好、项目约定、个人习惯等），\
你可以在回复中用 [记忆: 一句话总结] 的格式记录下来。\
系统会自动将其存入你的持久记忆。\
例如：用户说「我更喜欢用 pnpm 而不是 npm」→ 回复末尾加上 [记忆: 用户偏好 pnpm 作为包管理器]");

    // 加载工具专属记忆文件（如 ~/.hermes/AGENTS.md、SOUL.md 等），注入到 system prompt
    if let Some(mem_files) = memory_files_for_tool(&tool_id) {
        let mut mem_content = String::new();
        for (name, path) in &mem_files {
            if let Ok(content) = std::fs::read_to_string(path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    mem_content.push_str(&format!("\n\n<!-- {} -->\n{}", name, trimmed));
                }
            }
        }
        if !mem_content.is_empty() {
            system_prompt = format!("{}{}", system_prompt, mem_content);
        }
    }

    // 获取历史消息
    let messages = db.get_chat_messages(&session_id)?;
    let mut chat_history: Vec<serde_json::Value> = vec![
        serde_json::json!({"role": "system", "content": system_prompt}),
    ];
    for m in messages.iter() {
        let content = if m.role == "user" {
            build_content_with_images(&m.content)
        } else {
            serde_json::Value::String(m.content.clone())
        };
        chat_history.push(serde_json::json!({
            "role": m.role,
            "content": content
        }));
    }

    // 构建请求
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    // 为每个已安装 skill 构造一个 OpenAI function calling tool 定义
    let tools_json: Vec<serde_json::Value> = installed_skills.iter()
        .filter(|s| !s.saved_only)
        .map(|s| serde_json::json!({
            "type": "function",
            "function": {
                "name": format!("skill_{}", s.slug.replace('-', "_")),
                "description": format!("调用本地技能 `{}`。当用户请求使用此技能时调用本函数。", s.slug),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "用户原始请求内容"}
                    },
                    "required": ["query"]
                }
            }
        }))
        .collect();
    let mut body_map = serde_json::Map::new();
    body_map.insert("model".to_string(), serde_json::Value::String(model.clone()));
    body_map.insert("messages".to_string(), serde_json::Value::Array(chat_history));
    body_map.insert("stream".to_string(), serde_json::Value::Bool(true));
    body_map.insert("stream_options".to_string(), serde_json::json!({"include_usage": true}));
    if !tools_json.is_empty() && model_supports_function_calling(&model) {
        body_map.insert("tools".to_string(), serde_json::Value::Array(tools_json));
        body_map.insert("tool_choice".to_string(), serde_json::Value::String("auto".to_string()));
    }
    let body = serde_json::Value::Object(body_map);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let req = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body);

    let resp = req.send().await.map_err(|e| {
        let _ = window.emit("chat_error", serde_json::json!({"error": e.to_string()}));
        format!("请求 API 失败: {}", e)
    })?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        let _ = window.emit("chat_error", serde_json::json!({"error": err_text.clone()}));
        return Err(format!("API 返回错误: {}", err_text));
    }

    // 流式读取响应
    let mut stream = resp.bytes_stream();
    let mut assistant_content = String::new();
    let mut buffer = String::new();
    let mut usage_input: i64 = 0;
    let mut usage_output: i64 = 0;
    let mut usage_total: i64 = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            let _ = window.emit("chat_error", serde_json::json!({"error": e.to_string()}));
            format!("读取流失败: {}", e)
        })?;

        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // 解析 SSE 格式
        while let Some(pos) = buffer.find("\n\n") {
            let line = buffer[..pos].to_string();
            buffer = buffer[pos + 2..].to_string();

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("content")).and_then(|c| c.as_str()) {
                        assistant_content.push_str(delta);
                        // 扫描检测 <skill:slug> 标签，触发 log_skill_invoke 后从内容中剥除（备用机制）
                        let re = regex::Regex::new(r"<skill:([a-zA-Z0-9_-]+)>").unwrap();
                        let mut found_skills: Vec<String> = Vec::new();
                        let cleaned: String = re.replace_all(&assistant_content, |caps: &regex::Captures| {
                            let slug = caps.get(1).unwrap().as_str().to_string();
                            if !found_skills.contains(&slug) {
                                found_skills.push(slug);
                            }
                            String::new()  // 替换为空字符串
                        }).into_owned();
                        // 触发后台技能调用（不在主 UI 上等待）
                        for slug in &found_skills {
                            let app_clone = window.app_handle().clone();
                            let tool_id_clone = tool_id.clone();
                            let slug_owned = slug.clone();
                            std::thread::spawn(move || {
                                let db = app_clone.state::<Database>();
                                let _ = log_skill_invoke(app_clone.clone(), db, tool_id_clone, slug_owned.clone(), slug_owned);
                            });
                        }
                        // 推送清洗后的内容到前端
                        let _ = window.emit("chat_token", serde_json::json!({"content": cleaned}));
                    }
                    // 解析 tool_calls 字段（OpenAI function calling）：AI 真正调工具时发出
                    if let Some(tool_calls) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")).and_then(|d| d.get("tool_calls")).and_then(|t| t.as_array()) {
                        for tc in tool_calls {
                            if let Some(fname) = tc.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()) {
                                // 函数名是 skill_<slug> 格式，提取 slug
                                let slug = fname.strip_prefix("skill_").unwrap_or(fname).replace('_', "-");
                                let app_clone = window.app_handle().clone();
                                let tool_id_clone = tool_id.clone();
                                let slug_owned = slug.clone();
                                std::thread::spawn(move || {
                                    let db = app_clone.state::<Database>();
                                    let _ = log_skill_invoke(app_clone.clone(), db, tool_id_clone, slug_owned.clone(), slug_owned);
                                });
                            }
                        }
                    }
                    // 解析 usage（通常在最后一个 chunk）
                    if let Some(u) = json.get("usage") {
                        usage_input = u.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(usage_input);
                        usage_output = u.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(usage_output);
                        usage_total = u.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(usage_total);
                    }
                }
            }
        }
    }

    // 扫描 [记忆: ...] 标签并存入持久记忆
    let remember_re = regex::Regex::new(r"\[记忆:\s*([^\]]+)\]").unwrap();
    let mut facts_to_remember: Vec<String> = Vec::new();
    let mut cleaned_content = assistant_content.clone();
    for caps in remember_re.captures_iter(&assistant_content) {
        if let Some(fact) = caps.get(1) {
            let fact_str = fact.as_str().trim();
            if !fact_str.is_empty() {
                facts_to_remember.push(format!("- {}", fact_str));
            }
        }
    }
    // 从显示内容中剥除标签
    if !facts_to_remember.is_empty() {
        cleaned_content = remember_re.replace_all(&cleaned_content, "").to_string();
        // 清理多余空行
        cleaned_content = cleaned_content.trim().to_string();
        // 写入工具专属 MEMORY.md
        if let Some(mem_files) = memory_files_for_tool(&tool_id) {
            if let Some((_, mem_path)) = mem_files.iter().find(|(name, _)| name == "MEMORY.md") {
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(mem_path)
                {
                    use std::io::Write;
                    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M");
                    let _ = writeln!(file, "");
                    for fact in &facts_to_remember {
                        let _ = writeln!(file, "{}", fact);
                    }
                    let _ = file.flush();
                    let _ = window.emit("memory_updated", serde_json::json!({
                        "tool_id": tool_id,
                        "count": facts_to_remember.len(),
                        "time": timestamp.to_string(),
                    }));
                }
            }
        }
    }

    // 保存助手回复（使用清洗后的内容）
    db.send_chat_message(&session_id, "assistant", &cleaned_content, None)?;

    // 记录 Token 用量
    if usage_total > 0 {
        let _ = db.log_token_usage(&tool_id, &session_id, &model, usage_input, usage_output, usage_total);
    }

    // 发送完成事件
    // 先发送 chat-finished 事件，让前端清除技能调用高亮状态
    let _ = window.emit("chat-finished", serde_json::json!({"tool_id": tool_id.clone()}));
    let _ = window.emit("chat_done", serde_json::json!({"content": cleaned_content}));

    Ok(())
}

// ===== Memory Files =====

/// 记忆文件信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct MemoryFile {
    name: String,
    path: String,
    content: String,
    modified: String,
    size: usize,
}

/// 各工具的记忆文件路径映射
fn memory_files_for_tool(tool_id: &str) -> Option<Vec<(String, String)>> {
    let home = dirs::home_dir()?;
    match tool_id {
        "claude-code" => Some(vec![
            ("CLAUDE.md".into(), home.join("CLAUDE.md").to_string_lossy().into()),
            ("MEMORY.md".into(), home.join(".claude").join("MEMORY.md").to_string_lossy().into()),
        ]),
        "openclaw" => Some(vec![
            ("AGENTS.md".into(), home.join(".openclaw").join("AGENTS.md").to_string_lossy().into()),
            ("SOUL.md".into(), home.join(".openclaw").join("SOUL.md").to_string_lossy().into()),
            ("MEMORY.md".into(), home.join(".openclaw").join("MEMORY.md").to_string_lossy().into()),
            ("USER.md".into(), home.join(".openclaw").join("USER.md").to_string_lossy().into()),
            ("TOOLS.md".into(), home.join(".openclaw").join("TOOLS.md").to_string_lossy().into()),
        ]),
        "hermes-agent" => Some(vec![
            ("AGENTS.md".into(), home.join(".hermes").join("AGENTS.md").to_string_lossy().into()),
            ("SOUL.md".into(), home.join(".hermes").join("SOUL.md").to_string_lossy().into()),
            ("MEMORY.md".into(), home.join(".hermes").join("MEMORY.md").to_string_lossy().into()),
            ("USER.md".into(), home.join(".hermes").join("USER.md").to_string_lossy().into()),
        ]),
        _ => None,
    }
}

#[tauri::command]
fn get_memory_files(tool_id: String) -> Result<Vec<MemoryFile>, String> {
    let files = memory_files_for_tool(&tool_id)
        .ok_or_else(|| format!("工具 {} 不支持记忆文件", tool_id))?;

    let mut result = Vec::new();
    for (name, path) in files {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let metadata = std::fs::metadata(&path).ok();
        let modified = metadata
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let datetime: chrono::DateTime<chrono::Local> = t.into();
                datetime.format("%Y-%m-%d %H:%M").to_string()
            })
            .unwrap_or_else(|| "-".into());
        let size = content.len();
        result.push(MemoryFile {
            name,
            path,
            content,
            modified,
            size,
        });
    }
    Ok(result)
}

/// 读取本地文件并返回 base64 编码（用于 Tauri WebView 中 File API 受限时的替代方案）
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文本文件失败: {}", e))
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(base64_encode(&bytes))
}

/// 标准库手写 base64 编码（避免引入额外依赖）
fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// 截取主屏幕并返回 data URL（供前端插入到聊天输入预览区）
#[tauri::command]
fn capture_screen(app: tauri::AppHandle) -> Result<String, String> {
    use screenshots::Screen;

    // 1) 隐藏主窗口，避免截到自己（深色窗口缩略图）
    let main_window = app.get_webview_window("main");
    if let Some(ref w) = main_window {
        let _ = w.hide();
    }

    // RAII guard：函数任何路径 return 都会恢复窗口
    struct WindowGuard(Option<tauri::WebviewWindow>);
    impl Drop for WindowGuard {
        fn drop(&mut self) {
            if let Some(ref w) = self.0 {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
    let _guard = WindowGuard(main_window);

    // 2) 等屏幕重新绘制（OS 异步合成，最少 300ms）
    std::thread::sleep(std::time::Duration::from_millis(400));

    // 3) 截屏
    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;
    if screens.is_empty() {
        return Err("未检测到可用屏幕".to_string());
    }
    let img = screens[0]
        .capture()
        .map_err(|e| format!("截屏失败: {}", e))?;

    // 4) 编码 PNG → base64
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("codexhub_capture_{}.png", secs));
    image::DynamicImage::ImageRgba8(img)
        .save(&tmp)
        .map_err(|e| format!("保存截屏失败: {}", e))?;
    let bytes = std::fs::read(&tmp).map_err(|e| format!("读取截屏失败: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(format!("data:image/png;base64,{}", base64_encode(&bytes)))
}

//// 直接截图：不隐藏窗口，不等待，立刻截全屏并返回 base64
#[tauri::command]
fn capture_immediate() -> Result<String, String> {
    use screenshots::Screen;

    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;
    if screens.is_empty() {
        return Err("未检测到可用屏幕".to_string());
    }
    let img = screens[0]
        .capture()
        .map_err(|e| format!("截屏失败: {}", e))?;

    // 编码 PNG → base64
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("codexhub_capture_{}.png", secs));
    image::DynamicImage::ImageRgba8(img)
        .save(&tmp)
        .map_err(|e| format!("保存截屏失败: {}", e))?;
    let bytes = std::fs::read(&tmp).map_err(|e| format!("读取截屏失败: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(format!("data:image/png;base64,{}", base64_encode(&bytes)))
}

#[derive(serde::Serialize)]
struct WindowInfo {
    hwnd: String,
    title: String,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[tauri::command]
fn get_visible_windows() -> Result<Vec<WindowInfo>, String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowRect, IsWindowVisible,
        GetWindow, GW_OWNER,
    };
    use std::sync::Mutex;

    let windows: Mutex<Vec<WindowInfo>> = Mutex::new(Vec::new());

    use windows::Win32::Foundation::BOOL;
    unsafe extern "system" fn enum_proc(hwnd_raw: HWND, lparam: windows::Win32::Foundation::LPARAM) -> BOOL {
        let guard = &*(lparam.0 as *const Mutex<Vec<WindowInfo>>);
        if let Ok(mut w) = guard.lock() {
            if !IsWindowVisible(hwnd_raw).as_bool() { return BOOL(1); }
            let mut title_buf = [0u16; 512];
            let len = GetWindowTextW(hwnd_raw, &mut title_buf);
            if len == 0 { return BOOL(1); }
            let title = String::from_utf16_lossy(&title_buf[..len as usize]);
            if title.trim().is_empty() { return BOOL(1); }
            let owner = GetWindow(hwnd_raw, GW_OWNER);
            if owner.is_ok() && owner.unwrap().0 != std::ptr::null_mut() { return BOOL(1); }
            let mut rect = RECT::default();
            if GetWindowRect(hwnd_raw, &mut rect).is_err() { return BOOL(1); }
            let w2 = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w2 < 50 || h < 30 { return BOOL(1); }
            w.push(WindowInfo {
                hwnd: format!("{:p}", hwnd_raw.0),
                title,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            });
        }
        BOOL(1)
    }

    unsafe {
        let lparam = windows::Win32::Foundation::LPARAM(&windows as *const _ as isize);
        let _ = EnumWindows(Some(enum_proc), lparam);
    }

    let mut w = windows.into_inner().map_err(|e| format!("lock error: {}", e))?;
    w.sort_by(|a, b| {
        let area_a = ((a.right - a.left) * (a.bottom - a.top)) as i64;
        let area_b = ((b.right - b.left) * (b.bottom - b.top)) as i64;
        area_b.cmp(&area_a)
    });
    w.truncate(50);
    Ok(w)
}

#[tauri::command]
fn save_memory_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("保存失败: {}", e))
}

#[tauri::command]
fn delete_memory_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    // 二次保险：限制只能删除 .md / CLAUDE.md / MEMORY.md 等记忆文件
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !name.ends_with(".md") {
        return Err(format!("仅允许删除 .md 记忆文件，拒绝删除: {}", name));
    }
    std::fs::remove_file(p)
        .map_err(|e| format!("删除失败: {}", e))
}

#[tauri::command]
async fn summarize_memory_file(file_content: String, tool_id: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    // 获取 API 配置
    let config = db.get_tool_api_config(&tool_id)?;
    let api_key = config["api_key"].as_str().ok_or("missing api_key")?.to_string();
    let base_url = config["base_url"].as_str().ok_or("missing base_url")?.to_string();
    let model = config["model"].as_str().ok_or("missing model")?.to_string();

    let prompt = format!("你是一个专业的记忆文件分析助手。请分析以下记忆文件的内容，提取关键信息并按结构化方式重写。\n\n要求：\n1. 提取所有事实性信息（用户身份、偏好、技术栈、项目背景等）\n2. 按类别整理（如：身份信息、技术偏好、项目信息、行为准则）\n3. 删除过期或重复内容\n4. 保持简洁、清晰\n5. 如果内容已有良好结构，只补充缺失的关键信息\n\n记忆文件内容：\n```\n{}\n```", file_content);

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": false
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 API 失败: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("API 返回错误: {}", err_text));
    }

    let result: serde_json::Value = resp.json().await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = result["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("API 返回格式异常")?
        .to_string();

    Ok(content)
}

#[tauri::command]
fn upload_skill_local(app: tauri::AppHandle, zip_path: String, slug: String) -> Result<String, String> {
    skills::upload_skill_local(app, zip_path, slug)
}

#[tauri::command]
fn get_skill_readme(app: tauri::AppHandle, slug: String) -> Result<String, String> {
    skills::get_skill_readme(app, slug)
}

#[tauri::command]
fn reinstall_skill_local(app: tauri::AppHandle, slug: String, zip_path: String) -> Result<String, String> {
    skills::reinstall_skill_local(app, slug, zip_path)
}

#[tauri::command]
fn export_skill_zip(app: tauri::AppHandle, slug: String, save_path: String) -> Result<String, String> {
    skills::export_skill_zip(app, slug, save_path)
}

#[tauri::command]
fn parse_binary_file(path: String) -> Result<String, String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "pdf" => binary_parser::parse_pdf(&path),
        "docx" => binary_parser::parse_docx(&path),
        "pptx" | "pptm" => binary_parser::parse_pptx(&path),
        "xlsx" | "xlsm" => binary_parser::parse_xlsx(&path),
        _ => Err(format!(
            "不支持的文件格式: .{}\n目前支持: PDF (.pdf), Word (.docx), PPT (.pptx / .pptm), Excel (.xlsx / .xlsm)",
            ext
        )),
    }
}

// ===== GenHub 亚蓝账户 =====
#[tauri::command]
fn genhub_login(username: String, password: String) -> Result<String, String> {
    use std::io::Read;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    let payload = serde_json::json!({"username": username, "password": password});
    let mut resp = client.post("https://agent.eake.cn/wp-json/ylan/v1/login")
        .json(&payload)
        .send()
        .map_err(|e| format!("登录请求失败: {}", e))?;
    let mut body = String::new();
    resp.read_to_string(&mut body).map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
fn genhub_report_usage(report_token: String, db: tauri::State<'_, Database>) -> Result<String, String> {
    use std::io::Read;
    let (total_in, total_out, total, by_tool) = db.get_aggregated_usage()?;
    let by_tool_obj: serde_json::Map<String, serde_json::Value> = by_tool.into_iter()
        .map(|(k, v)| (k, serde_json::json!(v)))
        .collect();
    let payload = serde_json::json!({
        "report_token": report_token,
        "total_in": total_in,
        "total_out": total_out,
        "total": total,
        "by_tool": serde_json::Value::Object(by_tool_obj),
        "last_active": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    let mut resp = client.post("https://agent.eake.cn/wp-json/ylan/v1/report-usage")
        .json(&payload)
        .send()
        .map_err(|e| format!("上报请求失败: {}", e))?;
    let mut body = String::new();
    resp.read_to_string(&mut body).map_err(|e| e.to_string())?;
    Ok(body)
}

// ===== Workspace 目录选择 =====
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::FilePath;
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| match p {
        FilePath::Path(path) => path.to_string_lossy().to_string(),
        FilePath::Url(url) => url.to_file_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| url.to_string()),
    }))
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    use std::fs;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file_content(path: String, content: String) -> Result<(), String> {
    use std::fs;
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_workspace_dir_config(db: tauri::State<'_, Database>) -> Result<String, String> {
    // 从数据库读取配置的 workspace，没有则返回默认
    match db.get_setting("workspace_dir") {
        Ok(Some(dir)) => Ok(dir),
        _ => code_runner::get_workspace_dir(),
    }
}

#[tauri::command]
fn set_workspace_dir(db: tauri::State<'_, Database>, dir: String) -> Result<(), String> {
    db.set_setting("workspace_dir", &dir)
        .map_err(|e| format!("保存失败: {}", e))
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
    is_file: bool,
}

#[tauri::command]
fn read_dir_entries(dir: String) -> Result<Vec<DirEntry>, String> {
    use std::fs;
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    // 排除构建生成的目录
    let exclude_dirs = [".fingerprint", ".cargo", ".rustc_info.json"];
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏文件和构建目录
        if name.starts_with('.') || exclude_dirs.contains(&name.as_str()) {
            continue;
        }
        result.push(DirEntry {
            name,
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }
    // 文件夹在前，文件在后，按名称排序
    result.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(result)
}


// ============ 定时任务 (cron) 命令 ============
#[tauri::command]
fn get_cron_jobs(tool_id: String, db: tauri::State<'_, Database>) -> Result<Vec<db::CronJob>, String> {
    db.get_cron_jobs(&tool_id)
}

#[tauri::command]
fn add_cron_job(
    id: String,
    tool_id: String,
    name: String,
    cron_expr: String,
    message: String,
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let job = db::CronJob {
        id: id.clone(),
        tool_id: tool_id.clone(),
        name,
        cron_expr: cron_expr.clone(),
        message: message.clone(),
        enabled: true,
        created_at: now,
        last_run: None,
        next_run: None,
    };
    db.add_cron_job(&job)?;
    if let Some(scheduler) = cron_scheduler::get_scheduler() {
        scheduler.start_job(job, app);
    }
    Ok(())
}

#[tauri::command]
fn toggle_cron_job(job_id: String, enabled: bool, app: tauri::AppHandle, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.toggle_cron_job(&job_id, enabled)?;
    if let Some(scheduler) = cron_scheduler::get_scheduler() {
        if enabled {
            let job = db.get_cron_jobs(&"".to_string())
                .ok()
                .and_then(|jobs| jobs.into_iter().find(|j| j.id == job_id));
            if let Some(job) = job {
                scheduler.start_job(job, app);
            }
        } else {
            scheduler.stop_job(&job_id);
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_cron_job(job_id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_cron_job(&job_id)?;
    if let Some(scheduler) = cron_scheduler::get_scheduler() {
        scheduler.stop_job(&job_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_files_for_hermes() {
        let files = memory_files_for_tool("hermes-agent");
        assert!(files.is_some(), "hermes-agent 应返回记忆文件列表");
        let files = files.unwrap();
        assert!(!files.is_empty(), "hermes-agent 至少应有 SOUL.md");

        for (name, path_str) in &files {
            let content = std::fs::read_to_string(path_str)
                .unwrap_or_else(|_| panic!("应能读取文件: {} ({})", name, path_str));
            assert!(!content.trim().is_empty(),
                "文件 {} 内容不应为空", name);
        }
    }

    #[test]
    fn test_memory_files_for_unknown_tool() {
        assert!(memory_files_for_tool("nonexistent-tool").is_none(),
            "未知工具应返回 None");
    }

    #[test]
    fn test_memory_files_loading_logic() {
        // 模拟 stream_chat 中的加载逻辑
        let tool_id = "hermes-agent";
        let mem_files = memory_files_for_tool(tool_id)
            .expect("hermes-agent 应有记忆文件");

        let mut mem_content = String::new();
        for (name, path) in &mem_files {
            if let Ok(content) = std::fs::read_to_string(path) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    mem_content.push_str(&format!("\n\n<!-- {} -->\n{}", name, trimmed));
                }
            }
        }

        assert!(!mem_content.is_empty(), "加载后的内容不应为空");
        assert!(mem_content.contains("AGENTS.md"), "应包含 AGENTS.md");
        assert!(mem_content.contains("SOUL.md"), "应包含 SOUL.md");
        assert!(mem_content.contains("MEMORY.md"), "应包含 MEMORY.md");
        assert!(mem_content.contains("Hermes"), "应包含 Hermes 相关内容");
    }
}
