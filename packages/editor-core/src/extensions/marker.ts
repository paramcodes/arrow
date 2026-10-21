import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * A marker that names the tools mounted on an editor.
 *
 * A caller that mounts a tool on the editor can name it, and the name lands on
 * the content of the view. A test that changes the `extensions` prop of the
 * editor reads that name, so a prop that never reaches the view fails the
 * test instead of passing it.
 */

/** The extension that marks the content of an editor with an attribute. */
export function contentMarker(name: string, value: string): Extension {
  return EditorView.contentAttributes.of({ [name]: value });
}
