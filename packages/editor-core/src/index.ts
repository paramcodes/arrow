/**
 * The editor engine of Arrow.
 *
 * The editor core owns the document model and nothing else. It never imports
 * the desktop app and never reaches for Tauri, so the same engine runs in a
 * browser, in a test and inside the shell.
 *
 * The module exports the three pieces the shell needs: the base extension
 * bundle every document opens with, the theme that paints it, and the React
 * component that owns the life of the view.
 */

export { Editor, type EditorProps } from "./Editor";
export { baseExtensions } from "./extensions/base";
export { arrowKeymap } from "./extensions/keymaps";
export { arrowDarkTheme, arrowHighlightStyle } from "./extensions/theme";
export {
  languageFor,
  supportedLanguageIds,
  supportedLanguages,
} from "./languages";

/** One open document. */
export interface EditorDocument {
  readonly path: string;
  readonly languageId: string;
  readonly text: string;
  readonly dirty: boolean;
}

/** The language of a document Arrow does not recognise. */
export const PLAIN_TEXT_LANGUAGE = "plaintext";

/** Build an empty document. */
export function createEmptyDocument(
  path: string,
  languageId: string = PLAIN_TEXT_LANGUAGE,
): EditorDocument {
  return { path, languageId, text: "", dirty: false };
}

/** Count the lines of a document. An empty document has one line. */
export function countLines(document: EditorDocument): number {
  if (document.text.length === 0) {
    return 1;
  }
  return document.text.split("\n").length;
}
