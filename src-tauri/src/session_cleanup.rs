use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct CleanupStats {
    pub deleted_files: usize,
    pub freed_bytes: u64,
    pub kept_checkpoints: usize,
    pub removed_checkpoints: usize,
    pub removed_deleted: usize,
    pub removed_bak: usize,
    pub removed_lock: usize,
    pub current_session_size_mb: f64,
}

/// 获取 QClaw 的 sessions 目录路径
fn get_sessions_dirs() -> Vec<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\Users\\Administrator".to_string());
    let qclaw_agents = PathBuf::from(&home).join(".qclaw").join("agents");
    
    let mut dirs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&qclaw_agents) {
        for entry in entries.flatten() {
            let sessions_dir = entry.path().join("sessions");
            if sessions_dir.exists() && sessions_dir.is_dir() {
                dirs.push(sessions_dir);
            }
        }
    }
    dirs
}

/// 估算可清理空间（不删文件）
#[tauri::command]
pub fn estimate_cleanable_space() -> Result<CleanupStats, String> {
    let sessions_dirs = get_sessions_dirs();
    if sessions_dirs.is_empty() {
        return Ok(CleanupStats {
            deleted_files: 0,
            freed_bytes: 0,
            kept_checkpoints: 0,
            removed_checkpoints: 0,
            removed_deleted: 0,
            removed_bak: 0,
            removed_lock: 0,
            current_session_size_mb: 0.0,
        });
    }

    let mut total_freed: u64 = 0;
    let mut total_rm_deleted: usize = 0;
    let mut total_rm_bak: usize = 0;
    let mut total_rm_lock: usize = 0;
    let mut total_checkpoint_keep: usize = 0;
    let mut total_checkpoint_rm: usize = 0;
    let mut _total_files: usize = 0;
    let mut total_all_bytes: u64 = 0;

    for sessions_dir in &sessions_dirs {
        let entries = std::fs::read_dir(sessions_dir).map_err(|e| format!("读取目录失败 {}: {}", sessions_dir.display(), e))?;
        
        // 按 session ID 分组文件
        let mut session_files: HashMap<String, Vec<std::fs::DirEntry>> = HashMap::new();
        let mut standalone_files: Vec<std::fs::DirEntry> = Vec::new();

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            
            // 提取 session ID（UUID 前缀）
            if let Some(session_id) = name.split('.').next() {
                if session_id.len() >= 32 {
                    session_files.entry(session_id.to_string())
                        .or_default()
                        .push(entry);
                } else {
                    standalone_files.push(entry);
                }
            } else {
                standalone_files.push(entry);
            }
        }

        // 处理独立的 .deleted / .bak / .lock 文件
        for entry in &standalone_files {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Ok(meta) = entry.metadata() {
                total_all_bytes += meta.len();
                _total_files += 1;
            }
            if name.contains(".deleted.") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                total_rm_deleted += 1;
            } else if name.ends_with(".bak") || name.contains(".bak.") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                total_rm_bak += 1;
            } else if name.ends_with(".lock") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                total_rm_lock += 1;
            }
        }

        // 处理每个 session 的 checkpoint
        for (_session_id, files) in &session_files {
            let mut checkpoints: Vec<(std::time::SystemTime, PathBuf, u64)> = Vec::new();
            let mut other: Vec<&std::fs::DirEntry> = Vec::new();
            
            for entry in files {
                let name = entry.file_name().to_string_lossy().to_string();
                
                // .deleted.* 和 .bak 也加入清理统计
                if name.contains(".deleted.") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    total_rm_deleted += 1;
                    continue;
                }
                if name.ends_with(".bak") || name.contains(".bak.") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    total_rm_bak += 1;
                    continue;
                }
                if name.ends_with(".lock") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    total_rm_lock += 1;
                    continue;
                }

                // checkpoint 文件
                if name.contains(".checkpoint.") {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            checkpoints.push((modified, entry.path(), meta.len()));
                        }
                    }
                    continue;
                }
                
                other.push(entry);
            }

            // 按修改时间排序（最新的在后）
            checkpoints.sort_by(|a, b| a.0.cmp(&b.0));

            // 保留最新 1 个 checkpoint，其余标记可删除
            if checkpoints.len() > 1 {
                for (_, _, size) in checkpoints.iter().take(checkpoints.len() - 1) {
                    total_freed += size;
                    total_checkpoint_rm += 1;
                }
                total_checkpoint_keep += 1;
            } else if checkpoints.len() == 1 {
                total_checkpoint_keep += 1;
            }

            // 其他文件计入总大小
            for entry in other {
                if let Ok(meta) = entry.metadata() {
                    total_all_bytes += meta.len();
                    _total_files += 1;
                }
            }
        }
    }

    let current_size_mb = if total_all_bytes > total_freed {
        (total_all_bytes - total_freed) as f64 / 1_048_576.0
    } else {
        0.0
    };

    Ok(CleanupStats {
        deleted_files: total_rm_deleted + total_rm_bak + total_rm_lock + total_checkpoint_rm,
        freed_bytes: total_freed,
        kept_checkpoints: total_checkpoint_keep,
        removed_checkpoints: total_checkpoint_rm,
        removed_deleted: total_rm_deleted,
        removed_bak: total_rm_bak,
        removed_lock: total_rm_lock,
        current_session_size_mb: (current_size_mb * 10.0).round() / 10.0,
    })
}

/// 执行清理
#[tauri::command]
pub fn cleanup_sessions_cache(keep_checkpoints: Option<usize>) -> Result<CleanupStats, String> {
    let keep = keep_checkpoints.unwrap_or(1);
    if keep < 1 { return Err("至少保留 1 个 checkpoint".to_string()); }

    let sessions_dirs = get_sessions_dirs();
    if sessions_dirs.is_empty() {
        return Ok(CleanupStats {
            deleted_files: 0,
            freed_bytes: 0,
            kept_checkpoints: 0,
            removed_checkpoints: 0,
            removed_deleted: 0,
            removed_bak: 0,
            removed_lock: 0,
            current_session_size_mb: 0.0,
        });
    }

    let mut total_deleted: usize = 0;
    let mut total_freed: u64 = 0;
    let mut total_keep_cp: usize = 0;
    let mut total_rm_cp: usize = 0;
    let mut total_rm_deleted: usize = 0;
    let mut total_rm_bak: usize = 0;
    let mut total_rm_lock: usize = 0;
    let mut total_all_bytes_after: u64 = 0;

    for sessions_dir in &sessions_dirs {
        let entries = std::fs::read_dir(sessions_dir)
            .map_err(|e| format!("读取目录失败 {}: {}", sessions_dir.display(), e))?;

        let mut session_files: HashMap<String, Vec<std::fs::DirEntry>> = HashMap::new();
        let mut standalone_files: Vec<std::fs::DirEntry> = Vec::new();

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(session_id) = name.split('.').next() {
                if session_id.len() >= 32 {
                    session_files.entry(session_id.to_string())
                        .or_default()
                        .push(entry);
                } else {
                    standalone_files.push(entry);
                }
            } else {
                standalone_files.push(entry);
            }
        }

        // 删独立 .deleted / .bak / .lock
        for entry in &standalone_files {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.contains(".deleted.") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                let _ = std::fs::remove_file(entry.path());
                total_deleted += 1;
                total_rm_deleted += 1;
            } else if name.ends_with(".bak") || name.contains(".bak.") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                let _ = std::fs::remove_file(entry.path());
                total_deleted += 1;
                total_rm_bak += 1;
            } else if name.ends_with(".lock") {
                if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                let _ = std::fs::remove_file(entry.path());
                total_deleted += 1;
                total_rm_lock += 1;
            } else {
                if let Ok(meta) = entry.metadata() { total_all_bytes_after += meta.len(); }
            }
        }

        // 处理每个 session 的 checkpoint
        for (_session_id, files) in &session_files {
            let mut checkpoints: Vec<(std::time::SystemTime, PathBuf, u64)> = Vec::new();
            let mut keep_files: Vec<&std::fs::DirEntry> = Vec::new();

            for entry in files {
                let name = entry.file_name().to_string_lossy().to_string();

                // 删 .deleted
                if name.contains(".deleted.") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    let _ = std::fs::remove_file(entry.path());
                    total_deleted += 1;
                    total_rm_deleted += 1;
                    continue;
                }
                // 删 .bak
                if name.ends_with(".bak") || name.contains(".bak.") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    let _ = std::fs::remove_file(entry.path());
                    total_deleted += 1;
                    total_rm_bak += 1;
                    continue;
                }
                // 删 .lock
                if name.ends_with(".lock") {
                    if let Ok(meta) = entry.metadata() { total_freed += meta.len(); }
                    let _ = std::fs::remove_file(entry.path());
                    total_deleted += 1;
                    total_rm_lock += 1;
                    continue;
                }
                // checkpoint
                if name.contains(".checkpoint.") {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            checkpoints.push((modified, entry.path(), meta.len()));
                        }
                    }
                    continue;
                }

                keep_files.push(entry);
            }

            // 按时间排序，保留最新的 N 个
            checkpoints.sort_by(|a, b| a.0.cmp(&b.0));
            if checkpoints.len() > keep {
                for (_, path, size) in checkpoints.iter().take(checkpoints.len() - keep) {
                    let _ = std::fs::remove_file(path);
                    total_freed += size;
                    total_deleted += 1;
                    total_rm_cp += 1;
                }
                total_keep_cp += keep.min(checkpoints.len());
            } else {
                total_keep_cp += checkpoints.len();
            }

            // 剩余文件统计
            for entry in &keep_files {
                if let Ok(meta) = entry.metadata() {
                    total_all_bytes_after += meta.len();
                }
            }
        }
    }

    let remaining_mb = (total_all_bytes_after as f64 / 1_048_576.0 * 10.0).round() / 10.0;

    Ok(CleanupStats {
        deleted_files: total_deleted,
        freed_bytes: total_freed,
        kept_checkpoints: total_keep_cp,
        removed_checkpoints: total_rm_cp,
        removed_deleted: total_rm_deleted,
        removed_bak: total_rm_bak,
        removed_lock: total_rm_lock,
        current_session_size_mb: remaining_mb,
    })
}
