//! The Arrow desktop shell.
//!
//! The Rust side owns every privileged capability: the file system, the
//! terminal, git and the AI client. The webview never holds a secret and
//! never touches the disk directly.

use std::sync::Arc;

use tauri::Manager;

pub mod commands;
pub mod pty;

/// The file watcher of the shell. It watches a directory and reports every
/// change of it.
pub mod watcher;

/// The terminal commands sit in `commands/terminal.rs`, beside the other
/// commands. This session owns `lib.rs` and not `commands/mod.rs`, so the
/// module is declared here rather than in the commands module.
#[path = "commands/terminal.rs"]
pub mod terminal;

/// The git commands sit in `commands/git.rs`, beside the other commands, and
/// this session owns `lib.rs` and not `commands/mod.rs`.
#[path = "commands/git.rs"]
pub mod git;

/// The watcher commands sit in `commands/watcher.rs`, beside the other
/// commands, and this session owns `lib.rs` and not `commands/mod.rs`. The
/// engine they call lives in `watcher/`, so the two names differ.
#[path = "commands/watcher.rs"]
pub mod watcher_commands;

/// The AI commands sit in `commands/ai.rs`, beside the other commands, and
/// this session owns `lib.rs` and not `commands/mod.rs`.
#[path = "commands/ai.rs"]
pub mod ai_commands;

/// The keychain commands sit in `commands/keys.rs`, beside the other commands.
#[path = "commands/keys.rs"]
pub mod key_commands;

/// The AI feature: the client, the providers, the normalizers and the model
/// registry live in `ai/`, and the module tree of that directory lives in
/// `ai/mod.rs`.
///
/// The two halves of this feature were written at the same time against one
/// contract, so the tree is declared here and the two files of this half are
/// declared beside it with a path of their own. The tree keeps the names the
/// contract fixed: `crate::ai::models` and `crate::ai::client`.
pub mod ai;

/// The context builder of the AI feature.
///
/// The client, the providers and the normalizers live in `ai/` beside it, and
/// the other half of this session owns those files. The builder and the
/// keychain are declared here, so the module tree of the feature does not
/// depend on the half that is written at the same time.
#[path = "ai/context.rs"]
pub mod ai_context;

/// The keychain of the AI feature. The key of a provider lives here and in the
/// keychain of the operating system, and it never leaves Rust.
#[path = "ai/keys.rs"]
pub mod ai_keys;

/// Build and run the Arrow desktop shell.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // One manager for the application. Its sink emits to the main
            // window, which is the only window the shell opens.
            let sink = Arc::new(pty::TauriSink::new(app.handle().clone()));
            app.manage(pty::PtyManager::new(sink));
            // The watches of the application live as long as the shell does.
            app.manage(watcher::WatcherRegistry::new());
            // The requests of the AI feature live as long as the shell does,
            // so a cancel can find the request that is in flight.
            app.manage(Arc::new(ai_commands::AiRequests::new()));
            // The keys live in the keychain of the operating system. The
            // webview never holds one.
            app.manage(ai_keys::KeyStore::os());
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
            git::git_branch,
            git::git_status,
            git::git_diff_stat,
            watcher_commands::watch_directory,
            watcher_commands::unwatch,
            ai_commands::complete,
            ai_commands::inline_edit,
            ai_commands::cancel_request,
            key_commands::set_api_key,
            key_commands::get_api_key,
            key_commands::delete_api_key,
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

    /// The watcher and the git commands are registered on the same shell. The
    /// lists are the five names of the frontend contract, in one place.
    #[test]
    fn the_watcher_and_git_commands_are_part_of_the_contract() {
        assert_eq!(crate::watcher_commands::COMMANDS.len(), 2);
        assert!(crate::watcher_commands::COMMANDS.contains(&"watch_directory"));
        assert!(crate::watcher_commands::COMMANDS.contains(&"unwatch"));

        assert_eq!(crate::git::COMMANDS.len(), 3);
        assert!(crate::git::COMMANDS.contains(&"git_branch"));
        assert!(crate::git::COMMANDS.contains(&"git_status"));
        assert!(crate::git::COMMANDS.contains(&"git_diff_stat"));
    }

    /// The AI commands are registered on the same shell. The lists are the
    /// names of the frontend contract, in one place.
    #[test]
    fn the_ai_commands_are_part_of_the_contract() {
        assert_eq!(crate::ai_commands::COMMANDS.len(), 3);
        assert!(crate::ai_commands::COMMANDS.contains(&"complete"));
        assert!(crate::ai_commands::COMMANDS.contains(&"inline_edit"));
        assert!(crate::ai_commands::COMMANDS.contains(&"cancel_request"));

        assert_eq!(crate::key_commands::COMMANDS.len(), 3);
        assert!(crate::key_commands::COMMANDS.contains(&"set_api_key"));
        assert!(crate::key_commands::COMMANDS.contains(&"get_api_key"));
        assert!(crate::key_commands::COMMANDS.contains(&"delete_api_key"));
    }

    /// The folder picker is a plugin of the shell, and the capability that
    /// allows it lies in the tree.    ///
    /// The permission of the plugin resolves only when the plugin is
    /// registered, so the build of the shell is what proves the registration.
    /// The capability itself proves that the picker is allowed.
    #[test]
    fn the_folder_picker_is_allowed() {
        let capabilities = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let path = capabilities.join("dialog.json");
        let capability: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("capabilities/dialog.json"),
        )
        .expect("capabilities/dialog.json is valid JSON");

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

        assert!(
            permissions
                .iter()
                .any(|permission| permission.starts_with("dialog:")),
            "the folder picker is allowed: {permissions:?}"
        );
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
    }
}
