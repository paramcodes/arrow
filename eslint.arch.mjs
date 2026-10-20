import { readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import { plugin as localPlugin } from "./eslint-rules/index.mjs";

const config = JSON.parse(readFileSync(new URL("./harness.config.json", import.meta.url), "utf8"));

const restricted = config.layers?.restricted ?? [];

function boundary(layer) {
  const forbidPackages = layer.forbidPackages ?? [];
  const forbidRoots = layer.forbidRoots ?? [];

  const message = `This import crosses a layer boundary. The ${layer.name} layer may not reach it.`;

  const paths = forbidPackages.map((name) => ({ name, message }));

  const patterns = [
    ...forbidPackages.map((name) => ({ group: [name], message })),
    ...forbidPackages.map((name) => ({ group: [`${name}/*`], message })),
    ...forbidRoots.map((root) => ({ group: [`**/${root}/**`], message })),
  ];

  return {
    files: layer.files,
    languageOptions: {
      parser: tseslint.parser,
      sourceType: "module",
    },
    plugins: {
      local: localPlugin,
    },
    rules: {
      "no-restricted-imports": ["error", { paths, patterns }],
      "local/no-cross-layer-import": [
        "error",
        { forbiddenPackages: forbidPackages, forbiddenRoots: forbidRoots },
      ],
    },
  };
}

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.tsbuild/**",
    "**/target/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/.worktrees/**",
  ]),
  ...restricted.map((layer) => boundary(layer)),
]);
