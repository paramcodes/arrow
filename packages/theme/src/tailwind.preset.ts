/**
 * The Tailwind theme of Arrow as a JavaScript preset.
 *
 * The app loads the CSS-first preset in `src/theme.css`, which is the Tailwind
 * v4 way to ship a preset. This module is the same mapping for a consumer
 * that configures Tailwind in JavaScript.
 *
 * The colors are derived from the token names, so the two presets cannot
 * drift apart. `src/index.test.ts` proves they agree.
 */

import { colorTokens, fontVariables, radiusVariables } from "./index";

function variables(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, `var(--${name})`]));
}

/** The Tailwind v4 preset of Arrow. */
export const arrowPreset = {
  theme: {
    extend: {
      colors: variables(colorTokens),
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        display: "var(--font-display)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
    },
  },
};

/** The runtime variables the preset reads. */
export const presetVariables = {
  fonts: fontVariables,
  radii: radiusVariables,
};

export default arrowPreset;
