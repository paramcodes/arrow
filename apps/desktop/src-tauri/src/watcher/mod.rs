//! The file watcher of the Rust shell.
//!
//! The webview never watches the disk. It asks the shell to watch a
//! directory, and the shell reports every change of that directory through
//! three events: `fs:created`, `fs:changed` and `fs:deleted`.
//!
//! The watcher is built on the `notify` crate. A raw event is held for a
//! hundred milliseconds before it is reported, so a write that arrives in
//! pieces is reported once and the tree of the frontend is not rebuilt for
//! every chunk of a file. The directories that no reader edits are dropped
//! before they reach the sink.

pub mod events;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use self::events::{is_ignored, Change};
pub use self::events::{EventSink, WatchEvent};

/// The quiet time a change waits before the watcher reports it.
pub const DEBOUNCE: Duration = Duration::from_millis(100);

/// How often the watcher looks at the changes it holds.
const TICK: Duration = Duration::from_millis(20);

/// Every live watch of the application, keyed by its id.
///
/// One registry lives for the whole application, in Tauri's managed state. It
/// hands out the ids of the watches, keeps every live one, and forgets a
/// watch when the frontend closes it.
pub struct WatcherRegistry {
    watches: Mutex<HashMap<String, Watch>>,
    next: AtomicU64,
}

impl WatcherRegistry {
    /// A registry without a watch.
    pub fn new() -> Self {
        Self {
            watches: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
        }
    }

    /// Watch `root` and return the id of the watch.
    ///
    /// The changes of the directory leave through `sink`. The id is what the
    /// frontend hands back to stop the watch.
    pub fn watch(&self, root: &Path, sink: Arc<dyn EventSink>) -> Result<String, String> {
        let (sender, receiver) = channel();

        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    let _ = sender.send(event);
                }
            })
            .map_err(|error| {
                format!("the watcher of {} could not start: {error}", root.display())
            })?;

        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| format!("{} could not be watched: {error}", root.display()))?;

        let id = format!("watch-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let stopped = Arc::new(AtomicBool::new(false));
        report(receiver, sink, root.to_path_buf(), Arc::clone(&stopped));

        self.watches
            .lock()
            .map_err(|_| "the watches of the shell are poisoned".to_string())?
            .insert(
                id.clone(),
                Watch {
                    _watcher: watcher,
                    stopped,
                },
            );

        Ok(id)
    }

    /// Stop the watch of `id` and forget it.
    ///
    /// The watch leaves the map before it stops, so a second stop of the same
    /// id answers that the watch is unknown instead of stopping it twice.
    pub fn unwatch(&self, id: &str) -> Result<(), String> {
        let watch = self
            .watches
            .lock()
            .map_err(|_| "the watches of the shell are poisoned".to_string())?
            .remove(id)
            .ok_or_else(|| format!("there is no watch {id}"))?;

        watch.stopped.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// The number of live watches.
    pub fn len(&self) -> usize {
        self.watches
            .lock()
            .map(|watches| watches.len())
            .unwrap_or(0)
    }

    /// True when no watch is live.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for WatcherRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// One live watch: the raw watcher and the flag that stops it.
struct Watch {
    /// The raw watcher of `notify`. Dropping it stops the watch of the disk.
    _watcher: RecommendedWatcher,
    /// Set when the watch stops, so the thread that reports the changes stops
    /// with it.
    stopped: Arc<AtomicBool>,
}

/// Report the changes of one watch, one hundred milliseconds apart.
///
/// The thread holds every change it hears for a hundred milliseconds. A change
/// that is followed by another one inside that window is reported once, and
/// the change that ends the window is the strongest one the window saw.
fn report(
    receiver: Receiver<notify::Event>,
    sink: Arc<dyn EventSink>,
    root: PathBuf,
    stopped: Arc<AtomicBool>,
) {
    let _ = std::thread::Builder::new()
        .name("arrow watcher".to_string())
        .spawn(move || {
            let mut held: HashMap<PathBuf, (Change, Instant)> = HashMap::new();

            while !stopped.load(Ordering::SeqCst) {
                match receiver.recv_timeout(TICK) {
                    Ok(event) => hold(&mut held, &event, &root),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }

                release(&mut held, &sink, &stopped);
            }
        });
}

/// Hold the changes of a raw event, when the reader cares about the path.
fn hold(held: &mut HashMap<PathBuf, (Change, Instant)>, event: &notify::Event, root: &Path) {
    let Some(change) = Change::of(&event.kind) else {
        return;
    };

    let now = Instant::now();
    for path in &event.paths {
        if is_ignored(root, path) {
            continue;
        }

        held.entry(path.clone())
            .and_modify(|(held_change, seen)| {
                *held_change = held_change.stronger(change);
                *seen = now;
            })
            .or_insert((change, now));
    }
}

/// Report the changes that fell quiet, and forget them.
fn release(
    held: &mut HashMap<PathBuf, (Change, Instant)>,
    sink: &Arc<dyn EventSink>,
    stopped: &Arc<AtomicBool>,
) {
    if stopped.load(Ordering::SeqCst) {
        held.clear();
        return;
    }

    let now = Instant::now();
    let quiet: Vec<PathBuf> = held
        .iter()
        .filter(|(_, (_, seen))| now.duration_since(*seen) >= DEBOUNCE)
        .map(|(path, _)| path.clone())
        .collect();

    for path in quiet {
        let (change, _) = held.remove(&path).expect("the change is held");
        sink.send(&change.event(path));
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::events::WatchEvent;
    use super::*;

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
            let path = scratch_root().join(format!(
                "arrow-watcher-{name}-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("the scratch directory");
            Self { path }
        }

        fn file(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }
    }

    /// The directory the scratch of a case lies in.
    ///
    /// The scratch lies in the target directory of the build, because the
    /// temporary directory of the machine carries a quota and a case that
    /// cannot write its file proves nothing about the watcher.
    fn scratch_root() -> PathBuf {
        std::env::var("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("target"))
            .join("arrow-scratch")
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    /// A sink that keeps every change, so a case can read what the frontend
    /// would have received.
    #[derive(Default)]
    struct Recorder {
        events: Mutex<Vec<WatchEvent>>,
        sender: Mutex<Option<Sender<WatchEvent>>>,
    }

    impl Recorder {
        fn new() -> (Arc<Recorder>, Receiver<WatchEvent>) {
            let (sender, receiver) = channel();
            let recorder = Arc::new(Recorder {
                events: Mutex::new(Vec::new()),
                sender: Mutex::new(Some(sender)),
            });
            (recorder, receiver)
        }

        fn events(&self) -> Vec<WatchEvent> {
            self.events
                .lock()
                .expect("the recorder")
                .iter()
                .cloned()
                .collect()
        }
    }

    impl EventSink for Recorder {
        fn send(&self, event: &WatchEvent) {
            self.events
                .lock()
                .expect("the recorder")
                .push(event.clone());
            if let Some(sender) = self.sender.lock().expect("the recorder").as_ref() {
                let _ = sender.send(event.clone());
            }
        }
    }

    /// Wait for the change of a path, and answer it.
    fn wait_for(receiver: &Receiver<WatchEvent>, name: &str) -> WatchEvent {
        let deadline = Duration::from_secs(10);

        loop {
            match receiver.recv_timeout(deadline) {
                Ok(event) => {
                    if event.path().file_name().is_some_and(|file| file == name) {
                        return event;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    panic!("no change of {name} arrived in {deadline:?}")
                }
                Err(RecvTimeoutError::Disconnected) => panic!("the watcher stopped"),
            }
        }
    }

    /// True when a change of a path arrives inside the window.
    fn arrives(receiver: &Receiver<WatchEvent>, name: &str, window: Duration) -> bool {
        let deadline = Instant::now() + window;

        while Instant::now() < deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(left) {
                Ok(event) => {
                    if event.path().file_name().is_some_and(|file| file == name) {
                        return true;
                    }
                }
                Err(RecvTimeoutError::Timeout) => return false,
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }

        false
    }

    #[test]
    fn a_file_that_changes_is_reported_as_changed() {
        let scratch = Scratch::new("changed");
        let file = scratch.file("notes.txt");
        fs::write(&file, "first\n").expect("the file");

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");

        fs::write(&file, "second\n").expect("the write");

        let event = wait_for(&receiver, "notes.txt");
        assert_eq!(event, WatchEvent::Changed(file));
        assert_eq!(event.name(), "fs:changed");
    }

    #[test]
    fn a_file_that_appears_is_reported_as_created() {
        let scratch = Scratch::new("created");

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");

        let file = scratch.file("fresh.txt");
        fs::write(&file, "hello\n").expect("the write");

        let event = wait_for(&receiver, "fresh.txt");
        assert_eq!(event, WatchEvent::Created(file));
        assert_eq!(event.name(), "fs:created");
    }

    #[test]
    fn a_file_that_disappears_is_reported_as_deleted() {
        let scratch = Scratch::new("deleted");
        let file = scratch.file("gone.txt");
        fs::write(&file, "here\n").expect("the file");

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");

        fs::remove_file(&file).expect("the removal");

        let event = wait_for(&receiver, "gone.txt");
        assert_eq!(event, WatchEvent::Deleted(file));
        assert_eq!(event.name(), "fs:deleted");
    }

    #[test]
    fn the_directories_the_reader_does_not_want_are_ignored() {
        let scratch = Scratch::new("ignored");
        for ignored in events::IGNORED_DIRECTORIES {
            fs::create_dir_all(scratch.file(ignored)).expect("the directory");
            fs::write(scratch.file(ignored).join("inside.txt"), "x\n").expect("the file");
        }

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");

        for ignored in events::IGNORED_DIRECTORIES {
            fs::write(scratch.file(ignored).join("inside.txt"), "changed\n").expect("the write");
        }

        assert!(
            !arrives(&receiver, "inside.txt", Duration::from_millis(600)),
            "the changes inside the ignored directories were reported: {:?}",
            recorder.events()
        );
    }

    #[test]
    fn a_watch_reports_the_files_below_the_root() {
        let scratch = Scratch::new("deep");
        fs::create_dir_all(scratch.file("src")).expect("the directory");
        let file = scratch.file("src/main.rs");
        fs::write(&file, "fn main() {}\n").expect("the file");

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");

        fs::write(&file, "fn main() { println!(\"arrow\"); }\n").expect("the write");

        let event = wait_for(&receiver, "main.rs");
        assert_eq!(event, WatchEvent::Changed(file));
    }

    #[test]
    fn unwatch_stops_the_changes() {
        let scratch = Scratch::new("unwatch");
        let file = scratch.file("notes.txt");
        fs::write(&file, "first\n").expect("the file");

        let registry = WatcherRegistry::new();
        let (recorder, receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();
        let id = registry
            .watch(&scratch.path, sink)
            .expect("the watch starts");
        assert_eq!(registry.len(), 1);

        registry.unwatch(&id).expect("the watch stops");
        assert!(registry.is_empty());

        fs::write(&file, "second\n").expect("the write");

        assert!(
            !arrives(&receiver, "notes.txt", Duration::from_millis(600)),
            "the watch reported a change after it stopped"
        );
        assert!(recorder.events().is_empty());
    }

    #[test]
    fn an_unknown_watch_is_refused() {
        let registry = WatcherRegistry::new();

        let error = registry
            .unwatch("watch-404")
            .expect_err("there is no such watch");

        assert!(error.contains("watch-404"));
    }

    #[test]
    fn a_directory_that_does_not_exist_is_refused() {
        let registry = WatcherRegistry::new();
        let (recorder, _receiver) = Recorder::new();
        let sink: Arc<dyn EventSink> = recorder.clone();

        let missing = scratch_root().join("arrow-watcher-missing-does-not-exist");

        let error = registry
            .watch(&missing, sink)
            .expect_err("the directory is not there");

        assert!(error.contains("could not be watched"));
    }
}
