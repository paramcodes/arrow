import { useEffect } from "react";

import { hydrateSettingsFromHost, startSettingsPersistence } from "../../lib/settingsPersistence";

/**
 * The settings of the shell, on their way in and out of the disk.
 *
 * The store opens on its defaults so the window paints at once. This hook then
 * reads the document of the last session, and it follows the store so every
 * change reaches the disk. In a plain browser there is no host and the store
 * of the browser holds the document instead.
 */
export function useSettingsPersistence(): void {
  useEffect(() => {
    hydrateSettingsFromHost().catch(() => undefined);
    return startSettingsPersistence();
  }, []);
}
