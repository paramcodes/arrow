import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  acceptInlineDiff,
  clearInlineDiff,
  inlineDiff,
  inlineDiffField,
  inlineEditRange,
  rejectInlineDiff,
  setInlineDiff,
  type InlineDiff,
} from "./inline-diff";

/**
 * The inline diff of the editor.
 *
 * The cases below drive the engine the way the editor drives it: they put a
 * proposed edit into the state, they run the transactions of the two bindings
 * and they read the document, the field and the decorations afterwards. A case
 * that reads the code instead of the behaviour would pass when the engine
 * stopped working.
 */

/** A state that carries the inline diff extension. */
function stateWithDiff(doc = ""): EditorState {
  return EditorState.create({ doc, extensions: [inlineDiff()] });
}

/** The proposed edit a state holds. */
function diffOf(state: EditorState): InlineDiff | null {
  return state.field(inlineDiffField, false)?.diff ?? null;
}

/** The classes of the decorations a state paints. */
function classesOf(state: EditorState): readonly string[] {
  const decorations = state.field(inlineDiffField, false)?.decorations;
  if (!decorations) return [];

  const classes: string[] = [];
  decorations.between(0, Number.MAX_SAFE_INTEGER, (_from, _to, value) => {
    classes.push(value.spec.class as string);
  });
  return classes;
}

/** A proposed edit of the range of a document. */
function proposed(from: number, to: number, original: string, text: string): InlineDiff {
  return { from, to, original, proposed: text };
}

describe("the inline diff of the editor", () => {
  it("holds the edit that a caller puts into it", () => {
    const state = stateWithDiff("const a = 1;");

    const withEdit = state.update({
      effects: setInlineDiff.of(proposed(0, 12, "const a = 1;", "const a = 2;")),
    }).state;

    expect(diffOf(withEdit)?.proposed).toBe("const a = 2;");
    expect(withEdit.doc.toString(), "the document waits for the reader").toBe("const a = 1;");
  });

  it("gives the decoration of the edit to the editor", () => {
    const state = stateWithDiff("const a = 1;");

    const withEdit = state.update({
      effects: setInlineDiff.of(proposed(0, 12, "const a = 1;", "const a = 2;")),
    }).state;

    const painted = withEdit.facet(EditorView.decorations);
    expect(painted.length, "the editor paints the fields that hand it their decorations").toBe(1);
    expect(painted[0]?.size).toBeGreaterThan(0);
  });

  it("paints the lines the model removes and the lines it adds", () => {
    const state = stateWithDiff("const a = 1;\nconst b = 2;");

    const withEdit = state.update({
      effects: setInlineDiff.of(
        proposed(0, 25, "const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;"),
      ),
    }).state;

    const classes = classesOf(withEdit);
    expect(classes, "the lines the model removes are painted").toContain("cm-inline-diff-removed");
    expect(classes, "the lines the model adds are painted").toContain("cm-inline-diff-added");
  });

  it("puts the edit into the document when the reader takes it", () => {
    const state = stateWithDiff("const a = 1;\nconst b = 2;");

    const withEdit = state.update({
      effects: setInlineDiff.of(
        proposed(0, 25, "const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;"),
      ),
    }).state;

    const spec = acceptInlineDiff(withEdit);
    expect(spec, "the edit can be taken").not.toBeNull();

    const accepted = withEdit.update(spec ?? {}).state;

    expect(accepted.doc.toString()).toBe("const a = 1;\nconst b = 3;");
    expect(diffOf(accepted), "the edit leaves the screen").toBeNull();
  });

  it("leaves the document alone when the reader throws the edit away", () => {
    const state = stateWithDiff("const a = 1;\nconst b = 2;");

    const withEdit = state.update({
      effects: setInlineDiff.of(
        proposed(0, 25, "const a = 1;\nconst b = 2;", "const a = 1;\nconst b = 3;"),
      ),
    }).state;

    const spec = rejectInlineDiff(withEdit);
    expect(spec, "the edit can be thrown away").not.toBeNull();

    const rejected = withEdit.update(spec ?? {}).state;

    expect(rejected.doc.toString()).toBe("const a = 1;\nconst b = 2;");
    expect(diffOf(rejected)).toBeNull();
  });

  it("has no edit to take when the editor holds none", () => {
    const state = stateWithDiff("const a = 1;");

    expect(acceptInlineDiff(state)).toBeNull();
    expect(rejectInlineDiff(state)).toBeNull();
  });

  it("refuses an edit of another text", () => {
    const state = stateWithDiff("const a = 1;");

    const withEdit = state.update({
      effects: setInlineDiff.of(proposed(0, 12, "const a = 1;", "const a = 2;")),
    }).state;

    const typed = withEdit.update({ changes: { from: 12, insert: " " } }).state;

    expect(acceptInlineDiff(typed), "an edit of another text is an edit that lies").toBeNull();
  });

  it("takes the edit away when the document changes", () => {
    const state = stateWithDiff("const a = 1;");

    const withEdit = state.update({
      effects: setInlineDiff.of(proposed(0, 12, "const a = 1;", "const a = 2;")),
    }).state;

    const typed = withEdit.update({
      changes: { from: 12, insert: "x" },
      userEvent: "input.type",
    }).state;

    expect(diffOf(typed)).toBeNull();
  });

  it("empties the field when a caller clears the edit", () => {
    const state = stateWithDiff("const a = 1;");

    const withEdit = state.update({
      effects: setInlineDiff.of(proposed(0, 12, "const a = 1;", "const a = 2;")),
    }).state;

    const cleared = withEdit.update({ effects: clearInlineDiff.of(null) }).state;

    expect(diffOf(cleared)).toBeNull();
  });

  it("binds the command and the escape of the reader to the edit", () => {
    const state = stateWithDiff();
    const bindings = state.facet(keymap).flat();

    expect(bindings.some((binding) => binding.key === "Mod-Enter")).toBe(true);
    expect(bindings.some((binding) => binding.key === "Escape")).toBe(true);
  });

  it("takes the range of the reader as whole lines", () => {
    const state = EditorState.create({
      doc: "const a = 1;\nconst b = 2;\nconst c = 3;",
      selection: { anchor: 14, head: 24 },
    });

    const range = inlineEditRange(state);

    expect(range?.from).toBe(13);
    expect(range?.to).toBe(25);
    expect(range?.original).toBe("const b = 2;");
  });

  it("takes the line of the caret when the reader selected nothing", () => {
    const state = EditorState.create({
      doc: "const a = 1;\nconst b = 2;",
      selection: { anchor: 15 },
    });

    const range = inlineEditRange(state);

    expect(range?.from).toBe(13);
    expect(range?.to).toBe(25);
    expect(range?.original).toBe("const b = 2;");
  });

  it("opens no range on a line that holds no code", () => {
    const state = EditorState.create({
      doc: "const a = 1;\n\nconst b = 2;",
      selection: { anchor: 13 },
    });

    expect(inlineEditRange(state), "a line of nothing holds nothing to edit").toBeNull();
  });
});
