import { Button, Dialog, DialogContent, DialogTitle } from "@arrow/ui";

import { useSettingsStore } from "../../stores/settings";
import { EditorSettings } from "./EditorSettings";
import { GeneralSettings } from "./GeneralSettings";

/**
 * The settings dialog.
 *
 * The dialog writes to the settings store, and the editor reads the store, so
 * a change applies to the open document while the reader is still in the
 * dialog. The store persists the change, so the next window opens with it.
 *
 * The dialog needs no Tauri host: in a browser the store of the browser holds
 * the document, which is what the end to end suite reads after a reload.
 */
export function SettingsDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-lg gap-0 p-0"
        data-testid="settings-dialog"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <DialogTitle>Settings</DialogTitle>
          <Button data-testid="settings-done" onClick={onClose} size="sm" variant="ghost">
            Done
          </Button>
        </header>

        <div className="flex flex-col gap-6 px-4 py-4">
          <GeneralSettings />
          <EditorSettings />
        </div>

        <footer className="flex items-center justify-end border-t border-border px-4 py-2">
          <Button data-testid="settings-reset" onClick={resetSettings} size="sm" variant="ghost">
            Reset to defaults
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
