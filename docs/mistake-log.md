# Mistake log

This log records mistakes this repository has made and the guardrail that now catches each one. A
row is added only when a guardrail exists. `docs/ratchet.md` describes the three steps that
produce a row.

| Date       | Mistake                                                                              | How it slipped through                                                                 | Fix                                                                                     | Guardrail now                                                    |
| ---------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-10-21 | The workspace packages could import the Tauri API and the desktop app with nothing to stop them. | No architecture boundary existed, so the rule lived only in the plan.                 | Added a layer boundary that bans the Tauri API and the desktop app inside `packages/*/src`. | `eslint.arch.mjs` with `local/no-cross-layer-import`                |
| 2026-10-21 | A component could hardcode a hex color and leave the dark-first palette behind.       | No check read the token rule, so a literal color passed review unnoticed.               | Added a token check that scans every component source for a color literal.                | `scripts/check-theme-discipline.mjs`                                |
| 2026-10-21 | A stray `pnpm-workspace.yaml` build allowlist let an unapproved install script run.  | The build script list was written under a setting pnpm 12 no longer reads.               | Moved the allowlist to `allowBuilds` in `pnpm-workspace.yaml`, the setting pnpm 12 reads.   | `pnpm-workspace.yaml` and the failed `pnpm install`                  |

## Reading a row

The mistake column names what the repository got wrong. The how-it-slipped-through column names the
check that was absent, because an absent check is what let the mistake through. The fix column names
the decision that was recorded. The guardrail column names the artifact that now fails when the
mistake returns.

A mistake that repeats after its guardrail existed is a guardrail failure. Fix it at a stronger
layer than the one that already failed and add a new row.
