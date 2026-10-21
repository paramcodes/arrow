import { useEffect, useMemo, useRef } from "react";

import {
  Editor,
  type EditorProps,
  type EditorView,
  languageForPath,
  selectionListener,
} from "@arrow/editor-core";
import { useAtomValue, useSetAtom } from "jotai";

import { fileCursorAtom, type FileCursor } from "../../atoms/file";
import { baseName } from "../../hooks/fileSystem";

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

  const resolvedLanguage = useMemo(
    () => language ?? (path ? languageForPath(path) : "plaintext"),
    [language, path],
  );

  const extensions = useMemo<EditorProps["extensions"]>(
    () => [
      selectionListener(({ anchor, head }) =>
        setCursor((current: FileCursor) => ({ ...current, anchor, head })),
      ),
    ],
    [setCursor],
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
      <Editor
        className="min-h-0 flex-1"
        content={content}
        extensions={extensions}
        language={resolvedLanguage}
        onChange={onChange}
        testId="editor"
        viewRef={view}
      />
    </div>
  );
}
