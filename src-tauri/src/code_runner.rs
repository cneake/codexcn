//! GenHub CodeRunner - Python & Shell execution backend

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;
use std::thread;

/// Execute code synchronously and return stdout/stderr combined output
/// language: "python" or "shell"
#[tauri::command]
pub fn execute_code(language: String, code: String, timeout_secs: u64, stdin_input: Option<String>) -> String {
    let input = stdin_input.unwrap_or_default();
    let result = match language.as_str() {
        "python" => run_python(&code, &input, timeout_secs),
        "shell" => run_shell(&code, timeout_secs),
        _ => Err(format!("Unsupported language: {}", language)),
    };

    match result {
        Ok(output) => {
            if output.trim().is_empty() {
                "(无输出)".to_string()
            } else {
                output
            }
        }
        Err(e) => format!("❌ 执行失败: {}", e),
    }
}

fn run_python(code: &str, stdin_input: &str, timeout_secs: u64) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("genhub_py_{}.py", std::process::id()));

    if let Err(e) = std::fs::write(&script_path, code) {
        return Err(format!("无法写入临时文件: {}", e));
    }

    let path_str = script_path.to_string_lossy().to_string();
    let result = run_with_timeout("python", &["-X", "utf8", &path_str], Some(stdin_input), timeout_secs);

    let _ = std::fs::remove_file(&script_path);
    result
}

fn run_shell(code: &str, timeout_secs: u64) -> Result<String, String> {
    // Windows cmd /c does NOT execute multi-line strings properly.
    // Write code to a .bat file so multi-line scripts work correctly.
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("genhub_sh_{}.bat", std::process::id()));

    if let Err(e) = std::fs::write(&script_path, code) {
        return Err(format!("无法写入临时文件: {}", e));
    }

    let path_str = script_path.to_string_lossy().to_string();
    let result = run_with_timeout("cmd", &["/c", &path_str], None, timeout_secs);

    let _ = std::fs::remove_file(&script_path);
    result
}

fn run_with_timeout(program: &str, args: &[&str], stdin_input: Option<&str>, timeout_secs: u64) -> Result<String, String> {
    let program = program.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let timeout = Duration::from_secs(timeout_secs.max(1));

    // Spawn child process
    let mut child = Command::new(&program)
        .args(&args)
        .stdin(match stdin_input {
            Some(_) => Stdio::piped(),
            None => Stdio::null(),
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW on Windows
        .spawn()
        .map_err(|e| format!("无法启动进程 {}: {}", program, e))?;

    // Write stdin input if provided
    if let Some(input) = stdin_input {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(input.as_bytes());
            let _ = stdin.write_all(b"\n"); // trailing newline to unblock last input()
            drop(stdin); // close stdin to signal EOF
        }
    }

    // Read output in a separate thread
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let (tx, rx) = std::sync::mpsc::channel();

    let _reader = thread::spawn(move || {
        let mut out = String::new();
        if let Some(mut h) = stdout_handle {
            let _ = h.read_to_string(&mut out);
        }
        let mut err = String::new();
        if let Some(mut h) = stderr_handle {
            let _ = h.read_to_string(&mut err);
        }
        let _ = tx.send((out, err));
    });

    // Wait for child with timeout
    match child.wait_timeout(timeout) {
        Ok(Some(_)) => {
            let (stdout_str, stderr_str) = rx.recv().unwrap_or((String::new(), String::new()));
            let mut output = String::new();
            if !stdout_str.trim().is_empty() {
                output.push_str(stdout_str.trim());
            }
            if !stderr_str.trim().is_empty() {
                if !output.is_empty() {
                    output.push('\n');
                }
                output.push_str("STDERR:\n");
                output.push_str(stderr_str.trim());
            }
            Ok(output)
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            Err("❌ 执行超时（超过指定时间）".to_string())
        }
        Err(e) => Err(format!("进程等待失败: {}", e)),
    }
}

#[cfg(target_os = "windows")]
trait CommandExt {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl CommandExt for Command {
    fn creation_flags(&mut self, flags: u32) -> &mut Self {
        use std::os::windows::process::CommandExt as WinCommandExt;
        WinCommandExt::creation_flags(self, flags)
    }
}

/// Extension trait for wait_timeout
trait WaitTimeout {
    fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<std::process::ExitStatus>, std::io::Error>;
}

#[cfg(target_os = "windows")]
impl WaitTimeout for std::process::Child {
    fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<std::process::ExitStatus>, std::io::Error> {
        use std::time::Instant;
        let deadline = Instant::now() + timeout;
        loop {
            match self.try_wait() {
                Ok(Some(status)) => return Ok(Some(status)),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        return Ok(None);
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl WaitTimeout for std::process::Child {
    fn wait_timeout(&mut self, timeout: Duration) -> Result<Option<std::process::ExitStatus>, std::io::Error> {
        use std::time::Instant;
        let deadline = Instant::now() + timeout;
        loop {
            match self.try_wait() {
                Ok(Some(status)) => return Ok(Some(status)),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        return Ok(None);
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

/// Save editor file to ~/GenHub/workspace/
#[tauri::command]
pub fn save_editor_file(name: String, content: String) -> Result<String, String> {
    let home = dirs_next().ok_or_else(|| "无法获取用户目录".to_string())?;
    let workspace = home.join("GenHub").join("workspace");
    std::fs::create_dir_all(&workspace)
        .map_err(|e| format!("无法创建目录: {}", e))?;
    let file_path = workspace.join(&name);
    std::fs::write(&file_path, content.as_bytes())
        .map_err(|e| format!("无法写入文件 {}: {}", name, e))?;
    Ok(file_path.to_string_lossy().to_string())
}

/// Get workspace directory path
#[tauri::command]
pub fn get_workspace_dir() -> Result<String, String> {
    let home = dirs_next().ok_or_else(|| "无法获取用户目录".to_string())?;
    let workspace = home.join("GenHub").join("workspace");
    std::fs::create_dir_all(&workspace)
        .map_err(|e| format!("无法创建目录: {}", e))?;
    Ok(workspace.to_string_lossy().to_string())
}

fn dirs_next() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(std::path::PathBuf::from)
    }
}
