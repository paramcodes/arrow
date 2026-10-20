//! The Arrow desktop shell.
//!
//! The Rust side owns every privileged capability: the file system, the
//! terminal, git and the AI client. The webview never holds a secret and
//! never touches the disk directly.

/// Build and run the Arrow desktop shell.
pub fn run() {
    tauri::Builder::default()
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
}
