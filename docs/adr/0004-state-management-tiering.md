# Assign Zustand, Jotai, and XState to separate state layers

Status: Accepted, 2026-10-21.

## Context and Problem Statement

Arrow holds state at three shapes. Workspace state changes rarely and matters everywhere: open tabs, the active buffer, panel layout, settings. Granular state changes constantly in small pieces: a dirty marker on one tab, selection state on one file-tree node, cursor memory per buffer. Workflow state is asynchronous with many possible orderings: a ghost text request, a `Cmd+K` edit session, a file save, a terminal's PTY lifecycle. One library for all three means every fine-grained update re-renders wide swaths, or every workflow becomes a pile of boolean flags.

## Decision Drivers

- CodeMirror and xterm.js run callbacks outside React's render lifecycle. Their code must write state that the UI reads reliably.
- Typing and scrolling must not re-render the file tree, the tab bar, or the layout shell.
- The AI workflows have forbidden states. A session cannot be streaming while the user has dismissed it; a `Cmd+K` edit cannot be applied twice. These must be prevented by modeling, not by checklist.
- Agents learn this codebase in one pass. The state tool should name the layer: if a piece of state lives in a machine, agents know its lifecycle is one of the machine's states.

## Considered Options

- Zustand for everything
- Redux Toolkit for everything
- Jotai for everything
- Layers: Zustand, then Jotai, then XState

### Zustand for everything

- Good, because a single unopinionated store is easy to learn and to explain.
- Good, because it works outside React, which CodeMirror callbacks need.
- Bad, because one store mixes velocities: the dirty flag of one tab and the layout of the shell share a tree, and large updates or careful selectors become the only re-render brakes.
- Bad, because asynchronous, cancellable workflows become hand-rolled flag combinations.

### Redux Toolkit for everything

- Good, because it is the industry-standard pattern with wide recognition.
- Bad, because of ceremony, and because it is optimized for one central discipline rather than layers of different grains.
- Bad, because rapid per-keystroke updates in DevTools-heavy repos show RTK's overhead for very fine-grained state.

### Jotai for everything

- Good, because atoms give the finest re-render control for high-frequency UI like tree nodes and tab badges.
- Bad, because a large atoms graph is harder to navigate than a store, and the workspace-level state reads more naturally from a store.
- Bad, because it still cannot model a cancellable streaming lifecycle as well as a state machine: forbidden states stay forbidden by convention.

### Layers: Zustand, then Jotai, then XState

- Good, because each layer's tool matches its grain. Zustand's store sits outside React and holds the workspace. Jotai atoms hold the per-item, high-frequency pieces. XState machines own the asynchronous lifecycles where states are few and constraints are strong.
- Good, because the forbidden states disappear: a machine in the `streaming` state cannot simultaneously be `reviewing`, because those are different states, not two flags.
- Bad, because three libraries must stay separated, and the boundaries need reinforcement.

## Decision Outcome

Chosen option: "Layers: Zustand, then Jotai, then XState". Zustand holds open tabs, the active buffer, sidebar state, panel sizes, and settings. Jotai holds per-tab cursor memory, per-node tree selection, and similar small pieces that update on every interaction. XState governs the file save pipeline, the ghost text completion lifecycle, the `Cmd+K` edit lifecycle (idle, prompting, streaming, reviewing, applied or rejected), and each terminal's PTY status.

### Consequences

- Good, because re-render cascades stop at Jotai atoms and machine transitions, instead of rebuilding the tree.
- Good, because AI workflow bugs become machine-definition bugs, with a finite list of states to audit.
- Bad, because contributors must learn three tools, and their separation rules must be enforced, not hoped for.
- Bad, because a determined contributor can still put a workspace fact into an atom; the harness per its ADR-0006 needs criteria naming where each kind of state belongs.

## Confirmation

The XState machines get Vitest suites that test transitions and cancellation, which is Session 9 through Session 11 test work. Harness criteria (in the agent-ready harness from ADR-0006) will pin the layer boundaries: store, atom files, and machine files live in their own directories, and a lint rule flags cross-layer imports.

## More Information

The layered state table and rationale are in [docs/plan/discovery.md](../plan/discovery.md), section 3. The store and machine work is distributed across Sessions 3 through 11 in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
