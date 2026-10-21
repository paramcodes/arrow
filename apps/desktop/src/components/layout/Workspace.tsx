import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@arrow/ui";
import {
  MAX_BOTTOM_PANEL_HEIGHT,
  MAX_SIDEBAR_WIDTH,
  MIN_BOTTOM_PANEL_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  useLayoutStore,
} from "../../stores/layout";
import { BottomPanel } from "./BottomPanel";
import { EditorArea } from "./EditorArea";
import { Sidebar } from "./Sidebar";

/**
 * The working area of the shell.
 *
 * The sidebar and the bottom panel take their size from the layout store, so
 * the tree of the window and the facts of the window never disagree. The
 * editor area fills whatever the two panels leave over.
 */
export function Workspace() {
  const sidebarOpen = useLayoutStore((state) => state.sidebarOpen);
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
  const bottomPanelOpen = useLayoutStore((state) => state.bottomPanelOpen);
  const bottomPanelHeight = useLayoutStore((state) => state.bottomPanelHeight);
  const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
  const setBottomPanelHeight = useLayoutStore((state) => state.setBottomPanelHeight);

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
      <ResizablePanel size={sidebarOpen ? sidebarWidth : 0} testId="sidebar-panel">
        <Sidebar />
      </ResizablePanel>
      {sidebarOpen ? (
        <ResizableHandle
          label="Resize the sidebar"
          max={MAX_SIDEBAR_WIDTH}
          min={MIN_SIDEBAR_WIDTH}
          onResize={setSidebarWidth}
          size={sidebarWidth}
          testId="sidebar-handle"
        />
      ) : null}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 min-w-0 flex-1">
        <EditorArea />
        {bottomPanelOpen ? (
          <ResizableHandle
            label="Resize the bottom panel"
            max={MAX_BOTTOM_PANEL_HEIGHT}
            min={MIN_BOTTOM_PANEL_HEIGHT}
            onResize={setBottomPanelHeight}
            size={bottomPanelHeight}
            testId="bottom-panel-handle"
          />
        ) : null}
        <ResizablePanel size={bottomPanelOpen ? bottomPanelHeight : 0} testId="bottom-panel-panel">
          <BottomPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanelGroup>
  );
}
