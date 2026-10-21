import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * The extra listeners a caller mounts on a document.
 *
 * The engine already reports every change of the text through `onChange`. A
 * caller that also needs the place of the reader, such as the pane that keeps
 * one caret per file, mounts `selectionListener` on top of the base bundle.
 * The listener is a plain extension, so the caller never imports CodeMirror
 * and the editor core keeps its rule of owning the engine.
 */

/** The place of a caret, as the listener reports it. */
export interface SelectionChange {
  /** The anchor of the selection. */
  readonly anchor: number;
  /** The head of the selection. */
  readonly head: number;
}

/** An extension that reports every change of the selection. */
export function selectionListener(report: (selection: SelectionChange) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const { anchor, head } = update.state.selection.main;
    report({ anchor, head });
  });
}
