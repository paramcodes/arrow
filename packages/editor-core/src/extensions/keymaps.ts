import { copyLineDown, copyLineUp, moveLineDown, moveLineUp } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

/**
 * The key bindings Arrow owns on top of the CodeMirror defaults.
 *
 * The defaults of CodeMirror already cover editing, history, folding and
 * search. These are the bindings a reader of a code editor expects and that
 * the defaults do not carry: a line that is copied above or below, and a line
 * that moves.
 */
export const arrowKeymap = keymap.of([
  { key: "Alt-Mod-ArrowUp", run: copyLineUp },
  { key: "Alt-Mod-ArrowDown", run: copyLineDown },
  { key: "Mod-Shift-ArrowUp", run: moveLineUp },
  { key: "Mod-Shift-ArrowDown", run: moveLineDown },
]);
