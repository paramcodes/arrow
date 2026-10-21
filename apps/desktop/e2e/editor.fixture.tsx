import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { Editor, contentMarker } from "@arrow/editor-core";

import { EditorPane } from "../src/components/editor/EditorPane";
import { READY_ATTRIBUTE } from "./support/app";
import "../src/app.css";

/**
 * The page that carries the editor for the end to end suite.
 *
 * The suite drives the editor in a plain browser, with no Tauri host present.
 * The page mounts one pane per language of the registry, so a case can read
 * the highlighting of every language the engine ships, and two panes that
 * take their props from the page, so a case can change a prop after the mount
 * and read what the engine did with it.
 */

declare global {
  interface Window {
    /** The caret of the pane that takes its text from the page. */
    __arrowCaret?: () => { anchor: number; head: number; length: number } | null;
  }
}

const SAMPLES = [
  {
    language: "typescript",
    content: `const answer = 42;
const label = "arrow";
function greet(name: string) {
  return \`Hello, \${name}\`;
}
`,
  },
  {
    language: "javascript",
    content: `const answer = 42;
const label = "arrow";
function greet(name) {
  return "Hello, " + name;
}
`,
  },
  {
    language: "python",
    content: `answer = 42
label = "arrow"
def greet(name):
    return "Hello, " + name
`,
  },
  {
    language: "rust",
    content: `fn main() {
    let answer: i32 = 42;
    let label = "arrow";
    println!("Hello, {}", label);
}
`,
  },
  {
    language: "json",
    content: `{
  "answer": 42,
  "label": "arrow"
}
`,
  },
  {
    language: "markdown",
    content: `# Arrow

A number, 42, and a word, "arrow".

- first
- second
`,
  },
];

/** The text the pane of the props opens with. */
const INITIAL_TEXT = `const answer = 42;
const label = "arrow";
function greet(name: string) {
  return \`Hello, \${name}\`;
}
`;

/** The text that replaces it, the way a file that reloads from disk does. */
const RELOADED_TEXT = `const answer = 42;
const label = "arrow";
function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;

/** The extensions of the pane of the props. */
type Extensions = ComponentProps<typeof Editor>["extensions"];

/** The view of the editor, as the props of the engine name it. */
type View = NonNullable<ComponentProps<typeof Editor>["viewRef"]>["current"];

/**
 * The panes that take their props from the page.
 *
 * The page holds the text and the extensions in its own state, so a case can
 * change either of them after the mount and read what the engine did with it.
 */
function PropsPanes() {
  const [text, setText] = useState(INITIAL_TEXT);
  const [tools, setTools] = useState<Extensions>([]);
  const view = useRef<View>(null);

  useEffect(() => {
    window.__arrowCaret = () => {
      const instance = view.current;
      if (!instance) return null;
      const { anchor, head } = instance.state.selection.main;
      return { anchor, head, length: instance.state.doc.length };
    };
    return () => {
      window.__arrowCaret = undefined;
    };
  }, []);

  return (
    <section
      style={{
        display: "flex",
        gap: "8px",
        height: "240px",
        padding: "8px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "4px" }}>
        <button type="button" data-testid="reload-content" onClick={() => setText(RELOADED_TEXT)}>
          reload the file
        </button>
        <div style={{ height: "170px" }}>
          <Editor
            content={text}
            language="typescript"
            onChange={setText}
            testId="pane-content"
            viewRef={view}
          />
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "4px" }}>
        <button
          type="button"
          data-testid="mount-tool"
          onClick={() => setTools([contentMarker("data-arrow-tool", "ghost")])}
        >
          mount the tool
        </button>
        <div style={{ height: "170px" }}>
          <Editor extensions={tools} language="typescript" testId="pane-tools" />
        </div>
      </div>
    </section>
  );
}

/** The page that mounts one pane per language. */
function Fixture() {
  // The fixture page carries the same readiness signal as the app, so the
  // helper that opens a page waits for one contract. The panes of the page
  // are mounted by the time this effect runs, because the effects of a child
  // run before the effect of its parent.
  useEffect(() => {
    document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "grid",
          flex: 1,
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "repeat(3, 1fr)",
          minHeight: 0,
        }}
      >
        {SAMPLES.map((sample) => (
          <section
            key={sample.language}
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              borderBottom: "1px solid var(--border)",
              borderRight: "1px solid var(--border)",
            }}
          >
            <EditorPane
              content={sample.content}
              language={sample.language}
              testId={`pane-${sample.language}`}
            />
          </section>
        ))}
      </div>
      <PropsPanes />
    </div>
  );
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<Fixture />);
}
