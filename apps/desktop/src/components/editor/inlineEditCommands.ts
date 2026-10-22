import { activeEditor } from "./activeEditor";

/**
 * The commands of the inline edit that the palette runs.
 *
 * The palette has no editor of its own, so every command of the inline edit
 * asks the registry of the active pane for the actions of that pane. The
 * answer is the same whether the reader pressed a key or picked a command of
 * the palette.
 */

/** Open the prompt of the inline edit on the document the reader sees. */
export function startInlineEdit(): void {
  activeEditor()?.inlineEdit.start();
}

/** Take the proposed edit into the document the reader sees. */
export function acceptInlineEdit(): void {
  activeEditor()?.inlineEdit.accept();
}

/** Throw the proposed edit away. */
export function rejectInlineEdit(): void {
  activeEditor()?.inlineEdit.reject();
}
