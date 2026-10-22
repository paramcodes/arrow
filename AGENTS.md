# Arrow

Arrow is a standalone, AI-native code editor built from scratch with Tauri v2, React 19 and
Vite. It is a desktop application: the Rust shell owns the disk, the terminal, git and the AI
client, and the React tree owns the screen. Agents change this repository daily, so every rule
below names the path that fails when the rule breaks.

## Commands

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `pnpm dev`        | Run the Tauri shell and the Vite dev server         |
| `pnpm verify`     | Format check, lint, typecheck, unit tests, build    |
| `pnpm test:e2e`   | Drive the browser build with Playwright              |
| `pnpm harness`    | Score the harness criteria                          |
| `pnpm prove`      | Prove every guardrail catches the mistake it was made for |
| `pnpm prove-harness` | Prove the harness can fail                       |
| `cargo build`     | Build the Rust shell in `apps/desktop/src-tauri`     |

## Rules

- The workspace packages never import the Tauri API and never import the desktop app. Enforced by: eslint.arch.mjs
- The frontend boots in a plain browser with no Tauri host, and Playwright proves it. Enforced by: apps/desktop/e2e/smoke.spec.ts
- Every color comes from a token in `packages/theme`, and no component hardcodes one. Enforced by: scripts/check-theme-discipline.mjs
- Every package that ships utility classes is scanned by Tailwind, so every primitive renders styled. The source list lives in `apps/desktop/tailwind.config.js`. Enforced by: packages/ui/src/tailwind-source.test.ts
- The source tree has no escape hatches: inline lint config, `@ts-ignore`, `@ts-expect-error`, skipped tests and raw `JSON.parse` are errors. Enforced by: eslint.config.mjs
- TypeScript is strict in every workspace, and the compiler refuses an implicit `any`. Enforced by: tsconfig.base.json
- API keys never enter the webview, the DOM, the bundle, the logs or a frontend store; they live in Rust and the OS keychain. The lint rule `local/no-secret-in-webview` holds the webview side, and `docs/adr/0005-ai-integration-architecture.md` records the decision. Enforced by: eslint.config.mjs
- Workspace facts live in Zustand, per-item facts live in Jotai and async workflows live in XState; no store imports another tier. The lint rule `local/no-cross-tier-store` holds the boundary, and `docs/adr/0004-state-management-tiering.md` records the decision. Enforced by: eslint.config.mjs
- Every rule in this file names the path that enforces it, and this file stays under 100 lines. Enforced by: scripts/harness-score.mjs
- Every mistake earns a permanent check, a proof case and a log row. Enforced by: scripts/prove-guardrails.mjs
- One gate owns the tree at a time: the scorer, the prover and the self proof take the same exclusive lock, so two gate runs cannot interleave. Enforced by: scripts/prove-guardrails.mjs
- The harness can fail: the self proof breaks a copy of the harness seven ways, and the scorer has to fail on every one of them. Enforced by: scripts/prove-harness.mjs
- A mistake that returns after its guardrail existed is a guardrail failure, and the fix moves to a stronger layer. The procedure is written in `docs/ratchet.md` and the `ratchet` criterion checks it. Enforced by: scripts/harness-score.mjs
- The pre-commit gate runs format, lint and typecheck on the staged files. Enforced by: lefthook.yml
- CI runs the same canonical commands, the end to end suite and scores the harness. Enforced by: .github/workflows/ci.yml
- Work happens on a task branch, never on the default branch. Enforced by: scripts/guard-branch.sh
- Every file that carries the app version names one version, and the check refuses when they disagree. Enforced by: scripts/check-version.mjs

## Where things live

| Path                      | What lives there                                                             |
| ------------------------- | ---------------------------------------------------------------------------- |
| `apps/desktop/src`        | The React tree of the desktop shell. It owns the Tauri calls.               |
| `apps/desktop/src-tauri`  | The Rust shell: the file system, the terminal, git and the AI client.       |
| `packages/ui`             | The shared UI primitives. It reads theme tokens and never Tauri.            |
| `packages/editor-core`    | The editor engine. It owns documents and never the desktop shell.           |
| `packages/theme`          | The dark-first design tokens every layer reads.                             |
| `packages/types`          | The shared type contracts.                                                  |
| `scripts`                 | The harness: the scorer, the prover, the branch guard and the theme check.  |
