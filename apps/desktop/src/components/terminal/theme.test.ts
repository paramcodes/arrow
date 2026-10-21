import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ANSI_VARIABLES, createTerminalTheme, slotOfVariable, TERMINAL_TOKENS } from "./theme";

/**
 * The palette of the terminal.
 *
 * The terminal cannot read a CSS variable, so the theme maps every slot onto
 * a variable and the stylesheet maps every variable onto a token. The cases
 * read both halves, because a slot that is not in the table is a slot xterm
 * paints with a default of its own.
 */
const read = (variable: string): string => `resolved:${variable}`;

describe("the terminal theme", () => {
  it("maps the surface, the cursor and the selection onto tokens", () => {
    const theme = createTerminalTheme(read);

    expect(theme.background).toBe("resolved:--canvas-soft");
    expect(theme.foreground).toBe("resolved:--ink");
    expect(theme.cursor).toBe("resolved:--accent");
    expect(theme.cursorAccent).toBe("resolved:--canvas");
    expect(theme.selectionBackground).toBe("resolved:--accent-soft");
  });

  it("maps every ANSI slot onto its variable", () => {
    const theme = createTerminalTheme(read);

    expect(theme.black).toBe("resolved:--terminal-ansi-black");
    expect(theme.red).toBe("resolved:--terminal-ansi-red");
    expect(theme.green).toBe("resolved:--terminal-ansi-green");
    expect(theme.yellow).toBe("resolved:--terminal-ansi-yellow");
    expect(theme.blue).toBe("resolved:--terminal-ansi-blue");
    expect(theme.magenta).toBe("resolved:--terminal-ansi-magenta");
    expect(theme.cyan).toBe("resolved:--terminal-ansi-cyan");
    expect(theme.white).toBe("resolved:--terminal-ansi-white");
  });

  it("maps every bright ANSI slot onto its variable", () => {
    const theme = createTerminalTheme(read);

    expect(theme.brightBlack).toBe("resolved:--terminal-ansi-bright-black");
    expect(theme.brightRed).toBe("resolved:--terminal-ansi-bright-red");
    expect(theme.brightGreen).toBe("resolved:--terminal-ansi-bright-green");
    expect(theme.brightYellow).toBe("resolved:--terminal-ansi-bright-yellow");
    expect(theme.brightBlue).toBe("resolved:--terminal-ansi-bright-blue");
    expect(theme.brightMagenta).toBe("resolved:--terminal-ansi-bright-magenta");
    expect(theme.brightCyan).toBe("resolved:--terminal-ansi-bright-cyan");
    expect(theme.brightWhite).toBe("resolved:--terminal-ansi-bright-white");
  });

  it("keeps the sixteen ANSI variables distinct", () => {
    expect(new Set(ANSI_VARIABLES).size).toBe(16);
  });

  it("derives the xterm slot of a bright variable", () => {
    expect(slotOfVariable("--terminal-ansi-bright-black")).toBe("brightBlack");
    expect(slotOfVariable("--terminal-ansi-bright-cursor")).toBe("brightCursor");
  });

  it("ships a stylesheet that declares every slot and reads a token", () => {
    const css = readFileSync(new URL("./terminal.css", import.meta.url), "utf8");

    for (const variable of ANSI_VARIABLES) {
      expect(css, `${variable} is missing from terminal.css`).toContain(`${variable}:`);
    }

    expect(css).toContain("--terminal-ansi-red: var(--error);");
    expect(css).toContain("--terminal-ansi-green: var(--success);");
    expect(css).toContain("--terminal-ansi-blue: var(--info);");
    expect(css).toContain("--terminal-ansi-bright-black: var(--ink-tertiary);");
  });

  it("maps every slot of the table onto a real token name", () => {
    for (const token of Object.values(TERMINAL_TOKENS)) {
      expect(token).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });
});
