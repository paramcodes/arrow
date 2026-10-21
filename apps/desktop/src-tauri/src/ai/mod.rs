//! The AI client of the shell.
//!
//! The client owns the request model, the three providers, the normalizers
//! that turn every wire format into one internal event shape, the reader of
//! the stream, and the registry of the models. The keychain and the
//! commands the webview calls live in the other half of the session, and
//! they declare their modules at the end of this file.

pub mod client;
pub mod models;
pub mod providers;
pub mod stream;

// The keychain and the context builder of the other half of the session
// declare their modules here.
