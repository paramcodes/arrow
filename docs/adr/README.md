# Architecture decision records

This directory holds the architecture decisions for Arrow. Each record states one decision, the options it replaced, and what follows from it. The fuller research behind every record lives in [docs/plan/discovery.md](../plan/discovery.md), and the roadmap that sequences the work lives in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).

## Index

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](0001-desktop-shell-tauri-v2.md) | Use Tauri v2 for the desktop shell | Accepted | 2026-10-21 |
| [ADR-0002](0002-editor-engine-codemirror-6.md) | Use CodeMirror 6 as the editor core | Accepted | 2026-10-21 |
| [ADR-0003](0003-ui-and-design-system.md) | Use shadcn/ui, Tailwind CSS v4, and dark-first OKLCH tokens | Accepted | 2026-10-21 |
| [ADR-0004](0004-state-management-tiering.md) | Assign Zustand, Jotai, and XState to separate state layers | Accepted | 2026-10-21 |
| [ADR-0005](0005-ai-integration-architecture.md) | Put the AI client in the Rust backend and stream tokens over SSE | Accepted | 2026-10-21 |
| [ADR-0006](0006-agent-ready-harness-and-testing.md) | Install the agent-ready harness with Vitest and Playwright from day one | Accepted | 2026-10-21 |
| [ADR-0007](0007-publish-linux-bundles-from-a-tag.md) | Publish the Linux bundles from a tag in a workflow of its own | Accepted | 2026-10-22 |

## Format

Records follow the [MADR 4.0.0](https://adr.github.io/madr/) template: Context and Problem Statement, Decision Drivers, Considered Options with pros and cons, Decision Outcome, Consequences, and Confirmation. Each record is short. The prose favors full sentences over bullet fragments, and lists negative consequences as plainly as positive ones.

## Conventions

- One record states one decision. Files are named `NNNN-title-with-dashes.md`, where `NNNN` counts the next record in sequence.
- Numbers are never reused, and existing records are never renumbered.
- A record is not rewritten to reverse a decision. When a decision changes, mark the old record as superseded and add a new one, then update this index.
- The Confirmation section names the check that proves the decision holds. In this repository, most confirmations map to a harness criterion, a lint rule, or a session exit gate in the MVP plan.
