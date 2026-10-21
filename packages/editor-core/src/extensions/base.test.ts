import { redoDepth, undoDepth } from "@codemirror/commands";
import { highlightingFor } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { baseExtensions } from "./base";

/**
 * The base extension bundle of Arrow.
 *
 * The bundle is the editor every document opens with. The cases below read
 * the state the bundle produces, so a bundle that loses an extension fails
 * here instead of failing in the window of the product.
 */

/** A state that carries the base bundle. */
function stateWithBundle(doc = ""): EditorState {
  return EditorState.create({ doc, extensions: [...baseExtensions] });
}

describe("the base extension bundle", () => {
  it("paints the editor with the dark theme of Arrow", () => {
    const state = stateWithBundle();

    expect(state.facet(EditorView.darkTheme)).toBe(true);
    expect(state.facet(EditorView.theme)).not.toBe("");
  });

  it("paints every surface with a token of the palette", () => {
    const state = stateWithBundle();
    const css = state
      .facet(EditorView.styleModule)
      .map((module) => module.getRules())
      .join("\n");

    expect(css).toContain("var(--canvas)");
    expect(css).toContain("var(--ink)");
    expect(css).toContain("var(--accent)");
  });

  it("keeps the history of the document", () => {
    const state = stateWithBundle("const a = 1;");
    expect(undoDepth(state)).toBe(0);

    const changed = state.update({ changes: { from: 0, insert: "// " } }).state;

    expect(undoDepth(changed)).toBeGreaterThan(0);
    expect(redoDepth(changed)).toBe(0);
  });

  it("registers the key bindings of the editor", () => {
    const state = stateWithBundle();

    expect(state.facet(keymap).length).toBeGreaterThan(0);
  });

  it("styles the syntax tokens of the languages", () => {
    const state = stateWithBundle();

    expect(highlightingFor(state, [tags.keyword])).not.toBeNull();
    expect(highlightingFor(state, [tags.string])).not.toBeNull();
    expect(highlightingFor(state, [tags.comment])).not.toBeNull();
  });
});
