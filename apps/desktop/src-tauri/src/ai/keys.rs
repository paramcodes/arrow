//! The keychain of the AI feature.
//!
//! The key of a provider lives in the keychain of the operating system and in
//! the memory of the Rust shell. It never leaves Rust. The webview asks
//! whether a key exists, and it gets a boolean back; the key itself never
//! crosses the bridge, never reaches the DOM and never reaches a log.
//!
//! The keychain is written against the [`KeyBackend`] trait, so the store can
//! be driven by a test without a keychain of the operating system, and so the
//! keychain of the operating system stays one implementation of one
//! interface.

use std::sync::Arc;

/// The service the keys of Arrow live under in the keychain of the operating
/// system.
pub const KEYCHAIN_SERVICE: &str = "ai.arrow";

/// The message of a failed call to the keychain.
///
/// The message never carries key material. The keychain of the operating
/// system is asked to describe a failure, and the description is redacted
/// before it is kept, so a failure cannot leak a key into a log or into the
/// webview.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyError {
    message: String,
}

impl KeyError {
    /// The message of the failure.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// The message of the failure.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for KeyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for KeyError {}

/// The prefixes the keys of the known providers carry.
const SECRET_PREFIXES: [&str; 6] = ["sk-", "AIza", "ghp_", "gho_", "xoxb-", "xoxp-"];

/// The length a run of characters needs before it is treated as key material.
const SECRET_RUN: usize = 20;

/// True when the character can be part of a key.
fn is_key_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-'
}

/// Removes the key material from a message.
///
/// A message that leaves Rust reaches the webview, a log and the screen of the
/// reader, so it is scrubbed before it goes. A run of key characters is
/// removed when it starts with the prefix of a known provider or when it is
/// long enough to be a key. The scrubbing is deliberately eager: a message
/// that loses a word is a small price for a message that cannot carry a key.
pub fn redact(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut scrubbed = String::with_capacity(text.len());
    let mut index = 0;

    while index < characters.len() {
        if !is_key_char(characters[index]) {
            scrubbed.push(characters[index]);
            index += 1;
            continue;
        }

        let mut end = index;
        while end < characters.len() && is_key_char(characters[end]) {
            end += 1;
        }

        let run: String = characters[index..end].iter().collect();
        let known = SECRET_PREFIXES.iter().any(|prefix| run.starts_with(prefix));
        if known || run.len() >= SECRET_RUN {
            scrubbed.push_str("[redacted]");
        } else {
            scrubbed.push_str(&run);
        }

        index = end;
    }

    scrubbed
}

/// The keychain behind the store.
///
/// Every implementation keeps the key outside the webview: the operating
/// system keeps it in its keychain, and a test keeps it in memory.
pub trait KeyBackend: Send + Sync {
    /// Write the key of a provider.
    fn set(&self, provider: &str, key: &str) -> Result<(), KeyError>;

    /// Read the key of a provider, or nothing when the provider has no key.
    fn get(&self, provider: &str) -> Result<Option<String>, KeyError>;

    /// Remove the key of a provider.
    fn delete(&self, provider: &str) -> Result<(), KeyError>;
}

/// The keychain of the operating system.
///
/// The key never leaves this process: it is written to the keychain of the
/// desktop and read back from it, and both calls stay in Rust.
pub struct OsKeychain;

impl KeyBackend for OsKeychain {
    fn set(&self, provider: &str, key: &str) -> Result<(), KeyError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, provider).map_err(|error| {
            KeyError::new(format!(
                "the keychain refused an entry for {provider}: {}",
                redact(&error.to_string())
            ))
        })?;

        entry.set_password(key).map_err(|error| {
            KeyError::new(format!(
                "the keychain refused the key of {provider}: {}",
                redact(&error.to_string())
            ))
        })
    }

    fn get(&self, provider: &str) -> Result<Option<String>, KeyError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, provider).map_err(|error| {
            KeyError::new(format!(
                "the keychain refused an entry for {provider}: {}",
                redact(&error.to_string())
            ))
        })?;

        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(KeyError::new(format!(
                "the keychain refused the key of {provider}: {}",
                redact(&error.to_string())
            ))),
        }
    }

    fn delete(&self, provider: &str) -> Result<(), KeyError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, provider).map_err(|error| {
            KeyError::new(format!(
                "the keychain refused an entry for {provider}: {}",
                redact(&error.to_string())
            ))
        })?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(KeyError::new(format!(
                "the keychain refused to remove the key of {provider}: {}",
                redact(&error.to_string())
            ))),
        }
    }
}

/// The store of the keys of the AI feature.
///
/// The store is the only place in the shell that knows a key. It offers two
/// faces: one for the webview, which asks whether a key exists, and one for
/// Rust, which reads the key to hand it to the client.
pub struct KeyStore {
    backend: Arc<dyn KeyBackend>,
}

impl KeyStore {
    /// A store over the keychain of the operating system.
    pub fn os() -> Self {
        Self::new(Arc::new(OsKeychain))
    }

    /// A store over the given keychain.
    pub fn new(backend: Arc<dyn KeyBackend>) -> Self {
        Self { backend }
    }

    /// Write the key of a provider.
    pub fn set(&self, provider: &str, key: &str) -> Result<(), KeyError> {
        let provider = provider_name(provider)?;
        let key = key.trim();
        if key.is_empty() {
            return Err(KeyError::new("the key is empty"));
        }

        self.backend.set(&provider, key)
    }

    /// True when the provider has a key.
    ///
    /// This is the answer the webview gets. It is a boolean, and it is the
    /// only thing about a key that ever crosses the bridge.
    pub fn exists(&self, provider: &str) -> bool {
        let provider = match provider_name(provider) {
            Ok(provider) => provider,
            Err(_) => return false,
        };

        match self.backend.get(&provider) {
            Ok(Some(key)) => !key.is_empty(),
            Ok(None) => false,
            Err(_) => false,
        }
    }

    /// Remove the key of a provider.
    pub fn delete(&self, provider: &str) -> Result<(), KeyError> {
        let provider = provider_name(provider)?;
        self.backend.delete(&provider)
    }

    /// The key of a provider, for Rust only.
    ///
    /// The key read here goes straight into the client of the AI feature. It
    /// is never returned to the webview, never written to a log and never
    /// kept in a store of the frontend.
    pub fn secret(&self, provider: &str) -> Result<Option<String>, KeyError> {
        let provider = provider_name(provider)?;
        self.backend.get(&provider)
    }
}

/// The name a provider is known by in the keychain.
///
/// The name is trimmed and lowered, so the webview cannot write one key
/// under two names and then read neither of them.
fn provider_name(provider: &str) -> Result<String, KeyError> {
    let name = provider.trim().to_ascii_lowercase();
    if name.is_empty() {
        return Err(KeyError::new("the provider has no name"));
    }

    Ok(name)
}

#[cfg(test)]
pub(crate) mod testing {
    use super::{KeyBackend, KeyError};

    /// A keychain that keeps the keys in memory.
    ///
    /// The tests of the shell run on a machine that has no keychain of the
    /// desktop, and a test that needs a key must not need one.
    #[derive(Default)]
    pub struct MemoryKeychain {
        entries: std::sync::Mutex<std::collections::HashMap<String, String>>,
    }

    impl MemoryKeychain {
        /// An empty keychain.
        pub fn new() -> Self {
            Self::default()
        }

        /// The keys the keychain holds, for a test that reads them.
        pub fn keys(&self) -> Vec<String> {
            let mut keys: Vec<String> = self
                .entries
                .lock()
                .expect("the memory keychain")
                .keys()
                .cloned()
                .collect();
            keys.sort();
            keys
        }
    }

    impl KeyBackend for MemoryKeychain {
        fn set(&self, provider: &str, key: &str) -> Result<(), KeyError> {
            self.entries
                .lock()
                .expect("the memory keychain")
                .insert(provider.to_string(), key.to_string());
            Ok(())
        }

        fn get(&self, provider: &str) -> Result<Option<String>, KeyError> {
            Ok(self
                .entries
                .lock()
                .expect("the memory keychain")
                .get(provider)
                .cloned())
        }

        fn delete(&self, provider: &str) -> Result<(), KeyError> {
            self.entries
                .lock()
                .expect("the memory keychain")
                .remove(provider);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::MemoryKeychain;
    use super::*;

    fn store() -> (KeyStore, Arc<MemoryKeychain>) {
        let backend = Arc::new(MemoryKeychain::new());
        (KeyStore::new(backend.clone()), backend)
    }

    #[test]
    fn a_key_is_written_and_read_back() {
        let (store, backend) = store();

        store.set("anthropic", "sk-test-value").expect("the write");

        assert!(store.exists("anthropic"));
        assert_eq!(backend.keys(), ["anthropic"]);
    }

    #[test]
    fn the_store_reports_a_missing_key_as_absent() {
        let (store, _backend) = store();

        assert!(!store.exists("openai"));
        assert_eq!(store.secret("openai").expect("the read"), None);
    }

    #[test]
    fn a_deleted_key_is_gone() {
        let (store, backend) = store();
        store.set("google", "sk-test-value").expect("the write");

        store.delete("google").expect("the delete");

        assert!(!store.exists("google"));
        assert!(backend.keys().is_empty());
    }

    #[test]
    fn the_provider_name_is_trimmed_and_lowered() {
        let (store, backend) = store();

        store
            .set("  Anthropic ", "sk-test-value")
            .expect("the write");

        assert!(store.exists("anthropic"));
        assert_eq!(backend.keys(), ["anthropic"]);
    }

    #[test]
    fn a_provider_without_a_name_is_refused() {
        let (store, _backend) = store();

        assert!(store.set("   ", "sk-test-value").is_err());
        assert!(!store.exists(""));
    }

    #[test]
    fn an_empty_key_is_refused() {
        let (store, backend) = store();

        assert!(store.set("anthropic", "   ").is_err());
        assert!(backend.keys().is_empty());
    }

    #[test]
    fn the_secret_is_read_in_rust_only() {
        let (store, _backend) = store();
        store.set("anthropic", "sk-test-value").expect("the write");

        assert_eq!(
            store.secret("anthropic").expect("the read"),
            Some("sk-test-value".to_string())
        );
    }

    #[test]
    fn a_scrubbed_message_carries_no_key() {
        let message = "the request failed with sk-ant-api03-1234567890abcdef";

        let scrubbed = redact(message);

        assert!(!scrubbed.contains("sk-ant-api03-1234567890abcdef"));
        assert!(scrubbed.contains("[redacted]"));
    }

    #[test]
    fn a_long_run_of_characters_is_scrubbed() {
        let message = "the provider answered with AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

        let scrubbed = redact(message);

        assert!(!scrubbed.contains("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    }

    #[test]
    fn an_ordinary_message_survives_the_scrubbing() {
        let message = "the provider anthropic refused the request";

        assert_eq!(redact(message), message);
    }
}
