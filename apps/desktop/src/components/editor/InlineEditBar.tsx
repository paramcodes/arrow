import { useCallback, useEffect, useState } from "react";

import { Button } from "@arrow/ui";

import type { InlineEditStatus } from "../../machines/inline-edit";
import type { InlineEditPosition } from "./useInlineEdit";

/**
 * The bar of the inline edit.
 *
 * The bar floats above the selection of the reader. It holds the instruction
 * while the reader writes it, it says that the model is writing while the
 * stream runs, and it offers the two answers of the reader once the proposal
 * is on the screen: the reader takes it or throws it away.
 *
 * The bar owns the draft of the instruction and nothing else. The workflow
 * lives in the machine, and the diff lives in the document.
 */

/** The props of the bar. */
export interface InlineEditBarProps {
  /** The state the workflow is in. */
  readonly status: InlineEditStatus;
  /** The message of a failure, or null when nothing failed. */
  readonly error: string | null;
  /** Where the bar sits, or null when the bar is closed. */
  readonly position: InlineEditPosition | null;
  /** Send the instruction of the reader to the shell. */
  readonly onSubmit: (instruction: string) => void;
  /** Leave the edit without taking it. */
  readonly onCancel: () => void;
  /** Take the edit into the document. */
  readonly onAccept: () => void;
  /** Throw the edit away. */
  readonly onReject: () => void;
}

/** The bar of the inline edit of one document. */
export function InlineEditBar({
  status,
  error,
  position,
  onSubmit,
  onCancel,
  onAccept,
  onReject,
}: InlineEditBarProps) {
  const [instruction, setInstruction] = useState("");

  /**
   * The input takes the focus when it appears.
   *
   * The bar opens for the reader and the reader writes the instruction right
   * away, so the field of the instruction takes the focus as soon as it is on
   * the screen.
   */
  const attach = useCallback((element: HTMLInputElement | null) => {
    if (element) element.focus();
  }, []);

  useEffect(() => {
    if (status !== "prompting") return;
    setInstruction("");
  }, [status]);

  if (!position) return null;
  if (status === "idle" && !error) return null;

  return (
    <div
      className="fixed z-20 flex -translate-y-full items-center gap-2 rounded-md border border-border-strong bg-surface px-2 py-1.5 shadow-lg"
      data-status={status}
      data-testid="inline-edit-bar"
      style={{ top: position.top, left: position.left }}
    >
      {status === "prompting" ? (
        <>
          <input
            className="w-72 rounded-sm border border-border bg-canvas px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            data-testid="inline-edit-input"
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit(instruction);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            placeholder="Describe the change…"
            ref={attach}
            spellCheck={false}
            type="text"
            value={instruction}
          />
          <span className="text-[11px] text-ink-tertiary">Enter to send</span>
        </>
      ) : null}

      {status === "streaming" ? (
        <>
          <span className="text-[11px] text-ink-secondary">The model is writing…</span>
          <Button data-testid="inline-edit-cancel" onClick={onCancel} size="sm" variant="ghost">
            Cancel
          </Button>
        </>
      ) : null}

      {status === "reviewing" ? (
        <>
          <span className="text-[11px] text-ink-secondary">The model proposes a change</span>
          <Button data-testid="inline-edit-accept" onClick={onAccept} size="sm" variant="default">
            Accept
          </Button>
          <Button data-testid="inline-edit-reject" onClick={onReject} size="sm" variant="outline">
            Reject
          </Button>
        </>
      ) : null}

      {error ? (
        <span className="text-[11px] text-error" data-testid="inline-edit-error">
          {error}
        </span>
      ) : null}

      {status === "idle" ? (
        <Button data-testid="inline-edit-dismiss" onClick={onCancel} size="sm" variant="ghost">
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}
