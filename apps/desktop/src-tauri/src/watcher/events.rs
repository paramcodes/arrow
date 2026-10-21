//! The changes the watcher reports, and the rule that decides which one.
//!
//! The disk speaks in raw events of the `notify` crate: a file was created, a
//! file was written, a file was gone. This module turns those raw events into
//! the three changes the webview knows about, drops the ones that no reader
//! wants, and gives every change the payload the frontend reads.

use std::path::{Path, PathBuf};

use notify::EventKind;

/// The directories the watcher never reports.
///
/// `.git` holds the history of a repository and changes on every commit,
/// `node_modules` holds the dependencies of a project and `target` holds the
/// build of a project. None of them is a file the reader edits, and all of
/// them change on their own.
pub const IGNORED_DIRECTORIES: [&str; 3] = [".git", "node_modules", "target"];

/// One change of the disk, as the webview hears it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    /// A file appeared.
    Created(PathBuf),
    /// The content of a file changed.
    Changed(PathBuf),
    /// A file disappeared.
    Deleted(PathBuf),
}

impl WatchEvent {
    /// The name of the Tauri event that carries this change.
    pub fn name(&self) -> &'static str {
        match self {
            WatchEvent::Created(_) => "fs:created",
            WatchEvent::Changed(_) => "fs:changed",
            WatchEvent::Deleted(_) => "fs:deleted",
        }
    }

    /// The path the change happened at.
    pub fn path(&self) -> &Path {
        match self {
            WatchEvent::Created(path) | WatchEvent::Changed(path) | WatchEvent::Deleted(path) => {
                path
            }
        }
    }

    /// The payload the event carries across the boundary.
    ///
    /// The payload holds the absolute path of the file, because the frontend
    /// matches it against the tree it holds, and the tree holds absolute
    /// paths.
    pub fn payload(&self) -> serde_json::Value {
        serde_json::json!({ "path": self.path().to_string_lossy() })
    }
}

/// Where the watcher sends the changes it sees.
///
/// The application sends them to the main window, and a test keeps them, so
/// the same watcher serves both.
pub trait EventSink: Send + Sync + 'static {
    /// Report one change.
    fn send(&self, event: &WatchEvent);
}

/// The kind of a change, as the watcher reads it from the raw event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// The content of a file changed.
    Changed,
    /// A file appeared.
    Created,
    /// A file disappeared.
    Deleted,
}

impl Change {
    /// The change a raw event means, if it means one at all.
    ///
    /// A raw event that only reads a file changes nothing on the disk, so it
    /// is not a change.
    pub fn of(kind: &EventKind) -> Option<Change> {
        if kind.is_create() {
            Some(Change::Created)
        } else if kind.is_remove() {
            Some(Change::Deleted)
        } else if kind.is_modify() {
            Some(Change::Changed)
        } else {
            None
        }
    }

    /// The stronger of two changes of the same file.
    ///
    /// A file that is written and removed inside one window is gone, and a
    /// file that is created and then written is new. The order matters: the
    /// tree of the frontend has to add a file that appeared, not change it.
    pub fn stronger(self, other: Change) -> Change {
        match (self, other) {
            (Change::Deleted, _) | (_, Change::Deleted) => Change::Deleted,
            (Change::Created, _) | (_, Change::Created) => Change::Created,
            (Change::Changed, Change::Changed) => Change::Changed,
        }
    }

    /// The event this change is.
    pub fn event(self, path: PathBuf) -> WatchEvent {
        match self {
            Change::Changed => WatchEvent::Changed(path),
            Change::Created => WatchEvent::Created(path),
            Change::Deleted => WatchEvent::Deleted(path),
        }
    }
}

/// True when the path lies in a directory the watcher never reports.
///
/// The rule reads the path relative to the watched root, so a directory above
/// the root that carries the name of an ignored one does not silence the
/// watch.
pub fn is_ignored(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);

    relative.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        IGNORED_DIRECTORIES
            .iter()
            .any(|ignored| name.as_ref() == *ignored)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_events_carry_the_names_the_frontend_listens_for() {
        let path = PathBuf::from("/tmp/arrow/notes.txt");

        assert_eq!(
            WatchEvent::Created(path.clone()).name(),
            "fs:created",
            "the frontend listens for fs:created"
        );
        assert_eq!(WatchEvent::Changed(path.clone()).name(), "fs:changed");
        assert_eq!(WatchEvent::Deleted(path.clone()).name(), "fs:deleted");
    }

    #[test]
    fn the_payload_of_an_event_holds_the_absolute_path() {
        let event = WatchEvent::Changed(PathBuf::from("/tmp/arrow/notes.txt"));

        let payload = event.payload();

        assert_eq!(payload["path"], "/tmp/arrow/notes.txt");
    }

    #[test]
    fn a_raw_event_becomes_the_change_it_means() {
        assert_eq!(
            Change::of(&EventKind::Create(notify::event::CreateKind::File)),
            Some(Change::Created)
        );
        assert_eq!(
            Change::of(&EventKind::Modify(notify::event::ModifyKind::Any)),
            Some(Change::Changed)
        );
        assert_eq!(
            Change::of(&EventKind::Remove(notify::event::RemoveKind::File)),
            Some(Change::Deleted)
        );
        assert_eq!(
            Change::of(&EventKind::Access(notify::event::AccessKind::Any)),
            None,
            "reading a file changes nothing"
        );
    }

    #[test]
    fn a_delete_is_stronger_than_a_write_and_a_creation_is_stronger_than_a_write() {
        assert_eq!(
            Change::Changed.stronger(Change::Deleted),
            Change::Deleted,
            "a file that is gone is gone"
        );
        assert_eq!(
            Change::Changed.stronger(Change::Created),
            Change::Created,
            "a file that appeared is new, not changed"
        );
        assert_eq!(Change::Created.stronger(Change::Changed), Change::Created);
        assert_eq!(Change::Deleted.stronger(Change::Created), Change::Deleted);
    }

    #[test]
    fn the_ignored_directories_are_the_three_the_project_names() {
        assert_eq!(IGNORED_DIRECTORIES, [".git", "node_modules", "target"]);
    }

    #[test]
    fn a_path_inside_an_ignored_directory_is_ignored() {
        let root = Path::new("/tmp/arrow");

        for ignored in IGNORED_DIRECTORIES {
            let path = root.join(ignored).join("inside.txt");
            assert!(is_ignored(root, &path), "{} is ignored", path.display());
        }

        let kept = root.join("src").join("main.rs");
        assert!(!is_ignored(root, &kept), "{} is watched", kept.display());
    }

    #[test]
    fn a_directory_above_the_root_that_carries_an_ignored_name_is_watched() {
        let root = Path::new("/tmp/arrow/target/project");

        let path = root.join("main.rs");

        assert!(
            !is_ignored(root, &path),
            "the rule reads the path below the root only"
        );
    }
}
