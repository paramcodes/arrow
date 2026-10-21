import { useSettingsStore, settingsSnapshot, type SettingsFacts } from "../stores/settings";
import { invokeCommand, isTauriHost } from "./tauri";

/**
 * The settings on their way to the disk.
 *
 * In the window the settings live in `tauri-plugin-store`, which writes one
 * JSON document into the configuration directory of the app. In a plain
 * browser there is no host, so the store of the browser holds the document and
 * the same reader flow works in Playwright.
 *
 * The document is read back through the type guard below and never trusted:
 * a settings file is a file on the disk, and a file on the disk can carry a
 * number where a flag belongs.
 */

/** True when a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The settings a document holds, field by field.
 *
 * A field of the wrong type is dropped, so the store keeps the default of that
 * field and the window still opens.
 */
export function sanitizeSettings(value: unknown): Partial<SettingsFacts> {
  if (!isRecord(value)) return {};

  const settings: {
    fontSize?: number;
    tabSize?: number;
    wordWrap?: boolean;
    minimap?: boolean;
    fontFamily?: string;
  } = {};

  if (typeof value["fontSize"] === "number") settings.fontSize = value["fontSize"];
  if (typeof value["tabSize"] === "number") settings.tabSize = value["tabSize"];
  if (typeof value["wordWrap"] === "boolean") settings.wordWrap = value["wordWrap"];
  if (typeof value["minimap"] === "boolean") settings.minimap = value["minimap"];
  if (typeof value["fontFamily"] === "string") settings.fontFamily = value["fontFamily"];

  return settings;
}

/** Write the settings of the window to the store of the shell. */
export async function saveSettingsToHost(settings: SettingsFacts): Promise<void> {
  if (!isTauriHost()) return;
  await invokeCommand<null>("save_settings", { settings });
}

/**
 * Read the settings of the last session.
 *
 * The store opens on its own defaults, so the window paints at once and the
 * document of the last session arrives a moment later. A field the document
 * does not hold keeps the default.
 */
export async function hydrateSettingsFromHost(): Promise<void> {
  if (!isTauriHost()) return;

  const stored = await invokeCommand<unknown>("load_settings");
  const settings = sanitizeSettings(stored);
  if (Object.keys(settings).length === 0) return;

  useSettingsStore.setState(settings);
}

/** How long a burst of changes waits before it reaches the disk. */
const WRITE_DELAY_MS = 200;

/**
 * Follow the store and write every change to the store of the shell.
 *
 * A reader who drags the size of the text makes a change per pixel, so the
 * write waits for the burst to end instead of writing a file per pixel.
 */
export function startSettingsPersistence(): () => void {
  if (!isTauriHost()) return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = useSettingsStore.subscribe((state) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveSettingsToHost(settingsSnapshot(state));
    }, WRITE_DELAY_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
