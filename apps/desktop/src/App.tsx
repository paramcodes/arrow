import { AppShell } from "./components/layout/AppShell";

/**
 * The shell of Arrow.
 *
 * The window shows the shell of the editor: the activity bar, the sidebar,
 * the editor area, the bottom panel and the status bar. Every color of the
 * shell comes from a token of `@arrow/theme`, so a screenshot of this window
 * is a screenshot of the shipped palette.
 */
export function App() {
  return (
    <main className="h-full w-full" data-testid="app-root">
      <AppShell />
    </main>
  );
}
