import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createCommands, SHORTCUTS, type CommandActions } from "./commands";
import { vi } from "vitest";

/**
 * The shortcuts of the app and the command registry.
 *
 * The registry of the shell is the one table of the shortcuts: the palette
 * shows them and the key handler answers them, so a shortcut that shows in the
 * palette is the shortcut that runs.
 *
 * The engine of the AI feature owns two key bindings of its own, and the
 * modified one of them is a shortcut of the app: the reader presses it to take
 * the proposed edit. A binding the app owns and the registry does not know is
 * a shortcut the reader cannot find, so the case reads the engine and asks
 * the registry about every modified binding it finds.
 */

/** The files of the engine that own the key bindings of the AI feature. */
const engineFiles = [
  "../../../../../packages/editor-core/src/extensions/ai-completions.ts",
  "../../../../../packages/editor-core/src/extensions/inline-diff.ts",
];

/** A table of actions a command can run, every one a spy. */
function actions(): CommandActions {
  return {
    openPalette: vi.fn(),
    openSettings: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleBottomPanel: vi.fn(),
    showPanel: vi.fn(),
    saveActiveFile: vi.fn(),
    saveAllFiles: vi.fn(),
    openFolder: vi.fn(),
    refreshGitStatus: vi.fn(),
    startInlineEdit: vi.fn(),
    acceptInlineEdit: vi.fn(),
    rejectInlineEdit: vi.fn(),
  };
}

/**
 * The one spelling of a shortcut.
 *
 * The registry writes `Mod+Enter` and the engine writes `Mod-Enter`, and the
 * order of the modifiers says nothing, so both spellings become the same
 * string before they are compared.
 */
function normalize(shortcut: string): string {
  return shortcut
    .replaceAll("-", "+")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "")
    .sort()
    .join("+");
}

/** The key bindings the engine of the AI feature writes down. */
function engineBindings(): readonly string[] {
  const found: string[] = [];

  for (const file of engineFiles) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    for (const match of source.matchAll(/key:\s*"([^"]+)"/g)) {
      const key = match[1] ?? "";
      if (!key.toLowerCase().includes("mod")) continue;
      found.push(key);
    }
  }

  return found;
}

describe("the shortcuts of the app", () => {
  it("gives every shortcut of the registry a command in the palette", () => {
    const shortcuts = createCommands(actions())
      .map((command) => command.shortcut)
      .filter(Boolean);

    for (const shortcut of Object.values(SHORTCUTS)) {
      expect(shortcuts, `the registry holds ${shortcut} and the palette does not`).toContain(
        shortcut,
      );
    }
  });

  it("takes every shortcut of a command from the registry", () => {
    const known = new Set(Object.values(SHORTCUTS).map(normalize));

    for (const command of createCommands(actions())) {
      if (!command.shortcut) continue;
      expect(
        known.has(normalize(command.shortcut)),
        `${command.id} binds ${command.shortcut}, which the registry does not hold`,
      ).toBe(true);
    }
  });

  it("holds every modified binding of the AI feature in the registry", () => {
    const known = new Set(Object.values(SHORTCUTS).map(normalize));
    const bindings = engineBindings();

    expect(bindings.length, "the engine of the AI feature binds keys").toBeGreaterThan(0);

    for (const binding of bindings) {
      expect(
        known.has(normalize(binding)),
        `the engine binds ${binding}, which the registry does not hold`,
      ).toBe(true);
    }
  });
});
