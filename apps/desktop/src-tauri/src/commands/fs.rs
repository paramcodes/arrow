//! The file-system commands of the Rust shell.
//!
//! The webview never touches the disk. It asks the shell to read a directory,
//! read a file, write a file, create an entry, delete an entry or rename an
//! entry, and every one of those calls crosses this module.
//!
//! A path is resolved against the working directory of the shell when it is
//! relative, and an empty path names the working directory itself. The
//! commands return the entries of a directory and the text of a file, and they
//! answer with the message of the operating system when a call fails, so the
//! frontend can show it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// One entry of a directory, as the file tree reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    /// The file name of the entry, without its directory.
    pub name: String,
    /// The path of the entry, as the caller names it.
    pub path: String,
    /// True when the entry is a directory.
    pub is_directory: bool,
}

/// The message a failed command answers with.
fn message(error: std::io::Error, path: &Path) -> String {
    format!("{}: {error}", path.display())
}

/// The directory a path names. An empty path is the working directory.
fn resolve(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return std::env::current_dir().map_err(|error| error.to_string());
    }
    Ok(PathBuf::from(path))
}

/// Read one directory, directories first and then names in order.
#[tauri::command]
pub fn read_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let directory = resolve(&path)?;
    let listing = fs::read_dir(&directory).map_err(|error| message(error, &directory))?;

    let mut entries = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();
        let is_directory = entry
            .file_type()
            .map_err(|error| message(error, &entry_path))?
            .is_dir();
        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_path.to_string_lossy().into_owned(),
            is_directory,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(entries)
}

/// Read one file as text.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let file = resolve(&path)?;
    fs::read_to_string(&file).map_err(|error| message(error, &file))
}

/// Write text to one file, creating the file when it does not exist.
#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    let file = resolve(&path)?;
    fs::write(&file, contents).map_err(|error| message(error, &file))
}

/// Create a file, or a directory when `directory` is true.
#[tauri::command]
pub fn create_entry(path: String, directory: bool) -> Result<(), String> {
    let target = resolve(&path)?;
    if target.exists() {
        return Err(format!("{}: the entry already exists", target.display()));
    }

    let result = if directory {
        fs::create_dir_all(&target)
    } else {
        match target.parent() {
            Some(parent) => match fs::create_dir_all(parent) {
                Ok(()) => fs::write(&target, ""),
                Err(error) => Err(error),
            },
            None => fs::write(&target, ""),
        }
    };

    result.map_err(|error| message(error, &target))
}

/// Delete a file or a directory and everything inside it.
#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|error| message(error, &target))
    } else {
        fs::remove_file(&target).map_err(|error| message(error, &target))
    }
}

/// Move an entry to another path.
#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    let source = resolve(&from)?;
    let target = resolve(&to)?;
    if target.exists() {
        return Err(format!("{}: the entry already exists", target.display()));
    }
    fs::rename(&source, &target).map_err(|error| message(error, &source))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A directory of its own for one case, removed when the case ends.
    struct Scratch {
        path: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("the clock is after the epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "arrow-fs-{name}-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("the scratch directory");
            Self { path }
        }

        fn file(&self, name: &str) -> String {
            self.path.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn writes_and_reads_a_file() {
        let scratch = Scratch::new("roundtrip");
        let path = scratch.file("notes.txt");

        write_file(path.clone(), "arrow\n".to_string()).expect("the write");

        assert_eq!(read_file(path).expect("the read"), "arrow\n");
    }

    #[test]
    fn reads_a_directory_directories_first() {
        let scratch = Scratch::new("listing");
        create_entry(scratch.file("zeta.txt"), false).expect("the file");
        create_entry(scratch.file("alpha.txt"), false).expect("the file");
        create_entry(scratch.file("src"), true).expect("the directory");

        let entries = read_directory(scratch.path.to_string_lossy().into_owned()).expect("the read");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, ["src", "alpha.txt", "zeta.txt"]);
        assert!(entries[0].is_directory);
        assert!(!entries[1].is_directory);
    }

    #[test]
    fn creates_renames_and_deletes_an_entry() {
        let scratch = Scratch::new("rename");
        let before = scratch.file("before.ts");
        let after = scratch.file("after.ts");

        create_entry(before.clone(), false).expect("the create");
        assert!(Path::new(&before).exists());

        rename_entry(before.clone(), after.clone()).expect("the rename");
        assert!(!Path::new(&before).exists());
        assert!(Path::new(&after).exists());

        delete_entry(after.clone()).expect("the delete");
        assert!(!Path::new(&after).exists());
    }

    #[test]
    fn refuses_to_create_an_entry_that_exists() {
        let scratch = Scratch::new("exists");
        let path = scratch.file("taken.ts");
        create_entry(path.clone(), false).expect("the create");

        let error = create_entry(path, false).expect_err("the second create fails");

        assert!(error.contains("already exists"));
    }

    #[test]
    fn reports_the_path_of_a_missing_file() {
        let scratch = Scratch::new("missing");
        let path = scratch.file("gone.ts");

        let error = read_file(path.clone()).expect_err("the read fails");

        assert!(error.contains("gone.ts"));
    }

    #[test]
    fn deletes_a_directory_with_its_contents() {
        let scratch = Scratch::new("recursive");
        let directory = scratch.file("src");
        create_entry(directory.clone(), true).expect("the directory");
        write_file(scratch.file("src/main.ts"), "export {};\n".to_string()).expect("the file");

        delete_entry(directory.clone()).expect("the delete");

        assert!(!Path::new(&directory).exists());
    }
}
