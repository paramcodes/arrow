import { useEffect, useMemo, useRef } from "react";

import {
  Editor,
  type EditorProps,
  type EditorView,
  languageForPath,
  selectionListener,
} from "@arrow/editor-core";
import { EditorState } from "@codemirror/state";
import { EditorView as View } from "@codemirror/view";
import { useAtomValue, useSetAtom } from "jotai";

import { fileCursorAtom, type FileCursor } from "../../atoms/file";
import { baseName } from "../../hooks/fileSystem";
import { useAiStore } from "../../stores/ai";
import { useEditorStore } from "../../stores/editor";
import { useSettingsStore } from "../../stores/settings";
import { useGhostText } from "./useGhostText";

/**
 * The editor pane of one open file.
 *
 * The pane owns the view of one document. The shell keeps one pane per open
 * tab mounted, so the caret, the scroll and the undo history of a tab survive
 * a switch; the pane that is not active is hidden and never destroyed.
 *
 * The caret of the pane is written to the atom family of the file, so a later
 * session can read the place of the reader without the store that holds the
 * workspace.
 *
 * The pane reads the settings of the editor, so a change of the font size, the
 * family, the width of a tab or the wrapping of long lines repaints the open
 * document while the reader is still in the settings dialog.
 *
 * The pane mounts the ghost text of the AI feature on the document, so a
 * suggestion appears after the reader stops typing. The extension is built
 * once and never built again: a new extension would give the editor a new
 * wait, and the reader would type forever without a suggestion.
 */

declare global {
  interface Window {
    /** The caret of the active pane, for the end to end suite. */
    __arrowEditorCaret: (() => { anchor: number; head: number; path: string } | null) | undefined;
  }
}

/** The props of the editor pane. */
export interface EditorPaneProps {
  /** The path of the file, when the pane shows a file of the workspace. */
  readonly path?: string | undefined;
  /** The text of the document. */
  readonly content?: string | undefined;
  /** The name of the language of the document. */
  readonly language?: string | undefined;
  /** The callback that receives the text after every change of the document. */
  readonly onChange?: ((value: string) => void) | undefined;
  /** True when the pane is the one the reader sees. */
  readonly active?: boolean | undefined;
  /** The test id of the pane. */
  readonly testId?: string | undefined;
}

/** The text the pane opens with before a file is open. */
export const PLACEHOLDER_SOURCE = "";

/** How many lines the minimap draws at most. */
const MINIMAP_LINES = 200;

/** The preview of the document beside the text. */
function Minimap({ content }: { readonly content: string }) {
  const lines = useMemo(() => content.split("\n").slice(0, MINIMAP_LINES), [content]);

  return (
    <div
      aria-hidden="true"
      className="flex w-14 shrink-0 flex-col gap-px overflow-hidden border-l border-border bg-canvas px-1 py-2"
      data-testid="editor-minimap"
    >
      {lines.map((line, index) => (
        <span
          className="block h-px shrink-0 bg-ink-tertiary"
          key={index}
          style={{
            opacity: 0.5,
            width: `${Math.min(100, Math.max(4, line.trim().length * 1.5))}%`,
          }}
        />
      ))}
    </div>
  );
}

/** The pane that holds the editor of the open document. */
export function EditorPane({
  path,
  content = PLACEHOLDER_SOURCE,
  language,
  onChange,
  active = true,
  testId = "editor-pane",
}: EditorPaneProps) {
  const key = path ?? "";
  const cursor = useAtomValue(fileCursorAtom(key));
  const setCursor = useSetAtom(fileCursorAtom(key));
  const view = useRef<EditorView | null>(null);

  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const tabSize = useSettingsStore((state) => state.tabSize);
  const wordWrap = useSettingsStore((state) => state.wordWrap);
  const minimap = useSettingsStore((state) => state.minimap);
  const reveal = useEditorStore((state) => (state.reveal?.path === key ? state.reveal : null));

  const provider = useAiStore((state) => state.provider);
  const model = useAiStore((state) => state.model);
  const completionsEnabled = useAiStore((state) => state.completionsEnabled);

  const ghostText = useGhostText({
    viewRef: view,
    active,
    provider,
    model,
    enabled: completionsEnabled,
  });

  const resolvedLanguage = useMemo(
    () => language ?? (path ? languageForPath(path) : "plaintext"),
    [language, path],
  );

  const extensions = useMemo<EditorProps["extensions"]>(
    () => [
      EditorState.tabSize.of(tabSize),
      View.theme({
        // The selector names the editor element twice, so the rule of this
        // pane beats the base theme of the engine: the base theme paints the
        // text at its own size, and the settings own the size from here on.
        "&.cm-editor": { fontFamily, fontSize: `${fontSize}px` },
      }),
      wordWrap ? View.lineWrapping : [],
      selectionListener(({ anchor, head }) =>
        setCursor((current: FileCursor) => ({ ...current, anchor, head })),
      ),
      ghostText,
    ],
    [fontFamily, fontSize, ghostText, setCursor, tabSize, wordWrap],
  );

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const scroller = instance.scrollDOM;
    const onScroll = () => {
      const scrollTop = scroller.scrollTop;
      setCursor((current: FileCursor) => ({ ...current, scrollTop }));
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [setCursor]);

  useEffect(() => {
    if (!active) return;
    const instance = view.current;
    if (instance) instance.scrollDOM.scrollTop = cursor.scrollTop;
  }, [active, cursor.scrollTop]);

  useEffect(() => {
    if (!active || !reveal) return;
    const instance = view.current;
    if (!instance) return;

    const doc = instance.state.doc;
    const line = doc.line(Math.min(Math.max(reveal.line, 1), doc.lines));
    const position = Math.min(line.from + Math.max(reveal.column - 1, 0), line.to);

    instance.dispatch({
      selection: { anchor: position },
      effects: View.scrollIntoView(position, { y: "center" }),
    });
    instance.focus();
  }, [active, reveal]);

  useEffect(() => {
    if (!active) return;
    window.__arrowEditorCaret = () => {
      const instance = view.current;
      if (!instance) return null;
      const { anchor, head } = instance.state.selection.main;
      return { anchor, head, path: key };
    };
    return () => {
      window.__arrowEditorCaret = undefined;
    };
  }, [active, key]);

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
      data-testid={testId}
      data-language={resolvedLanguage}
      data-path={key}
      data-file-name={path ? baseName(path) : ""}
    >
      <div className="flex min-h-0 flex-1">
        <Editor
          className="min-h-0 flex-1"
          content={content}
          extensions={extensions}
          language={resolvedLanguage}
          onChange={onChange}
          testId="editor"
          viewRef={view}
        />
        {minimap ? <Minimap content={content} /> : null}
      </div>
    </div>
  );
}
