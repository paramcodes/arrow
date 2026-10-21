//! The watcher commands of the Rust shell.
//!
//! The webview opens a project and asks the shell to watch it. The shell
//! watches the directory, and every change of that directory leaves as an
//! event for the main window. The frontend closes the watch when it closes
//! the project.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::{CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::watcher::{EventSink, WatchEvent, WatcherRegistry};

/// The two commands the frontend invokes.
///
/// The names below are the contract the frontend is written against. A second
/// spelling of any of them would break the other half of this session.
pub const COMMANDS: [&str; 2] = ["watch_directory", "unwatch"];

/// The sink that sends the changes of the watcher to the main window.
struct WindowSink {
    app: AppHandle,
}

impl EventSink for WindowSink {
    fn send(&self, event: &WatchEvent) {
        let _ = self.app.emit_to("main", event.name(), event.payload());
    }
}

/// Watch a directory and answer the id of the watch.
///
/// The id is what the frontend hands back to stop the watch.
#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    state: State<'_, WatcherRegistry>,
    path: String,
) -> Result<String, String> {
    let root = PathBuf::from(path);

    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    state.watch(&root, Arc::new(WindowSink { app }))
}

/// Stop the watch of an id.
#[tauri::command]
pub fn unwatch(state: State<'_, WatcherRegistry>, watch_id: WatchId) -> Result<(), String> {
    state.unwatch(&watch_id.0)
}

/// The id of a watch, as the webview sends it.
///
/// The two halves of this session were written in parallel against one
/// contract, and the contract names this argument `watch_id` while the
/// boundary of the webview speaks camel case. The command reads the id under
/// either name, so the call works whichever spelling the frontend sends.
pub struct WatchId(pub String);

impl WatchId {
    /// The id inside the payload of the webview.
    pub fn of(payload: &serde_json::Value) -> Option<String> {
        payload
            .get("watchId")
            .or_else(|| payload.get("watch_id"))
            .or_else(|| payload.get("id"))
            .and_then(|id| id.as_str())
            .map(|id| id.to_string())
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for WatchId {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let InvokeBody::Json(payload) = command.message.payload() else {
            return Err(InvokeError::from("unwatch needs the id of a watch"));
        };

        WatchId::of(payload)
            .map(WatchId)
            .ok_or_else(|| InvokeError::from("unwatch needs the id of a watch"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_of_a_watch_is_read_under_either_spelling() {
        let camel = serde_json::json!({ "watchId": "watch-1" });
        let snake = serde_json::json!({ "watch_id": "watch-1" });

        assert_eq!(WatchId::of(&camel), Some("watch-1".to_string()));
        assert_eq!(WatchId::of(&snake), Some("watch-1".to_string()));
    }

    #[test]
    fn a_payload_without_an_id_has_none() {
        let payload = serde_json::json!({ "other": "watch-1" });

        assert_eq!(WatchId::of(&payload), None);
    }
}
