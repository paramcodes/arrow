/**
 * The editor engine of Arrow.
 *
 * The editor core owns the document model and nothing else. It never imports
 * the desktop app and never reaches for Tauri, so the same engine runs in a
 * browser, in a test and inside the shell.
 *
 * The CodeMirror 6 integration lands in phase 2. This module carries the
 * contract that integration will fill.
 */

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
