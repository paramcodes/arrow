#!/usr/bin/env node
/**
 * Scores the agent harness against the criteria in harness.config.json.
 *
 * Every criterion runs a real check against this repository. A criterion passes
 * only when its check passes. The script exits 0 only when every criterion
 * passes, and it prints the reason for every failure.
 *
 * A criterion never checks for a word. A check either runs the thing it
 * describes, or it reads a structure that a change could actually break: the
 * resolved ESLint configuration, the shape of a workflow file, the sections of
 * a procedure, the rows of a log. A file that keeps the words of a rule while
 * losing the rule fails the check.
 *
 * `node scripts/harness-score.mjs --only <criterion>` scores one criterion.
 * The proof cases use that mode, so a proof case can prove that a criterion
 * fails when the thing it guards breaks.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ESLint } from "eslint";

const argv = process.argv.slice(2);
const onlyFlag = argv.indexOf("--only");
const only = onlyFlag === -1 ? null : (argv[onlyFlag + 1] ?? null);
const positional = argv.filter(
  (value, index) => !value.startsWith("--") && !(onlyFlag !== -1 && index === onlyFlag + 1),
);
const root = path.resolve(positional[0] ?? process.cwd());
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

/**
 * The criteria the harness holds, and the command each one runs. The list
 * lives in this file, not only in `harness.config.json`, so that editing the
 * config alone cannot weaken the gate: a criterion that is deleted, renamed or
 * duplicated fails the score, and a command criterion that stops running the
 * command it is supposed to run fails the score too.
 *
 * Adding a criterion is allowed. It is a deliberate act of editing this list.
 */
const EXPECTED_CRITERIA = {
  boundaries: { run: "${PM} arch" },
  "theme-discipline": { run: "node scripts/check-theme-discipline.mjs" },
  proofs: { run: "${PM} prove" },
  "escape-hatches": {},
  "entry-point": {},
  "local-gate": {},
  ci: {},
  ratchet: {},
  "mistake-log": {},
  verify: { run: "${PM} verify" },
};

const EXPECTED_CRITERION_IDS = Object.keys(EXPECTED_CRITERIA);

/**
 * A command that exits 0 without proving anything. A criterion that runs one
 * of these scores as if it had checked the thing it names.
 */
const NOOP_COMMANDS = new Set([
  "true",
  "false",
  ":",
  "0",
  "exit 0",
  "exit 1",
  "echo",
  "echo hit",
  "noop",
  "nothing",
  "yes",
]);

function isNoopCommand(command) {
  const trimmed = String(command).trim();
  if (trimmed === "") return true;
  if (NOOP_COMMANDS.has(trimmed)) return true;
  if (NOOP_COMMANDS.has(trimmed.toLowerCase())) return true;
  return false;
}

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

/**
 * The resolved ESLint configuration of one file. The resolver reads the real
 * config, so a rule that was commented out is missing from the result and the
 * check that needs it fails.
 */
let eslint = null;

async function resolveEslintConfig(file) {
  eslint ??= new ESLint({ cwd: root });
  return eslint.calculateConfigForFile(file);
}

function severityOf(value) {
  if (typeof value === "number") return value;
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  return undefined;
}

/**
 * A small reader for the YAML subset this repository writes: nested maps,
 * sequences of maps, inline sequences and block scalars. It exists because the
 * checks below read the structure of a workflow file, and a substring search
 * cannot tell a command that runs from a comment that mentions one.
 */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

function nextContentLine(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return index;
  }
  return -1;
}

function parseScalar(raw) {
  const value = String(raw).trim();
  if (value === "") return "";
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseScalar(item));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  const comment = value.indexOf(" #");
  return comment === -1 ? value : value.slice(0, comment).trim();
}

function parseYamlMapping(lines, start, indent) {
  const map = {};
  let index = start;

  while (index < lines.length) {
    const content = nextContentLine(lines, index);
    if (content === -1) {
      index = lines.length;
      break;
    }
    const line = lines[content];
    if (indentOf(line) !== indent) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("-")) break;

    const match = trimmed.match(/^(?<key>"[^"]*"|'[^']*'|[^:]+):(?:\s+(?<value>.*))?$/);
    if (!match) {
      index = content + 1;
      continue;
    }

    const key = parseScalar(match.groups.key);
    const rawValue = (match.groups.value ?? "").trim();

    if (rawValue === "") {
      const next = nextContentLine(lines, content + 1);
      if (next !== -1 && indentOf(lines[next]) > indent) {
        const nested = parseYamlBlock(lines, next, indentOf(lines[next]));
        map[key] = nested.value;
        index = nested.index;
      } else {
        map[key] = null;
        index = content + 1;
      }
      continue;
    }

    if (rawValue === "|" || rawValue === ">" || rawValue === "|-" || rawValue === ">-") {
      const block = [];
      let cursor = content + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (candidate.trim() !== "" && indentOf(candidate) <= indent) break;
        block.push(candidate.trim());
        cursor += 1;
      }
      map[key] = block.join("\n").trim();
      index = cursor;
      continue;
    }

    map[key] = parseScalar(rawValue);
    index = content + 1;
  }

  return { value: map, index };
}

function parseYamlSequence(lines, start, indent) {
  const items = [];
  let index = start;

  while (index < lines.length) {
    const content = nextContentLine(lines, index);
    if (content === -1) {
      index = lines.length;
      break;
    }
    const line = lines[content];
    if (indentOf(line) !== indent) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) break;

    const rest = trimmed.slice(1).trim();
    if (rest === "") {
      const nested = parseYamlBlock(lines, content + 1, indent + 2);
      items.push(nested.value);
      index = nested.index;
      continue;
    }

    if (/^(?:"[^"]*"|'[^']*'|[^:]+):(\s|$)/.test(rest)) {
      const itemIndent = indent + 2;
      const patched = lines.slice();
      patched[content] = " ".repeat(itemIndent) + rest;
      const nested = parseYamlBlock(patched, content, itemIndent);
      items.push(nested.value);
      index = nested.index;
      continue;
    }

    items.push(parseScalar(rest));
    index = content + 1;
  }

  return { value: items, index };
}

function parseYamlBlock(lines, start, indent) {
  const content = nextContentLine(lines, start);
  if (content === -1) return { value: null, index: lines.length };
  const trimmed = lines[content].trim();
  if (trimmed.startsWith("-")) return parseYamlSequence(lines, content, indent);
  return parseYamlMapping(lines, content, indent);
}

function parseYaml(text) {
  const lines = text.split("\n");
  const first = nextContentLine(lines, 0);
  if (first === -1) return {};
  return parseYamlBlock(lines, first, indentOf(lines[first])).value;
}

function readPath(document, dottedPath) {
  let node = document;
  for (const segment of dottedPath.split(".")) {
    if (node === null || node === undefined || typeof node !== "object") return undefined;
    node = node[segment];
  }
  return node;
}

function requirementHolds(text, requirement) {
  if (typeof text !== "string") return false;
  for (const needle of requirement.contains ?? []) {
    if (!text.includes(needle)) return false;
  }
  for (const needle of requirement.notContains ?? []) {
    if (text.includes(needle)) return false;
  }
  return true;
}

function describeRequirement(requirement) {
  const parts = [];
  if (requirement.contains) parts.push(`hold ${requirement.contains.join(", ")}`);
  if (requirement.notContains) parts.push(`hold none of ${requirement.notContains.join(", ")}`);
  return parts.join(" and ");
}

/**
 * The file a command runs. It is the token of the command that names a script
 * in this repository.
 */
function commandScript(command) {
  return String(command)
    .split(/\s+/)
    .find((token) => /\.(mjs|cjs|js|ts|sh|yml|yaml)$/.test(token) && token.includes("/"));
}

/**
 * Reads a JSON file of the repository. A file that is not JSON fails the check
 * that reads it, rather than the run.
 */
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(path.join(root, file), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Validates one entry of the enforcement registry of `AGENTS.md`.
 *
 * A rule in `AGENTS.md` names the path that enforces it. A path that exists
 * proves nothing: the file can hold the words of a rule while the rule is
 * gone. So every rule names a kind, and the kind decides how the path is
 * checked.
 *
 * - `eslintRule` reads the resolved ESLint configuration and holds the rule
 *   on as an error.
 * - `tsconfig` reads the compiler options and holds the strict family on.
 * - `yamlStructure` reads the structure of a workflow file.
 * - `criterion` holds a criterion of the harness.
 * - `command` runs the command and holds its output.
 * - `fileShape` reads the file and holds the shape the rule claims.
 *
 * The return value is the reason the rule is not enforced, or null when the
 * mechanism is live.
 */
async function validateEnforcement(entry) {
  switch (entry.kind) {
    case "eslintRule": {
      const names = entry.rules ?? (entry.rule ? [entry.rule] : []);
      if (names.length === 0) return `the registry entry "${entry.match}" names no ESLint rule`;
      let resolved;
      try {
        resolved = await resolveEslintConfig(entry.file);
      } catch (error) {
        return `the ESLint configuration for ${entry.file} failed: ${error.message}`;
      }
      for (const name of names) {
        if (severityOf(resolved.rules?.[name]) !== 2) {
          return `${name} is not an error rule for ${entry.file}`;
        }
      }
      return null;
    }

    case "tsconfig": {
      const document = readJsonFile(entry.path);
      if (!document) return `${entry.path} is not readable JSON`;
      const options = document.compilerOptions ?? {};
      const implied = entry.impliedFlags ?? [];
      for (const [flag, value] of Object.entries(entry.flags ?? {})) {
        const actual = options[flag];
        const allowed = implied.includes(flag) ? [true, undefined] : [value];
        if (!allowed.includes(actual)) {
          return `the compiler option ${flag} is ${JSON.stringify(actual)} in ${entry.path}, ${JSON.stringify(value)} is required`;
        }
      }
      return null;
    }

    case "yamlStructure": {
      const result = checks.yamlStructure({ path: entry.path, require: entry.require ?? [] });
      if (result.ok) return null;
      return result.detail ?? result.reason;
    }

    case "criterion": {
      const criterion = criteria.find((candidate) => candidate.id === entry.criterion);
      if (!criterion) return `the criterion ${entry.criterion} does not exist`;
      if (!criterion.check?.type) return `the criterion ${entry.criterion} holds no check`;
      if (!checks[criterion.check.type]) {
        return `the criterion ${entry.criterion} holds the unknown check type ${criterion.check.type}`;
      }
      return null;
    }

    case "command": {
      const script = commandScript(entry.run);
      if (script && script !== entry.path) {
        return `the registry entry "${entry.match}" runs ${script}, the rule names ${entry.path}`;
      }
      if (isNoopCommand(entry.run)) {
        return `the registry entry "${entry.match}" runs \`${entry.run}\`, which proves nothing`;
      }
      const result = run(entry.run);
      if (result.code !== 0) return `the command \`${expand(entry.run)}\` exited ${result.code}`;
      if (entry.contains && !result.output.includes(entry.contains)) {
        return `the command \`${expand(entry.run)}\` did not print ${entry.contains}`;
      }
      return null;
    }

    case "fileShape": {
      if (!existsSync(path.join(root, entry.path))) return `${entry.path} is missing`;
      const content = readFileSync(path.join(root, entry.path), "utf8");
      const bodyLines = content.trimEnd().split("\n").length;
      const minimum = entry.minLines ?? 1;
      if (bodyLines < minimum) {
        return `${entry.path} holds ${bodyLines} lines, at least ${minimum} are required`;
      }
      for (const needle of entry.contains ?? []) {
        if (!content.includes(needle)) return `${entry.path} does not name ${needle}`;
      }
      for (const pattern of entry.patterns ?? []) {
        if (!new RegExp(pattern).test(content)) return `${entry.path} does not match ${pattern}`;
      }
      return null;
    }

    default:
      return `the registry entry "${entry.match}" names an unknown kind: ${entry.kind}`;
  }
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

  /**
   * Reads the resolved ESLint configuration and asserts that the rules of the
   * source tree are switched on as errors. A rule that was commented out in
   * `eslint.config.mjs` is missing from the resolved configuration, so this
   * check fails even when the words of the rule are still in the file.
   */
  async eslintRules(check) {
    const problems = [];

    for (const requirement of check.require ?? []) {
      let resolved;
      try {
        resolved = await resolveEslintConfig(requirement.file);
      } catch (error) {
        problems.push(`the ESLint configuration for ${requirement.file} failed: ${error.message}`);
        continue;
      }

      for (const rule of requirement.rules ?? []) {
        const severity = severityOf(resolved.rules?.[rule]);
        if (severity !== 2) {
          problems.push(`${rule} is not an error rule for ${requirement.file}`);
        }
      }

      for (const [rule, options] of Object.entries(requirement.ruleOptions ?? {})) {
        const entry = resolved.rules?.[rule];
        const settings = Array.isArray(entry) ? entry[1] : undefined;
        if (typeof settings !== "object" || settings === null) {
          problems.push(`${rule} holds no options for ${requirement.file}`);
          continue;
        }
        for (const [option, value] of Object.entries(options)) {
          if (settings[option] !== value) {
            problems.push(
              `${rule} sets ${option} to ${JSON.stringify(settings[option])}, ${JSON.stringify(value)} is required`,
            );
          }
        }
      }

      for (const option of requirement.linterOptions ?? []) {
        if (!resolved.linterOptions?.[option]) {
          problems.push(`the linter option ${option} is not set for ${requirement.file}`);
        }
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${problems.length} rules are not switched on`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },

  /**
   * Reads the structure of a YAML file and asserts what must be in it. A
   * command that was deleted fails the check even when its key survives.
   */
  yamlStructure(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };

    const document = parseYaml(readFileSync(check.path, "utf8"));
    const problems = [];

    for (const requirement of check.require ?? []) {
      const node = readPath(document, requirement.path);
      if (node === undefined) {
        problems.push(`${requirement.path} is missing from ${check.path}`);
        continue;
      }

      if (requirement.key === undefined) {
        if (!requirementHolds(node, requirement)) {
          problems.push(
            `${requirement.path} in ${check.path} does not ${describeRequirement(requirement)}`,
          );
        }
        continue;
      }

      const elements = Array.isArray(node) ? node : [node];
      const found = elements.some(
        (element) =>
          element !== null &&
          typeof element === "object" &&
          requirementHolds(element[requirement.key], requirement),
      );
      if (!found) {
        problems.push(
          `no "${requirement.key}" in ${requirement.path} of ${check.path} does ${describeRequirement(requirement)}`,
        );
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${check.path} does not hold what the rule requires`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },

  /**
   * Reads the sections of a procedure. The sections must exist, and each one
   * must hold enough of the rule to be usable.
   */
  markdownSections(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };

    const lines = readFileSync(check.path, "utf8").split("\n");
    const problems = [];

    for (const section of check.sections ?? []) {
      const start = lines.findIndex((line) => line.trim() === section.heading);
      if (start === -1) {
        problems.push(`${section.heading} is missing from ${check.path}`);
        continue;
      }

      let end = lines.length;
      for (let index = start + 1; index < lines.length; index += 1) {
        if (lines[index].trim().startsWith("#")) {
          end = index;
          break;
        }
      }

      const body = lines
        .slice(start + 1, end)
        .filter((line) => line.trim() !== "")
        .join("\n");
      const bodyLines = body.split("\n").filter((line) => line.trim() !== "").length;
      const minimum = section.minLines ?? 1;

      if (bodyLines < minimum) {
        problems.push(
          `${section.heading} holds ${bodyLines} lines, at least ${minimum} are required`,
        );
      }
      for (const needle of section.contains ?? []) {
        if (!body.includes(needle)) {
          problems.push(`${section.heading} does not name ${needle}`);
        }
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${check.path} does not hold the whole procedure`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },

  /**
   * Reads the rows of a log table. Every row must be complete, and the
   * guardrail it names must exist, so a row cannot point at nothing.
   */
  markdownTable(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };

    const rows = readFileSync(check.path, "utf8")
      .split("\n")
      .filter((line) => line.trim().startsWith("|"));
    const problems = [];

    if (rows.length < 2) {
      return { ok: false, reason: `${check.path} holds no table` };
    }

    const isSeparator = (row) => /^[|\s:-]+$/.test(row);
    const data = rows.slice(1).filter((row) => !isSeparator(row));
    const minimum = check.minRows ?? 1;

    if (data.length < minimum) {
      problems.push(`${check.path} holds ${data.length} rows, at least ${minimum} are required`);
    }

    for (const [index, row] of data.entries()) {
      const cells = row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      const columns = check.columns ?? cells.length;

      if (cells.length < columns) {
        problems.push(
          `row ${index + 1} of ${check.path} holds ${cells.length} cells, ${columns} are required`,
        );
        continue;
      }

      for (let cell = 0; cell < columns; cell += 1) {
        if (cells[cell] === "") {
          problems.push(
            `row ${index + 1} of ${check.path} holds an empty cell in column ${cell + 1}`,
          );
        }
      }

      for (const column of check.pathColumns ?? []) {
        const cell = cells[column];
        if (!cell) continue;
        for (const token of cell.match(/`([^`]+)`/g) ?? []) {
          const name = token.slice(1, -1);
          if (!looksLikePath(name)) continue;
          if (!existsSync(path.join(root, name))) {
            problems.push(`row ${index + 1} of ${check.path} names ${name}, which does not exist`);
          }
        }
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${check.path} does not hold a complete row for every mistake`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },

  /**
   * Reads the rules of `AGENTS.md`. Every rule must name an enforcement path
   * that exists and that can fail. A document cannot fail, so a rule may not
   * name one. The registry in the config names the mechanism of every rule,
   * and the check proves the mechanism is live: no rule is validated by the
   * existence of its path alone.
   */
  async agentsFile(check) {
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

    const entries = settings.enforcement ?? [];
    const problems = [];

    for (const rule of rules) {
      const match = rule.match(/Enforced by: (\S+)$/);
      if (!match) {
        problems.push(`a rule names no enforcement path: ${rule}`);
        continue;
      }
      const target = match[1];
      if (target.endsWith(".md")) {
        problems.push(`${target} is a document, and a document cannot fail`);
        continue;
      }
      if (!existsSync(path.join(root, target))) {
        problems.push(`${target} does not exist`);
        continue;
      }

      const matching = entries.filter((entry) => rule.includes(entry.match));
      if (matching.length !== 1) {
        problems.push(
          `the rule "${rule}" is named by ${matching.length} registry entries, one is required`,
        );
        continue;
      }

      const entry = matching[0];
      if (target !== entry.path) {
        problems.push(
          `the rule "${rule}" is enforced by ${target}, the registry names ${entry.path}`,
        );
        continue;
      }

      const reason = await validateEnforcement(entry);
      if (reason) problems.push(reason);
    }

    for (const entry of entries) {
      const matched = rules.filter((rule) => rule.includes(entry.match));
      if (matched.length !== 1) {
        problems.push(
          `the enforcement entry "${entry.match}" matches ${matched.length} rules of ${file}`,
        );
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
};

/**
 * True when a token in a table cell names a file. A rule name such as
 * `local/no-cross-layer-import` is not a file, and a command such as
 * `pnpm install` is not a file.
 */
function looksLikePath(token) {
  if (token.includes(" ")) return false;
  if (/^\.{0,2}\//.test(token)) return true;
  return /\.[A-Za-z0-9]+$/.test(token);
}

const selected = only
  ? criteria.filter((criterion) => (criterion.id ?? criterion.check?.type) === only)
  : criteria;

if (only && selected.length === 0) {
  die(`no criterion is named ${only}`);
}

/**
 * Checks that a criterion still is the criterion the harness holds. A
 * criterion whose id the harness does not know, or whose command was replaced
 * by something that proves nothing, fails before its check runs.
 */
function definitionProblems(criterion) {
  const problems = [];
  const id = criterion.id ?? criterion.check?.type ?? "criterion";
  const expected = EXPECTED_CRITERIA[id];

  if (!expected) {
    problems.push(
      `the criterion id ${id} is not one the harness holds: ${EXPECTED_CRITERION_IDS.join(", ")}`,
    );
    return problems;
  }

  const check = criterion.check ?? {};
  if (check.type === "command") {
    const command = String(check.run ?? "").trim();
    if (command === "") {
      problems.push(`${id} runs nothing`);
    } else if (isNoopCommand(command)) {
      problems.push(`${id} runs \`${command}\`, which exits 0 and proves nothing`);
    }
    if (expected.run !== undefined && expand(command) !== expand(expected.run)) {
      problems.push(`${id} runs \`${command}\`, the harness expects \`${expand(expected.run)}\``);
    }
  }

  return problems;
}

let passed = 0;
let failed = 0;

for (const criterion of selected) {
  const check = criterion.check ?? {};
  const handler = checks[check.type];
  const label = criterion.id ?? check.type ?? "criterion";

  const broken = definitionProblems(criterion);
  if (broken.length > 0) {
    console.log(`FAIL  ${label}  ${criterion.why ?? ""}`.trimEnd());
    for (const problem of broken) console.log(`      ${problem}`);
    failed += 1;
    continue;
  }

  if (!handler) {
    console.log(`FAIL  ${label}  unknown check type: ${check.type}`);
    failed += 1;
    continue;
  }

  let result;
  try {
    result = await handler(check);
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
const ids = criteria.map((criterion) => criterion.id ?? criterion.check?.type ?? "criterion");
const counts = new Map();
for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

const missing = EXPECTED_CRITERION_IDS.filter((id) => !counts.has(id));
const unexpected = ids.filter((id) => !EXPECTED_CRITERION_IDS.includes(id));
const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);

const coverage = [];
if (missing.length > 0) coverage.push(`the criteria ${missing.join(", ")} are missing`);
if (unexpected.length > 0) {
  coverage.push(`the criteria ${unexpected.join(", ")} are not one the harness holds`);
}
if (duplicated.length > 0) {
  coverage.push(`the criteria ${duplicated.join(", ")} appear more than once`);
}
if (minimum !== EXPECTED_CRITERION_IDS.length) {
  coverage.push(
    `minimumCriteria is ${minimum}, the harness holds ${EXPECTED_CRITERION_IDS.length} criteria`,
  );
}
if (criteria.length < minimum) {
  coverage.push(`the harness scores ${criteria.length} criteria, ${minimum} are required`);
}

if (coverage.length > 0) {
  console.log(`FAIL  coverage  the harness scores the criteria it must hold`);
  for (const problem of coverage) console.log(`      ${problem}`);
  failed += 1;
} else {
  // The coverage check is a gate on the criteria list, not a criterion of its
  // own, so it is reported separately and never inflates the score.
  console.log(`PASS  coverage  the harness scores ${criteria.length} criteria`);
}

if (Array.isArray(config.notes) && config.notes.length > 0 && !only) {
  console.log("\nharness notes:");
  for (const note of config.notes) console.log(`  - ${note}`);
}

console.log(`\nharness: ${passed}/${selected.length} criteria passed, ${failed} failed`);

if (failed > 0) process.exit(1);
