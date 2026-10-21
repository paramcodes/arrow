import { EditorSelection, EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { sameExtensions, selectionAfterContentChange } from "./sync";

/**
 * The rules that keep the view of the editor in step with the props.
 *
 * The cases below read the rules without a browser, so a rule that loses the
 * caret, or a rule that mistakes a new list for a new set of extensions,
 * fails here instead of failing in the window of the product.
 */

/** A document and a selection of it. */
function documentWith(anchor: number, head: number) {
  const doc = Text.of(["alpha beta", "gamma delta", ""]);
  const selection = EditorSelection.single(anchor, head);
  return { doc, selection };
}

describe("the rules that keep the view in step with the props", () => {
  it("holds the caret where it was when the document changes from outside", () => {
    const { doc, selection } = documentWith(2, 2);
    const next = Text.of(["a longer replacement document", "second line", "third line", ""]);

    const kept = selectionAfterContentChange(doc, selection, next);

    expect(kept.main.head).toBe(2);
  });

  it("holds the line and the column of the caret", () => {
    const { doc, selection } = documentWith(13, 13);
    const next = Text.of(["alpha beta", "gamma delta", "epsilon", ""]);

    const kept = selectionAfterContentChange(doc, selection, next);

    expect(kept.main.head).toBe(13);
  });

  it("holds a range, not only a caret", () => {
    const { doc, selection } = documentWith(0, 5);
    const next = Text.of(["alpha beta", "gamma delta epsilon", ""]);

    const kept = selectionAfterContentChange(doc, selection, next);

    expect(kept.main.anchor).toBe(0);
    expect(kept.main.head).toBe(5);
  });

  it("holds every range of a multiple selection", () => {
    const doc = Text.of(["alpha beta", "gamma delta", ""]);
    const selection = EditorSelection.create(
      [EditorSelection.range(0, 5), EditorSelection.range(6, 11)],
      1,
    );
    const next = Text.of(["alpha beta", "gamma delta epsilon", ""]);

    const kept = selectionAfterContentChange(doc, selection, next);

    expect(kept.ranges).toHaveLength(2);
    expect(kept.mainIndex).toBe(1);
    expect(kept.main.head).toBe(11);
  });

  it("clamps the caret to the bounds of a shorter document", () => {
    const { doc, selection } = documentWith(13, 13);
    const next = Text.of(["alpha", ""]);

    const kept = selectionAfterContentChange(doc, selection, next);

    expect(kept.main.head).toBe(6);
  });

  it("reads two lists of extensions by the extensions they hold", () => {
    const first = EditorState.tabSize.of(4);
    const second = EditorState.tabSize.of(2);

    expect(sameExtensions([first], [first])).toBe(true);
    expect(sameExtensions([first], [second])).toBe(false);
    expect(sameExtensions([first], [first, second])).toBe(false);
    expect(sameExtensions(undefined, undefined)).toBe(true);
    expect(sameExtensions(undefined, [])).toBe(true);
  });
});
