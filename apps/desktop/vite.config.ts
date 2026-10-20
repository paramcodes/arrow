import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packagesDir = fileURLToPath(new URL("../../packages", import.meta.url));

/**
 * The workspace packages resolve to their source, so a change in a package is
 * live in the app without a rebuild step.
 *
 * The alias names the entry point without its extension on purpose. A package
 * entry is either `index.ts` or `index.tsx`, and the resolver probes both. The
 * same rule lives in `vitest.config.ts` and in `tsconfig.base.json`.
 */
const alias = [
  {
    find: "@arrow/theme/tokens.css",
    replacement: `${packagesDir}/theme/src/tokens.css`,
  },
  {
    find: "@arrow/theme/theme.css",
    replacement: `${packagesDir}/theme/src/theme.css`,
  },
  {
    find: "@arrow/theme/fonts.css",
    replacement: `${packagesDir}/theme/src/fonts.css`,
  },
  {
    find: "@arrow/ui/ui.css",
    replacement: `${packagesDir}/ui/src/ui.css`,
  },
  {
    find: /^@arrow\/([a-z-]+)$/,
    replacement: `${packagesDir}/$1/src/index`,
  },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  alias,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
