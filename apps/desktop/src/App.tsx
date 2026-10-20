import { APP_NAME } from "@arrow/types";

/**
 * The shell of Arrow.
 *
 * The layout lands in phase 1 session 3. This session proves the window boots
 * and that the title is the product name.
 */
export function App() {
  return (
    <main className="app-root" data-testid="app-root">
      <h1 className="app-title">{APP_NAME}</h1>
    </main>
  );
}
