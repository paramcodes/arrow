import { Chunk } from "@codemirror/merge";
import {
  Prec,
  StateEffect,
  StateField,
  Text,
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

/**
 * The inline diff of the editor.
 *
 * The inline diff is a proposed edit that lives in the document the reader is
 * editing. The engine never changes the document on its own: it paints the
 * lines the model would remove in red and the lines it would add in green,
 * and the reader takes the edit or throws it away.
 *
 * The diff is a decoration of the same document, so the reader keeps the
 * caret, the scroll and the undo history of the file while the answer of the
 * model streams in. The merge package of CodeMirror computes the difference
 * between the text the reader has and the text the model proposes, and the
 * engine paints the two sides of that difference.
 *
 * The engine owns the mechanics and nothing else. It never asks the shell for
 * a proposal and never talks to a reader: it tells the caller that the reader
 * asked for the prompt, and the caller decides what to do with that.
 */

/** The range of the document an inline edit proposes to replace. */
export interface InlineEditRange {
  /** The first position of the range. */
  readonly from: number;
  /** The last position of the range. */
  readonly to: number;
  /** The text the range holds now. */
  readonly original: string;
}

/** The proposed edit of one request. */
export interface InlineDiff {
  /** The first position of the range the edit applies to. */
  readonly from: number;
  /** The last position of the range the edit applies to. */
  readonly to: number;
  /** The text the range holds now. */
  readonly original: string;
  /** The text the model proposes. */
  readonly proposed: string;
}

/** What the engine holds while a proposed edit is on the screen. */
export interface InlineDiffState {
  /** The proposed edit, or null when the editor holds none. */
  readonly diff: InlineDiff | null;
  /** The decoration that paints the proposed edit. */
  readonly decorations: DecorationSet;
}

/** The state of an editor that holds no proposed edit. */
const NO_DIFF: InlineDiffState = { diff: null, decorations: Decoration.none };

/** The effect that puts a proposed edit on the screen. */
export const setInlineDiff = StateEffect.define<InlineDiff>();

/** The effect that takes a proposed edit off the screen. */
export const clearInlineDiff = StateEffect.define<null>();

/**
 * The proposed edit a transaction carries, if it carries one.
 *
 * The effects of a transaction arrive in order, and the last one that speaks
 * about the edit wins. A transaction that carries no effect about the edit
 * returns undefined, which means that the field keeps the rules of the editor:
 * a change of the document and a move of the caret take the edit away.
 */
function diffOf(transaction: Transaction): InlineDiff | null | undefined {
  let found: InlineDiff | null | undefined;

  for (const effect of transaction.effects) {
    if (effect.is(setInlineDiff)) {
      found = effect.value;
    } else if (effect.is(clearInlineDiff)) {
      found = null;
    }
  }

  return found;
}

/**
 * The widget that paints the lines the model adds.
 *
 * The lines are not in the document yet, so the widget holds them until the
 * reader takes the edit. The widget never takes a click, so the reader can put
 * the caret next to it without the editor reacting to it.
 */
class AddedLinesWidget extends WidgetType {
  /** The text of the added lines. */
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  /** Two widgets are the same when they hold the same text. */
  override eq(other: AddedLinesWidget): boolean {
    return other.text === this.text;
  }

  /** The element that paints the added lines. */
  override toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-inline-diff-added";
    box.textContent = this.text;
    return box;
  }

  /** The widget never takes an event of the mouse. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The style of the diff, read from the tokens of the theme. */
const inlineDiffTheme = EditorView.baseTheme({
  ".cm-inline-diff-removed": {
    backgroundColor: "var(--error)",
    color: "var(--canvas-strong)",
    textDecoration: "line-through",
  },
  ".cm-inline-diff-added": {
    backgroundColor: "var(--success)",
    color: "var(--canvas-strong)",
    whiteSpace: "pre",
    padding: "0 4px",
  },
});

/**
 * The decoration that paints a proposed edit.
 *
 * The difference between the two texts is a list of chunks, and every chunk
 * names the lines the model removes and the lines it adds. The removed lines
 * are marked in the document, because they are still there, and the added
 * lines are painted by a block widget, because they are not in the document
 * until the reader takes the edit.
 */
function decorationsFor(diff: InlineDiff): DecorationSet {
  const before = Text.of(diff.original.split("\n"));
  const after = Text.of(diff.proposed.split("\n"));
  const chunks = Chunk.build(before, after);
  const ranges: Range<Decoration>[] = [];

  for (const chunk of chunks) {
    if (chunk.toA > chunk.fromA) {
      const first = before.lineAt(chunk.fromA);
      const last = before.lineAt(Math.max(chunk.fromA, chunk.toA - 1));

      for (let number = first.number; number <= last.number; number += 1) {
        const line = before.line(number);
        const from = diff.from + line.from;
        const to = diff.from + Math.min(line.to, chunk.toA);
        if (to <= from) continue;
        ranges.push(Decoration.mark({ class: "cm-inline-diff-removed" }).range(from, to));
      }
    }

    const added = after.sliceString(chunk.fromB, chunk.toB);
    if (added.length > 0) {
      const anchor = Math.min(diff.from + chunk.toA, diff.to);
      ranges.push(
        Decoration.replace({
          widget: new AddedLinesWidget(added),
          block: true,
          class: "cm-inline-diff-added",
        }).range(anchor, anchor),
      );
    }
  }

  return Decoration.set(ranges, true);
}

/**
 * The field that holds the proposed edit.
 *
 * The field answers three questions: what the edit says, where it is painted,
 * and whether it survives the transaction that is running. It survives a
 * transaction that carries an edit of its own, and it does not survive a
 * change of the document or a move of the caret, because an edit that belongs
 * to another place in the text is an edit that lies.
 */
export const inlineDiffField = StateField.define<InlineDiffState>({
  create() {
    return NO_DIFF;
  },
  update(value, transaction) {
    const diff = diffOf(transaction);

    if (diff !== undefined) {
      if (diff === null) return NO_DIFF;
      return { diff, decorations: decorationsFor(diff) };
    }

    if (value.diff === null) return value;
    if (transaction.docChanged || transaction.selection) return NO_DIFF;
    return value;
  },
  // The editor paints the decorations of the fields that hand them to it, so
  // the field gives the diff to the facet of the decorations.
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * The range of the document the reader selected, as whole lines.
 *
 * The range is a range of lines, because a diff of half a line has no line to
 * paint. A reader who put the caret in a line without selecting it gets that
 * line, and a reader who selected nothing on an empty line gets nothing, so
 * the prompt does not open on a range that holds no code.
 */
export function inlineEditRange(state: EditorState): InlineEditRange | null {
  const selection = state.selection.main;
  const from = state.doc.lineAt(selection.from).from;
  const to = state.doc.lineAt(selection.to).to;
  const original = state.doc.sliceString(from, to);

  if (original.trim() === "") return null;

  return { from, to, original };
}

/**
 * The transaction that takes the proposed edit into the document.
 *
 * The range of the edit is replaced by the text the model proposes, and the
 * caret follows the text. The transaction carries the effect that empties the
 * field, so the edit is gone from the screen in the same transaction that put
 * it into the document.
 *
 * The transaction is refused when the range of the edit holds another text
 * than it held when the request went out: an edit of another text is an edit
 * that lies.
 */
export function acceptInlineDiff(state: EditorState): TransactionSpec | null {
  const diff = state.field(inlineDiffField, false)?.diff ?? null;
  if (!diff) return null;
  if (state.doc.sliceString(diff.from, diff.to) !== diff.original) return null;

  return {
    changes: { from: diff.from, to: diff.to, insert: diff.proposed },
    selection: { anchor: diff.from + diff.proposed.length },
    effects: clearInlineDiff.of(null),
  };
}

/**
 * The transaction that takes the proposed edit off the screen.
 *
 * The transaction carries no change of the document: the edit leaves the
 * screen and the text of the file stays as the reader left it.
 */
export function rejectInlineDiff(state: EditorState): TransactionSpec | null {
  const diff = state.field(inlineDiffField, false)?.diff ?? null;
  if (!diff) return null;
  return { effects: clearInlineDiff.of(null) };
}

/** What the engine tells the caller. */
export interface InlineDiffOptions {
  /**
   * Called when the reader takes the proposed edit.
   *
   * The call answers whether it took the edit, so the binding keeps the key
   * only when the edit was really on the screen.
   */
  readonly onAccept?: (view: EditorView) => boolean;
  /**
   * Called when the reader throws the proposed edit away.
   *
   * The call answers whether it threw an edit away, so the binding keeps the
   * key only when the edit was really on the screen.
   */
  readonly onReject?: (view: EditorView) => boolean;
}

/**
 * The extension that holds the inline diff.
 *
 * The extension carries three things: the field that holds the edit, the style
 * that paints it, and the two bindings that act on the edit.
 *
 * The bindings run at the highest precedence, so they win over the bindings of
 * the defaults. The extension is mounted before the ghost text, so the escape
 * of the reader reaches the diff before it reaches the suggestion.
 */
export function inlineDiff(options: InlineDiffOptions = {}): Extension {
  return [
    inlineDiffField,
    inlineDiffTheme,
    Prec.highest(
      keymap.of([
        { key: "Mod-Enter", run: (view) => options.onAccept?.(view) === true },
        { key: "Escape", run: (view) => options.onReject?.(view) === true },
      ]),
    ),
  ];
}
