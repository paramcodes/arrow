import { useShallow } from "zustand/react/shallow";

import { useEditorStore } from "../../stores/editor";
import { Tab } from "./Tab";

/**
 * The strip of tabs above the editor.
 *
 * The strip subscribes to the paths and to the active path, not to the text of
 * the documents. A keystroke changes the text of one document and the dirty
 * flag of one tab, so the strip repaints one tab and not the whole workspace.
 */

/** The props of the tab strip. */
export interface TabBarProps {
  /** The callback that asks to close a tab. */
  readonly onClose: (path: string) => void;
}

/** The strip of the tabs of the open files. */
export function TabBar({ onClose }: TabBarProps) {
  const paths = useEditorStore(useShallow((state) => state.openFiles.map((file) => file.path)));
  const activePath = useEditorStore((state) => state.activePath);

  if (paths.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border bg-canvas-soft"
      data-testid="tab-bar"
    >
      {paths.map((path) => (
        <TabSlot key={path} path={path} active={path === activePath} onClose={onClose} />
      ))}
    </div>
  );
}

/** One tab, subscribed to its own dirty flag. */
function TabSlot({
  path,
  active,
  onClose,
}: {
  readonly path: string;
  readonly active: boolean;
  readonly onClose: (path: string) => void;
}) {
  const dirty = useEditorStore(
    (state) => state.openFiles.find((file) => file.path === path)?.dirty ?? false,
  );
  const setActiveFile = useEditorStore((state) => state.setActiveFile);

  return (
    <Tab path={path} active={active} dirty={dirty} onSelect={setActiveFile} onClose={onClose} />
  );
}
