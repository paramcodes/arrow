#!/usr/bin/env node
/**
 * Scores the agent harness against the criteria in harness.config.json.
 *
 * Every criterion runs a real check against this repository. A criterion passes
 * only when its check passes. The script exits 0 only when every criterion
 * passes, and it prints the reason for every failure.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
process.chdir(root);

const configPath = process.env.HARNESS_CONFIG ?? "harness.config.json";

function die(message) {
  console.error(`harness: ${message}`);
  process.exit(1);
}

if (!existsSync(configPath)) die(`${configPath} is missing`);

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  die(`${configPath} is not valid JSON: ${error.message}`);
}

const packageManager = config.packageManager ?? "pnpm";
const criteria = Array.isArray(config.criteria) ? config.criteria : [];

function expand(text) {
  return String(text)
    .replaceAll("${PM}", packageManager)
    .replaceAll("${DATA_ALIAS}", config.layers?.data?.alias ?? "@/db");
}

function run(command) {
  try {
    const stdout = execSync(expand(command), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: root,
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return {
      code: typeof error.status === "number" ? error.status : 1,
      output,
    };
  }
}

function tail(text, lines = 4) {
  const rows = String(text).trim().split("\n");
  return rows.slice(-lines).join("\n");
}

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function exportedFunctions(source) {
  const found = [];
  const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match = pattern.exec(source);
  while (match) {
    const start = pattern.lastIndex;
    let index = start;
    let depth = 1;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "(" || character === "{" || character === "[") depth += 1;
      else if (character === ")" || character === "}" || character === "]") depth -= 1;
      index += 1;
    }
    found.push({ name: match[1], params: source.slice(start, index - 1) });
    match = pattern.exec(source);
  }
  return found;
}

function readAllowlist(file) {
  const allowlist = new Map();
  if (!file || !existsSync(file)) return allowlist;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(\S+)\s*(?:—|::|--)\s*(.+)$/);
    if (!match) {
      throw new Error(`${file} has an entry without a reason: ${trimmed}`);
    }
    allowlist.set(match[1], match[2].trim());
  }
  return allowlist;
}

const checks = {
  command(check) {
    const result = run(check.run);
    if (result.code !== 0) {
      return {
        ok: false,
        reason: `\`${expand(check.run)}\` exited ${result.code}`,
        detail: tail(result.output),
      };
    }
    if (check.contains && !result.output.includes(check.contains)) {
      return {
        ok: false,
        reason: `\`${expand(check.run)}\` did not print ${check.contains}`,
        detail: tail(result.output),
      };
    }
    return { ok: true };
  },

  fileExists(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };
    return { ok: true };
  },

  fileContains(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };
    const content = readFileSync(check.path, "utf8");
    const missing = (check.contains ?? []).filter((needle) => !content.includes(needle));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `${check.path} does not contain: ${missing.join(", ")}`,
      };
    }
    return { ok: true };
  },

  fileMaxLines(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };
    const lines = readFileSync(check.path, "utf8").trimEnd().split("\n").length;
    if (lines > check.max) {
      return {
        ok: false,
        reason: `${check.path} has ${lines} lines, the limit is ${check.max}`,
      };
    }
    return { ok: true };
  },

  grepCount(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };
    const content = readFileSync(check.path, "utf8");
    const matches = content.match(new RegExp(check.pattern, check.flags ?? "gm")) ?? [];
    if (check.min !== undefined && matches.length < check.min) {
      return {
        ok: false,
        reason: `${check.path} has ${matches.length} matches, at least ${check.min} are required`,
      };
    }
    if (check.max !== undefined && matches.length > check.max) {
      return {
        ok: false,
        reason: `${check.path} has ${matches.length} matches, at most ${check.max} are allowed`,
      };
    }
    return { ok: true };
  },

  node(check) {
    const directory = mkdtempSync(path.join(tmpdir(), "harness-"));
    const file = path.join(directory, "check.mjs");
    writeFileSync(file, check.script);
    const result = run(`node ${file}`);
    if (result.code !== 0) {
      return {
        ok: false,
        reason: `the node check exited ${result.code}`,
        detail: tail(result.output),
      };
    }
    return { ok: true };
  },

  agentsFile(check) {
    const settings = { ...config.agents, ...check };
    const file = settings.file ?? "AGENTS.md";
    if (!existsSync(file)) return { ok: false, reason: `${file} is missing` };

    const content = readFileSync(file, "utf8");
    const lines = content.trimEnd().split("\n").length;
    if (settings.maxLines && lines > settings.maxLines) {
      return {
        ok: false,
        reason: `${file} has ${lines} lines, the limit is ${settings.maxLines}`,
      };
    }

    const rules = content
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());

    if (rules.length === 0) return { ok: false, reason: `${file} names no rules` };

    const problems = [];
    for (const rule of rules) {
      const match = rule.match(/Enforced by: (\S+)$/);
      if (!match) {
        problems.push(`a rule names no enforcement path: ${rule}`);
        continue;
      }
      if (!existsSync(path.join(root, match[1]))) {
        problems.push(`${match[1]} does not exist`);
      }
    }
    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${file} has ${problems.length} broken rules`,
        detail: problems.join("\n"),
      };
    }

    if (settings.entryPoint) {
      if (!existsSync(settings.entryPoint)) {
        return { ok: false, reason: `${settings.entryPoint} is missing` };
      }
      const pointer = readFileSync(settings.entryPoint, "utf8").trim();
      if (pointer !== `@${file}`) {
        return {
          ok: false,
          reason: `${settings.entryPoint} must contain only @${file}, it contains: ${pointer}`,
        };
      }
    }

    return { ok: true };
  },

  actorParams(check) {
    const settings = { ...config.dataAccess, ...check };
    if (!settings.dir) return { ok: false, reason: "dataAccess.dir is not set" };
    if (!existsSync(settings.dir)) return { ok: false, reason: `${settings.dir} is missing` };

    const actor = new RegExp(settings.actorPattern ?? "\\b(userId|ownerId|viewerId|actorId)\\b");
    const allowlist = readAllowlist(settings.allowlist);
    const problems = [];

    const files = walk(settings.dir).filter(
      (file) => file.endsWith(".ts") && !file.includes(".test.ts") && !file.includes(".spec.ts"),
    );

    const exported = new Map();
    for (const file of files) {
      for (const fn of exportedFunctions(readFileSync(file, "utf8"))) {
        exported.set(fn.name, fn);
        if (actor.test(fn.params)) continue;
        if (allowlist.has(fn.name)) continue;
        problems.push(`${fn.name} in ${file} takes no actor id and is not on the allowlist`);
      }
    }

    for (const name of allowlist.keys()) {
      if (!exported.has(name)) {
        problems.push(
          `${name} is on the allowlist but is not an exported function in ${settings.dir}`,
        );
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${problems.length} data functions break the actor rule`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },
};

let passed = 0;
let failed = 0;

for (const criterion of criteria) {
  const check = criterion.check ?? {};
  const handler = checks[check.type];
  const label = criterion.id ?? check.type ?? "criterion";

  if (!handler) {
    console.log(`FAIL  ${label}  unknown check type: ${check.type}`);
    failed += 1;
    continue;
  }

  let result;
  try {
    result = handler(check);
  } catch (error) {
    result = { ok: false, reason: error.message };
  }

  if (result.ok) {
    console.log(`PASS  ${label}  ${criterion.why ?? ""}`.trimEnd());
    passed += 1;
    continue;
  }

  console.log(`FAIL  ${label}  ${criterion.why ?? ""}`.trimEnd());
  console.log(`      ${result.reason}`);
  if (result.detail) {
    for (const line of String(result.detail).split("\n")) console.log(`      ${line}`);
  }
  failed += 1;
}

const minimum = config.minimumCriteria ?? 10;
if (criteria.length < minimum) {
  console.log(
    `FAIL  coverage  the harness scores ${criteria.length} criteria, ${minimum} are required`,
  );
  failed += 1;
} else {
  // The coverage check is a gate on the criteria list, not a criterion of its
  // own, so it is reported separately and never inflates the score.
  console.log(`PASS  coverage  the harness scores ${criteria.length} criteria`);
}

if (Array.isArray(config.notes) && config.notes.length > 0) {
  console.log("\nharness notes:");
  for (const note of config.notes) console.log(`  - ${note}`);
}

console.log(`\nharness: ${passed}/${criteria.length} criteria passed, ${failed} failed`);

if (failed > 0) process.exit(1);
