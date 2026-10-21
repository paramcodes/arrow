import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptGhostText,
  aiCompletions,
  clearGhostText,
  createTriggerDebounce,
  dismissGhostText,
  ghostTextField,
  GHOST_TEXT_DELAY_MS,
  setGhostText,
} from "./ai-completions";

/**
 * The ghost text of the editor.
 *
 * The cases below drive the engine the way the editor drives it: they put a
 * suggestion into the state, they run the transactions of the two bindings and
 * they read the document and the field afterwards. A case that reads the code
 * instead of the behaviour would pass when the engine stopped working.
 */

/** A state that carries the ghost text extension. */
function stateWithGhostText(doc = ""): EditorState {
  return EditorState.create({ doc, extensions: [aiCompletions()] });
}

/** A state that carries the ghost text extension and a caret at the end. */
function stateWithCaretAtEnd(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [aiCompletions()],
    selection: { anchor: doc.length },
  });
}

/** The suggestion a state holds. */
function suggestionOf(state: EditorState): string | null {
  return state.field(ghostTextField, false)?.text ?? null;
}

describe("the ghost text of the editor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the suggestion that a caller puts into it", () => {
    const state = stateWithGhostText("const a = 1;");

    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    expect(suggestionOf(withSuggestion)).toBe(" const b = 2;");
    expect(withSuggestion.field(ghostTextField).decorations.size).toBe(1);
  });

  it("gives the decoration of the suggestion to the editor", () => {
    const state = stateWithGhostText("const a = 1;");

    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const painted = withSuggestion.facet(EditorView.decorations);
    expect(painted.length, "the editor paints the fields that hand it their decorations").toBe(1);
    expect(painted[0]?.size).toBe(1);
  });

  it("asks for a suggestion once the reader stopped typing", () => {
    vi.useFakeTimers();
    let asked = 0;
    const wait = createTriggerDebounce(GHOST_TEXT_DELAY_MS, () => {
      asked += 1;
    });

    wait.notify();
    vi.advanceTimersByTime(GHOST_TEXT_DELAY_MS - 1);
    expect(asked, "the engine asks only after the reader has been still").toBe(0);

    vi.advanceTimersByTime(1);
    expect(asked).toBe(1);
  });

  it("waits again when the reader keeps typing", () => {
    vi.useFakeTimers();
    let asked = 0;
    const wait = createTriggerDebounce(GHOST_TEXT_DELAY_MS, () => {
      asked += 1;
    });

    wait.notify();
    vi.advanceTimersByTime(GHOST_TEXT_DELAY_MS - 10);
    wait.notify();
    vi.advanceTimersByTime(GHOST_TEXT_DELAY_MS - 10);

    expect(asked, "the wait restarts on every keystroke").toBe(0);

    vi.advanceTimersByTime(10);
    expect(asked).toBe(1);
  });

  it("does not ask when the wait is cancelled", () => {
    vi.useFakeTimers();
    let asked = 0;
    const wait = createTriggerDebounce(GHOST_TEXT_DELAY_MS, () => {
      asked += 1;
    });

    wait.notify();
    wait.cancel();
    vi.advanceTimersByTime(GHOST_TEXT_DELAY_MS * 2);

    expect(asked).toBe(0);
  });

  it("puts the suggestion into the document when the reader takes it", () => {
    const state = stateWithCaretAtEnd("const a = 1;");
    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const spec = acceptGhostText(withSuggestion);
    expect(spec, "the suggestion can be taken").not.toBeNull();

    const accepted = withSuggestion.update(spec ?? {}).state;

    expect(accepted.doc.toString()).toBe("const a = 1; const b = 2;");
    expect(accepted.selection.main.head).toBe("const a = 1; const b = 2;".length);
    expect(suggestionOf(accepted), "the suggestion leaves the screen").toBeNull();
  });

  it("leaves the document alone when the reader throws the suggestion away", () => {
    const state = stateWithGhostText("const a = 1;");
    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const spec = dismissGhostText(withSuggestion);
    expect(spec, "the suggestion can be dismissed").not.toBeNull();

    const dismissed = withSuggestion.update(spec ?? {}).state;

    expect(dismissed.doc.toString()).toBe("const a = 1;");
    expect(suggestionOf(dismissed)).toBeNull();
  });

  it("has no suggestion to take when the editor holds none", () => {
    const state = stateWithGhostText("const a = 1;");

    expect(acceptGhostText(state)).toBeNull();
    expect(dismissGhostText(state)).toBeNull();
  });

  it("takes the suggestion away when the document changes", () => {
    const state = stateWithGhostText("const a = 1;");
    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const typed = withSuggestion.update({
      changes: { from: 12, insert: "x" },
      userEvent: "input.type",
    }).state;

    expect(
      suggestionOf(typed),
      "a suggestion of another text is a suggestion that lies",
    ).toBeNull();
  });

  it("takes the suggestion away when the caret moves", () => {
    const state = stateWithGhostText("const a = 1;");
    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const moved = withSuggestion.update({ selection: { anchor: 0 } }).state;

    expect(suggestionOf(moved)).toBeNull();
  });

  it("grows the suggestion while the tokens arrive", () => {
    const state = stateWithGhostText("const a = 1;");

    const first = state.update({ effects: setGhostText.of({ text: " const" }) }).state;
    const second = first.update({ effects: setGhostText.of({ text: " const b" }) }).state;

    expect(suggestionOf(second)).toBe(" const b");
    expect(second.doc.toString(), "the document waits for the reader").toBe("const a = 1;");
  });

  it("binds Tab and Escape to the suggestion", () => {
    const state = stateWithGhostText();
    const bindings = state.facet(keymap).flat();

    expect(bindings.some((binding) => binding.key === "Tab")).toBe(true);
    expect(bindings.some((binding) => binding.key === "Escape")).toBe(true);
  });

  it("empties the field when a caller clears the suggestion", () => {
    const state = stateWithGhostText("const a = 1;");
    const withSuggestion = state.update({
      effects: setGhostText.of({ text: " const b = 2;" }),
    }).state;

    const cleared = withSuggestion.update({ effects: clearGhostText.of(null) }).state;

    expect(suggestionOf(cleared)).toBeNull();
  });
});
