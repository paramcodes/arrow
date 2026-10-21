import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, type RefObject } from "react";

import { baseExtensions } from "./extensions/base";
import { languageFor } from "./languages";

/**
 * The React wrapper of the editor.
 *
 * The wrapper owns the lifecycle of the CodeMirror view: it creates the view
 * in an effect, keeps the document, the language and the extensions in step
 * with the props, and tears the view down when the component unmounts.
 *
 * The wrapper never reads a store. A store that lives outside React reaches
 * the editor through the `onChange` callback, and a caller that needs the
 * view itself takes the `viewRef`.
 */

/** The props of the editor. */
export interface EditorProps {
  /** The text of the document. */
  readonly content?: string | undefined;
  /** The name of the language of the document, as the registry names it. */
  readonly language?: string | undefined;
  /** The callback that receives the text after every change of the document. */
  readonly onChange?: ((value: string) => void) | undefined;
  /** The extensions that the document adds on top of the base bundle. */
  readonly extensions?: readonly Extension[] | undefined;
  /** The class of the element that holds the editor. */
  readonly className?: string | undefined;
  /** The test id of the element that holds the editor. */
  readonly testId?: string | undefined;
  /** The reference that receives the view, for a caller that drives the editor. */
  readonly viewRef?: RefObject<EditorView | null> | undefined;
}

/** The editor of Arrow. */
export function Editor({
  content = "",
  language = "plaintext",
  onChange,
  extensions,
  className,
  testId = "arrow-editor",
  viewRef,
}: EditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const configured = useRef<Extension | null>(null);
  const change = useRef(onChange);

  const support = useMemo(() => languageFor(language), [language]);

  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const parser = support ?? [];
    configured.current = parser;

    const state = EditorState.create({
      doc: content,
      extensions: [
        ...baseExtensions,
        languageCompartment.current.of(parser),
        ...(extensions ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current?.(update.state.doc.toString());
        }),
      ],
    });

    const instance = new EditorView({ state, parent: element });
    view.current = instance;
    if (viewRef) viewRef.current = instance;

    return () => {
      instance.destroy();
      view.current = null;
      if (viewRef) viewRef.current = null;
    };
    // The view is created once, with the content of the first render. Every
    // later change of a prop reaches the view through the effects below.
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === content) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: content } });
  }, [content]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const parser = support ?? [];
    if (configured.current === parser) return;
    configured.current = parser;
    instance.dispatch({ effects: languageCompartment.current.reconfigure(parser) });
  }, [support]);

  return (
    <div
      ref={host}
      className={["h-full w-full", className].filter(Boolean).join(" ")}
      data-testid={testId}
    />
  );
}
