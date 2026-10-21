/**
 * The empty state of the editor.
 *
 * The area shows this page when no file is open. The heading is the heading of
 * the shell, so the smoke test reads the same window whether a file is open or
 * not.
 */
export function WelcomeTab() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      data-testid="welcome-tab"
    >
      <h1 className="text-lg font-medium text-ink">Arrow</h1>
      <p className="text-xs text-ink-secondary">No file is open. Choose a file in the explorer.</p>
    </div>
  );
}
