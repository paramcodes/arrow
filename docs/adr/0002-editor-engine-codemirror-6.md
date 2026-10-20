# Use CodeMirror 6 as the editor core

Status: Accepted, 2026-10-21.

## Context and Problem Statement

The editor is the product. Beyond plain text editing, the MVP requires AI features inside the editor surface itself: ghost text completion rendered at the caret, an inline `Cmd+K` edit flow with a unified diff preview, and streaming token updates that appear while the model is still generating. These features need the editor framework to accept custom widgets, decorations, and high-precedence keybindings. Which editor engine do we embed?

## Decision Drivers

- Ghost text must be a styled, low-priority overlay at the caret that Tab accepts and Escape or caret movement dismisses. The framework must let us build that widget and take precedence over normal keybindings.
- The `Cmd+K` flow needs an inline diff view with red and green line markers, and it must render inside the same document, not a separate pane.
- Token-by-token streaming must update the decoration layer without re-rendering the application.
- The webview runs Tauri, so every megabyte of editor engine competes with the bundle budget.
- The framework must cooperate with React 19 and with state stores that live outside React.

## Considered Options

- CodeMirror 6
- Monaco

### CodeMirror 6

- Good, because everything is an extension. The core stays small, and we pay only for the features we load: line numbers, folding, bracket matching, history, and the languages we ship.
- Good, because a `StateField` plus a `WidgetType` is the exact mechanism a ghost text overlay needs, and `@codemirror/merge` provides the diff machinery the `Cmd+K` flow needs.
- Good, because keymap precedence is explicit, which makes Tab-to-accept and Escape-to-dismiss predictable against the editor's own bindings.
- Good, because state updates flow through immutable `EditorState`, so our React wrapper and external stores stay consistent with the document.
- Bad, because we assemble the editor ourselves: theme, syntax styles, and language support are wired per language, and the result does not look like a finished VS Code flavor out of the box.
- Bad, because the community extension set is smaller than the VS Code feature surface, so some conveniences (a rich minimap, for example) need custom work or wait for a later phase.

### Monaco

- Good, because it is the VS Code editor, so users already know its behavior, keybindings, and look.
- Good, because IntelliSense, a minimap, and broad language support arrive configured.
- Bad, because Monaco is built for the VS Code architecture inside Electron, and embedding it elsewhere takes real build effort for a webview target.
- Bad, because custom overlays (a phantom text widget at the caret) and inline diff flows in the same document fight Monaco's decoration and suggest models rather than extending them.
- Bad, because the engine is large, which pressures the Tauri webview's bundle budget for features we would partially silence anyway.

## Decision Outcome

Chosen option: "CodeMirror 6", because the AI-native requirements are the core differentiator of the product, and CodeMirror 6's architecture is built around exactly that kind of surgical extension: custom widgets, ordered decorations, keymap precedence, and immutable state. Monaco is stronger at shipping a familiar, complete VS Code editor quickly, but that familiarity matters least where our product must differ from VS Code.

### Consequences

- Good, because the editor bundle shrinks to what the app loads, and the AI features are ordinary extensions rather than framework surgery.
- Good, because `EditorState` composability integrates with the state tiers in ADR-0004 and with React 19 cleanly.
- Bad, because the team owns the theme and the language wiring, both of which are Session 4 work, and any missing conveniences surface later as visible gaps.
- Bad, because performance on very large files needs measuring; the MVP targets handle normal source files, and pathological sizes get revisited then.

## Confirmation

A lint-based architecture rule (part of the agent-ready harness) forbids `packages/editor-core` from importing desktop or Tauri code, keeping the engine portable. Session 4 closes with a syntax-highlighted editor in the desktop pane, and Session 10 closes with streaming ghost text accepted by Tab, both listed as exit gates in the MVP plan.

## More Information

The CodeMirror 6 versus Monaco analysis is in [docs/plan/discovery.md](../plan/discovery.md), section 3. The integration work is Session 4, and the ghost text work is Session 10, both in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
