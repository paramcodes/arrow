import { atom, type PrimitiveAtom } from "jotai";

/**
 * The per-file atoms of the editor.
 *
 * ADR-0004 splits the state of Arrow in tiers: Zustand holds the facts of the
 * workspace, such as which files are open and which one is active, and Jotai
 * holds the facts of one item, such as where the caret of a file sits. A
 * cursor belongs to one file and to no other, so every path owns an atom of
 * its own.
 *
 * The content of a file does not live here. It lives in the editor store with
 * the path and the dirty flag, because the tab bar and the save path read it.
 */

/** The place of the reader in one file. */
export interface FileCursor {
  /** The anchor of the selection. */
  readonly anchor: number;
  /** The head of the selection. */
  readonly head: number;
  /** How far the document is scrolled, in pixels. */
  readonly scrollTop: number;
}

/** The place a file opens at. */
export const INITIAL_CURSOR: FileCursor = { anchor: 0, head: 0, scrollTop: 0 };

const cursors = new Map<string, PrimitiveAtom<FileCursor>>();

/**
 * The cursor of one file.
 *
 * The atom of a path is created the first time the path is asked for, so two
 * tabs never share a caret and a file that is closed and opened again starts
 * at the top.
 */
export function fileCursorAtom(path: string): PrimitiveAtom<FileCursor> {
  const existing = cursors.get(path);
  if (existing) return existing;

  const created = atom<FileCursor>(INITIAL_CURSOR);
  cursors.set(path, created);
  return created;
}
