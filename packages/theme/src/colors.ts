/**
 * The color tokens of Arrow, as values a script can read.
 *
 * The stylesheet holds the same colors as CSS custom properties in
 * `tokens.css`. A script that needs a color, such as a CodeMirror theme or an
 * xterm.js palette, reads it here instead of writing a literal of its own.
 */

/** The dark-first color palette of Arrow, in OKLCH. */
export const colors = {
  canvas: "oklch(0.15 0.005 250)",
  "canvas-soft": "oklch(0.18 0.005 250)",
  "canvas-strong": "oklch(0.12 0.005 250)",
  surface: "oklch(0.2 0.008 250)",
  "surface-hover": "oklch(0.23 0.008 250)",
  border: "oklch(0.25 0.005 250)",
  "border-strong": "oklch(0.3 0.005 250)",
  ink: "oklch(0.93 0.005 90)",
  "ink-secondary": "oklch(0.6 0.005 90)",
  "ink-tertiary": "oklch(0.45 0.005 90)",
  accent: "oklch(0.65 0.25 30)",
  "accent-hover": "oklch(0.6 0.25 30)",
  "accent-soft": "oklch(0.25 0.08 30)",
  success: "oklch(0.65 0.18 145)",
  warning: "oklch(0.75 0.15 80)",
  error: "oklch(0.6 0.2 15)",
  info: "oklch(0.65 0.15 250)",
} as const;

/** The name of a color token. */
export type ColorTokenName = keyof typeof colors;

/** The value of a color token, as a CSS color string. */
export type ColorTokenValue = (typeof colors)[ColorTokenName];

/** The radius tokens of Arrow, in pixels. */
export const radii = {
  sm: "4px",
  md: "6px",
  lg: "8px",
} as const;

/** The name of a radius token. */
export type RadiusTokenName = keyof typeof radii;

/** The font stacks of Arrow. */
export const fontStacks = {
  sans: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  display: '"Inter", system-ui, sans-serif',
} as const;

/** The name of a font stack token. */
export type FontStackName = keyof typeof fontStacks;
