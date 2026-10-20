import { APP_NAME } from "@arrow/types";

/**
 * The shell of Arrow.
 *
 * The layout lands in phase 1 session 3. Until then the window shows the
 * theme itself: every class below is a Tailwind utility that reads a token
 * from `@arrow/theme`, so a screenshot of this window is a screenshot of the
 * shipped palette.
 */
export function App() {
  return (
    <main className="grid h-full place-items-center bg-canvas text-ink" data-testid="app-root">
      <section
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
        data-testid="theme-panel"
      >
        <h1 className="text-xl font-medium tracking-wide text-ink">{APP_NAME}</h1>
        <p className="text-ink-secondary">
          Dark-first tokens, applied through the Tailwind v4 preset of the theme package.
        </p>
        <div className="flex gap-2" data-testid="theme-swatches">
          <span className="h-6 w-6 rounded-sm bg-canvas-soft" title="canvas-soft" />
          <span className="h-6 w-6 rounded-sm bg-surface-hover" title="surface-hover" />
          <span className="h-6 w-6 rounded-sm bg-border-strong" title="border-strong" />
          <span className="h-6 w-6 rounded-sm bg-accent" title="accent" />
          <span className="h-6 w-6 rounded-sm bg-success" title="success" />
          <span className="h-6 w-6 rounded-sm bg-error" title="error" />
        </div>
        <code className="font-mono text-ink-tertiary">--canvas-soft</code>
      </section>
    </main>
  );
}
