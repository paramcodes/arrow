import { MAX_TAB_SIZE, MIN_TAB_SIZE, useSettingsStore } from "../../stores/settings";

/**
 * The settings of the editor surface.
 *
 * The wrapping of long lines, the minimap and the width of a tab reach the
 * editor through the store, so the open document takes the change at once.
 */
export function EditorSettings() {
  const tabSize = useSettingsStore((state) => state.tabSize);
  const wordWrap = useSettingsStore((state) => state.wordWrap);
  const minimap = useSettingsStore((state) => state.minimap);
  const setTabSize = useSettingsStore((state) => state.setTabSize);
  const setWordWrap = useSettingsStore((state) => state.setWordWrap);
  const setMinimap = useSettingsStore((state) => state.setMinimap);

  return (
    <section className="flex flex-col gap-3" data-testid="settings-editor">
      <h3 className="text-xs font-medium text-ink">Editor</h3>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Tab size</span>
        <input
          className="h-7 w-20 rounded-sm border border-border bg-canvas px-2 text-right text-xs text-ink outline-none focus:border-accent"
          data-testid="settings-tab-size"
          max={MAX_TAB_SIZE}
          min={MIN_TAB_SIZE}
          onChange={(event) => setTabSize(Number(event.target.value))}
          step={1}
          type="number"
          value={tabSize}
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Word wrap</span>
        <input
          checked={wordWrap}
          className="h-3.5 w-3.5 [accent-color:var(--accent)]"
          data-testid="settings-word-wrap"
          onChange={(event) => setWordWrap(event.target.checked)}
          type="checkbox"
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Minimap</span>
        <input
          checked={minimap}
          className="h-3.5 w-3.5 [accent-color:var(--accent)]"
          data-testid="settings-minimap"
          onChange={(event) => setMinimap(event.target.checked)}
          type="checkbox"
        />
      </label>
    </section>
  );
}
