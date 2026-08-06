use serde::{Deserialize, Serialize};
use std::process::Command;
use std::os::windows::process::CommandExt;

fn is_git_repo(dir: &str) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(dir)
        .creation_flags(0x08000000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_current_branch(dir: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn get_ahead_behind(dir: &str) -> (i32, i32) {
    let output = Command::new("git")
        .args(["rev-list", "--left-right", "--count", "HEAD...@{u}"])
        .current_dir(dir)
        .creation_flags(0x08000000)
        .output()
        .ok();
    if let Some(out) = output {
        if out.status.success() {
            let lossy: String = String::from_utf8_lossy(&out.stdout).into_owned();
            let parts: Vec<&str> = lossy.trim().split_whitespace().collect();
            if parts.len() == 2 {
                let ahead: i32 = parts[0].parse().unwrap_or(0);
                let behind: i32 = parts[1].parse().unwrap_or(0);
                return (ahead, behind);
            }
        }
    }
    (0, 0)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatusEntry {
    pub index_status: String,
    pub worktree_status: String,
    pub path: String,
    pub is_untracked: bool,
    pub is_staged: bool,
    pub is_modified: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitStatusEntry>,
    pub staged_count: usize,
    pub modified_count: usize,
    pub untracked_count: usize,
    pub ahead: i32,
    pub behind: i32,
    pub workspace_dir: String,
}

#[tauri::command]
pub fn get_git_status(dir: String) -> GitStatusResult {
    let is_repo = is_git_repo(&dir);
    if !is_repo {
        return GitStatusResult {
            is_repo: false,
            branch: None,
            files: vec![],
            staged_count: 0,
            modified_count: 0,
            untracked_count: 0,
            ahead: 0,
            behind: 0,
            workspace_dir: dir,
        };
    }

    let branch = get_current_branch(&dir);
    let output = Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    let mut files = Vec::new();
    let mut staged_count = 0;
    let mut modified_count = 0;
    let mut untracked_count = 0;

    if let Ok(output) = output {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if line.len() < 3 {
                    continue;
                }
                let index_st = line.chars().next().unwrap_or(' ');
                let worktree_st = line.chars().nth(1).unwrap_or(' ');
                let path = line[3..].to_string();
                let is_untracked = index_st == '?' && worktree_st == '?';
                let is_staged = index_st != ' ' && index_st != '?';
                let is_modified = worktree_st != ' ' && worktree_st != '?';

                if is_untracked {
                    untracked_count += 1;
                } else if is_staged {
                    staged_count += 1;
                } else if is_modified {
                    modified_count += 1;
                }

                files.push(GitStatusEntry {
                    index_status: if index_st == ' ' { String::new() } else { index_st.to_string() },
                    worktree_status: if worktree_st == ' ' { String::new() } else { worktree_st.to_string() },
                    path: path.clone(),
                    is_untracked,
                    is_staged,
                    is_modified,
                });
            }
        }
    }

    let (ahead, behind) = get_ahead_behind(&dir);

    GitStatusResult {
        is_repo: true,
        branch,
        files,
        staged_count,
        modified_count,
        untracked_count,
        ahead,
        behind,
        workspace_dir: dir,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommitResult {
    pub success: bool,
    pub message: String,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub fn git_commit(dir: String, message: String) -> GitCommitResult {
    if message.trim().is_empty() {
        return GitCommitResult {
            success: false,
            message: "Message cannot be empty".to_string(),
            stdout: String::new(),
            stderr: String::new(),
        };
    }

    let output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    match &output {
        Ok(o) if o.status.success() => GitCommitResult {
            success: true,
            message: "Commit successful".to_string(),
            stdout: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            stderr: String::new(),
        },
        Ok(o) => GitCommitResult {
            success: false,
            message: String::from_utf8_lossy(&o.stderr).trim().to_string(),
            stdout: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).trim().to_string(),
        },
        Err(e) => GitCommitResult {
            success: false,
            message: e.to_string(),
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLogResult {
    pub success: bool,
    pub commits: Vec<GitLogEntry>,
    pub stdout: String,
}

#[tauri::command]
pub fn get_git_log(dir: String, count: usize) -> GitLogResult {
    let n = count.to_string();
    let output = Command::new("git")
        .args(["log", &format!("-{}", n), "--pretty=format:%H|%h|%s|%an|%ad", "--date=short"])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let mut commits = Vec::new();
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let parts: Vec<&str> = line.splitn(5, '|').collect();
                if parts.len() >= 4 {
                    commits.push(GitLogEntry {
                        hash: parts[0].to_string(),
                        short_hash: parts.get(1).unwrap_or(&parts[0]).to_string(),
                        message: parts[2].to_string(),
                        author: parts.get(3).unwrap_or(&"").to_string(),
                        date: parts.get(4).unwrap_or(&"").to_string(),
                    });
                }
            }
            GitLogResult { success: true, commits, stdout: String::new() }
        }
        Ok(out) => GitLogResult {
            success: false,
            commits: vec![],
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        },
        Err(e) => GitLogResult {
            success: false,
            commits: vec![],
            stdout: e.to_string(),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitPushResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn git_push(dir: String) -> GitPushResult {
    let output = Command::new("git")
        .args(["push"])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    match &output {
        Ok(o) if o.status.success() => GitPushResult {
            success: true,
            message: "Push successful".to_string(),
        },
        Ok(o) => GitPushResult {
            success: false,
            message: String::from_utf8_lossy(&o.stderr).trim().to_string(),
        },
        Err(e) => GitPushResult {
            success: false,
            message: e.to_string(),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitPullResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn git_pull(dir: String) -> GitPullResult {
    let output = Command::new("git")
        .args(["pull"])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    match &output {
        Ok(o) if o.status.success() => GitPullResult {
            success: true,
            message: "Pull successful".to_string(),
        },
        Ok(o) => GitPullResult {
            success: false,
            message: String::from_utf8_lossy(&o.stderr).trim().to_string(),
        },
        Err(e) => GitPullResult {
            success: false,
            message: e.to_string(),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranchesResult {
    pub success: bool,
    pub current: Option<String>,
    pub branches: Vec<String>,
    pub message: String,
}

#[tauri::command]
pub fn get_git_branches(dir: String) -> GitBranchesResult {
    let output = Command::new("git")
        .args(["branch", "-a"])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let current = get_current_branch(&dir);
            let branches: Vec<String> = String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim_start_matches(['*', ' ']).to_string())
                .collect();
            GitBranchesResult { success: true, current, branches, message: String::new() }
        }
        Ok(out) => GitBranchesResult {
            success: false,
            current: None,
            branches: vec![],
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        },
        Err(e) => GitBranchesResult {
            success: false,
            current: None,
            branches: vec![],
            message: e.to_string(),
        },
    }
}

// ===== GitHub 相关命令 =====

#[derive(serde::Serialize)]
pub struct GitCloneResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn git_clone(url: String, dir: String) -> GitCloneResult {
    use std::process::Command;
    let output = Command::new("git")
        .args(["clone", &url])
        .current_dir(&dir)
        .output();
    match output {
        Ok(o) if o.status.success() => GitCloneResult {
            success: true,
            message: String::from_utf8_lossy(&o.stdout).to_string(),
        },
        Ok(o) => GitCloneResult {
            success: false,
            message: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => GitCloneResult {
            success: false,
            message: e.to_string(),
        },
    }
}

#[tauri::command]
pub fn get_github_url(dir: String) -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&dir)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // 转换 git@github.com:user/repo.git -> https://github.com/user/repo
    let https_url = if url.starts_with("git@github.com:") {
        url.replace("git@github.com:", "https://github.com/").replace(".git", "")
    } else if url.starts_with("https://github.com/") {
        url.replace(".git", "")
    } else {
        url
    };
    Ok(https_url)
}

#[derive(serde::Serialize)]
pub struct GitInitResult {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn git_init(dir: String) -> GitInitResult {
    use std::process::Command;
    let output = Command::new("git")
        .args(["init"])
        .current_dir(&dir)
        .output();
    match output {
        Ok(o) if o.status.success() => GitInitResult {
            success: true,
            message: String::from_utf8_lossy(&o.stdout).to_string(),
        },
        Ok(o) => GitInitResult {
            success: false,
            message: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => GitInitResult {
            success: false,
            message: e.to_string(),
        },
    }
}

// ===== Git Diff 命令 =====

#[derive(serde::Serialize)]
pub struct GitDiffResult {
    pub success: bool,
    pub diff: String,
    pub message: String,
}

#[tauri::command]
pub fn git_diff_file(dir: String, path: String) -> GitDiffResult {
    let output = Command::new("git")
        .args(["diff", "HEAD", &path])
        .current_dir(&dir)
        .creation_flags(0x08000000)
        .output();
    match output {
        Ok(o) if o.status.success() => GitDiffResult {
            success: true,
            diff: String::from_utf8_lossy(&o.stdout).to_string(),
            message: String::new(),
        },
        Ok(_o) => {
            // git diff 对未跟踪文件会失败，尝试 diff 工作区 vs 索引
            let output2 = Command::new("git")
                .args(["diff", &path])
                .current_dir(&dir)
                .creation_flags(0x08000000)
                .output();
            match output2 {
                Ok(o2) if o2.status.success() => GitDiffResult {
                    success: true,
                    diff: String::from_utf8_lossy(&o2.stdout).to_string(),
                    message: String::new(),
                },
                Ok(o2) => GitDiffResult {
                    success: false,
                    diff: String::new(),
                    message: String::from_utf8_lossy(&o2.stderr).to_string(),
                },
                Err(e) => GitDiffResult {
                    success: false,
                    diff: String::new(),
                    message: e.to_string(),
                },
            }
        }
        Err(e) => GitDiffResult {
            success: false,
            diff: String::new(),
            message: e.to_string(),
        },
    }
}
