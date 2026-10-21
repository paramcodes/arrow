import { createRoot } from "react-dom/client";

import { EditorPane } from "../src/components/editor/EditorPane";
import "../src/app.css";

/**
 * The page that carries the editor for the end to end suite.
 *
 * The suite drives the editor in a plain browser, with no Tauri host present.
 * The page mounts one pane per language of the registry, so a case can read
 * the highlighting of every language the engine ships.
 */

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

/** The page that mounts one pane per language. */
function Fixture() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "repeat(3, 1fr)",
        height: "100%",
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
  );
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<Fixture />);
}
