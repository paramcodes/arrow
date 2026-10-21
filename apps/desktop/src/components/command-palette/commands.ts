import {
  Files,
  FolderOpen,
  MessageSquare,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
  Settings,
  SquareSplitHorizontal,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import { baseName } from "../../hooks/fileSystem";
import type { ActivePanel } from "../../stores/layout";
import type { PaletteMode } from "../../stores/overlay";
import { fuzzyScore } from "../../lib/fuzzy";

/**
 * The commands of the shell.
 *
 * Every command of the window is one entry of this registry: a stable id, the
 * label a reader searches for, the shortcut that runs it, the category it sits
 * under and the action it runs. A shortcut that exists in the shell exists
 * here, and the key handler of the shell reads this table, so a binding cannot
 * show in the palette without working.
 *
 * The registry is a pure function of the actions, so a test can hand it a
 * table of spies and read which action a command runs.
 */

/** The category a command sits under in the palette. */
export type CommandCategory = "file" | "edit" | "view" | "git" | "terminal" | "ai";

/** The label of every category. */
export const CATEGORY_LABELS: Readonly<Record<CommandCategory, string>> = {
  file: "File",
  edit: "Edit",
  view: "View",
  git: "Git",
  terminal: "Terminal",
  ai: "AI",
};

/** The order the palette lists the categories in. */
export const CATEGORY_ORDER: readonly CommandCategory[] = [
  "file",
  "edit",
  "view",
  "git",
  "terminal",
  "ai",
];

/** The shortcuts of the shell. One spelling, read by the palette and the key handler. */
export const SHORTCUTS = {
  commandPalette: "Mod+Shift+P",
  quickOpen: "Mod+P",
  openFolder: "Mod+O",
  toggleSidebar: "Mod+B",
  toggleBottomPanel: "Mod+`",
  openSettings: "Mod+,",
  save: "Mod+S",
  saveAll: "Mod+Shift+S",
} as const;

/** One command of the shell. */
export interface Command {
  /** The stable id of the command. */
  readonly id: string;
  /** The label a reader searches for. */
  readonly label: string;
  /** The shortcut that runs the command, as `Mod+Shift+P`. */
  readonly shortcut?: string | undefined;
  /** The icon the palette shows beside the label. */
  readonly icon?: LucideIcon | undefined;
  /** The category the command sits under. */
  readonly category: CommandCategory;
  /** The action the command runs. */
  readonly action: () => void;
}

/** The actions a command can run. */
export interface CommandActions {
  /** Open the palette on the list of commands or of files. */
  readonly openPalette: (mode: PaletteMode) => void;
  /** Open the settings dialog. */
  readonly openSettings: () => void;
  /** Toggle the sidebar. */
  readonly toggleSidebar: () => void;
  /** Toggle the bottom panel. */
  readonly toggleBottomPanel: () => void;
  /** Show a panel of the sidebar, opening the sidebar when it is closed. */
  readonly showPanel: (panel: ActivePanel) => void;
  /** Save the active file. */
  readonly saveActiveFile: () => void;
  /** Save every dirty file. */
  readonly saveAllFiles: () => void;
  /** Ask the reader for a folder and open it as the project. */
  readonly openFolder: () => void;
  /** Read the state of the repository of the project again. */
  readonly refreshGitStatus: () => void;
}

/** The commands of the shell, in the order the palette lists them. */
export function createCommands(actions: CommandActions): readonly Command[] {
  const commands: Command[] = [
    {
      id: "file.quickOpen",
      label: "Go to File…",
      shortcut: SHORTCUTS.quickOpen,
      icon: FolderOpen,
      category: "file",
      action: () => actions.openPalette("files"),
    },
    {
      id: "file.save",
      label: "File: Save",
      shortcut: SHORTCUTS.save,
      icon: Save,
      category: "file",
      action: actions.saveActiveFile,
    },
    {
      id: "file.saveAll",
      label: "File: Save All",
      shortcut: SHORTCUTS.saveAll,
      icon: Save,
      category: "file",
      action: actions.saveAllFiles,
    },
    {
      id: "file.openFolder",
      label: "File: Open Folder…",
      shortcut: SHORTCUTS.openFolder,
      icon: FolderOpen,
      category: "file",
      action: actions.openFolder,
    },
    {
      id: "palette.commands",
      label: "Show All Commands",
      shortcut: SHORTCUTS.commandPalette,
      icon: Search,
      category: "view",
      action: () => actions.openPalette("commands"),
    },
    {
      id: "view.toggleSidebar",
      label: "View: Toggle Sidebar",
      shortcut: SHORTCUTS.toggleSidebar,
      icon: PanelLeft,
      category: "view",
      action: actions.toggleSidebar,
    },
    {
      id: "view.showExplorer",
      label: "View: Show Explorer",
      icon: Files,
      category: "view",
      action: () => actions.showPanel("explorer"),
    },
    {
      id: "view.showSearch",
      label: "View: Show Search",
      icon: Search,
      category: "view",
      action: () => actions.showPanel("search"),
    },
    {
      id: "view.showSourceControl",
      label: "View: Show Source Control",
      icon: SquareSplitHorizontal,
      category: "view",
      action: () => actions.showPanel("git"),
    },
    {
      id: "view.showChat",
      label: "View: Show Chat",
      icon: MessageSquare,
      category: "view",
      action: () => actions.showPanel("chat"),
    },
    {
      id: "settings.open",
      label: "Preferences: Open Settings",
      shortcut: SHORTCUTS.openSettings,
      icon: Settings,
      category: "view",
      action: actions.openSettings,
    },
    {
      id: "git.refreshStatus",
      label: "Git: Refresh Status",
      icon: RefreshCw,
      category: "git",
      action: actions.refreshGitStatus,
    },
    {
      id: "terminal.toggle",
      label: "Terminal: Toggle Panel",
      shortcut: SHORTCUTS.toggleBottomPanel,
      icon: Terminal,
      category: "terminal",
      action: actions.toggleBottomPanel,
    },
  ];

  const rank = (category: CommandCategory) => CATEGORY_ORDER.indexOf(category);

  return commands.sort(
    (left, right) =>
      rank(left.category) - rank(right.category) || left.label.localeCompare(right.label),
  );
}

/** The text a query is matched against. */
function commandText(command: Command): string {
  return `${command.label} ${CATEGORY_LABELS[command.category]}`;
}

/** The commands that match a query, best first. */
export function rankCommands(commands: readonly Command[], query: string): readonly Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return commands;

  const ranked = commands
    .map((command) => {
      const match = fuzzyScore(commandText(command), query);
      return match ? { command, score: match.score } : null;
    })
    .filter((entry): entry is { command: Command; score: number } => entry !== null);

  ranked.sort(
    (left, right) =>
      right.score - left.score || left.command.label.localeCompare(right.command.label),
  );

  return ranked.map((entry) => entry.command);
}

/** The best score of a file path, from its name and from its whole path. */
function fileScore(path: string, query: string): number | null {
  const name = fuzzyScore(baseName(path), query);
  const whole = fuzzyScore(path, query);

  if (!name && !whole) return null;

  // The name of the file is what a reader remembers, so a match on the name
  // beats a match that is only a stretch of directories.
  return Math.max(name?.score ?? Number.NEGATIVE_INFINITY, (whole?.score ?? 0) - 4);
}

/** The files that match a query, best first. */
export function rankFiles(files: readonly string[], query: string): readonly string[] {
  const needle = query.trim();
  if (needle === "") return files;

  const ranked = files
    .map((file) => {
      const score = fileScore(file, needle);
      return score === null ? null : { file, score };
    })
    .filter((entry): entry is { file: string; score: number } => entry !== null);

  ranked.sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  return ranked.map((entry) => entry.file);
}
