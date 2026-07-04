use napi::Error;
use napi_derive::napi;

use futures::future::join_all;

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
    if pattern.len() > 200 {
        return Err(Error::from_reason(
            "Regex pattern too long (max 200 characters)".to_string(),
        ));
    }
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


