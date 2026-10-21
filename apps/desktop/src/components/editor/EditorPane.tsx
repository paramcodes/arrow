import { Editor } from "@arrow/editor-core";

/**
 * The editor pane of Arrow.
 *
 * The pane holds the editor of the document that is open. It reads the
 * tokens of `@arrow/theme` through the theme of the engine, so the pane and
 * the shell share one palette.
 */

/** The text the pane opens with before a file is open. */
export const PLACEHOLDER_SOURCE = `// Arrow, an editor that thinks in documents.
import { EditorState } from "@codemirror/state";

export function greet(name: string): string {
  const hours = 21;
  return \`Hello, \${name}. It is \${hours} o'clock.\`;
}

const state = EditorState.create({
  doc: greet("world"),
  extensions: [],
});
`;

/** The props of the editor pane. */
export interface EditorPaneProps {
  /** The text of the document. */
  readonly content?: string | undefined;
  /** The name of the language of the document. */
  readonly language?: string | undefined;
  /** The callback that receives the text after every change of the document. */
  readonly onChange?: ((value: string) => void) | undefined;
  /** The test id of the pane. */
  readonly testId?: string | undefined;
}

/** The pane that holds the editor of the open document. */
export function EditorPane({
  content = PLACEHOLDER_SOURCE,
  language = "typescript",
  onChange,
  testId = "editor-pane",
}: EditorPaneProps) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
      data-testid={testId}
      data-language={language}
    >
      <Editor
        className="min-h-0 flex-1"
        content={content}
        language={language}
        onChange={onChange}
        testId="editor"
      />
    </div>
  );
}
