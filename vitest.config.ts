import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packagesDir = fileURLToPath(new URL("./packages", import.meta.url));

/**
 * The workspace packages resolve to their source, exactly as the app build
 * does in `apps/desktop/vite.config.ts`.
 *
 * The alias names the entry point without its extension on purpose. A package
 * entry is either `index.ts` or `index.tsx`, and the resolver probes both. The
 * same rule lives in `tsconfig.base.json`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@arrow\/([a-z-]+)$/,
        replacement: `${packagesDir}/$1/src/index`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
