/**
 * The design token contract.
 *
 * The colors live in `tokens.css` as CSS custom properties. This module names
 * them, so a component that needs a token in JavaScript, such as a CodeMirror
 * theme or an xterm.js theme, reads the same variable the stylesheet uses.
 */

/** The names of the surface tokens. */
export const surfaceTokens = [
  "canvas",
  "canvas-soft",
  "canvas-strong",
  "surface",
  "surface-hover",
  "border",
  "border-strong",
] as const;

/** The names of the text tokens. */
export const textTokens = ["ink", "ink-secondary", "ink-tertiary"] as const;

/** The names of the accent tokens. */
export const accentTokens = ["accent", "accent-hover", "accent-soft"] as const;

/** Every token name the product uses. */
export const tokenNames = [...surfaceTokens, ...textTokens, ...accentTokens, "focus-ring"] as const;

/** One token name. */
export type TokenName = (typeof tokenNames)[number];

/** The CSS custom property that holds a token. */
export function tokenVariable(name: TokenName): string {
  return `var(--${name})`;
}
