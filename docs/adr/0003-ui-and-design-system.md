# Use shadcn/ui, Tailwind CSS v4, and dark-first OKLCH tokens

Status: Accepted, 2026-10-21.

## Context and Problem Statement

Arrow needs a component layer and a theme system for an IDE layout: resizable panes, a file tree with context menus, a command palette, editor tabs, and a status bar, all on a dark canvas. The design language follows the Cursor aesthetic from `getdesign.md/cursor`, whose reference tokens are light-first, so dark variants must be produced and be the shipped default. The component choice also matters for agents that will read and change UI code daily: the source should be in this repository, not behind an npm abstraction.

## Decision Drivers

- The codebase is built with agents. In-repo component source outweighs a polished library that fights the density and theming requirements.
- IDE layouts are dense. Editors use 8-pixel paddings and hairline borders, not the rounded, glowing surfaces of consumer SaaS components.
- The command palette (`Cmd+Shift+P`) and quick-open (`Cmd+P`) need `cmdk`, and the file tree needs context menus and dropdowns from the same universe of primitives.
- Theming must be token-driven. Tailwind CSS v4 supports CSS-first custom properties and native OKLCH color spaces, which the design system uses.
- Dark-first is the stated user preference, from the discovery round of questions.

## Considered Options

- shadcn/ui on Radix primitives, styled with Tailwind v4
- HeroUI
- Components built only directly on Radix, with our own wrappers

### shadcn/ui on Radix primitives, styled with Tailwind v4

- Good, because component code is copied into the repository, so we own it. Any component can be edited or trimmed with no library release to wait for.
- Good, because it exposes the primitives an IDE needs day one: `resizable` for split panes, `command` (cmdk) for the palette, `context-menu`, `dropdown-menu`, `tabs`, `dialog`, `tooltip`, and `scroll-area`.
- Good, because Tailwind v4 drives its styling, and our `@arrow/theme` tokens slot straight in.
- Bad, because vendored code is our maintenance burden: upgrades are mechanical edits across our source, done by us.

### HeroUI

- Good, because it ships a complete, attractive component set with dark mode.
- Bad, because npm is the distribution, so density overrides mean fighting the library's abstractions.
- Bad, because its aesthetic is consumer: rounded corners, glow, generous spacing. An IDE needs tight paddings and hairline borders, which is a rewrite of most components in spirit.

### Components built only directly on Radix

- Good, because it is the most control with the least vendored code.
- Bad, because it re-implements the composition work shadcn/ui already does, which is Session 3 time better spent on layout and behavior.

## Decision Outcome

Chosen option: "shadcn/ui on Radix primitives, styled with Tailwind v4", because code ownership serves the agent-built nature of this project, the exposed primitives cover the IDE's real needs from Session 3, and Tailwind v4's CSS-first custom properties give the design tokens a single source in `@arrow/theme`. HeroUI is rejected on aesthetics and lock-in; the raw-Radix option is rejected because it buys control we already have with shadcn/ui's vendored source.

The theme defaults to dark. Tokens live in `packages/theme` as OKLCH custom properties derived from the `getdesign.md` reference, with dark variants authored by us and treated as the primary palette.

### Consequences

- Good, because every component is our source, so an agent task like "make toolbars 8 pixels tighter" is an edit, not a fork.
- Good, because one source of truth for tokens means the CodeMirror theme and the terminal ANSI palette derive from the same definitions.
- Bad, because we carry the components' future changes; upstream shadcn/ui improvements are copied in by hand.
- Bad, because the light theme from the original `getdesign.md` tokens still needs to be authored for later phases; dark-first means light is not free.

## Confirmation

Session 2 delivers `packages/theme` with typed token exports and a `tokens.css` custom-property file, and its exit gate requires the desktop preview to demonstrate token accuracy. A harness criterion keeps source components in `packages/ui` and keeps hardcoded colors out of them, with the CodeMirror and terminal palettes consuming the same tokens.

## More Information

The shadcn/ui versus HeroUI comparison and the stack table are in [docs/plan/discovery.md](../plan/discovery.md), sections 2 and 3. The theme work is Session 2, and the shell work is Session 3, both in [docs/plan/mvp-plan.md](../plan/mvp-plan.md).
