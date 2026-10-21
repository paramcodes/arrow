import { describe, expect, it, vi } from "vitest";

import {
  CATEGORY_ORDER,
  createCommands,
  rankCommands,
  rankFiles,
  SHORTCUTS,
  type Command,
  type CommandActions,
} from "./commands";

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

/** The command with an id, or a failure that names the missing id. */
function command(commands: readonly Command[], id: string): Command {
  const found = commands.find((entry) => entry.id === id);
  if (!found) throw new Error(`the registry has no command ${id}`);
  return found;
}

/**
 * The command registry.
 *
 * The registry is the single table of the window: the palette lists it, the
 * key handler answers it and the tests read the action of a command instead of
 * its label.
 */
describe("the command registry", () => {
  it("gives every command an id, a label and a category", () => {
    const commands = createCommands(actions());

    expect(commands.length).toBeGreaterThan(0);
    for (const entry of commands) {
      expect(entry.id).not.toBe("");
      expect(entry.label).not.toBe("");
      expect(CATEGORY_ORDER).toContain(entry.category);
    }
  });

  it("gives every command an id of its own", () => {
    const ids = createCommands(actions()).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers every shortcut of the shell", () => {
    const commands = createCommands(actions());
    const shortcuts = commands.map((entry) => entry.shortcut).filter(Boolean);

    for (const shortcut of Object.values(SHORTCUTS)) {
      expect(shortcuts).toContain(shortcut);
    }
  });

  it("registers one command per category it ships", () => {
    const commands = createCommands(actions());
    const categories = new Set(commands.map((entry) => entry.category));

    expect(categories).toContain("file");
    expect(categories).toContain("view");
    expect(categories).toContain("terminal");
  });

  it("runs the toggle of the sidebar", () => {
    const spies = actions();
    command(createCommands(spies), "view.toggleSidebar").action();

    expect(spies.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("opens the settings through the registry", () => {
    const spies = actions();
    command(createCommands(spies), "settings.open").action();

    expect(spies.openSettings).toHaveBeenCalledTimes(1);
  });

  it("opens the palette on the list of files", () => {
    const spies = actions();
    command(createCommands(spies), "file.quickOpen").action();

    expect(spies.openPalette).toHaveBeenCalledWith("files");
  });

  it("shows a panel and opens the sidebar for it", () => {
    const spies = actions();
    command(createCommands(spies), "view.showSearch").action();

    expect(spies.showPanel).toHaveBeenCalledWith("search");
  });

  it("opens a folder through the picker", () => {
    const spies = actions();
    command(createCommands(spies), "file.openFolder").action();

    expect(spies.openFolder).toHaveBeenCalledTimes(1);
  });

  it("reads the state of the repository again", () => {
    const spies = actions();
    command(createCommands(spies), "git.refreshStatus").action();

    expect(spies.refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("lists the categories in the order of the registry", () => {
    const commands = createCommands(actions());
    const order = commands.map((entry) => CATEGORY_ORDER.indexOf(entry.category));

    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("finds a command by the letters of its label", () => {
    const commands = createCommands(actions());
    const ranked = rankCommands(commands, "tsb");

    expect(ranked[0]?.id).toBe("view.toggleSidebar");
  });

  it("finds a file by the letters of its name", () => {
    const files = ["src/util.ts", "src/components/Button.tsx", "README.md"];

    expect(rankFiles(files, "utl")[0]).toBe("src/util.ts");
    expect(rankFiles(files, "btn")[0]).toBe("src/components/Button.tsx");
    expect(rankFiles(files, "readme")[0]).toBe("README.md");
  });

  it("keeps every file when the query is empty", () => {
    const files = ["b.ts", "a.ts"];
    expect(rankFiles(files, "")).toEqual(files);
  });
});
