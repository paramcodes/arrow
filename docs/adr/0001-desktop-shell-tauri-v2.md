# Use Tauri v2 for the desktop shell

Status: Accepted, 2026-10-21.

## Context and Problem Statement

Arrow is a standalone, AI-native code editor built from scratch. It is not a fork of VS Code, so it does not inherit VS Code's shell, and it does not depend on the VS Code extension marketplace. The app needs a desktop window on Windows, macOS, and Linux, direct file system access, a pseudo-terminal for the integrated terminal, and git integration. Later phases add the Rust AI streaming client. Which shell do we build on?

## Decision Drivers

- Bundle size and idle memory shape the first impression. An editor that loads in a second and idles low feels native. One that idles at 250 MB does not.
- The backend work for PTY, file watching, git, and the AI client lands in Rust. A shell backend in another language either duplicates that work or bridges to it.
- The UI uses web platform features: CodeMirror 6, WebGL rendering for the terminal, modern CSS.
- No VS Code extension compatibility is required. This removes Electron's strongest argument for this project.
- A capable security model matters, because the app reads, writes, and executes things on the user's disk.

## Considered Options

- Tauri v2
- Electron
- NW.js

### Tauri v2

- Good, because the bundle is about 20 MB and idle memory is about 50 to 80 MB, against roughly 150 MB and 250 MB for Chromium plus Node shells.
- Good, because the backend is Rust, which is the same language the PTY manager (`portable-pty`), the file watcher (`notify`), the git bindings (`git2`), and the AI streaming client already use.
- Good, because Tauri v2 ships capability-based permissions over its IPC, which matches the need to limit editor code's access to the disk.
- Bad, because the webview engine differs per platform: WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. Each needs testing.
- Bad, because the Tauri community is smaller than Electron's, and some answers take longer to find.

### Electron

- Good, because it is proven for this exact product shape: VS Code, Cursor, and Atom all run on it.
- Good, because VS Code extensions would run natively, if we ever changed course on that requirement.
- Bad, because every window ships Chromium and Node, which costs roughly 130 MB of bundle and about four times the idle memory of Tauri.
- Bad, because the backend is JavaScript, so the PTY, watcher, git, and AI streaming work would either be re-implemented in JS or wrapped with a bridge.

### NW.js

- Good, for the same Chromium plus Node capability set as Electron.
- Bad, because its community and release cadence are smaller than both alternatives, and it offers no advantage over Electron for this project.

## Decision Outcome

Chosen option: "Tauri v2", because we build from scratch, so Electron's extension compatibility buys nothing, while 20 MB bundles and 50-to-80 MB idle memory are paid, or saved, on every launch. The Rust backend matches where the PTY, file watching, git, and AI streaming code already lives, and Tauri v2's capability system fits the disk-heavy nature of an editor.

### Consequences

- Good, because the binary stays small and the app idles low, which matters when the process holds numerous open buffers and terminal sessions.
- Good, because one language, Rust, covers the shell backend and all native features, and one toolchain covers their tests.
- Bad, because webview differences across the three platforms need a real test matrix and occasional platform branches.
- Bad, because contributors need enough Rust to work in `apps/desktop/src-tauri`, not just TypeScript.
- Neutral, because VS Code extension compatibility can return later through a sidecar process if it ever becomes a product requirement.

## Confirmation

Session 1 of the MVP plan closes this decision in practice: `pnpm dev` launches the empty Tauri window, and `pnpm verify` and `pnpm harness` exit 0. The Windows, macOS, and Linux build matrix in CI covers the platform webview differences.

## More Information

The full comparison, including the memory and bundle table, is in [docs/plan/discovery.md](../plan/discovery.md), section 3. The scaffold work that installs the shell is Session 1 in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
