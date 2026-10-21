import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@arrow/ui";

/**
 * The confirmation that guards unsaved work.
 *
 * A tab with unsaved changes never disappears on a cross, and a file that is
 * open and dirty never disappears on a delete. Both paths ask with this one
 * dialog, so the reader answers the same question in the same words whichever
 * action would have thrown the work away.
 */

/** The props of the confirmation. */
export interface DiscardChangesDialogProps {
  /** True when the dialog asks. */
  readonly open: boolean;
  /** The names of the files whose unsaved changes would be lost. */
  readonly names: readonly string[];
  /** The label of the button that throws the changes away. */
  readonly confirmLabel?: string;
  /** The callback that keeps the work. */
  readonly onCancel: () => void;
  /** The callback that throws the work away. */
  readonly onConfirm: () => void;
}

/** "One file has unsaved changes." or "Two files have unsaved changes." */
export function describeUnsaved(names: readonly string[]): string {
  if (names.length === 0) return "No file has unsaved changes.";
  if (names.length === 1) return `${names[0]} has unsaved changes.`;
  return `${names.join(", ")} have unsaved changes.`;
}

/** The confirmation that guards unsaved work. */
export function DiscardChangesDialog({
  open,
  names,
  confirmLabel = "Discard the changes",
  onCancel,
  onConfirm,
}: DiscardChangesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid="close-confirm">
        <DialogTitle>Discard the changes?</DialogTitle>
        <DialogDescription>
          {describeUnsaved(names)} The work since the last save is lost.
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" data-testid="close-confirm-cancel" onClick={onCancel}>
            Keep editing
          </Button>
          <Button size="sm" data-testid="close-confirm-discard" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
