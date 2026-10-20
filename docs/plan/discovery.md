# 🏹 Arrow — Cursor Clone: Discovery & Stack Proposal

> [!NOTE]
> This document captures the full research findings across Cursor features, tech stack options, design system alignment, and agent-ready harness integration. It's a living discussion document — not a final plan.

---

## 1. What Cursor Actually Is (Feature Breakdown)

Cursor is an AI-first code editor built as a VS Code fork (Electron + Monaco). Here's what makes it tick, organized by priority for an MVP clone:

### 🔴 Core Editor Features (Must-Have for MVP)
| Feature | What It Does |
|---------|-------------|
| **Multi-tab editor** | Open/close/reorder tabs with dirty indicators |
| **File tree sidebar** | Hierarchical file explorer with create/rename/delete |
| **Integrated terminal** | xterm.js-based terminal with multiple tabs |
| **Syntax highlighting** | 100+ language grammars via CodeMirror/Monaco |
| **Split panes** | Horizontal/vertical editor splits |
| **Command palette** | `Cmd+K` / `Ctrl+Shift+P` fuzzy-search command launcher |
| **Search & replace** | Global project-wide search with regex |
| **Settings panel** | JSON + GUI hybrid settings editor |
| **Status bar** | File info, language, encoding, git branch |
| **Activity bar** | Icon sidebar for switching between panels |
| **Minimap** | Code overview sidebar (optional for MVP) |
| **Breadcrumbs** | File path navigation at top of editor |

### 🟡 AI Features (Core Differentiator — MVP Phase 2)
| Feature | What It Does |
|---------|-------------|
| **Inline completions (ghost text)** | Copilot-style grey text predictions that stream in real-time |
| **Chat panel** | Side panel for conversing with AI about code context |
| **Cmd+K inline editing** | Select code → describe change → AI rewrites in-place with diff view |
| **Codebase context** | AI reads your files, understands your project structure |
| **@-mentions** | Reference files, functions, docs in chat (`@file`, `@codebase`, `@docs`) |
| **Model switching** | Toggle between Claude, GPT, Gemini per-task |

### 🟢 Advanced Features (Post-MVP)
| Feature | What It Does |
|---------|-------------|
| **Composer (multi-file editing)** | Single instruction → coordinated edits across dozens of files |
| **Agent mode** | Autonomous multi-step: plan → code → test → fix loop |
| **Background agents** | Cloud VMs that work asynchronously, produce PRs |
| **MCP support** | Model Context Protocol for external tool integration |
| **Cursor Rules** | `.cursor/rules` — project-specific AI guidelines |
| **Checkpoints & rollbacks** | Snapshot state before AI changes, one-click restore |
| **Embedded browser** | In-editor browser for frontend testing |
| **Voice control** | Speech-to-text for hands-free coding |

---

## 2. Design System — Cursor Aesthetic via `getdesign.md`

The `DESIGN.md` from [getdesign.md/cursor](https://getdesign.md/cursor/design-md) defines these tokens:

### Color Palette
```
Primary Accent:     #f54e00  (Cursor Orange — CTAs, active highlights)
Canvas Background:  #f7f7f4  (Warm cream paper)
Canvas Soft:        #fafaf7  (IDE pane backgrounds)
Canvas Strong:      #f2f1ed  (Sidebar/secondary panels)
Ink Primary:        #26251e  (Warm near-black text)
Ink Secondary:      #807d72  (Muted stone gray — metadata)
Error:              #cf2d56  (Deep red)
Surface Border:     1px solid subtle warm grays
```

### Typography
- **Display/Headlines**: Gothic sans (CursorGothic/Inter), tight line-height (`1.05–1.12`), negative letter-spacing (`-0.5px` to `-2.16px`)
- **Code/Mono**: Berkeley Mono or JetBrains Mono
- **Body**: Inter or similar editorial sans

### Component Style Rules
- Button radius: `8px`, thin `1px` borders
- Cards: subtle surface borders, clean padding hierarchy
- Badges: muted background pills for tags/versions
- Dark theme: warm editorial developer vibe, not neon/aggressive

> [!IMPORTANT]
> We'll pull this via `npx getdesign@latest add cursor` and use it as the single source of truth for all UI tokens. This means our DESIGN.md drives every component.

---

## 3. Recommended Tech Stack

### 🏗️ Architecture Decision: Electron vs Tauri

| | Electron | Tauri v2 |
|---|---|---|
| **Bundle size** | ~150MB | ~20MB |
| **Memory** | ~250MB idle | ~50-80MB idle |
| **VS Code extensions** | Native compat | Requires sidecar |
| **Terminal (xterm.js)** | First-class | Works via webview + Rust PTY |
| **Maturity for IDEs** | Proven (Cursor, VS Code, Atom) | Growing (Org2, custom editors) |
| **Language** | JS/TS full stack | Rust backend + web frontend |
| **Performance** | Moderate | Excellent |

**Recommendation: Tauri v2** 🦀
- We're building from scratch, not forking VS Code, so we don't need Electron's extension compat
- 5× smaller bundles, 3-5× lower memory
- Rust backend for PTY management, file watching, git operations = native perf
- Tauri v2's enhanced IPC, plugin system, and capability-based security are production-ready
- Terminal via `portable-pty` in Rust → xterm.js in webview with chunked streaming

### 📝 Editor Engine: CodeMirror 6

**Why not Monaco?** Monaco is the VS Code engine — it's heavier, harder to deeply customize, and optimized for Electron. CodeMirror 6 wins for our use case:

- **Modular & lightweight**: Everything is an extension, pay only for what you use
- **AI-native**: Easy to build custom ghost text widgets, inline diffs, streaming decorations
- **Custom keymaps**: High-precedence keymap interception for Tab-to-accept
- **State management**: Immutable state fields that integrate cleanly with React
- **Diff view**: `@codemirror/merge` for inline AI diff reviews
- **Mobile/web friendly**: DOM-based architecture, works in any webview

### ⚛️ Frontend Framework: React 19

- Largest ecosystem, most AI-tooling integrations
- shadcn/ui + Radix primitives are React-first
- Motion (Framer Motion) is React-first
- CodeMirror 6 has excellent React bindings
- Most AI coding assistants are trained on React codebases

### 🎨 UI Component Library: shadcn/ui + Radix Primitives

**Why shadcn/ui wins over HeroUI for an IDE:**

| | shadcn/ui | HeroUI |
|---|---|---|
| **Code ownership** | Components copied into your codebase — full control | npm dependency — fight the abstractions |
| **Density** | Easily hackable for tight IDE padding | Designed for SaaS landing pages |
| **Dark theme** | Tailwind-native, precise token control | Consumer-aesthetic, rounded/glowy |
| **Key IDE components** | Resizable panels, cmdk command palette, context menus | Missing IDE-specific primitives |
| **Customization** | Modify source directly | Override CSS variables |

**Key shadcn components we'll use:**
- `Resizable` — split panes (sidebar + editor + terminal)
- `Command` (cmdk) — command palette (`Ctrl+P`)
- `ContextMenu` — file tree right-click menus
- `DropdownMenu` — toolbar menus
- `Tabs` — editor tabs
- `Dialog` / `Sheet` — settings, modals
- `Tooltip` — hover info throughout
- `ScrollArea` — custom scrollbars

### 🎬 Animation: Motion (formerly Framer Motion)

**Primary choice** for 90% of IDE interactions:
- `layout` prop for automatic FLIP animations when panels resize
- `AnimatePresence` for mount/unmount transitions (panels opening/closing)
- Declarative API fits React component architecture
- Sidebar collapse, terminal drawer, command palette fade-in

**GSAP reserved for** (if needed):
- Complex onboarding sequences
- Timeline-controlled marketing/splash screens
- Canvas-based visualization tools

### 🎨 Styling: Tailwind CSS v4

- Native CSS-first architecture (no PostCSS needed)
- CSS custom properties for design token management
- Seamless integration with shadcn/ui
- Dark/light theme switching via CSS variables
- `@theme` directive for Cursor design tokens

### 📦 State Management: Zustand + Jotai + XState (Layered)

| Layer | Tool | Manages |
|-------|------|---------|
| **Global UI** | Zustand | Open tabs, active file, sidebar state, settings, layout |
| **Granular UI** | Jotai | Individual file tree items, toolbar button states, panel configs |
| **Complex flows** | XState | File save pipeline, LSP connection, AI streaming sessions, agent state machines |

**Why this combination:**
- Zustand reads/writes outside React (essential for CodeMirror extension callbacks)
- Jotai atoms prevent re-render cascades in high-frequency UI (typing, scrolling)
- XState eliminates impossible states in async AI workflows

### 🛠️ Tooling

| Category | Choice | Why |
|----------|--------|-----|
| **Bundler** | Vite 6 | Tauri's default, blazing HMR, native ESM |
| **Linting** | Oxlint + ESLint (hybrid) | Oxlint for 95% of rules (100x faster), ESLint for type-aware/custom |
| **Formatting** | Biome | Prettier-compatible, instant, single binary |
| **Package manager** | pnpm | Fastest, disk-efficient, workspace support |
| **Monorepo** | Turborepo | pnpm workspace + turbo for task orchestration |
| **Testing** | Vitest + Playwright | Vitest for unit/integration, Playwright for E2E |
| **Type checking** | TypeScript 5.7+ strict | Full strict mode, no escape hatches |
| **Git hooks** | Lefthook | Fast, polyglot, no node dependency |
| **CI** | GitHub Actions | Standard, free for OSS |

### 🖥️ Terminal: xterm.js + Rust PTY

- **Frontend**: xterm.js with WebGL renderer, FitAddon, WebLinksAddon
- **Backend**: Rust `portable-pty` managing PTY lifecycle
- **Transport**: Tauri v2 event emitters with chunked streaming + rAF batching
- **Multi-tab**: Each terminal tab gets its own PTY instance managed by Rust state

### 🔌 Backend / AI Integration

| Concern | Approach |
|---------|----------|
| **LLM API calls** | Rust HTTP client (reqwest) → SSE streaming |
| **Context management** | Local file indexing + embeddings (optional) |
| **Chat protocol** | WebSocket or SSE between Rust backend and React frontend |
| **Model routing** | Configuration-based model selection (OpenAI, Anthropic, Google) |
| **API key management** | OS keychain via Tauri's secure storage plugin |

---

## 4. Monorepo Structure

```
arrow/
├── apps/
│   ├── desktop/              # Tauri v2 desktop app
│   │   ├── src-tauri/        # Rust backend (PTY, file ops, git, AI)
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/     # Tauri IPC commands
│   │   │   │   ├── pty/          # Terminal management
│   │   │   │   ├── fs/           # File system operations
│   │   │   │   ├── git/          # Git integration
│   │   │   │   └── ai/           # LLM API client
│   │   │   ├── Cargo.toml
│   │   │   └── tauri.conf.json
│   │   └── src/              # React frontend
│   │       ├── components/
│   │       │   ├── editor/       # CodeMirror wrapper + AI extensions
│   │       │   ├── sidebar/      # File tree, search, git panel
│   │       │   ├── terminal/     # xterm.js terminal
│   │       │   ├── chat/         # AI chat panel
│   │       │   ├── command-palette/
│   │       │   └── layout/       # Shell, activity bar, status bar
│   │       ├── stores/           # Zustand + Jotai stores
│   │       ├── machines/         # XState state machines
│   │       ├── hooks/
│   │       ├── lib/
│   │       └── styles/
│   └── web/                  # (Future) Web version
├── packages/
│   ├── ui/                   # Shared shadcn/ui components
│   ├── editor-core/          # CodeMirror extensions & AI integrations
│   ├── theme/                # Design tokens from DESIGN.md
│   └── types/                # Shared TypeScript types
├── DESIGN.md                 # Cursor design system tokens
├── AGENTS.md                 # Agent entry-point file
├── CLAUDE.md                 # Second entry point → AGENTS.md
├── harness.config.json       # Agent-ready harness config
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## 5. Agent-Ready Harness Integration

Per the `agent-ready-harness` skill at `~/.agents/skills/agent-ready-harness/`, we'll install the full harness from day one:

### What We Get
| File | Purpose |
|------|---------|
| `harness.config.json` | 10 scored criteria, layer boundaries, proof cases |
| `scripts/harness-score.mjs` | Scores all criteria, exits non-zero on failure |
| `scripts/prove-guardrails.mjs` | Proves each guardrail catches its mistake |
| `eslint.arch.mjs` | Layer boundary enforcement |
| `eslint-rules/index.mjs` | Escape hatch errors (no inline config, no ts-ignore) |
| `lefthook.yml` | Pre-commit: format, lint, typecheck |
| `.github/workflows/ci.yml` | CI runs harness + canonical commands |
| `docs/ratchet.md` | Mistake → guardrail procedure |
| `docs/mistake-log.md` | Tracked mistakes with guardrail references |

### Adapted Layers for Arrow
```json
{
  "layers": {
    "data": { "alias": "@arrow/types", "dir": "packages/types" },
    "restricted": [
      { "name": "editor-core", "files": ["packages/editor-core/**/*.ts"] },
      { "name": "ui", "files": ["packages/ui/**/*.tsx"] },
      { "name": "desktop-components", "files": ["apps/desktop/src/components/**/*.tsx"] }
    ]
  }
}
```

### Key Rules for AGENTS.md
- Editor core never imports desktop-specific code. *Enforced by: eslint.arch.mjs*
- UI components never import Tauri IPC directly. *Enforced by: eslint.arch.mjs*
- Every exported store function has JSDoc. *Enforced by: eslint.config.mjs*
- No escape hatches in source. *Enforced by: eslint.config.mjs*
- Every mistake earns a guardrail. *Enforced by: scripts/prove-guardrails.mjs*

---

## 6. MVP Feature Phases (Proposed)

### Phase 1: Foundation Shell (Sessions 1-3)
**Goal**: Tauri app boots, shows a working editor layout with theme

- [ ] Tauri v2 + React + Vite scaffold
- [ ] Monorepo setup (pnpm + turborepo)
- [ ] Design tokens from DESIGN.md → Tailwind CSS theme
- [ ] App shell layout: activity bar + sidebar + editor area + status bar
- [ ] Resizable panels (sidebar ↔ editor, editor ↔ terminal)
- [ ] Dark theme matching Cursor aesthetic
- [ ] Agent-ready harness installed and passing

### Phase 2: Editor Core (Sessions 4-6)
**Goal**: Open, edit, and save files with full syntax highlighting

- [ ] CodeMirror 6 integration with custom theme
- [ ] File tree sidebar (read from filesystem via Tauri)
- [ ] Multi-tab editor with dirty indicators
- [ ] File open/save via Tauri file system commands
- [ ] Syntax highlighting for top languages (TS, JS, Python, Rust, JSON, MD)
- [ ] Command palette (cmdk-based)
- [ ] Breadcrumbs navigation
- [ ] Search & replace (in-file)

### Phase 3: Terminal & System Integration (Sessions 7-8)
**Goal**: Working terminal and git integration

- [ ] xterm.js terminal with Rust PTY backend
- [ ] Multi-tab terminals
- [ ] Terminal resize/fit handling
- [ ] Basic git status in status bar
- [ ] File watcher for external changes (Tauri fs events)

### Phase 4: AI Integration - Inline (Sessions 9-11)
**Goal**: Ghost text completions and Cmd+K inline editing

- [ ] LLM API client in Rust (SSE streaming)
- [ ] Ghost text CodeMirror extension (widget decorations)
- [ ] Tab-to-accept inline completions
- [ ] Cmd+K: select → describe → inline diff view
- [ ] Model configuration (API keys, model selection)

### Phase 5: AI Integration - Chat (Sessions 12-14)
**Goal**: Full chat panel with codebase context

- [ ] Chat panel UI (message list, input, markdown rendering)
- [ ] @-mentions for files and symbols
- [ ] Codebase context (file tree + active file)
- [ ] Streaming message responses
- [ ] Chat history persistence

### Phase 6: Polish & Advanced (Sessions 15+)
**Goal**: Production-quality experience

- [ ] Settings panel (GUI + JSON)
- [ ] Keybinding customization
- [ ] Multi-file AI editing (Composer-lite)
- [ ] Project rules (`.arrow/rules`)
- [ ] Minimap
- [ ] Global project search
- [ ] Themes (light/dark + custom)
- [ ] Auto-update (Tauri updater plugin)

---

## 7. Key Decision Points for Discussion

Before we commit to the plan, I'd like your input on these:

### 🤔 Open Questions

1. **Tauri vs Electron?** I'm strongly recommending Tauri v2, but if you want VS Code extension compat or faster time-to-prototype, Electron is safer. What's your priority — lean/fast or ecosystem compat?

2. **CodeMirror 6 vs Monaco?** CM6 is more customizable for AI features, Monaco gives instant VS Code feel. Are you okay with more custom work for a unique product, or do you want the VS Code baseline?

3. **Web version?** Should the architecture support a web deployment (like github.dev) from the start, or desktop-only for MVP?

4. **AI backend?** 
   - Option A: Direct LLM API calls (simpler, user provides API keys)
   - Option B: Your own backend proxy (adds billing, rate limiting, user accounts)
   - Option C: Both (start with A, add B later)

5. **Name**: Is "Arrow" the final name, or is this the repo/project name only?

6. **Scope of MVP**: The phases above go from "bootable shell" to "AI chat". Where do you want to draw the MVP line? Phase 4 (inline AI) or Phase 5 (full chat)?

7. **Design system**: Go with the Cursor warm-cream light theme, or start with dark mode (which most devs prefer)? The `getdesign.md` tokens are light-first — we'd need to create dark variants.

---

## 8. Full Stack Summary

```
┌─────────────────────────────────────────────────┐
│                 Arrow IDE Stack                  │
├─────────────────────────────────────────────────┤
│  Desktop Shell     │  Tauri v2 (Rust)           │
│  Frontend          │  React 19 + TypeScript     │
│  Editor Engine     │  CodeMirror 6              │
│  UI Components     │  shadcn/ui + Radix         │
│  Animations        │  Motion (Framer Motion)    │
│  Styling           │  Tailwind CSS v4           │
│  State (Global)    │  Zustand                   │
│  State (Granular)  │  Jotai                     │
│  State (Flows)     │  XState                    │
│  Terminal          │  xterm.js + Rust PTY       │
│  Bundler           │  Vite 6                    │
│  Linting           │  Oxlint + ESLint (hybrid)  │
│  Formatting        │  Biome                     │
│  Package Manager   │  pnpm                      │
│  Monorepo          │  Turborepo                 │
│  Testing           │  Vitest + Playwright       │
│  Git Hooks         │  Lefthook                  │
│  CI/CD             │  GitHub Actions            │
│  AI Integration    │  Rust HTTP + SSE streaming │
│  Design System     │  DESIGN.md (getdesign.md)  │
│  Agent Harness     │  agent-ready-harness       │
└─────────────────────────────────────────────────┘
```

---

> [!TIP]
> Once we align on the decisions above, I'll create a detailed multi-phase implementation plan, broken into context-window-friendly sessions with clear entry/exit criteria for each.
