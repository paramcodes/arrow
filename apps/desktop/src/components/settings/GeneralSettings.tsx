import { MAX_FONT_SIZE, MIN_FONT_SIZE, useSettingsStore } from "../../stores/settings";

/**
 * The general settings of the editor.
 *
 * The size and the family of the text reach the editor through the store, so
 * a change paints the open document at once and the next window opens with
 * the same look.
 */
export function GeneralSettings() {
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const setFontFamily = useSettingsStore((state) => state.setFontFamily);

  return (
    <section className="flex flex-col gap-3" data-testid="settings-general">
      <h3 className="text-xs font-medium text-ink">General</h3>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Font size</span>
        <input
          className="h-7 w-20 rounded-sm border border-border bg-canvas px-2 text-right text-xs text-ink outline-none focus:border-accent"
          data-testid="settings-font-size"
          max={MAX_FONT_SIZE}
          min={MIN_FONT_SIZE}
          onChange={(event) => setFontSize(Number(event.target.value))}
          step={1}
          type="number"
          value={fontSize}
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-xs text-ink-secondary">
        <span>Font family</span>
        <input
          className="h-7 w-48 rounded-sm border border-border bg-canvas px-2 text-xs text-ink outline-none focus:border-accent"
          data-testid="settings-font-family"
          onChange={(event) => setFontFamily(event.target.value)}
          spellCheck={false}
          type="text"
          value={fontFamily}
        />
      </label>
    </section>
  );
}
