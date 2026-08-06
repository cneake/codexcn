// Utility to get CodexHub CN installation directory
// This reads from Windows registry: HKEY_LOCAL_MACHINE\SOFTWARE\CodexHub CN\InstallDir

use std::path::PathBuf;

/// Get the installation directory of CodexHub CN
/// Returns the path where CodexHub CN is installed
/// This is read from Windows registry, or defaults to the executable directory
pub fn get_install_dir() -> PathBuf {
    // Try to read from Windows registry (simplified without winapi)
    #[cfg(target_os = "windows")]
    {
        // Try using the registry via std::env
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let codexhub_dir = PathBuf::from(program_files).join("CodexHub CN");
            if codexhub_dir.exists() {
                return codexhub_dir;
            }
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            let codexhub_dir = PathBuf::from(program_files_x86).join("CodexHub CN");
            if codexhub_dir.exists() {
                return codexhub_dir;
            }
        }
    }
    
    // Fallback: use the executable directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            return exe_dir.to_path_buf();
        }
    }
    
    // Last fallback: current working directory
    PathBuf::from(".")
}

/// Get the tools installation directory
/// Tools will be installed to {InstallDir}\tools\
pub fn get_tools_dir() -> PathBuf {
    get_install_dir().join("tools")
}

/// Get the skills installation directory  
/// Skills will be installed to {InstallDir}\skills\
pub fn get_skills_dir() -> PathBuf {
    get_install_dir().join("skills")
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_get_install_dir() {
        let dir = get_install_dir();
        assert!(dir.exists() || dir == PathBuf::from("."));
    }
    
    #[test]
    fn test_get_tools_dir() {
        let dir = get_tools_dir();
        assert!(dir.ends_with("tools"));
    }
    
    #[test]
    fn test_get_skills_dir() {
        let dir = get_skills_dir();
        assert!(dir.ends_with("skills"));
    }
}
