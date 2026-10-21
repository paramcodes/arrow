import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * The ghost text of the editor.
 *
 * The ghost text is the suggestion of the AI feature: a text that the editor
 * paints after the caret, in the faded italic of the Cursor look, and that the
 * reader takes with Tab or throws away with Escape.
 *
 * The engine owns the mechanics and nothing else. It holds the suggestion in a
 * field of the state, paints it with a widget, and runs the two bindings at the
 * highest precedence so they win over the bindings of the defaults. It never
 * asks for a suggestion: it tells the caller that the reader stopped typing,
 * and the caller decides what to do with that.
 *
 * The caller lives outside this package. The engine never imports the desktop
 * app and never reaches for Tauri, so the same suggestion runs in a browser, in
 * a test and inside the shell.
 */

/** The milliseconds the engine waits before it asks for a suggestion. */
export const GHOST_TEXT_DELAY_MS = 300;

/** The effect that puts a suggestion into the editor. */
export const setGhostText = StateEffect.define<{ readonly text: string }>();

/** The effect that takes the suggestion out of the editor. */
export const clearGhostText = StateEffect.define<null>();

/** What the engine holds while a suggestion is on screen. */
export interface GhostTextState {
  /** The text of the suggestion, or null when the editor holds none. */
  readonly text: string | null;
  /** The decoration that paints the suggestion. */
  readonly decorations: DecorationSet;
}

/** The state of an editor that holds no suggestion. */
const NO_GHOST_TEXT: GhostTextState = { text: null, decorations: Decoration.none };

/**
 * The widget that paints the suggestion.
 *
 * The widget paints the text after the caret and never takes a click, so the
 * reader can put the caret inside the suggestion without the editor reacting
 * to it.
 */
class GhostTextWidget extends WidgetType {
  /** The text of the suggestion. */
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  /** Two widgets are the same when they hold the same text. */
  override eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }

  /** The element that paints the suggestion. */
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost-text";
    span.textContent = this.text;
    return span;
  }

  /** The widget never takes an event of the mouse. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The style of the suggestion, read from the tokens of the theme. */
const ghostTextTheme = EditorView.baseTheme({
  ".cm-ghost-text": {
    color: "var(--ink-tertiary)",
    fontStyle: "italic",
    opacity: 0.5,
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  },
});

/**
 * The decoration that paints a suggestion after the caret.
 *
 * The widget sits at the head of the selection, on the side of the caret that
 * faces the text that follows it, so the suggestion reads as a continuation of
 * the line and not as a prefix of it.
 */
function decorationFor(state: EditorState, text: string): DecorationSet {
  const head = state.selection.main.head;
  return Decoration.set(
    [Decoration.widget({ widget: new GhostTextWidget(text), side: 1 }).range(head)],
    true,
  );
}

/**
 * The suggestion a transaction carries, if it carries one.
 *
 * The effects of a transaction arrive in order, and the last one that speaks
 * about the suggestion wins. A transaction that carries no effect about the
 * suggestion returns undefined, which means that the field keeps the rules of
 * the editor: a change of the document and a move of the caret take the
 * suggestion away.
 */
function suggestionOf(transaction: Transaction): { readonly text: string | null } | undefined {
  let found: { readonly text: string | null } | undefined;

  for (const effect of transaction.effects) {
    if (effect.is(setGhostText)) {
      found = { text: effect.value.text };
    } else if (effect.is(clearGhostText)) {
      found = { text: null };
    }
  }

  return found;
}

/**
 * The field that holds the suggestion.
 *
 * The field answers three questions: what the suggestion says, where it is
 * painted, and whether it survives the transaction that is running. It
 * survives a transaction that carries a suggestion of its own, and it does not
 * survive a change of the document or a move of the caret, because a
 * suggestion that belongs to another place in the text is a suggestion that
 * lies.
 */
export const ghostTextField = StateField.define<GhostTextState>({
  create() {
    return NO_GHOST_TEXT;
  },
  update(value, transaction) {
    const suggestion = suggestionOf(transaction);

    if (suggestion) {
      if (suggestion.text === null || suggestion.text === "") return NO_GHOST_TEXT;
      return {
        text: suggestion.text,
        decorations: decorationFor(transaction.state, suggestion.text),
      };
    }

    if (value.text === null) return value;
    if (transaction.docChanged || transaction.selection) return NO_GHOST_TEXT;
    return value;
  },
  // The editor paints the decorations of the fields that hand them to it, so
  // the field gives the suggestion to the facet of the decorations.
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * The transaction that takes the suggestion into the document.
 *
 * The text of the suggestion lands at the caret, and the caret follows the
 * text. The transaction carries the effect that empties the field, so the
 * suggestion is gone from the screen in the same transaction that put it into
 * the document.
 */
export function acceptGhostText(state: EditorState): TransactionSpec | null {
  const ghost = state.field(ghostTextField, false);
  if (!ghost?.text) return null;

  const head = state.selection.main.head;
  return {
    changes: { from: head, to: head, insert: ghost.text },
    selection: { anchor: head + ghost.text.length },
    effects: clearGhostText.of(null),
  };
}

/**
 * The transaction that takes the suggestion out of the editor.
 *
 * The transaction carries no change of the document: the suggestion leaves the
 * screen and the text of the file stays as the reader left it.
 */
export function dismissGhostText(state: EditorState): TransactionSpec | null {
  const ghost = state.field(ghostTextField, false);
  if (!ghost?.text) return null;
  return { effects: clearGhostText.of(null) };
}

/** The wait before the engine asks for a suggestion. */
export interface TriggerDebounce {
  /** Start the wait again, so the timer runs from this moment. */
  readonly notify: () => void;
  /** Stop the wait without asking. */
  readonly cancel: () => void;
}

/**
 * The wait that ends when the reader stops typing.
 *
 * Every keystroke restarts the wait, so the engine asks once the reader has
 * been still for the delay and not on every keystroke. The wait is a plain
 * timer, and a test drives it with a fake clock.
 */
export function createTriggerDebounce(delayMs: number, ask: () => void): TriggerDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    notify() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        ask();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** What the engine tells the caller when the reader stopped typing. */
export interface GhostTextTrigger {
  /** The text of the document before the caret. */
  readonly before: string;
  /** The text of the document after the caret. */
  readonly after: string;
  /** The line the caret sits on. */
  readonly line: string;
  /** The place of the caret in the document. */
  readonly position: number;
}

/** What the caller can tell the engine. */
export interface GhostTextOptions {
  /**
   * Called when the reader typed.
   *
   * The engine says that the reader typed and does not wait for the reader to
   * stop: the caller takes the old suggestion away at once, so the tokens of
   * a request that belongs to another text never reach the screen.
   */
  readonly onType?: () => void;
  /**
   * Called once the reader has stopped typing.
   *
   * The engine never asks for a suggestion on its own: it says that the
   * reader stopped, and the caller decides whether a request goes out.
   */
  readonly onTrigger?: (trigger: GhostTextTrigger) => void;
  /** Called when the reader takes the suggestion with Tab. */
  readonly onAccept?: (text: string) => void;
  /**
   * Called when the reader throws the suggestion away with Escape.
   *
   * The call answers whether it ended a request that was in flight. The
   * binding keeps the key when the answer is true, so Escape ends the request
   * even when no suggestion was on the screen.
   */
  readonly onDismiss?: () => boolean;
  /** The milliseconds the engine waits before it asks. */
  readonly delayMs?: number;
}

/**
 * The extension that holds the ghost text.
 *
 * The extension carries four things: the field that holds the suggestion, the
 * style that paints it, the two bindings that act on it, and the wait that
 * ends when the reader stops typing.
 */
export function aiCompletions(options: GhostTextOptions = {}): Extension {
  const delay = options.delayMs ?? GHOST_TEXT_DELAY_MS;

  const accept = (view: EditorView): boolean => {
    const text = view.state.field(ghostTextField, false)?.text ?? null;
    const spec = acceptGhostText(view.state);
    if (!spec || text === null) return false;

    view.dispatch(spec);
    options.onAccept?.(text);
    return true;
  };

  const dismiss = (view: EditorView): boolean => {
    const spec = dismissGhostText(view.state);
    if (spec) view.dispatch(spec);
    const ended = options.onDismiss?.() === true;
    return spec !== null || ended;
  };

  const trigger = ViewPlugin.fromClass(
    class {
      /** The wait that ends when the reader stops typing. */
      private readonly wait: TriggerDebounce;

      constructor(view: EditorView) {
        this.wait = createTriggerDebounce(delay, () => {
          options.onTrigger?.(triggerOf(view));
        });
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (!update.transactions.some((transaction) => transaction.isUserEvent("input"))) return;

        options.onType?.();
        this.wait.notify();
      }

      destroy() {
        this.wait.cancel();
      }
    },
  );

  return [
    ghostTextField,
    ghostTextTheme,
    trigger,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: accept },
        { key: "Escape", run: dismiss },
      ]),
    ),
  ];
}

/** The place of the caret, as the caller of a trigger needs it. */
function triggerOf(view: EditorView): GhostTextTrigger {
  const state = view.state;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);

  return {
    before: state.doc.sliceString(0, head),
    after: state.doc.sliceString(head),
    line: state.doc.sliceString(line.from, line.to),
    position: head,
  };
}
