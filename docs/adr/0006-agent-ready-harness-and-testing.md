# Install the agent-ready harness with Vitest and Playwright from day one

Status: Accepted, 2026-10-21.

## Context and Problem Statement

Agents will change Arrow daily throughout the MVP plan, and the plan's operating protocol requires every session to end with a clean, verified PR. A repository whose gates live in memory does not survive rotation: a rule that "editor-core never imports desktop code" is pure convention unless a tool or a test name enforces it. The repo needs its proof machinery installed from the first commit, before any code exists to break the rules.

## Decision Drivers

- Change acceptance must be objective: `pnpm verify` and `pnpm harness` exit 0 on green and nonzero on anything not green, and every session's PR depends on them.
- Guardrails must prove their worth. Each one ships with a deliberate reproduction of the mistake it catches, so "it works" is shown, not claimed.
- Every mistake adds a permanent check. A recurring error pattern becomes a criteria entry or a lint rule, so the same note does not have to be remembered twice.
- The real product runs in a Tauri webview with a Rust backend. Unit tests of the frontend alone cannot verify the IPC and PTY paths, which need E2E trails against the desktop build.
- Commit and branch hygiene (Conventional Commits, `feat/p{phase}s{session}/{slug}` branches, PR per session) belongs in CI, not in the reviewer's memory.

## Considered Options

- No dedicated tooling, review gates only
- A heavyweight process gate, with formal sign-off documents
- The agent-ready harness with Vitest and Playwright

### No dedicated tooling, review gates only

- Good, because there is nothing to install and nothing to maintain, which is tempting for a young repo.
- Bad, because the agents' error patterns recur, and each review catches the same mistake again without a permanent fix.
- Bad, because it violates the operating protocol the plan locks: every session exit depends on `pnpm verify` passing, and "verify" means nothing if the checks are absent.

### A heavyweight process gate, with formal sign-off documents

- Good, because formal gates can catch wide categories of error early.
- Bad, because the overhead is per-change and slows the exact audience (agents and humans iterating daily) that MVP velocity depends on.
- Bad, because signing documents cannot prove that a specific guardrail catches a specific mistake; only a deliberate failing case can.

### The agent-ready harness with Vitest and Playwright

- Good, because it pins the proof list in `harness.config.json`: scored criteria, layer boundaries, and proof cases, all versioned in the repo.
- Good, because it enforces layer boundaries and escape-hatch bans in real lint rules (`eslint.arch.mjs`, `eslint-rules/`), which are boundaries the other ADRs rely on.
- Good, because `scripts/prove-guardrails.mjs` writes bad code on purpose and shows the guard catching it; if the guard misses, the proof fails.
- Good, because Vitest covers units and Playwright drives the desktop build E2E, which is the only level that reaches the Tauri IPC and PTY truthfully.
- Bad, because the harness config and criteria list are standing maintenance, and criteria need pruning when phases retire them.
- Bad, because it is a famous point of initial friction for agents that are not used to being scored against criteria; the AGENTS.md needs to say in one line what the harness requires from them.

## Decision Outcome

Chosen option: "The agent-ready harness with Vitest and Playwright". The full harness ships in Session 1 (install harness.config.json, AGENTS.md, CLAUDE.md pointing at AGENTS.md, harness-score, prove-guardrails, lefthook, GitHub Actions CI, and the docs) before any feature code is written. The mistake-ratchet rule (a mistake becomes a guardrail) extends to the ADR system itself: a real mistake inside a decision-perimeter becomes a criteria or lint entry with proof.

### Consequences

- Good, because agents self-verify: the agent that ships an edit runs `pnpm verify` and `pnpm harness` and knows whether the change survives its own gates, before requesting review.
- Good, because guardrails that prove their worth in code stay honest about what they protect, which is why `prove-guardrails.mjs` runs in CI, not just at setup.
- Bad, because the criteria list takes ongoing care; each phase's gates need review at their landing, and stale criteria get pruned rather than left to rot in green.
- Bad, because the criteria scoring is an opinionated structure; a new contributor unfamiliar with the pattern pays a learning curve to navigate it.
- Neutral, because criteria get tuned with the plan's phases and adjusted as the product's risk surface changes.

## Confirmation

The harness itself is the confirmation, and this record is largely self-verifying: `pnpm harness` scores the criteria listed in `harness.config.json`, and CI runs it with `pnpm verify` on every PR. Session 1's exit gate is the harness criterion check for itself: `pnpm dev` launches, `pnpm verify` and `pnpm harness` exit 0 (per the MVP plan).

## More Information

The harness plan, layer JSON, and rules are in [docs/plan/discovery.md](../plan/discovery.md), section 5. The tooling install is Session 1 in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
