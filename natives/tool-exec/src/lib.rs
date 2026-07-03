use napi::Error;
use napi_derive::napi;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time;

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

#[napi(object)]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
    pub signal: Option<String>,
}

#[napi(object)]
pub struct ShellOptions {
    pub command: String,
    pub workdir: Option<String>,
    pub timeout_ms: Option<i32>,
    pub env: Option<Vec<(String, String)>>,
    pub max_output_bytes: Option<i32>,
}

#[napi(object)]
pub struct FileContent {
    pub content: String,
    pub size: i32,
}

#[napi]
pub async fn execute_shell(options: ShellOptions) -> Result<ShellOutput, Error> {
    let timeout = Duration::from_millis(options.timeout_ms.unwrap_or(120_000) as u64);
    let max_output = options.max_output_bytes.unwrap_or(1_048_576) as usize;

    let shell_cmd = if cfg!(target_os = "windows") {
        "cmd.exe"
    } else {
        "/bin/sh"
    };
    let shell_flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let mut cmd = Command::new(shell_cmd);
    cmd.arg(shell_flag);
    cmd.arg(&options.command);
    cmd.kill_on_drop(true);

    if let Some(dir) = &options.workdir {
        cmd.current_dir(dir);
    }

    if let Some(env_vars) = &options.env {
        for (key, val) in env_vars {
            cmd.env(key, val);
        }
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        Error::from_reason(format!("Failed to spawn process: {e}"))
    })?;

    let pid = child.id().unwrap_or(0);

    let stdout_handle = tokio::spawn({
        let stdout = child.stdout.take().unwrap();
        read_stream_with_limit(stdout, max_output)
    });

    let stderr_handle = tokio::spawn({
        let stderr = child.stderr.take().unwrap();
        read_stream_with_limit(stderr, max_output)
    });

    let status = time::timeout(timeout, child.wait()).await;

    let (stdout, stdout_truncated) = stdout_handle
        .await
        .unwrap_or_else(|_| (String::new(), false));
    let (stderr, stderr_truncated) = stderr_handle
        .await
        .unwrap_or_else(|_| (String::new(), false));

    let truncated = stdout_truncated || stderr_truncated;

    match status {
        Ok(Ok(status)) => {
            let exit_code = status.code().unwrap_or(-1);
            #[cfg(unix)]
            let signal = status.signal().map(|s| format!("SIG{s}"));
            #[cfg(not(unix))]
            let signal = None;

            Ok(ShellOutput {
                stdout: truncate_output(stdout, truncated, max_output),
                stderr,
                exit_code,
                timed_out: false,
                signal,
            })
        }
        Ok(Err(e)) => Err(Error::from_reason(format!("Process error: {e}"))),
        Err(_elapsed) => {
            let _ = kill_process_group(pid);
            Ok(ShellOutput {
                stdout: truncate_output(stdout, truncated, max_output),
                stderr,
                exit_code: -1,
                timed_out: true,
                signal: None,
            })
        }
    }
}

fn truncate_output(output: String, truncated: bool, max_bytes: usize) -> String {
    if truncated {
        let end = output.len().min(max_bytes);
        format!(
            "{}...\n<Output truncated at {} bytes>",
            &output[..end],
            max_bytes
        )
    } else {
        output
    }
}

async fn read_stream_with_limit<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> (String, bool) {
    let mut output = String::new();
    let mut buf = vec![0u8; 4096];
    let mut total = 0usize;
    let mut truncated = false;

    while let Ok(n) = reader.read(&mut buf).await {
        if n == 0 {
            break;
        }
        if total + n > max_bytes {
            let remaining = max_bytes.saturating_sub(total);
            if remaining > 0 {
                if let Ok(s) = String::from_utf8(buf[..remaining].to_vec()) {
                    output.push_str(&s);
                }
            }
            truncated = true;
            break;
        }
        if let Ok(s) = String::from_utf8(buf[..n].to_vec()) {
            output.push_str(&s);
        } else {
            output.push_str(&format!("<binary data: {n} bytes>"));
        }
        total += n;
    }

    (output, truncated)
}

#[cfg(unix)]
fn kill_process_group(pid: u32) -> Result<(), String> {
    use std::process::Command as SyncCommand;
    let _ = SyncCommand::new("kill")
        .arg("-TERM")
        .arg(format!("-{pid}"))
        .output();
    std::thread::sleep(std::time::Duration::from_millis(500));
    let _ = SyncCommand::new("kill")
        .arg("-KILL")
        .arg(format!("-{pid}"))
        .output();
Ok(())
}

#[cfg(not(unix))]
fn kill_process_group(pid: u32) -> Result<(), String> {
    use std::process::Command as SyncCommand;
    let _ = SyncCommand::new("taskkill")
        .arg("/T")
        .arg("/F")
        .arg("/PID")
        .arg(format!("{pid}"))
        .output();
    Ok(())
}

use futures::future::join_all;

#[napi(object)]
pub struct GlobEntry {
    pub path: String,
    pub size: i64,
    pub is_dir: bool,
}

#[napi]
pub fn glob_files(pattern: String, root: String) -> Result<Vec<GlobEntry>, Error> {
    let abs_root = std::path::Path::new(&root);
    let full_pattern = if abs_root.is_absolute() {
        abs_root.join(&pattern)
    } else {
        std::path::PathBuf::from(&pattern)
    };

    let mut results = Vec::new();
    let pattern_str = full_pattern.to_string_lossy().to_string();
    for entry in glob::glob(&pattern_str).map_err(|e| Error::from_reason(format!("Glob pattern error: {e}")))? {
        match entry {
            Ok(path) => {
                let rel = path
                    .strip_prefix(abs_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let is_dir = path.is_dir();
                let size = if is_dir {
                    0
                } else {
                    std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0)
                };
                results.push(GlobEntry { path: rel, size, is_dir });
            }
            Err(e) => {
                return Err(Error::from_reason(format!("Glob entry error: {e}")));
            }
        }
    }
    Ok(results)
}

#[napi(object)]
pub struct GrepMatch {
    pub path: String,
    pub line: i32,
    pub column: i32,
    pub text: String,
}

#[napi]
pub async fn grep_files(
    pattern: String,
    root: String,
    include_pattern: Option<String>,
    max_matches: Option<i32>,
) -> Result<Vec<GrepMatch>, Error> {
    let re = regex::Regex::new(&pattern)
        .map_err(|e| Error::from_reason(format!("Invalid regex pattern: {e}")))?;
    let max = max_matches.unwrap_or(1000) as usize;
    let root_path = std::path::Path::new(&root);
    let mut results = Vec::new();

    let walk_entries = collect_files_sync(root_path, &include_pattern)
        .map_err(|e| Error::from_reason(format!("Walk error: {e}")))?;

    let chunks: Vec<_> = walk_entries.chunks(32).collect();
    for chunk in chunks {
        if results.len() >= max {
            break;
        }
        let tasks: Vec<_> = chunk
            .iter()
            .filter(|p| !p.is_dir())
            .map(|p| read_and_search(p, &re, root_path, max - results.len()))
            .collect();
        for batch in join_all(tasks).await {
            match batch {
                Ok(mut matches) => {
                    results.append(&mut matches);
                }
                Err(_) => continue,
            }
        }
    }
    Ok(results)
}

async fn read_and_search(
    path: &std::path::Path,
    re: &regex::Regex,
    root: &std::path::Path,
    max: usize,
) -> std::io::Result<Vec<GrepMatch>> {
    let content = tokio::fs::read_to_string(path).await?;
    let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().to_string();
    let mut matches = Vec::new();
    for (line_num, line_text) in content.lines().enumerate() {
        if matches.len() >= max {
            break;
        }
        if let Some(mat) = re.find(line_text) {
            matches.push(GrepMatch {
                path: rel.clone(),
                line: line_num as i32 + 1,
                column: mat.start() as i32 + 1,
                text: line_text.to_string(),
            });
        }
    }
    Ok(matches)
}

fn collect_files_sync(
    dir: &std::path::Path,
    include_pattern: &Option<String>,
) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        out.push(dir.to_path_buf());
        return Ok(out);
    }
    let filter_re = include_pattern
        .as_ref()
        .and_then(|p| regex::Regex::new(p).ok());

    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries: Vec<_> = match std::fs::read_dir(&current) {
            Ok(iter) => iter.filter_map(|e| e.ok()).collect(),
            Err(_) => continue,
        };
        for entry in entries {
            let path = entry.path();
            let is_hidden = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with('.'));
            if path.is_dir() {
                if is_hidden {
                    if path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n == ".git")
                    {
                        continue;
                    }
                } else {
                    stack.push(path);
                }
            } else {
                if let Some(ref re) = filter_re {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if !re.is_match(name) {
                            continue;
                        }
                    }
                }
                out.push(path);
            }
        }
    }
    Ok(out)
}

#[napi]
pub async fn read_file(path: String) -> Result<FileContent, Error> {
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| Error::from_reason(format!("Failed to read file: {e}")))?;

    let size = content.len() as i32;
    Ok(FileContent { content, size })
}

#[napi]
pub async fn write_file(path: String, content: String) -> Result<(), Error> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| Error::from_reason(format!("Failed to create directories: {e}")))?;
    }

    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| Error::from_reason(format!("Failed to write file: {e}")))?;

    Ok(())
}
