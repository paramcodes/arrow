import { create } from "zustand";

import { PLAIN_TEXT_LANGUAGE, languageForPath } from "@arrow/editor-core";

import { readFile, writeFile } from "../hooks/fileSystem";

/**
 * The editor store of the shell.
 *
 * ADR-0004 puts the facts of the workspace in Zustand: which files are open,
 * which one is active and which of them are dirty. The content sits here too,
 * because the save path and the editor pane read it, but no component of the
 * shell subscribes to the whole store: the tab bar selects the paths, one tab
 * selects its own dirty flag, and only the active pane selects the text. A
 * keystroke therefore repaints the editor and nothing else.
 */

/** One file that is open in a tab. */
export interface OpenFile {
  /** The path of the file on the disk. */
  readonly path: string;
  /** The name of the language of the file, read from its extension. */
  readonly languageId: string;
  /** The text the editor shows. */
  readonly content: string;
  /** True when the text differs from the text on the disk. */
  readonly dirty: boolean;
}

/** A line the editor has to reveal in a file. */
export interface RevealTarget {
  /** The path of the file. */
  readonly path: string;
  /** The line to reveal, counting from one. */
  readonly line: number;
  /** The column to put the caret on, counting from one. */
  readonly column: number;
  /** A counter that changes on every request, so two requests are two events. */
  readonly nonce: number;
}

/** The facts of the editor, without the actions that change them. */
export interface EditorFacts {
  /** The files that are open, in the order of their tabs. */
  readonly openFiles: readonly OpenFile[];
  /** The path of the active file, or null when no file is open. */
  readonly activePath: string | null;
  /** The place a search result asked for, or null. */
  readonly reveal: RevealTarget | null;
}

/** The editor store of the shell. */
export interface EditorState extends EditorFacts {
  /** Open a file in a new tab, or activate its tab when it is already open. */
  readonly openFile: (path: string) => Promise<void>;
  /** Close a tab. The caller confirms the close of a dirty tab first. */
  readonly closeFile: (path: string) => void;
  /** Activate the tab of a file. */
  readonly setActiveFile: (path: string) => void;
  /** Replace the text of a file and mark it dirty. */
  readonly updateContent: (path: string, content: string) => void;
  /** Write a file back to the disk and clear its dirty flag. */
  readonly saveFile: (path: string) => Promise<void>;
  /** Write every dirty file back to the disk. */
  readonly saveAll: () => Promise<void>;
  /** Move the path of an open file after a rename in the tree. */
  readonly remapPath: (from: string, to: string) => void;
  /** Open a file and put the caret on a line of it. */
  readonly openFileAt: (path: string, line: number, column?: number) => Promise<void>;
  /** Put the caret on a line of a file that is open. */
  readonly revealLine: (path: string, line: number, column?: number) => void;
}

/** The facts the editor holds when it opens. */
const INITIAL_FACTS: EditorFacts = { openFiles: [], activePath: null, reveal: null };

/** The counter behind the nonce of a reveal, so two requests never share one. */
let revealNonce = 0;

/** The language of a path, or plain text when the registry does not know it. */
export function languageOfPath(path: string): string {
  return languageForPath(path) || PLAIN_TEXT_LANGUAGE;
}

/**
 * The editor store of the shell.
 *
 * A file that is already open is activated, never opened twice: two tabs of
 * one file would carry two copies of its text, and a save of one would silently
 * lose the edits of the other.
 */
export const useEditorStore = create<EditorState>()((set, get) => ({
  ...INITIAL_FACTS,

  openFile: async (path) => {
    const existing = get().openFiles.find((file) => file.path === path);
    if (existing) {
      set({ activePath: path });
      return;
    }

    const content = await readFile(path);
    // The read is async, so the file may have been opened while it was in
    // flight. The second open must not add a second tab.
    if (get().openFiles.some((file) => file.path === path)) {
      set({ activePath: path });
      return;
    }

    const file: OpenFile = {
      path,
      languageId: languageOfPath(path),
      content,
      dirty: false,
    };

    set((state) => ({ openFiles: [...state.openFiles, file], activePath: path }));
  },

  closeFile: (path) => {
    set((state) => {
      const index = state.openFiles.findIndex((file) => file.path === path);
      if (index === -1) return state;

      const openFiles = state.openFiles.filter((file) => file.path !== path);
      if (state.activePath !== path) return { openFiles };

      const neighbour = openFiles[Math.min(index, openFiles.length - 1)];
      return { openFiles, activePath: neighbour?.path ?? null };
    });
  },

  setActiveFile: (path) => {
    if (!get().openFiles.some((file) => file.path === path)) return;
    set({ activePath: path });
  },

  updateContent: (path, content) => {
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === path ? { ...file, content, dirty: true } : file,
      ),
    }));
  },

  saveFile: async (path) => {
    const file = get().openFiles.find((open) => open.path === path);
    if (!file) return;

    await writeFile(file.path, file.content);
    set((state) => ({
      openFiles: state.openFiles.map((open) =>
        open.path === path ? { ...open, dirty: false } : open,
      ),
    }));
  },

  saveAll: async () => {
    const dirty = get().openFiles.filter((file) => file.dirty);
    await Promise.all(dirty.map((file) => get().saveFile(file.path)));
  },

  openFileAt: async (path, line, column = 1) => {
    await get().openFile(path);
    get().revealLine(path, line, column);
  },

  revealLine: (path, line, column = 1) => {
    revealNonce += 1;
    set({
      reveal: {
        path,
        line: Math.max(1, Math.round(line)),
        column: Math.max(1, Math.round(column)),
        nonce: revealNonce,
      },
    });
  },

  remapPath: (from, to) => {
    const remap = (path: string): string =>
      path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;

    set((state) => ({
      openFiles: state.openFiles.map((file) => {
        const path = remap(file.path);
        return path === file.path ? file : { ...file, path, languageId: languageOfPath(path) };
      }),
      activePath: state.activePath ? remap(state.activePath) : null,
    }));
  },
}));

/**
 * Puts the editor back the way a new window opens it.
 *
 * The store is one mutable object, so a test that changes it changes it for
 * every test that runs after it. Every test of the store resets it first, and
 * the guardrail in `layout.test.ts` fails when one of them forgets.
 */
export function resetEditorStore(): void {
  useEditorStore.setState(INITIAL_FACTS);
}
