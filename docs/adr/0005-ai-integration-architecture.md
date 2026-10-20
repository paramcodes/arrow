# Put the AI client in the Rust backend and stream tokens over SSE

Status: Accepted, 2026-10-21.

## Context and Problem Statement

Phase 4 adds the AI features. The frontend asks for a completion or an inline edit; a provider (Anthropic, OpenAI, or a compatible endpoint) streams tokens back over Server-Sent Events; the editor renders those tokens as they arrive, and aborts the request the instant the user presses Escape. The API keys must not appear in webview memory or DOM. The request must be cancelable mid-flight. The Rust backend already owns the PTY, file watching, and git work, and it is the natural home for the HTTP client. Which side of the Tauri boundary owns the LLM calls, and how do streams and keys reach the webview?

## Decision Drivers

- Key security. Keys live in the OS keychain and in Rust, never in webview code or its bundles.
- Cancellation parity. The webview's Escape goes from keybinding to aborted request in one hop, per the `Cmd+K` and ghost text requirements.
- Stream shape. Token events cross the IPC bridge at a rate that stays smooth while the buffer renders.
- Provider breadth. The product switches between Claude, GPT-4o, and Gemini from settings, so provider-specific protocol code must stay out of the React components.
- The user's stated preference in the discovery round is a backend proxy architecture.

## Considered Options

- Frontend calls providers directly
- Hosted backend proxy service
- Rust backend proxy client

### Frontend calls providers directly

- Good, because there is the least architecture: fetch to the provider from the webview.
- Bad, because API keys live in webview code, in storage the webview can read, and in whatever logs it emits.
- Bad, because cancellation runs from DOM land, and the abort wiring is per component.
- Bad, because provider quirks (SSE formats, tool schemas) leak into React code.

### Hosted backend proxy service

- Good, because keys are fully ours to rotate, and the webview talks to one URL.
- Good, because a hosted service can enforce rate limits and tie tokens to accounts for billing.
- Bad, because it is an always-on server and a deploy target the MVP does not need, and the client is not in this repo at the MVP.
- Bad, because offline use breaks, and an editor does not owe its responsiveness to a remote service that can go away.

### Rust backend proxy client

- Good, because keys are loaded from the OS keychain (via Tauri's secure storage plugin) into Rust memory and never cross the IPC boundary except through a capability-gated command.
- Good, because cancellation is one local Rust command, so the Escape path is short and testable.
- Good, because reqwest handles provider HTTP, one internal event shape normalizes all providers, and the normalizers are pure Rust functions under unit tests.
- Bad, because every new provider or provider change is Rust work plus a stable bridge schema, and the frontend trusts that schema.

## Decision Outcome

Chosen option: "Rust backend proxy client". The backend (in `apps/desktop/src-tauri`) owns the LLM HTTP and SSE pipeline, normalizes each provider into one internal event stream, forwards token events to the webview over Tauri events, and aborts in-flight requests on command. Keys are stored with Tauri's secure storage plugin, tied to the OS keychain. This matches the backend-proxy preference from the discovery answers while keeping the proxy inside the app: no hosted service, no billing, and no accounts exist in the MVP. A hosted gateway can supersede this record later if the product adds team accounts or metered billing.

### Consequences

- Good, because key material stays out of the renderer process, in the OS keychain, and never enters webview code.
- Good, because Escape cancels through one command path, and the `Cmd+K` and ghost text flows share the same abort pipeline.
- Good, because provider protocol differences live in Rust modules with unit tests rather than in React components.
- Bad, because adding a provider or an upstream protocol change is Rust plus bridge work, which is slower than a frontend fetch.
- Bad, because there are no rate limits, billing, or telemetry for AI usage in the MVP; that gap is deliberate and known.
- Neutral, because token accounting stays per-request in Rust and is exposed for later settings surfaces.

## Confirmation

Session 9's exit gate in the MVP plan is the actual proof: Rust streams tokens from Anthropic and OpenAI to the webview over the event bridge, with an abort pipeline that ends mid-flight requests on Escape. The agent-ready harness from ADR-0006 proves a guard that fails a build on any hardcoded key in source, so the security property stays checked, not assumed.

## More Information

The AI integration table and the terminal/streaming notes are in [docs/plan/discovery.md](../plan/discovery.md), section 3. The client work is Session 9, and its consumers are Sessions 10 and 11, in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
