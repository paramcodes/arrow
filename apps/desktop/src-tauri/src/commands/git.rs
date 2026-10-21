//! The git commands of the Rust shell.
//!
//! The webview never runs git. It asks the shell for the branch of a
//! repository, for the status of the repository and for the counts of the
//! diff, and the shell answers with `libgit2`, which reads the repository
//! where it lies.
//!
//! Every command names the root of the repository it reads. A root that holds
//! no repository is an error with the message of the operating system, so the
//! frontend can show it.

use std::path::Path;

use git2::{ErrorCode, Repository, Status, StatusOptions};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

/// The three commands the frontend invokes.
///
/// The names below are the contract the frontend is written against. A second
/// spelling of any of them would break the other half of this session.
pub const COMMANDS: [&str; 3] = ["git_branch", "git_status", "git_diff_stat"];

/// The state of one file of a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitFile {
    /// The path of the file, relative to the root of the repository.
    pub path: String,
    /// The state of the file: `modified`, `added`, `deleted`, `untracked`,
    /// `renamed` or `conflicted`.
    pub status: String,
}

/// The status of a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitStatus {
    /// The branch the repository is on.
    pub branch: String,
    /// The number of files whose content changed.
    pub modified: u32,
    /// The number of files that wait for the next commit.
    pub staged: u32,
    /// The number of files the repository does not track.
    pub untracked: u32,
    /// The number of files that are gone.
    pub deleted: u32,
    /// The state of every file that is not as it was.
    pub files: Vec<GitFile>,
}

/// The counts of the diff of a repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiffStat {
    /// The number of files the diff touches.
    pub files_changed: u32,
    /// The number of lines the diff adds.
    pub insertions: u32,
    /// The number of lines the diff removes.
    pub deletions: u32,
}

impl Serialize for GitDiffStat {
    /// Write the counts under the names the frontend reads.
    ///
    /// The type of the frontend names the first count `filesChanged`, so the
    /// shell writes it under that name and under no other. One field carries
    /// one spelling: a payload that offers two spellings of one value leaves
    /// every reader of it guessing which one is the contract.
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut map = serializer.serialize_map(Some(3))?;
        map.serialize_entry("filesChanged", &self.files_changed)?;
        map.serialize_entry("insertions", &self.insertions)?;
        map.serialize_entry("deletions", &self.deletions)?;
        map.end()
    }
}

/// The branch of the repository at `root`.
#[tauri::command]
pub fn git_branch(root: String) -> Result<String, String> {
    let repository = open(&root)?;

    branch_of(&repository).map_err(|error| format!("the branch of {root} is unknown: {error}"))
}

/// The status of the repository at `root`.
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
    let repository = open(&root)?;
    let branch = branch_of(&repository)
        .map_err(|error| format!("the branch of {root} is unknown: {error}"))?;

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(|error| format!("the status of {root} is unknown: {error}"))?;

    let mut status = GitStatus {
        branch,
        modified: 0,
        staged: 0,
        untracked: 0,
        deleted: 0,
        files: Vec::new(),
    };

    for entry in statuses.iter() {
        let Some(state) = state_of(entry.status()) else {
            continue;
        };

        let path = entry.path().unwrap_or_default().to_string();

        match state {
            "modified" => status.modified += 1,
            "untracked" => status.untracked += 1,
            "deleted" => status.deleted += 1,
            _ => {}
        }

        if is_staged(entry.status()) {
            status.staged += 1;
        }

        status.files.push(GitFile {
            path,
            status: state.to_string(),
        });
    }

    Ok(status)
}

/// The counts of the diff of the repository at `root`.
#[tauri::command]
pub fn git_diff_stat(root: String) -> Result<GitDiffStat, String> {
    let repository = open(&root)?;

    let head = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_tree().ok());

    let mut options = git2::DiffOptions::new();
    options.include_untracked(false);

    let diff = repository
        .diff_tree_to_workdir_with_index(head.as_ref(), Some(&mut options))
        .map_err(|error| format!("the diff of {root} is unknown: {error}"))?;

    let mut insertions = 0;
    let mut deletions = 0;

    diff.foreach(
        &mut |_delta, _progress| true,
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            match line.origin() {
                '+' => insertions += 1,
                '-' => deletions += 1,
                _ => {}
            }
            true
        }),
    )
    .map_err(|error| format!("the diff of {root} is unknown: {error}"))?;

    Ok(GitDiffStat {
        files_changed: diff.deltas().len() as u32,
        insertions,
        deletions,
    })
}

/// Open the repository that lies at `root`.
fn open(root: &str) -> Result<Repository, String> {
    let path = Path::new(root);

    Repository::open(path)
        .map_err(|error| format!("{} is not a git repository: {error}", path.display()))
}

/// The branch a repository is on.
///
/// A repository without a commit is still on a branch, and a repository whose
/// head was detached is on no branch at all, so the commit it points at names
/// it.
fn branch_of(repository: &Repository) -> Result<String, git2::Error> {
    match repository.head() {
        Ok(head) => {
            if head.is_branch() {
                Ok(head.shorthand().unwrap_or("HEAD").to_string())
            } else {
                Ok(head
                    .target()
                    .map(|commit| commit.to_string())
                    .unwrap_or_else(|| "HEAD".to_string()))
            }
        }
        Err(error) if error.code() == ErrorCode::UnbornBranch => {
            let head = repository.find_reference("HEAD")?;
            let target = head.symbolic_target()?.unwrap_or("refs/heads/main");
            Ok(target
                .strip_prefix("refs/heads/")
                .unwrap_or(target)
                .to_string())
        }
        Err(error) => Err(error),
    }
}

/// The state of one file, as the frontend reads it.
///
/// A file that waits for the next commit is `added`, a file that changed is
/// `modified`, a file that is gone is `deleted`, a file the repository does
/// not track is `untracked`, a file that was moved is `renamed` and a file
/// with a merge conflict is `conflicted`. A file that is none of those is not
/// in the status at all.
fn state_of(status: Status) -> Option<&'static str> {
    if status.is_conflicted() {
        Some("conflicted")
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        Some("deleted")
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        Some("renamed")
    } else if status.is_index_new() {
        Some("added")
    } else if status.is_index_modified() || status.is_wt_modified() {
        Some("modified")
    } else if status.is_wt_new() {
        Some("untracked")
    } else {
        None
    }
}

/// True when a file waits for the next commit.
fn is_staged(status: Status) -> bool {
    status.is_index_new()
        || status.is_index_modified()
        || status.is_index_deleted()
        || status.is_index_renamed()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use git2::{Repository, RepositoryInitOptions};

    use super::*;

    /// A repository of its own for one case, removed when the case ends.
    struct Scratch {
        path: PathBuf,
    }

    impl Scratch {
        /// A directory with a repository in it, on the branch `main`.
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("the clock is after the epoch")
                .as_nanos();
            let path =
                scratch_root().join(format!("arrow-git-{name}-{}-{stamp}", std::process::id()));
            fs::create_dir_all(&path).expect("the scratch directory");

            let mut options = RepositoryInitOptions::new();
            options.initial_head("main");
            Repository::init_opts(&path, &options).expect("the repository");

            Self { path }
        }

        fn root(&self) -> String {
            self.path.to_string_lossy().into_owned()
        }

        fn file(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    /// The directory the scratch of a case lies in.
    ///
    /// The scratch lies in the target directory of the build, because the
    /// temporary directory of the machine carries a quota and a case that
    /// cannot write its file proves nothing about the repository.
    fn scratch_root() -> PathBuf {
        std::env::var("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("target"))
            .join("arrow-scratch")
    }

    /// Write a file into the repository and stage it.
    fn stage(repository: &Repository, name: &str, content: &str) {
        fs::write(
            repository.workdir().expect("the workdir").join(name),
            content,
        )
        .expect("the file");

        let mut index = repository.index().expect("the index");
        index.add_path(Path::new(name)).expect("the file is staged");
        index.write().expect("the index is written");
    }

    /// Write every file into the repository and commit them.
    fn commit(repository: &Repository, files: &[(&str, &str)]) {
        for (name, content) in files {
            stage(repository, name, content);
        }

        let mut index = repository.index().expect("the index");
        let tree = repository
            .find_tree(index.write_tree().expect("the tree"))
            .expect("the tree");
        let signature = git2::Signature::now("Arrow", "arrow@example.com").expect("the signature");

        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "the commit",
                &tree,
                &[],
            )
            .expect("the commit");
    }

    /// A repository with one committed file, and the file changed on the disk.
    fn repository_with_a_change(name: &str) -> Scratch {
        let scratch = Scratch::new(name);
        let repository = Repository::open(&scratch.path).expect("the repository");
        commit(&repository, &[("notes.txt", "one\ntwo\n")]);
        fs::write(scratch.file("notes.txt"), "one\ntwo\nthree\n").expect("the change");
        scratch
    }

    #[test]
    fn the_branch_of_a_repository_is_its_name() {
        let scratch = Scratch::new("branch");

        let branch = git_branch(scratch.root()).expect("the branch");

        assert_eq!(branch, "main");
    }

    #[test]
    fn the_branch_of_a_repository_without_a_commit_is_its_name() {
        let scratch = Scratch::new("unborn");

        let branch = git_branch(scratch.root()).expect("the branch");

        assert_eq!(branch, "main");
    }

    #[test]
    fn a_directory_that_is_no_repository_is_refused() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock is after the epoch")
            .as_nanos();
        let plain = scratch_root().join(format!("arrow-git-plain-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&plain).expect("the plain directory");

        let error =
            git_branch(plain.to_string_lossy().into_owned()).expect_err("there is no repository");

        assert!(error.contains("not a git repository"));
        let _ = fs::remove_dir_all(&plain);
    }

    #[test]
    fn the_status_counts_the_files_of_a_repository() {
        let scratch = Scratch::new("status");
        let repository = Repository::open(&scratch.path).expect("the repository");
        commit(&repository, &[("notes.txt", "one\n")]);

        // A file that changed on the disk, a file that waits for the next
        // commit and a file the repository does not know.
        fs::write(scratch.file("notes.txt"), "one\ntwo\n").expect("the change");
        stage(&repository, "added.txt", "new\n");
        fs::write(scratch.file("loose.txt"), "loose\n").expect("the loose file");

        let status = git_status(scratch.root()).expect("the status");

        assert_eq!(status.branch, "main");
        assert_eq!(status.modified, 1, "one file changed");
        assert_eq!(status.staged, 1, "one file waits for the next commit");
        assert_eq!(status.untracked, 1, "one file is not tracked");
        assert_eq!(status.deleted, 0, "no file is gone");
        assert_eq!(status.files.len(), 3, "every file is in the status");

        let state = |name: &str| {
            status
                .files
                .iter()
                .find(|file| file.path == name)
                .map(|file| file.status.clone())
                .expect("the file is in the status")
        };

        assert_eq!(state("notes.txt"), "modified");
        assert_eq!(state("added.txt"), "added");
        assert_eq!(state("loose.txt"), "untracked");
    }

    #[test]
    fn the_status_reports_a_file_that_is_gone() {
        let scratch = Scratch::new("deleted");
        let repository = Repository::open(&scratch.path).expect("the repository");
        commit(&repository, &[("notes.txt", "one\n")]);

        fs::remove_file(scratch.file("notes.txt")).expect("the removal");

        let status = git_status(scratch.root()).expect("the status");

        assert_eq!(status.deleted, 1, "one file is gone");
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].status, "deleted");
        assert_eq!(status.files[0].path, "notes.txt");
    }

    #[test]
    fn the_diff_stat_counts_the_lines_of_a_change() {
        let scratch = repository_with_a_change("diff");

        let stat = git_diff_stat(scratch.root()).expect("the diff");

        assert_eq!(stat.files_changed, 1, "one file changed");
        assert_eq!(stat.insertions, 1, "one line was added");
        assert_eq!(stat.deletions, 0, "no line was removed");
    }

    #[test]
    fn the_diff_stat_counts_the_lines_that_are_removed() {
        let scratch = Scratch::new("diff-removed");
        let repository = Repository::open(&scratch.path).expect("the repository");
        commit(&repository, &[("notes.txt", "one\ntwo\nthree\n")]);

        fs::write(scratch.file("notes.txt"), "one\n").expect("the change");

        let stat = git_diff_stat(scratch.root()).expect("the diff");

        assert_eq!(stat.files_changed, 1);
        assert_eq!(stat.insertions, 0);
        assert_eq!(stat.deletions, 2, "two lines were removed");
    }

    #[test]
    fn the_diff_stat_of_a_clean_repository_is_empty() {
        let scratch = Scratch::new("clean");
        let repository = Repository::open(&scratch.path).expect("the repository");
        commit(&repository, &[("notes.txt", "one\n")]);

        let stat = git_diff_stat(scratch.root()).expect("the diff");

        assert_eq!(stat.files_changed, 0);
        assert_eq!(stat.insertions, 0);
        assert_eq!(stat.deletions, 0);
    }

    #[test]
    fn the_counts_of_the_diff_carry_the_spelling_the_frontend_reads() {
        let stat = GitDiffStat {
            files_changed: 2,
            insertions: 3,
            deletions: 4,
        };

        let payload = serde_json::to_value(&stat).expect("the payload");

        assert_eq!(payload["filesChanged"], 2, "the spelling the frontend reads");
        assert!(
            payload.get("files_changed").is_none(),
            "one field carries one spelling"
        );
        assert_eq!(payload["insertions"], 3);
        assert_eq!(payload["deletions"], 4);
    }

    #[test]
    fn the_status_carries_the_field_names_the_frontend_reads() {
        let status = GitStatus {
            branch: "main".to_string(),
            modified: 1,
            staged: 2,
            untracked: 3,
            deleted: 4,
            files: vec![GitFile {
                path: "notes.txt".to_string(),
                status: "modified".to_string(),
            }],
        };

        let payload = serde_json::to_value(&status).expect("the payload");

        assert_eq!(payload["branch"], "main");
        assert_eq!(payload["modified"], 1);
        assert_eq!(payload["staged"], 2);
        assert_eq!(payload["untracked"], 3);
        assert_eq!(payload["deleted"], 4);
        assert_eq!(payload["files"][0]["path"], "notes.txt");
        assert_eq!(payload["files"][0]["status"], "modified");
    }
}
