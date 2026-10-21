//! The keychain commands of the Rust shell.
//!
//! The webview asks the shell to write a key, to remove a key and to say
//! whether a key exists. The key itself goes into the keychain of the
//! operating system and stays there: the command that writes it answers with
//! nothing, and the command that reads it answers with a boolean.

use tauri::State;

use crate::ai_keys::KeyStore;

/// The three commands the frontend invokes.
///
/// The names below are the contract the frontend is written against. A second
/// spelling of any of them would break the other half of this session.
pub const COMMANDS: [&str; 3] = ["set_api_key", "get_api_key", "delete_api_key"];

/// Write the key of a provider into the keychain.
pub fn set_key(store: &KeyStore, provider: &str, key: &str) -> Result<(), String> {
    store
        .set(provider, key)
        .map_err(|error| error.message().to_string())
}

/// True when the provider has a key.
pub fn has_key(store: &KeyStore, provider: &str) -> bool {
    store.exists(provider)
}

/// Remove the key of a provider.
pub fn delete_key(store: &KeyStore, provider: &str) -> Result<(), String> {
    store
        .delete(provider)
        .map_err(|error| error.message().to_string())
}

/// `set_api_key(provider, key)` writes the key of a provider into the
/// keychain of the operating system.
#[tauri::command]
pub fn set_api_key(
    state: State<'_, KeyStore>,
    provider: String,
    key: String,
) -> Result<(), String> {
    set_key(&state, &provider, &key)
}

/// `get_api_key(provider)` reports whether the provider has a key.
///
/// The answer is a boolean. The key never crosses the bridge.
#[tauri::command]
pub fn get_api_key(state: State<'_, KeyStore>, provider: String) -> bool {
    has_key(&state, &provider)
}

/// `delete_api_key(provider)` removes the key of a provider.
#[tauri::command]
pub fn delete_api_key(state: State<'_, KeyStore>, provider: String) -> Result<(), String> {
    delete_key(&state, &provider)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::ai_keys::testing::MemoryKeychain;

    fn store() -> (KeyStore, Arc<MemoryKeychain>) {
        let backend = Arc::new(MemoryKeychain::new());
        (KeyStore::new(backend.clone()), backend)
    }

    #[test]
    fn the_three_commands_are_the_contract() {
        assert_eq!(COMMANDS, ["set_api_key", "get_api_key", "delete_api_key"]);
    }

    #[test]
    fn a_key_is_written_and_the_answer_is_a_boolean() {
        let (store, backend) = store();

        set_key(&store, "anthropic", "sk-test-value").expect("the write");

        let answer = has_key(&store, "anthropic");
        assert!(answer, "the answer is true");
        assert_eq!(backend.keys(), ["anthropic"]);
    }

    #[test]
    fn a_provider_without_a_key_answers_false() {
        let (store, _backend) = store();

        assert!(!has_key(&store, "anthropic"));
    }

    #[test]
    fn a_key_is_removed() {
        let (store, backend) = store();
        set_key(&store, "anthropic", "sk-test-value").expect("the write");

        delete_key(&store, "anthropic").expect("the delete");

        assert!(!has_key(&store, "anthropic"));
        assert!(backend.keys().is_empty());
    }
}
