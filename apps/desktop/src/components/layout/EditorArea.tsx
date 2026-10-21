import { useState } from "react";

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@arrow/ui";
import { useShallow } from "zustand/react/shallow";

import { baseName } from "../../hooks/fileSystem";
import { useEditorShortcuts } from "../../hooks/useEditorShortcuts";
import { useEditorStore } from "../../stores/editor";
import { Breadcrumbs } from "../editor/Breadcrumbs";
import { EditorPane } from "../editor/EditorPane";
import { TabBar } from "../editor/TabBar";
import { WelcomeTab } from "../editor/WelcomeTab";

/**
 * The editor area of the shell.
 *
 * The area holds the tabs of the open files, the breadcrumbs of the active
 * file and one pane per open file. Every pane stays mounted, so a switch
 * between two tabs keeps the caret, the scroll and the undo history of the
 * file that the reader leaves.
 *
 * The area also owns the confirmation of a close. A tab with unsaved changes
 * never disappears on a cross: the reader either discards the changes or keeps
 * the tab.
 */
export function EditorArea() {
  useEditorShortcuts();

  const paths = useEditorStore(useShallow((state) => state.openFiles.map((file) => file.path)));
  const activePath = useEditorStore((state) => state.activePath);
  const closeFile = useEditorStore((state) => state.closeFile);

  const [pendingClose, setPendingClose] = useState<string | null>(null);

  const requestClose = (path: string) => {
    const file = useEditorStore.getState().openFiles.find((open) => open.path === path);
    if (file?.dirty) {
      setPendingClose(path);
      return;
    }
    closeFile(path);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="editor-area">
      <TabBar onClose={requestClose} />
      <Breadcrumbs path={activePath} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {paths.length === 0 ? (
          <WelcomeTab />
        ) : (
          paths.map((path) => <OpenFilePane key={path} path={path} active={path === activePath} />)
        )}
      </div>

      <Dialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
      >
        <DialogContent data-testid="close-confirm">
          <DialogTitle>Discard the changes?</DialogTitle>
          <DialogDescription>
            {pendingClose ? `${baseName(pendingClose)} has unsaved changes.` : ""} Closing the tab
            discards them.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              data-testid="close-confirm-cancel"
              onClick={() => setPendingClose(null)}
            >
              Keep editing
            </Button>
            <Button
              size="sm"
              data-testid="close-confirm-discard"
              onClick={() => {
                if (pendingClose) closeFile(pendingClose);
                setPendingClose(null);
              }}
            >
              Discard the changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One open file and its pane.
 *
 * The pane subscribes to the text and the language of its own file, so a
 * keystroke in the active file repaints the active pane and nothing else: not
 * the tab strip, not the sidebar and not the shell.
 */
function OpenFilePane({ path, active }: { readonly path: string; readonly active: boolean }) {
  const content = useEditorStore(
    (state) => state.openFiles.find((file) => file.path === path)?.content ?? "",
  );
  const languageId = useEditorStore(
    (state) => state.openFiles.find((file) => file.path === path)?.languageId ?? "plaintext",
  );
  const updateContent = useEditorStore((state) => state.updateContent);

  return (
    <div
      className={active ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
      data-testid={`pane-host-${path}`}
      data-active={active}
    >
      <EditorPane
        active={active}
        content={content}
        language={languageId}
        onChange={(value) => updateContent(path, value)}
        path={path}
      />
    </div>
  );
}
