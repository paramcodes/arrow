//! The search commands of the Rust shell.
//!
//! The webview never walks the disk itself. It asks the shell for the files of
//! the workspace and for every match of a query, and the shell answers with a
//! flat list the palette and the search panel render.
//!
//! The text search runs `rg` when it is on the machine and falls back to
//! `grep`, so a machine without ripgrep still searches. Both engines are asked
//! for a NUL after the path, so a path that holds a colon, a space or a
//! newline cannot be cut in two by the parser.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// The directories the file list never enters.
///
/// They hold generated output, a package manager store or the database of git:
/// a quick-open that offers them offers noise.
const SKIPPED_DIRECTORIES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".worktrees",
    "coverage",
    "vendor",
];

/// How deep the walk of the file list goes.
const MAX_DEPTH: usize = 16;

/// How many files the file list holds at most.
const MAX_FILES: usize = 5_000;

/// How many matches one search returns at most.
pub const DEFAULT_MAX_MATCHES: usize = 200;

/// One match of a search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// The path of the file, relative to the root of the search.
    pub path: String,
    /// The line of the match, counting from one.
    pub line: u32,
    /// The column of the match, counting from one.
    pub column: u32,
    /// The text of the line the match sits on.
    pub text: String,
}

/// The answer of a search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    /// The matches, in the order the engine printed them.
    pub matches: Vec<SearchMatch>,
    /// True when the engine found more matches than the list holds.
    pub truncated: bool,
    /// The engine that answered the search, `rg` or `grep`.
    pub engine: String,
}

/// The engine a search runs with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Engine {
    /// ripgrep.
    Ripgrep,
    /// GNU grep.
    Grep,
}

impl Engine {
    /// The name of the program.
    fn program(self) -> &'static str {
        match self {
            Engine::Ripgrep => "rg",
            Engine::Grep => "grep",
        }
    }

    /// The arguments that print `path\0line:text` for every match.
    fn arguments(self) -> Vec<&'static str> {
        match self {
            Engine::Ripgrep => vec![
                "--line-number",
                "--no-heading",
                "--color",
                "never",
                "--null",
                "--fixed-strings",
                "--max-filesize",
                "5M",
                "--max-count",
                "50",
                "--glob",
                "!.git/*",
            ],
            Engine::Grep => vec![
                "--recursive",
                "--line-number",
                "--binary-files=without-match",
                "--null",
                "--fixed-strings",
                "--exclude-dir=.git",
                "--exclude-dir=node_modules",
                "--exclude-dir=target",
                "--exclude-dir=dist",
            ],
        }
    }
}

/// The directory a path names. An empty path is the working directory.
fn resolve(root: &str) -> Result<PathBuf, String> {
    if root.is_empty() {
        return std::env::current_dir().map_err(|error| error.to_string());
    }
    Ok(PathBuf::from(root))
}

/// The engine this machine runs, preferring ripgrep.
fn engine() -> Engine {
    let found = Command::new("rg").arg("--version").output();
    match found {
        Ok(output) if output.status.success() => Engine::Ripgrep,
        _ => Engine::Grep,
    }
}

/// The column of `needle` in `haystack`, counting from one.
fn column_of(haystack: &str, needle: &str) -> u32 {
    match haystack.find(needle) {
        Some(index) => haystack[..index].chars().count() as u32 + 1,
        None => 1,
    }
}

/// Parse one line of the output of an engine.
///
/// The shape is `path\0line:text`. The path ends at the first NUL, the line
/// ends at the first colon and the text is the rest of the record, so a colon
/// inside the text of the match is kept.
fn parse_match(record: &str, needle: &str) -> Option<SearchMatch> {
    let (path, rest) = record.split_once('\0')?;
    let (line, text) = rest.split_once(':')?;
    let line: u32 = line.trim().parse().ok()?;
    let path = path.strip_prefix("./").unwrap_or(path);

    Some(SearchMatch {
        path: path.to_string(),
        line,
        column: column_of(text, needle),
        text: text.trim_end_matches(['\r', '\n']).to_string(),
    })
}

/// Parse the whole output of an engine.
fn parse_output(output: &str, needle: &str, max: usize) -> (Vec<SearchMatch>, bool) {
    let mut matches = Vec::new();
    let mut truncated = false;

    for record in output.lines() {
        if matches.len() >= max {
            truncated = true;
            break;
        }
        if let Some(found) = parse_match(record, needle) {
            matches.push(found);
        }
    }

    (matches, truncated)
}

/// Search the text of every file under a root.
///
/// The query is matched as a fixed string, so a query that holds a regular
/// expression metacharacter searches for that character and not for a pattern.
#[tauri::command]
pub fn search_files(
    root: String,
    query: String,
    max_results: Option<usize>,
) -> Result<SearchResults, String> {
    if query.trim().is_empty() {
        return Ok(SearchResults {
            matches: Vec::new(),
            truncated: false,
            engine: engine().program().to_string(),
        });
    }

    let directory = resolve(&root)?;
    let max = max_results.unwrap_or(DEFAULT_MAX_MATCHES).max(1);
    let engine = engine();

    let output = Command::new(engine.program())
        .args(engine.arguments())
        .arg("--")
        .arg(&query)
        .arg(".")
        .current_dir(&directory)
        .output()
        .map_err(|error| format!("{}: {error}", engine.program()))?;

    // grep answers 1 when it finds nothing, and both engines answer 2 when
    // they could not run at all.
    if output.status.code() == Some(2) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (matches, truncated) = parse_output(&stdout, &query, max);

    Ok(SearchResults {
        matches,
        truncated,
        engine: engine.program().to_string(),
    })
}

/// True when a directory name is generated output or a package store.
fn is_skipped(name: &str) -> bool {
    SKIPPED_DIRECTORIES.contains(&name)
}

/// Walk a directory and collect the files under it.
fn walk(directory: &Path, root: &Path, depth: usize, files: &mut Vec<String>) {
    if depth > MAX_DEPTH || files.len() >= MAX_FILES {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if files.len() >= MAX_FILES {
            return;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            if is_skipped(&name) || name.starts_with('.') {
                continue;
            }
            walk(&path, root, depth + 1, files);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let relative = path.strip_prefix(root).unwrap_or(&path);
        files.push(relative.to_string_lossy().replace('\\', "/"));
    }
}

/// The files of a workspace, for the quick-open.
///
/// The paths are relative to the root and use a forward slash, so the
/// quick-open ranks one spelling of a path on every platform. The walk skips
/// the directories of generated output and never enters a hidden directory.
#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
    let directory = resolve(&root)?;
    let mut files = Vec::new();

    walk(&directory, &directory, 0, &mut files);
    files.sort();

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A directory of its own for one test.
    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("arrow-search-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("the scratch directory");
        directory
    }

    #[test]
    fn a_record_is_cut_at_the_null_and_the_first_colon() {
        let found = parse_match("./src/app.ts\012:const answer = 42;", "answer").expect("a match");

        assert_eq!(found.path, "src/app.ts");
        assert_eq!(found.line, 12);
        assert_eq!(found.column, 7);
        assert_eq!(found.text, "const answer = 42;");
    }

    #[test]
    fn a_path_with_a_colon_survives_the_parser() {
        let found = parse_match("./a:b/c.ts\03:x: y", "y").expect("a match");

        assert_eq!(found.path, "a:b/c.ts");
        assert_eq!(found.line, 3);
        assert_eq!(found.text, "x: y");
        assert_eq!(found.column, 4);
    }

    #[test]
    fn a_record_from_another_program_is_ignored() {
        assert_eq!(parse_match("no null here", "here"), None);
        assert_eq!(parse_match("./a.ts\0not-a-line:text", "text"), None);
    }

    #[test]
    fn the_list_stops_at_the_limit_and_says_so() {
        let output = "./a.ts\01:one\n./b.ts\02:two\n./c.ts\03:three\n";
        let (matches, truncated) = parse_output(output, "o", 2);

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[1].path, "b.ts");
        assert!(truncated);
    }

    #[test]
    fn the_file_list_skips_generated_directories() {
        let root = scratch("list");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::create_dir_all(root.join("node_modules/left-pad")).expect("node_modules");
        fs::File::create(root.join("src/app.ts")).expect("a file");
        fs::File::create(root.join("node_modules/left-pad/index.js")).expect("a file");

        let files = list_files(root.to_string_lossy().to_string()).expect("the list");

        assert_eq!(files, vec!["src/app.ts".to_string()]);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_search_finds_a_line_in_a_file() {
        let root = scratch("find");
        let mut file = fs::File::create(root.join("notes.md")).expect("a file");
        writeln!(file, "# Arrow\n\nThe answer is 42.").expect("the text");
        drop(file);

        let results = search_files(
            root.to_string_lossy().to_string(),
            "answer".to_string(),
            None,
        )
        .expect("the search");

        assert_eq!(results.matches.len(), 1);
        assert_eq!(results.matches[0].path, "notes.md");
        assert_eq!(results.matches[0].line, 3);
        assert_eq!(results.matches[0].column, 5);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_empty_query_answers_without_running_an_engine() {
        let results = search_files(String::new(), "   ".to_string(), None).expect("the search");

        assert!(results.matches.is_empty());
        assert!(!results.truncated);
    }
}
