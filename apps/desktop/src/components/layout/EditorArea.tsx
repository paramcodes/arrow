import { Tabs, TabsContent, TabsList, TabsTrigger } from "@arrow/ui";

/**
 * The editor area of the shell.
 *
 * The area holds the tabs of the open files and the pane below them. The
 * files themselves land in a later session, so the area shows the empty
 * state of the editor.
 */
export function EditorArea() {
  return (
    <Tabs className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" defaultValue="welcome">
      <TabsList>
        <TabsTrigger value="welcome">Arrow</TabsTrigger>
      </TabsList>
      <TabsContent
        value="welcome"
        className="flex flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <h1 className="text-lg font-medium text-ink">Arrow</h1>
        <p className="text-xs text-ink-secondary">No file is open. The editor lands in phase 2.</p>
      </TabsContent>
    </Tabs>
  );
}
