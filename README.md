# Arrow

Arrow is a desktop code editor built with Tauri v2, React 19 and Vite, with AI completions that
run in the Rust shell. It is for developers who want to know where their code runs and where their
API key lives.

[![CI](https://github.com/paramcodes/arrow/actions/workflows/ci.yml/badge.svg)](https://github.com/paramcodes/arrow/actions/workflows/ci.yml)

The window of Arrow: the file tree on the left, the editor area in the middle, the status bar at
the bottom.

![The window of Arrow](docs/images/arrow-shell.png)

The completion of the AI feature arrives as ghost text after the caret, and the tree carries the
`M`, `U` and `D` badges of git.

![The ghost text of the AI feature and the badges of the tree](docs/images/ghost-text.png)

The command palette searches the commands of the shell.

![The command palette](docs/images/command-palette.png)

## What it does

- A file tree that follows the disk. The Rust watcher sends `fs:changed`, `fs:created` and
  `fs:deleted`, and the tree updates without a refresh.
- A CodeMirror 6 editor with tabs, breadcrumbs and a dirty marker. `Ctrl+S` writes the file back.
- Ghost text for the AI feature. The suggestion appears after the caret, `Tab` takes it and
  `Escape` throws it away.
- A terminal on a real PTY. Every tab owns one shell, and the output comes back in chunks.
- Git in the status bar and in the tree. The branch, the counts of the diff, and a badge on every
  changed file.
- A command palette on `Ctrl+Shift+P`, a project search, and a settings dialog whose values persist.

## Requirements

- Node.js 22 or newer. `package.json` asks for 22 or newer, and the workflow of CI installs 22.
- pnpm 12.9.1, the version `package.json` names in `packageManager`.
- A Rust toolchain on the stable channel, with the `clippy` and `rustfmt` components. CI installs
  it with `dtolnay/rust-toolchain@stable`.
- The Linux packages that the Tauri v2 shell needs. The list below is the one the workflow of CI
  installs, and it is the list to install:

  ```bash
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    librsvg2-dev \
    patchelf \
    libxdo-dev \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    build-essential \
    curl \
    wget \
    file
  ```

## Run it

```bash
git clone https://github.com/paramcodes/arrow.git
cd arrow
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts the Tauri shell. The shell starts the Vite dev server itself, so there is no
second terminal to open.

To work on the frontend in a browser instead, run it on its own. The web build has no Tauri host,
so every call to the shell answers from a stub:

```bash
pnpm --filter @arrow/desktop dev:web
```

The shell of Rust builds on its own with:

```bash
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## The gates

Five commands check the repository. CI runs all of them on every pull request.

| Command              | What it proves                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | The format check, the lint, the typecheck, the unit tests and the build all pass.                                                                                                        |
| `pnpm test:e2e`      | The app boots in a plain browser with no Tauri host, and the editor, the tree, the terminal, the palette and the AI feature work when Playwright drives them.                            |
| `pnpm harness`       | The repository holds every criterion of `harness.config.json`. A criterion runs a real check against the tree, so a rule that kept its words while losing its behaviour fails the score. |
| `pnpm prove`         | Every guardrail catches the mistake it was made for. The prover writes the bad code on purpose and fails when a guardrail misses it.                                                     |
| `pnpm prove-harness` | The harness can fail. The script copies the harness into a scratch tree, breaks the copy seven ways, and fails when the scorer passes on any of them.                                    |

A test runner checks that the code does what it should. The harness scores a set of criteria
instead, and each criterion runs a check against the repository rather than against a function. The
scorer holds the exact list of criteria, so a criterion that is deleted, renamed or duplicated
fails the score. `pnpm prove-harness` answers the remaining question. It breaks a copy of the
harness seven ways and shows that the scorer fails on every one of them.

## How the code is laid out

| Path                     | What it owns                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src-tauri` | The Rust shell. The file system, the terminal, git, the watcher and the AI client. It holds the key of the provider in the keychain of the operating system. |
| `apps/desktop/src`       | The React tree of the desktop shell. It owns the screen and every call to the shell.                                                                         |
| `packages/editor-core`   | The editor engine, on CodeMirror 6. It owns the documents.                                                                                                   |
| `packages/ui`            | The shared UI primitives. They read theme tokens and never Tauri.                                                                                            |
| `packages/theme`         | The dark-first design tokens every layer reads.                                                                                                              |
| `packages/types`         | The shared type contracts.                                                                                                                                   |
| `scripts`                | The gates: the scorer, the prover, the self proof, the theme check and the branch guard.                                                                     |

Four boundaries hold the tree together, and each one names the path that fails when it breaks.

- The packages under `packages/` never import the Tauri API and never import the desktop app.
  `eslint.arch.mjs` fails the build when one does.
- The frontend boots in a plain browser with no Tauri host.
  `apps/desktop/e2e/smoke.spec.ts` proves it with Playwright.
- Every color comes from a token in `packages/theme`. `scripts/check-theme-discipline.mjs` scans
  the source for a literal.
- Workspace facts live in Zustand, per item facts live in Jotai and async workflows live in
  XState. No store imports another tier.

## The AI feature

- The key of a provider lives in the keychain of the operating system and in Rust. The bridge
  never hands it back. The command `get_api_key` answers with a boolean, and the lint rule
  `local/no-secret-in-webview` refuses a key inside the webview.
- The providers are `anthropic`, `openai` and `google`. The registry in
  `apps/desktop/src-tauri/src/ai/models.rs` holds the models of the three.
- The Rust client owns the HTTP call and the stream, and normalizes each provider into one event
  shape. The React tree never reads a provider protocol.
- The web build answers from a stub. With no Tauri host, the bridge in `apps/desktop/src/lib/ai.ts`
  replays a canned token stream, so Playwright can drive the ghost text in a plain browser.

## Documentation

- [The MVP plan](docs/plan/mvp-plan.md) holds the eleven sessions of the plan and the exit gate of
  each.
- [The architecture decision records](docs/adr/README.md) hold six decisions, each with the options
  it replaced.
- [The mistake log](docs/mistake-log.md) holds every mistake the repository has made and the
  guardrail that now catches it.
- [The ratchet](docs/ratchet.md) holds the procedure that turns a mistake into a permanent check.
- [The contract of the repository](AGENTS.md) holds the rules and the path that enforces each one.
- [The design system](DESIGN.md) holds the tokens of the product.
- [The discovery round](docs/plan/discovery.md) holds the research behind the decisions.
