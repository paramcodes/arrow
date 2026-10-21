import { EditorSelection, type Extension, type Text } from "@codemirror/state";

/**
 * The rules that keep the view of the editor in step with the props.
 *
 * The wrapper of the editor owns the life of the view. Two props can change
 * after the view exists: the extensions a caller mounts on the document, and
 * the text of the document itself. The rules below decide when a change of
 * either prop reaches the view, and they are plain functions, so a case can
 * read them without a browser.
 */

/**
 * Whether two lists of extensions hold the same extensions.
 *
 * A caller that builds its list of extensions in the render holds a new list
 * on every render, and the list itself says nothing about the extensions it
 * holds. The rule compares the extensions one by one, so a list that holds
 * the same extensions in the same order is the same list.
 */
export function sameExtensions(
  previous: readonly Extension[] | undefined,
  next: readonly Extension[] | undefined,
): boolean {
  const before = previous ?? [];
  const after = next ?? [];
  if (before.length !== after.length) return false;
  return before.every((extension, index) => extension === after[index]);
}

/**
 * The selection that survives a change of the document from outside.
 *
 * A file that reloads from disk, or a tab that opens another file, changes the
 * text of the document under the caret. The caret keeps its line and its
 * column, clamped to the bounds of the new document, and every range of a
 * multiple selection keeps its own place.
 *
 * A change that came from typing inside the editor never reaches this rule,
 * because the transaction of the typing already owns the selection.
 */
export function selectionAfterContentChange(
  doc: Text,
  selection: EditorSelection,
  next: Text,
): EditorSelection {
  const ranges = selection.ranges.map((range) =>
    EditorSelection.range(
      keepLineAndColumn(doc, range.anchor, next),
      keepLineAndColumn(doc, range.head, next),
    ),
  );
  return EditorSelection.create(ranges, selection.mainIndex);
}

/** The position in the new document that keeps the line and the column of the old one. */
function keepLineAndColumn(doc: Text, offset: number, next: Text): number {
  const line = doc.lineAt(offset);
  const target = next.line(Math.min(line.number, next.lines));
  const column = offset - line.from;
  return target.from + Math.min(column, target.length);
}
