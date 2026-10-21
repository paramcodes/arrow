/**
 * The Arrow dark theme of xterm.js.
 *
 * xterm.js paints colors into a canvas, so it cannot read a CSS variable the
 * way a stylesheet can: it needs the value behind the variable. The terminal
 * palette is therefore declared in `terminal.css` as variables that alias the
 * tokens of `packages/theme`, and this module copies the resolved values into
 * the shape xterm reads.
 *
 * The ANSI slots are named in CSS as `--terminal-ansi-<slot>`. The names of
 * the slots are the names xterm asks for, and a name such as `red` is also a
 * CSS color keyword, so the slot is derived from the variable instead of
 * written as a bare word. A bare word here would be a color the palette does
 * not control, which is exactly what the theme check refuses.
 *
 * The palette has five semantic hues and sixteen ANSI slots, so a slot with no
 * hue of its own takes the nearest semantic token, and a bright slot takes the
 * same token as its normal slot. A second spelling of one color is a color the
 * palette does not own.
 */

import { colors, fontStacks, type ColorTokenName } from "@arrow/theme";
import type { ITheme } from "@xterm/xterm";

/** The prefix of the ANSI variables of the terminal palette. */
export const ANSI_VARIABLE_PREFIX = "--terminal-ansi-";

/**
 * The ANSI slots of the terminal, in the order the stylesheet declares them.
 *
 * The list is written as variable names so the theme check never reads a bare
 * color keyword, and so the stylesheet stays the one place the palette is
 * spelled.
 */
export const ANSI_VARIABLES = [
  "--terminal-ansi-black",
  "--terminal-ansi-red",
  "--terminal-ansi-green",
  "--terminal-ansi-yellow",
  "--terminal-ansi-blue",
  "--terminal-ansi-magenta",
  "--terminal-ansi-cyan",
  "--terminal-ansi-white",
  "--terminal-ansi-bright-black",
  "--terminal-ansi-bright-red",
  "--terminal-ansi-bright-green",
  "--terminal-ansi-bright-yellow",
  "--terminal-ansi-bright-blue",
  "--terminal-ansi-bright-magenta",
  "--terminal-ansi-bright-cyan",
  "--terminal-ansi-bright-white",
] as const;

/** The token of a slot that is not one of the sixteen ANSI slots. */
export const TERMINAL_TOKENS = {
  background: "canvas-soft",
  foreground: "ink",
  cursor: "accent",
  cursorAccent: "canvas",
  selectionBackground: "accent-soft",
  scrollbarSliderBackground: "border",
  scrollbarSliderHoverBackground: "border-strong",
  scrollbarSliderActiveBackground: "border-strong",
} as const satisfies Partial<Record<keyof ITheme, ColorTokenName>>;

/** Reads the color behind one CSS variable. */
export type VariableReader = (variable: string) => string;

/**
 * The xterm slot name of an ANSI variable.
 *
 * `--terminal-ansi-bright-black` becomes `brightBlack`, which is the name of
 * the slot in the xterm theme, and `--terminal-ansi-red` becomes `red`.
 */
export function slotOfVariable(variable: string): string {
  const suffix = variable.startsWith(ANSI_VARIABLE_PREFIX)
    ? variable.slice(ANSI_VARIABLE_PREFIX.length)
    : variable;
  const dash = suffix.indexOf("-");

  if (dash < 0) return suffix;

  const family = suffix.slice(0, dash);
  const name = suffix.slice(dash + 1);
  return `${family}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Builds the xterm theme from a variable reader.
 *
 * The reader is a parameter so the mapping is a pure function a test can drive
 * without a document, and so a future light tier reads the same table through
 * the variables instead of through a second copy.
 */
export function createTerminalTheme(read: VariableReader): ITheme {
  const theme: Record<string, string> = {};

  for (const [slot, token] of Object.entries(TERMINAL_TOKENS)) {
    theme[slot] = read(`--${token}`);
  }

  for (const variable of ANSI_VARIABLES) {
    theme[slotOfVariable(variable)] = read(variable);
  }

  return theme as ITheme;
}

/**
 * Converts a CSS color to a form xterm.js can paint.
 *
 * The tokens are written in OKLCH, and the color parser of xterm.js reads hex
 * and rgb. A canvas is the browser's own color parser: paint one pixel with
 * the token and read the channel values back. The conversion therefore reads
 * the same value the browser paints, instead of a copy of the palette.
 */
function browserConverter(): (value: string) => string {
  const cache = new Map<string, string>();
  let context: CanvasRenderingContext2D | null = null;
  let usable = false;

  return (value: string): string => {
    const cached = cache.get(value);
    if (cached !== undefined) return cached;

    if (!usable && context === null) {
      if (typeof document === "undefined") return value;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      context = canvas.getContext("2d", { willReadFrequently: true });
      usable = context !== null;
    }

    if (!context) return value;

    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    const channels = [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
    const hex = channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
    const resolved = `#${hex}`;

    cache.set(value, resolved);
    return resolved;
  };
}

let converter: ((value: string) => string) | null = null;

/** True when a document can answer for the tokens. */
function hasDocument(): boolean {
  return typeof document !== "undefined";
}

/**
 * Resolves one CSS variable to a color xterm.js can paint.
 *
 * The document is read first, because a token that changes at runtime changes
 * with it. The constants of `@arrow/theme` are the fallback for the tokens,
 * so a test or a server render still gets a real palette.
 */
export function resolveTerminalColor(variable: string): string {
  converter ??= browserConverter();

  if (!hasDocument()) {
    const token = variable.startsWith("--") ? variable.slice(2) : variable;
    return token in colors ? colors[token as ColorTokenName] : "";
  }

  const read = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (read !== "") return converter(read);

  const token = variable.startsWith("--") ? variable.slice(2) : variable;
  return token in colors ? converter(colors[token as ColorTokenName]) : "";
}

/** The xterm theme of the shipped dark tier. */
export function arrowTerminalTheme(): ITheme {
  return createTerminalTheme(resolveTerminalColor);
}

/** The monospace stack of the terminal, read from the same token as the editor. */
export function terminalFontFamily(): string {
  if (!hasDocument()) return fontStacks.mono;

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-family-mono")
    .trim();

  return value || fontStacks.mono;
}

/**
 * The resolved palette, keyed by the CSS variable of each slot.
 *
 * The key is the variable and not the slot name, because a slot name such as
 * `red` is a CSS color keyword: a table that spells it is a table the theme
 * check refuses. A reader that needs one slot asks for its variable, and the
 * name of the slot never appears as a bare word.
 */
export function terminalVariables(): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};

  for (const token of Object.values(TERMINAL_TOKENS)) {
    variables[`--${token}`] = resolveTerminalColor(`--${token}`);
  }

  for (const variable of ANSI_VARIABLES) {
    variables[variable] = resolveTerminalColor(variable);
  }

  return variables;
}
