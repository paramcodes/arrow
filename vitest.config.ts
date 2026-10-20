import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packagesDir = fileURLToPath(new URL("./packages", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@arrow\/([a-z-]+)$/,
        replacement: `${packagesDir}/$1/src/index.ts`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
