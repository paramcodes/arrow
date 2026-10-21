//! The Arrow desktop shell.
//!
//! The Rust side owns every privileged capability: the file system, the
//! terminal, git and the AI client. The webview never holds a secret and
//! never touches the disk directly.

use std::sync::Arc;

use tauri::Manager;

pub mod commands;
pub mod pty;

/// The terminal commands sit in `commands/terminal.rs`, beside the other
/// commands. This session owns `lib.rs` and not `commands/mod.rs`, so the
/// module is declared here rather than in the commands module.
#[path = "commands/terminal.rs"]
pub mod terminal;

/// Build and run the Arrow desktop shell.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // One manager for the application. Its sink emits to the main
            // window, which is the only window the shell opens.
            let sink = Arc::new(pty::TauriSink::new(app.handle().clone()));
            app.manage(pty::PtyManager::new(sink));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_entry,
            commands::fs::delete_entry,
            commands::fs::rename_entry,
            commands::search::search_files,
            commands::search::list_files,
            commands::settings::load_settings,
            commands::settings::save_settings,
            terminal::create_pty,
            terminal::write_pty,
            terminal::resize_pty,
            terminal::kill_pty,
            terminal::pty_alive,
        ])
        .run(tauri::generate_context!())
        .expect("the Arrow desktop shell failed to start");
}

#[cfg(test)]
mod tests {
    /// The window title and the bundle name come from `tauri.conf.json`.
    /// The test reads that file, so a renamed product fails the Rust suite.
    #[test]
    fn the_shell_is_named_arrow() {
        let config_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).expect("tauri.conf.json"))
                .expect("tauri.conf.json is valid JSON");

        assert_eq!(config["productName"], "Arrow");

        let windows = config["app"]["windows"]
            .as_array()
            .expect("the config declares the windows");
        let title = windows[0]["title"]
            .as_str()
            .expect("the main window has a title");
        assert_eq!(title, "Arrow");
    }

    /// The terminal commands are registered on the shell the webview talks to.
    /// The list is the five names of the frontend contract, in one place.
    #[test]
    fn the_terminal_commands_are_part_of_the_contract() {
        assert_eq!(crate::terminal::COMMANDS.len(), 5);
        assert!(crate::terminal::COMMANDS.contains(&"create_pty"));
        assert!(crate::terminal::COMMANDS.contains(&"write_pty"));
        assert!(crate::terminal::COMMANDS.contains(&"resize_pty"));
        assert!(crate::terminal::COMMANDS.contains(&"kill_pty"));
        assert!(crate::terminal::COMMANDS.contains(&"pty_alive"));
    }
}
