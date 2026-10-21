//! The commands the webview may run in the Rust shell.
//!
//! Every privileged capability lives here, behind a command the frontend
//! invokes through `apps/desktop/src/lib/tauri.ts`. The file system is the
//! first one: the webview reads and writes the disk through these commands
//! only.

pub mod fs;
