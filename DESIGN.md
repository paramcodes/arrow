---
name: Arrow
description: The design system of Arrow, an AI-native code editor. Derived from the Cursor design language, authored as a dark-first OKLCH palette. Every color, radius and font in the product comes from a token in `packages/theme`.
source: Cursor, via `npx getdesign@latest add cursor`
---

# Arrow Design System

Arrow is a dense IDE shell, not a marketing page. The design language comes from Cursor: hairline
borders instead of shadows, an 8-pixel padding rhythm, one scarce accent color, and code that is
always monospaced. The upstream Cursor reference is light-first; Arrow ships the dark variant as the
default and the only variant so far.

## The rule that governs everything

No color is written in a component. Every color, radius and font comes from a token in
`packages/theme`. `scripts/check-theme-discipline.mjs` fails the build when a component holds a hex
value, a color function or a named color.

| Need                     | Token                                              | Value                  |
| ------------------------ | -------------------------------------------------- | ---------------------- |
| A color in CSS           | `var(--canvas)`                                     | `oklch(0.15 0.005 250)` |
| A color in TypeScript   | `colors.canvas` from `@arrow/theme`                  | `oklch(0.15 0.005 250)` |
| A Tailwind utility       | `bg-canvas`, `text-ink`, `border-border`            | reads the token        |
| A color in CodeMirror    | `tokenVariable("canvas")` from `@arrow/theme`       | reads the token        |

## Colors

### Surfaces

| Token            | Value                  | Use                                             |
| ---------------- | ---------------------- | ----------------------------------------------- |
| `--canvas`       | `oklch(0.15 0.005 250)` | The window floor, the editor background         |
| `--canvas-soft`  | `oklch(0.18 0.005 250)` | Panels, the sidebar, the status bar             |
| `--canvas-strong`| `oklch(0.12 0.005 250)` | The activity bar, recessed wells               |
| `--surface`      | `oklch(0.2 0.008 250)` | Cards, dropdowns, the command palette          |
| `--surface-hover`| `oklch(0.23 0.008 250)` | A hovered row or a hovered surface             |
| `--border`       | `oklch(0.25 0.005 250)` | Hairline dividers, panel edges                 |
| `--border-strong`| `oklch(0.3 0.005 250)` | A focused edge, a scrollbar thumb              |

Surfaces are close in lightness on purpose. The product separates regions with a hairline and a
small step in lightness, never with a shadow.

### Text

| Token               | Value                    | Use                              |
| ------------------- | ------------------------ | -------------------------------- |
| `--ink`             | `oklch(0.93 0.005 90)`   | Primary text, code               |
| `--ink-secondary`   | `oklch(0.6 0.005 90)`   | Labels, muted text               |
| `--ink-tertiary`    | `oklch(0.45 0.005 90)`   | Disabled text, placeholders      |

### Accent

| Token            | Value                  | Use                                        |
| ---------------- | ---------------------- | ------------------------------------------ |
| `--accent`       | `oklch(0.65 0.25 30)` | The cursor accent, the primary action       |
| `--accent-hover` | `oklch(0.6 0.25 30)` | The pressed state of the accent             |
| `--accent-soft`  | `oklch(0.25 0.08 30)` | A quiet accent background, text selection  |

One accent color, used sparingly. A screen that shows orange everywhere shows nothing.

### Semantic

| Token       | Value                  | Use                            |
| ----------- | ---------------------- | ------------------------------ |
| `--success` | `oklch(0.65 0.18 145)` | A completed action             |
| `--warning` | `oklch(0.75 0.15 80)`  | A recoverable problem          |
| `--error`   | `oklch(0.6 0.2 15)`  | A failed action, invalid input |
| `--info`    | `oklch(0.65 0.15 250)` | Neutral information            |

### Focus

`--focus-ring` is `oklch(0.65 0.25 30 / 0.6)`. It is the only place an alpha value appears, and it
belongs to the focus ring alone.

## Typography

| Role              | Family                       | Stack                                        |
| ----------------- | ---------------------------- | -------------------------------------------- |
| Sans              | Inter                        | `"Inter", system-ui, sans-serif`              |
| Display           | Inter                        | `"Inter", system-ui, sans-serif`              |
| Code and terminal | JetBrains Mono               | `"JetBrains Mono", ui-monospace, monospace`   |

Both families are self-hosted in `packages/theme/fonts` and served from the bundle. The window never
reaches the network for a typeface.

| Role     | Size  | Weight | Line height | Letter spacing | Use                    |
| -------- | ----- | ------ | ----------- | -------------- | ---------------------- |
| Body     | 13px  | 400    | 1.5         | 0              | Default text           |
| Label    | 13px  | 500    | 1.4         | 0              | Panel and tab labels   |
| Title    | 20px  | 500    | 1.3         | 0.04em         | Window and pane titles |
| Caption  | 11px  | 600    | 1.4         | 0.88em         | Uppercase section tags |
| Code     | 13px  | 400    | 1.5         | 0              | Editor and terminal    |

## Shape

| Token         | Value | Use                          |
| ------------- | ----- | ---------------------------- |
| `--radius-sm` | 4px   | Tags, scrollbar thumbs       |
| `--radius-md` | 6px   | Inputs, buttons, surfaces    |
| `--radius-lg` | 8px   | Cards, panels                |

Radii stay small. A rounded card in an IDE reads as a web page.

## Spacing

The base unit is 4 pixels. An IDE is denser than a web page: 8-pixel paddings for controls, 4-pixel
gaps between dense items, 12 to 16 pixels between groups.

## Elevation

There are no shadows. Depth comes from a hairline border and one step of surface lightness. A
dropped shadow on a panel is a mistake.

## Surfaces of the product

The layout lands in phase 1 session 3. The surfaces it will use are fixed here so the palette does
not drift when they arrive.

| Region            | Background         | Border                |
| ----------------- | ------------------ | --------------------- |
| Window            | `--canvas`         | none                  |
| Activity bar      | `--canvas-strong`  | `--border`            |
| Sidebar and panel | `--canvas-soft`    | `--border`            |
| Editor            | `--canvas`         | none                  |
| Dropdown, palette | `--surface`        | `--border-strong`     |
| Status bar        | `--canvas-soft`    | `--border`            |
| Terminal          | `--canvas-strong`  | `--border`            |

## Tailwind

The Tailwind v4 preset of the product is `packages/theme/src/theme.css`. It maps every token onto
the Tailwind theme namespace, so a utility reads the token instead of a literal.

| Need                | Utility                                   |
| ------------------- | ----------------------------------------- |
| A background        | `bg-canvas`, `bg-surface`, `bg-accent`     |
| A text color        | `text-ink`, `text-ink-secondary`           |
| A border            | `border-border`, `border-border-strong`    |
| A radius            | `rounded-sm`, `rounded-md`, `rounded-lg`   |
| A font              | `font-sans`, `font-mono`, `font-display`   |

The global styles of the window, the selection color, the scrollbars and the focus ring live in
`apps/desktop/src/app.css`.

## Do's and don'ts

- Do reach for a token, in every language.
- Do keep the accent scarce. It marks the one thing the eye should land on.
- Do keep the radii small and the paddings tight. Density is the product.
- Do set code in JetBrains Mono, including the terminal.
- Don't introduce a second accent color.
- Don't add a drop shadow. Hairlines carry the depth.
- Don't write a named color such as `red` or `gray`, not even in a one-off rule.
- Don't ship a light theme. Dark is the product default.

## Known gaps

- The light tier of the palette is not authored yet. The ADR treats it as later work.
- The AI timeline palette of the Cursor reference, the pastel stage colors for thinking, reading,
  editing and done, is not tokenized yet. It arrives with the agent timeline in phase 2.
- The CodeMirror theme and the terminal ANSI palette read the same tokens, but they are written in
  their own sessions.
