//! The terminal commands of the Rust shell.
//!
//! The webview opens a terminal, types into it, resizes it and closes it
//! through these five commands. Every command answers with the message of the
//! failure when it fails, so the frontend can show it; the app itself decides
//! what to do about it, which is nothing more than a closed tab.
//!
//! The output of a session does not come back through a command. It leaves as
//! the events `pty:data:{id}` and `pty:exit:{id}`, built in `pty::stream` and
//! emitted by the session's sink to the main window.
//!
//! The names below are the contract the frontend is written against. A second
//! spelling of any of them would break the other half of this session.

use tauri::State;

use crate::pty::PtyManager;

/// The five commands the frontend invokes, in the order it may call them.
pub const COMMANDS: [&str; 5] = [
    "create_pty",
    "write_pty",
    "resize_pty",
    "kill_pty",
    "pty_alive",
];

/// Spawn a shell and answer with the id of its session.
pub fn create_session(state: &PtyManager, cols: u16, rows: u16) -> Result<String, String> {
    state.create(cols, rows)
}

/// Write the UTF-8 bytes of `data` to the shell.
pub fn write_session(state: &PtyManager, id: &str, data: &str) -> Result<(), String> {
    state.write(id, data)
}

/// Tell the PTY its new size, in columns and rows.
pub fn resize_session(state: &PtyManager, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(id, cols, rows)
}

/// Kill the shell and forget the session.
pub fn kill_session(state: &PtyManager, id: &str) -> Result<(), String> {
    state.kill(id)
}

/// True while the session exists.
pub fn session_alive(state: &PtyManager, id: &str) -> bool {
    state.alive(id)
}

/// `create_pty(cols, rows)` spawns the default shell and returns its id.
#[tauri::command]
pub fn create_pty(state: State<'_, PtyManager>, cols: u16, rows: u16) -> Result<String, String> {
    create_session(&state, cols, rows)
}

/// `write_pty(id, data)` writes the text of `data` to the shell.
#[tauri::command]
pub fn write_pty(state: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    write_session(&state, &id, &data)
}

/// `resize_pty(id, cols, rows)` resizes the PTY.
#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    resize_session(&state, &id, cols, rows)
}

/// `kill_pty(id)` kills the shell and removes the session.
#[tauri::command]
pub fn kill_pty(state: State<'_, PtyManager>, id: String) -> Result<(), String> {
    kill_session(&state, &id)
}

/// `pty_alive(id)` reports whether the session still exists.
#[tauri::command]
pub fn pty_alive(state: State<'_, PtyManager>, id: String) -> bool {
    session_alive(&state, &id)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::pty::stream::PtySink;
    use crate::pty::testing::Recorder;

    fn manager() -> (PtyManager, Arc<Recorder>) {
        let recorder = Arc::new(Recorder::default());
        let sink: Arc<dyn PtySink> = recorder.clone();
        (PtyManager::new(sink), recorder)
    }

    #[test]
    fn the_five_commands_are_the_contract() {
        assert_eq!(
            COMMANDS,
            [
                "create_pty",
                "write_pty",
                "resize_pty",
                "kill_pty",
                "pty_alive"
            ]
        );
    }

    #[test]
    fn create_answers_with_a_live_session_id() {
        let (manager, _recorder) = manager();

        let id = create_session(&manager, 80, 24).expect("the session starts");

        assert!(id.starts_with("pty-"), "the id names a terminal: {id}");
        assert!(session_alive(&manager, &id));
        kill_session(&manager, &id).expect("the session is killed");
    }

    #[test]
    fn write_reaches_the_shell() {
        let (manager, recorder) = manager();
        let id = create_session(&manager, 80, 24).expect("the session starts");

        write_session(&manager, &id, "echo arrow-ok\n").expect("the command is written");

        assert!(
            recorder.wait_for_text(&id, "arrow-ok"),
            "the shell answered: {:?}",
            recorder.text(&id)
        );
        kill_session(&manager, &id).expect("the session is killed");
    }

    #[test]
    fn resize_and_alive_answer_for_a_live_session() {
        let (manager, recorder) = manager();
        let id = create_session(&manager, 80, 24).expect("the session starts");

        resize_session(&manager, &id, 120, 40).expect("the session resizes");
        write_session(&manager, &id, "stty size\n").expect("the size is asked for");

        assert!(
            recorder.wait_for_text(&id, "40 120"),
            "the shell reports the new size: {:?}",
            recorder.text(&id)
        );
        assert!(session_alive(&manager, &id));
        kill_session(&manager, &id).expect("the session is killed");
    }

    #[test]
    fn kill_ends_the_session_and_alive_says_so() {
        let (manager, _recorder) = manager();
        let id = create_session(&manager, 80, 24).expect("the session starts");
        assert!(session_alive(&manager, &id));

        kill_session(&manager, &id).expect("the session is killed");

        assert!(!session_alive(&manager, &id));
        assert!(
            kill_session(&manager, &id).is_err(),
            "a closed tab cannot be closed twice"
        );
    }

    #[test]
    fn every_command_refuses_an_unknown_id() {
        let (manager, _recorder) = manager();

        assert!(!session_alive(&manager, "pty-0-0"));
        assert!(write_session(&manager, "pty-0-0", "x").is_err());
        assert!(resize_session(&manager, "pty-0-0", 80, 24).is_err());
        assert!(kill_session(&manager, "pty-0-0").is_err());
    }

    /// Application commands are not gated by the Tauri ACL; only plugins are.
    /// The capability therefore grants no terminal permission, and this test
    /// fails if one ever appears, because a permission the shell never defined
    /// would stop the build and a wildcard would widen the shell.
    #[test]
    fn the_capability_grants_no_terminal_permission() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
        let capability: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("capabilities/default.json"),
        )
        .expect("capabilities/default.json is valid JSON");

        let windows = capability["windows"]
            .as_array()
            .expect("the capability names its windows");
        assert_eq!(windows, &vec![serde_json::json!("main")]);

        let permissions: Vec<String> = capability["permissions"]
            .as_array()
            .expect("the capability lists its permissions")
            .iter()
            .map(|permission| {
                permission
                    .as_str()
                    .expect("a permission is a string")
                    .to_string()
            })
            .collect();
        assert_eq!(
            permissions,
            ["core:default", "store:default"],
            "the shell grants only the core and store defaults"
        );
        assert!(
            !permissions
                .iter()
                .any(|permission| permission.contains("terminal")),
            "the terminal commands are application commands, not permissions"
        );
    }
}
