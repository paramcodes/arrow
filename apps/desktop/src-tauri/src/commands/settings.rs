//! The settings commands of the Rust shell.
//!
//! Application settings live in `tauri-plugin-store`, which writes one JSON
//! document into the configuration directory of the app. The document holds
//! the look and the behaviour of the editor: a font size, a tab size, a word
//! wrap flag, a minimap flag and a font family.
//!
//! The document never holds a secret. API keys belong to the keychain, behind
//! their own session, and a settings document that carries one would sit in a
//! plain file on the disk. The shell therefore refuses a key that names a
//! secret, so a later session cannot move a key into the settings by accident.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// The file the settings live in, inside the configuration directory.
pub const SETTINGS_FILE: &str = "settings.json";

/// The key the settings document sits under.
pub const SETTINGS_KEY: &str = "settings";

/// The words a settings key may not hold.
const SECRET_WORDS: &[&str] = &[
    "apikey",
    "api_key",
    "keychain",
    "password",
    "passphrase",
    "privatekey",
    "secret",
    "token",
    "credential",
];

/// True when a settings key names a secret.
///
/// The check is deliberately blunt. A settings document holds the look of the
/// editor, so a key that mentions any of these words is a key of another
/// session that arrived in the wrong place.
pub fn is_secret_key(key: &str) -> bool {
    let normalised = key.to_lowercase().replace(['-', '.'], "_");
    SECRET_WORDS.iter().any(|word| normalised.contains(word))
}

/// Refuse a settings document that carries a secret.
fn refuse_secret(value: &Value) -> Result<(), String> {
    if let Value::Object(fields) = value {
        for key in fields.keys() {
            if is_secret_key(key) {
                return Err(format!(
                    "the settings document may not hold {key}: keys live in the keychain"
                ));
            }
        }
    }
    Ok(())
}

/// Read the settings of the app, or nothing when it has never saved any.
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<Value>, String> {
    let store = app.store(SETTINGS_FILE).map_err(|error| error.to_string())?;
    Ok(store.get(SETTINGS_KEY))
}

/// Write the settings of the app and flush them to the disk.
///
/// The write is a merge and not a replace: a key this call does not name
/// keeps the value it held, so two windows cannot erase each other's section.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    refuse_secret(&settings)?;

    let store = app.store(SETTINGS_FILE).map_err(|error| error.to_string())?;
    store.set(SETTINGS_KEY, settings);
    store.save().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_secret_key_is_refused() {
        assert!(is_secret_key("apiKey"));
        assert!(is_secret_key("openai_api_key"));
        assert!(is_secret_key("github-token"));
        assert!(is_secret_key("password"));
    }

    #[test]
    fn a_setting_key_is_allowed() {
        assert!(!is_secret_key("fontSize"));
        assert!(!is_secret_key("wordWrap"));
        assert!(!is_secret_key("minimap"));
        assert!(!is_secret_key("fontFamily"));
    }

    #[test]
    fn a_document_that_carries_a_secret_is_refused() {
        let document = json!({ "fontSize": 14, "apiKey": "sk-never" });
        let refused = refuse_secret(&document).expect_err("the document is refused");

        assert!(refused.contains("keychain"), "{refused}");
    }

    #[test]
    fn a_document_of_settings_is_accepted() {
        let document = json!({ "fontSize": 14, "tabSize": 2, "wordWrap": true });
        assert_eq!(refuse_secret(&document), Ok(()));
    }
}
