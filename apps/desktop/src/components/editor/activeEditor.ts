import type { EditorView } from "@arrow/editor-core";

/**
 * The document the reader sees.
 *
 * The shell has one pane per open file, and only one of them is the pane the
 * reader is looking at. A command of the palette has no pane of its own, so it
 * asks this module for the pane the reader sees and runs its action there.
 *
 * The registry holds one pane and never more: the pane that is not the one the
 * reader sees gives its place back when it loses it.
 */

/** The actions of the inline edit of one document. */
export interface InlineEditActions {
  /** Open the prompt of the inline edit. */
  readonly start: () => void;
  /** Take the proposed edit into the document. */
  readonly accept: () => void;
  /** Throw the proposed edit away. */
  readonly reject: () => void;
}

/** The pane the reader sees. */
export interface ActiveEditor {
  /** The view of the document. */
  readonly view: EditorView;
  /** The actions of the inline edit of that document. */
  readonly inlineEdit: InlineEditActions;
}

/** The pane the reader sees, or null when no pane is active. */
let active: ActiveEditor | null = null;

/** The pane the reader sees, or null when no pane is active. */
export function activeEditor(): ActiveEditor | null {
  return active;
}

/** Give the place of the active pane to a pane, or give it back. */
export function setActiveEditor(editor: ActiveEditor | null): void {
  active = editor;
}
