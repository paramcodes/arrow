#!/usr/bin/env node
/**
 * Scores the agent harness against the criteria in harness.config.json.
 *
 * Every criterion runs a real check against this repository. A criterion passes
 * only when its check passes. The script exits 0 only when every criterion
 * passes, and it prints the reason for every failure.
 *
 * A criterion never checks for a word. A check either runs the thing it
 * describes, or it reads a structure a change could actually break: the
 * resolved ESLint configuration, the shape of a workflow file, the sections of
 * a procedure, the rows of a log, the artifact a build produced. A file that
 * keeps the words of a rule while losing the rule fails the check.
 *
 * The scorer owns the tree while it runs. It takes an exclusive lock before it
 * touches anything, so a score and a proof run on one tree cannot interleave
 * and read a tree that a probe has half replaced. The lock lives outside the
 * tree, so a run that was killed outright never leaves it in the repository,
 * and a lock whose owner is gone is broken by the next run.
 *
 * The scorer writes probe files into the tree to run the linter, and it leaves
 * the tree exactly as it found it, on every exit path: a normal run, a thrown
 * error, an interrupt, a termination. A run that was killed outright cannot
 * clean up after itself, so it leaves a journal outside the tree, and the next
 * run restores the tree from that journal before it writes anything of its own.
 *
 * The criteria the harness holds live in this file, not only in
 * `harness.config.json`, so that editing the config alone cannot weaken the
 * gate: a criterion that is deleted, renamed or duplicated fails the score, and
 * a command criterion that stops running the command it is supposed to run
 * fails the score too. The proof names live here as well, and the scorer
 * proves that the prover holds the same set.
 *
 * `node scripts/harness-score.mjs --only <criterion>` scores one criterion.
 * `--only coverage` and `--only proof-set` score the gates that are not
 * criteria of their own.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { parse as parseYamlText } from "yaml";

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
const execCommand = config.commands?.exec ?? `${packageManager} exec`;
const criteria = Array.isArray(config.criteria) ? config.criteria : [];

/**
 * The criteria the harness holds, and the command each one runs.
 *
 * The list lives in this file, not only in `harness.config.json`, so that
 * editing the config alone cannot weaken the gate: a criterion that is
 * deleted, renamed or duplicated fails the score, and a command criterion that
 * stops running the command it is supposed to run fails the score too.
 *
 * Adding a criterion is allowed. It is a deliberate act of editing this list
 * and of raising `minimumCriteria` in the config in the same commit.
 */
const EXPECTED_CRITERIA = {
  boundaries: { run: "${PM} arch" },
  "theme-discipline": { run: "node scripts/check-theme-discipline.mjs" },
  "version-agreement": { run: "node scripts/check-version.mjs" },
  proofs: { run: "${PM} prove" },
  "escape-hatches": {},
  "entry-point": {},
  "local-gate": {},
  ci: {},
  ratchet: {},
  "mistake-log": {},
  verify: { run: "${PM} verify" },
  behavioral: { run: "${PM} test:e2e" },
  artifact: { build: "${PM} build" },
  "second-toolchain": { run: "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml" },
};

const EXPECTED_CRITERION_IDS = Object.keys(EXPECTED_CRITERIA);

/**
 * The proof cases the harness holds.
 *
 * The list lives in this file and in `scripts/prove-guardrails.mjs`, so that
 * editing `harness.config.json` alone cannot weaken the gate. The two files
 * must hold the same names, and the scorer reads the prover to prove it.
 */
const EXPECTED_PROOF_NAMES = [
  "a color literal inside the token package is allowed",
  "a component hardcodes a Tailwind default-palette utility",
  "a component hardcodes a bare channel triplet",
  "a component hardcodes a color",
  "a component hardcodes a modern color function",
  "a component hardcodes a named color",
  "a content change that loses the caret is caught",
  "a file reaches a state tier with a computed import",
  "a file reaches a state tier with a computed require",
  "a file with no state tier owns a computed import",
  "a stylesheet outside the old scan bounds is scanned",
  "a workspace package imports the Tauri API",
  "a workspace package imports the desktop app",
  "a workspace package imports the desktop app by its package name",
  "a workspace package reaches the desktop app with a computed import",
  "a workspace package reaches the desktop app with a dynamic import",
  "a workspace package reaches the desktop app with a template import",
  "a workspace package reaches the desktop app with require",
  "one file imports two state tiers",
  "the AI bridge never hands the key back",
  "the AI boundary that drifts from the contract is caught",
  "the AI store holds no key material",
  "the active line case fails when the active line is not painted",
  "the artifact criterion fails when the build output misses the source",
  "the behavioral criterion fails when the end to end command only prints",
  "the browser stub keeps no key material",
  "the browser stub that forgets the key of a provider is caught",
  "the ci criterion fails when the score step is commented out",
  "the ci criterion fails when the score step only echoes the command",
  "the ci criterion fails when the score step swallows the failure",
  "the ci criterion fails when the workflow runs again after a squash merge",
  "the ci criterion fails when the workflow stops running the self proof",
  "the command registry that grew an action without a spy for it is caught",
  "the coverage criterion fails when a criterion is deleted and another is duplicated",
  "the delete confirmation of a dirty file is caught",
  "the dialog permission lives in a capability of its own",
  "the end to end spec that navigates on its own is caught",
  "the entry point criterion fails when a rule names an unrelated path",
  "the entry point criterion fails when the browser smoke spec is gutted",
  "the entry point criterion fails when the compiler options lose their strictness",
  "the error of the AI client carries no key",
  "the error of the AI client keeps the key out of the tree",
  "the escape hatch criterion fails when the rules are switched off",
  "the extensions prop that is dropped after the mount is caught",
  "the failure of the inline edit that never reaches the reader is caught",
  "the ghost text field that never paints the suggestion is caught",
  "the end to end case that waits for a request that is already over is caught",
  "the harness fails when a command criterion runs a no-op",
  "the harness fails when it takes longer than the ceiling",
  "the inline diff that never paints the decorations is caught",
  "the inline edit that waits for an answer to a question that is gone is caught",
  "the local gate criterion fails when the hook commands lose their run lines",
  "the local gate criterion fails when the lint command is only a comment",
  "the mistake log criterion fails when the rows are deleted",
  "the next run restores the probe file of a run that was killed",
  "the prover fails when a proof case is deleted and another is duplicated",
  "the prover refuses a second run while the lock is held",
  "the ratchet criterion fails when the procedure is deleted",
  "the scorer refuses a second run while the tree lock is held",
  "the second toolchain criterion fails when the rust gate only prints",
  "the shell content padding that leaves eight pixels is caught",
  "the source tree carries a skipped test",
  "the source tree carries a ts-expect-error",
  "the source tree carries an inline lint config",
  "the source tree parses raw JSON",
  "the store test that skips the reset is caught",
  "the tailwind build scans the shared ui package",
  "the theme cascade of the editor settings is caught",
  "the version check fails when two files disagree",
  "the webview bundle reads a key from the environment",
  "the webview logs a key",
  "the webview stores a key in browser storage",
  "the workspace ui alias resolves to its entry point",
];

const GATE_NAMES = ["coverage", "proof-set", "runtime"];

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
  "noop",
  "nothing",
  "yes",
]);

function isNoopCommand(command) {
  const trimmed = String(command).trim();
  if (trimmed === "") return true;
  if (NOOP_COMMANDS.has(trimmed)) return true;
  if (NOOP_COMMANDS.has(trimmed.toLowerCase())) return true;
  if (/^echo\b/.test(trimmed)) return true;
  if (/(\|\|\s*true|;\s*true)\s*$/.test(trimmed)) return true;
  return false;
}

/**
 * The body of the package script a command runs, when the command runs one.
 *
 * A script whose body only prints is not the command it is named after, so the
 * body is read before the command is run.
 */
function packageScriptBody(command) {
  const match = String(command)
    .trim()
    .match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:._-]+)\s*$/);
  if (!match) return null;

  const name = match[1];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }

  const body = manifest.scripts?.[name];
  if (typeof body !== "string") return null;
  return { name, body };
}

/**
 * True when every part of a script body proves nothing. A body of
 * `echo everything is fine` is a no-op however it is written.
 */
function isNoopBody(body) {
  const parts = String(body)
    .split(/&&|\|\||;/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return true;
  return parts.every((part) => isNoopCommand(part));
}

function expand(text) {
  return String(text)
    .replaceAll("${PM}", packageManager)
    .replaceAll("${PM_EXEC}", execCommand)
    .replaceAll("${DATA_ALIAS}", config.layers?.data?.alias ?? "@/db")
    .replaceAll("${PROOF_COUNT}", String(EXPECTED_PROOF_NAMES.length))
    .replaceAll("${TREE_LOCK_PATH}", lockPath)
    .replaceAll("${OWNER_PID}", String(lockOwnerPid ?? ""));
}

/**
 * The tree discipline.
 *
 * The scorer writes probe files into the tree to run the linter. The tree must
 * be left exactly as it was found, on every exit path. The journal holds the
 * state of the files the scorer is about to overwrite, and it lives outside the
 * tree, so a run that was killed outright still leaves a record that the next
 * run restores.
 */
const treeHash = createHash("sha256").update(root).digest("hex").slice(0, 12);

/**
 * The lock of the tree.
 *
 * A score and a proof run on one tree fight over the same probe files, and the
 * loser reads a tree that the winner has half replaced, which is how a
 * concurrent run scores a false seven of ten. The lock makes the tree the
 * resource of one run: the second run waits for the first to finish and
 * refuses when the wait runs out.
 *
 * The lock lives outside the tree, so a run that was killed outright cannot
 * leave it in the repository. A lock whose owner is gone is broken, so a
 * killed run never blocks the next one.
 *
 * The lock is shared with the prover. The scorer runs the prover inside the
 * score, so the child prover is told that the tree is already owned and does
 * not take the lock a second time.
 */
function treePath(kind) {
  const override = process.env[`HARNESS_${kind}_PATH`];
  if (override) {
    return path.isAbsolute(override) ? override : path.join(root, override);
  }
  return path.join(os.tmpdir(), `arrow-harness-tree-${kind}-${treeHash}.${kind}`);
}

const lockPath = treePath("lock");

/**
 * The journal of the run.
 *
 * The name of the journal holds the pid of the run that wrote it, so two runs
 * that are killed in the same tree leave two journals and neither of them
 * loses the record of the other. The next run restores every journal of the
 * tree and removes them.
 */
const journalPrefix = `arrow-harness-tree-journal-${treeHash}-`;
const journalPath = path.join(os.tmpdir(), `${journalPrefix}${process.pid}.json`);

/**
 * The journals of this tree that a killed run left behind.
 *
 * The prover keeps its own journal, and a killed proof run leaves probe files
 * in the tree too. The scorer owns the tree while it runs, so it repairs both
 * kinds of journal before it reads a single file. The journal of a run that
 * is still alive belongs to that run, and it is left alone.
 */
function journalPaths() {
  const prefixes = [journalPrefix, `arrow-prove-journal-${treeHash}-`];
  let names = [];
  try {
    names = readdirSync(os.tmpdir());
  } catch {
    return [];
  }
  return (
    names
      .filter(
        (name) => name.endsWith(".json") && prefixes.some((prefix) => name.startsWith(prefix)),
      )
      .filter((name) => !journalOwnerIsAlive(name))
      .map((name) => path.join(os.tmpdir(), name))
      // The newest journal first. Every journal holds the state of the tree
      // before its own run wrote to it, so the newest journal undoes the
      // newest run, and the one before it undoes the run before that. The
      // other order leaves the file of a run that a later run found on the
      // tree, and the tree stays dirty.
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  );
}

/**
 * True when the run that wrote the journal is still alive.
 */
function journalOwnerIsAlive(name) {
  const match = name.match(/-(\d+)\.json$/);
  if (!match) return false;
  const pid = Number(match[1]);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/** The milliseconds a run waits for the lock before it refuses to run. */
const lockWaitMs = Number(process.env.HARNESS_LOCK_WAIT_MS ?? 30_000);

/** The milliseconds after which a lock without a readable owner is stale. */
const lockStaleMs = Number(process.env.HARNESS_LOCK_STALE_MS ?? 60_000);

/** The milliseconds a single command of the harness may run. */
const commandTimeoutMs = Number(process.env.HARNESS_COMMAND_TIMEOUT_MS ?? 1_800_000);

/** Sleeps without blocking the event loop for longer than it has to. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The pid that already owns the lock of this tree, when an ancestor of this
 * process owns it. A run that is started by a run that owns the tree does not
 * take the lock a second time, and the two do not wait for each other.
 */
function inheritedLockOwner() {
  // A run that names a lock of its own must take that lock, even when an
  // ancestor owns the tree. A case that proves the refusal of a second run
  // names the lock on purpose.
  if (process.env.HARNESS_LOCK_PATH) return null;
  const raw = process.env.HARNESS_TREE_LOCK_OWNER;
  if (!raw) return null;
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return error.code === "ESRCH" ? null : pid;
  }
}

/**
 * True when the lock belongs to a process that is gone.
 */
function lockOwnerIsGone() {
  let holder;
  try {
    holder = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > lockStaleMs;
    } catch {
      return true;
    }
  }

  if (typeof holder?.pid !== "number") return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

/**
 * The name of the run that holds the lock, and how long it has held it.
 */
function describeLockHolder() {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    if (typeof holder.startedAt !== "number" || holder.startedAt <= 0) {
      return `the run with the pid ${holder.pid}, which has held the lock for an unknown time`;
    }
    const seconds = Math.max(0, Math.round((Date.now() - holder.startedAt) / 1000));
    return `the run with the pid ${holder.pid}, which has held the lock for ${seconds} seconds`;
  } catch {
    return "a run whose holder cannot be read";
  }
}

/**
 * Takes the lock of the tree.
 */
function acquireLock() {
  const deadline = Date.now() + lockWaitMs;

  for (;;) {
    try {
      const handle = openSync(lockPath, "wx");
      try {
        writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      } finally {
        closeSync(handle);
      }
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    if (lockOwnerIsGone()) {
      const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
      try {
        renameSync(lockPath, stalePath);
        rmSync(stalePath, { force: true });
      } catch {
        // Another run broke the same lock first. It holds it now.
      }
      continue;
    }

    if (Date.now() >= deadline) return false;
    sleep(250);
  }
}

/**
 * Releases the lock of the run. Only the owner releases it.
 */
function releaseLock() {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    if (holder?.pid !== process.pid) return;
  } catch {
    return;
  }
  rmSync(lockPath, { force: true });
}

let pendingFiles = [];
let pendingDirectories = new Set();
let journalWritten = false;

/** The pid that owns the lock of the tree while this run runs. */
let lockOwnerPid = null;

function writeJournal() {
  try {
    writeFileSync(journalPath, JSON.stringify({ root, pendingFiles }, null, 2));
    journalWritten = true;
  } catch {
    // The journal is a backup for a run that cannot clean up after itself. A
    // failure to write it must not stop the run.
  }
}

/**
 * Restores every file the scorer touched and removes every directory it made.
 * It is safe to call twice, and it is called on every exit path.
 */
function restoreTree() {
  for (const entry of [...pendingFiles].reverse()) {
    try {
      if (entry.existed) writeFileSync(entry.path, entry.content);
      else rmSync(entry.path, { force: true });
    } catch (error) {
      console.error(`harness: could not restore ${entry.path}: ${error.message}`);
    }
  }
  pendingFiles = [];

  for (const directory of [...pendingDirectories].reverse()) {
    rmSync(directory, { recursive: true, force: true });
  }
  pendingDirectories.clear();

  // The journal belongs to the run that wrote it. A run that never wrote one
  // must not remove the journal of the run that holds the tree.
  if (!journalWritten) return;
  journalWritten = false;
  rmSync(journalPath, { force: true });
}

/**
 * A run that was killed outright cannot clean up after itself. The journal it
 * left behind holds the content of every file it overwrote, so the next run
 * puts the tree back before it writes anything of its own.
 */
function recoverStaleProbes() {
  for (const file of journalPaths()) {
    try {
      const stale = JSON.parse(readFileSync(file, "utf8"));
      if (stale.root === root && Array.isArray(stale.pendingFiles)) {
        for (const entry of stale.pendingFiles) {
          if (entry.existed) writeFileSync(entry.path, entry.content);
          else rmSync(entry.path, { force: true });
        }
        console.log(
          `harness: restored ${stale.pendingFiles.length} probe file(s) left behind by an earlier run`,
        );
      }
    } catch (error) {
      console.error(`harness: could not read the probe journal: ${error.message}`);
    }

    rmSync(file, { force: true });
  }
}

/**
 * The checker runs in a child process without blocking the event loop. A
 * blocking call would swallow the interrupt that stops this script, which is
 * the one signal the operator can always send.
 */
let runningChild = null;

function run(command, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(expand(command), {
      shell: true,
      cwd: options.cwd ?? root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HARNESS_TREE_LOCK_OWNER: String(lockOwnerPid ?? process.pid),
        ...options.env,
      },
    });
    runningChild = child;

    let output = "";
    let settled = false;
    const finish = (code, extra = "") => {
      if (settled) return;
      settled = true;
      if (runningChild === child) runningChild = null;
      resolve({ code, output: `${output}${extra}`.trim() });
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(124, `\nharness: the command \`${command}\` was killed after ${commandTimeoutMs} ms`);
    }, commandTimeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish(1, error.message);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(typeof code === "number" ? code : 1);
    });
  });
}

function tail(text, lines = 6) {
  const rows = String(text).trim().split("\n");
  return rows.slice(-lines).join("\n");
}

function onSignal(signal) {
  if (runningChild) {
    runningChild.kill("SIGKILL");
    runningChild = null;
  }
  restoreTree();
  releaseLock();
  console.error(`\nharness: ${signal} received, the tree was restored`);
  process.exit(128 + (os.constants.signals[signal] ?? 0));
}

/**
 * The run owns the tree before it touches it.
 *
 * The lock is taken before the stale probes are repaired, so two runs can never
 * repair the same probe at the same time.
 */
const inheritedOwner = inheritedLockOwner();

if (inheritedOwner !== null) {
  // An ancestor of this run owns the tree. The run does not take the lock a
  // second time, and the two do not wait for each other.
  lockOwnerPid = inheritedOwner;
} else {
  if (!acquireLock()) {
    console.error(
      `harness: another run holds the lock of this tree and did not finish within ${lockWaitMs} ms: ${describeLockHolder()}`,
    );
    process.exit(1);
  }
  lockOwnerPid = process.pid;
}

recoverStaleProbes();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => onSignal(signal));
}

process.on("exit", () => {
  restoreTree();
  releaseLock();
});

process.on("uncaughtException", (error) => {
  restoreTree();
  releaseLock();
  console.error(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  restoreTree();
  releaseLock();
  console.error(error);
  process.exit(1);
});

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

/**
 * A requirement that names a run value. The path of such a requirement ends
 * in `run`, or it names the `run` key of a step.
 */
function isRunRequirement(requirement) {
  if (requirement.key === "run") return true;
  const segments = requirement.path.split(".");
  return segments[segments.length - 1] === "run";
}

/**
 * The wrappers a command may sit behind and still be the command that runs.
 * `sudo apt-get install` runs apt-get, and `pnpm exec biome format` runs
 * biome, so the wrapper does not hide the command.
 */
const COMMAND_WRAPPERS = new Set(["sudo", "env", "time", "command", "npx", "corepack"]);
const COMMAND_WRAPPER_PREFIXES = ["pnpm exec", "pnpm run", "pnpm dlx", "yarn dlx"];

/** The interpreters. The script an interpreter runs is the command. */
const INTERPRETERS = new Set(["bash", "sh", "zsh", "node", "python3"]);

/** The commands that swallow the failure of the command in front of them. */
const FAILURE_SWALLOWERS = new Set(["true", ":"]);

/**
 * The logical lines of a run value. A line that ends with a backslash
 * continues on the next line, so the command is read as one line.
 */
function logicalLines(text) {
  const lines = [];
  let current = "";

  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (current !== "") current += " ";
    if (line.endsWith("\\")) {
      current += line.slice(0, -1).trim();
      continue;
    }
    current += line;
    lines.push(current);
    current = "";
  }

  if (current !== "") lines.push(current);
  return lines;
}

/**
 * The commands of one line. A shell line holds several commands, split by the
 * operators that end a command. The quotes of a token are stripped, so a
 * quoted value stays one token.
 */
function shellCommands(line) {
  const commands = [];
  let tokens = [];
  let current = "";
  let quote = null;
  let started = false;

  const flush = () => {
    if (!started) return;
    tokens.push(current);
    current = "";
    started = false;
  };
  const end = () => {
    flush();
    commands.push(tokens);
    tokens = [];
  };

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }

    if (character === "\\" && index + 1 < line.length) {
      current += line[index + 1];
      started = true;
      index += 1;
      continue;
    }

    if (character === "&" || character === "|" || character === ";") {
      if (line[index + 1] === character) index += 1;
      end();
      continue;
    }

    if (/\s/.test(character)) {
      flush();
      continue;
    }

    current += character;
    started = true;
  }

  end();
  return commands;
}

/**
 * The command a segment runs, with the wrapper in front of it removed. An
 * interpreter runs a script, so the script is the command.
 */
function effectiveCommand(tokens) {
  let index = 0;

  while (index < tokens.length) {
    const head = tokens[index];
    if (COMMAND_WRAPPERS.has(head)) {
      index += 1;
      continue;
    }
    const pair = tokens.slice(index, index + 2).join(" ");
    if (COMMAND_WRAPPER_PREFIXES.includes(pair)) {
      index += 2;
      continue;
    }
    break;
  }

  const head = tokens[index];
  if (head !== undefined && INTERPRETERS.has(head)) {
    return { script: tokens[index + 1], tokens: tokens.slice(index + 2) };
  }
  return { script: undefined, tokens: tokens.slice(index) };
}

/** True when the tokens of a command start with the tokens of the anchor. */
function startsWithTokens(tokens, prefix) {
  if (prefix.length === 0 || prefix > tokens.length) return false;
  return prefix.every((token, index) => tokens[index] === prefix[index]);
}

/**
 * True when a command runs the anchor. The anchor has to be the command
 * itself, not an argument of another command: `echo pnpm verify` prints the
 * command and does not run it.
 */
function commandRunsAnchor(tokens, anchor, anchorTokens) {
  const effective = effectiveCommand(tokens);

  if (effective.script !== undefined) {
    const base = effective.script.split("/").pop();
    if (base === anchor) return true;
    return startsWithTokens([base, ...effective.tokens], anchorTokens);
  }

  return startsWithTokens(effective.tokens, anchorTokens);
}

/** True when a command swallows the failure of the command in front of it. */
function isFailureSwallower(tokens) {
  if (tokens.length === 1) return FAILURE_SWALLOWERS.has(tokens[0]);
  if (tokens.length === 2 && tokens[0] === "exit") return tokens[1] === "0";
  return false;
}

/**
 * True when the run value runs the anchor as a command of its own. A command
 * that ends in `true` swallows the failure of the command in front of it, so
 * the run value does not hold the anchor when one follows it.
 */
function runsCommand(text, anchor) {
  const anchorTokens = anchor
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
  if (anchorTokens.length === 0) return false;

  for (const line of logicalLines(text)) {
    const commands = shellCommands(line);
    if (commands.some((command) => isFailureSwallower(command))) continue;
    if (commands.some((command) => commandRunsAnchor(command, anchor, anchorTokens))) return true;
  }

  return false;
}

/**
 * True when a run value holds the requirement. The first entry of `contains`
 * is the command the run value has to run, so it has to be the executable of
 * the step. The other entries have to appear in the run value.
 */
function runValueHolds(value, requirement) {
  if (typeof value !== "string") return false;
  if (!requirementHolds(value, requirement)) return false;

  const anchor = (requirement.contains ?? [])[0];
  if (anchor === undefined) return true;
  return runsCommand(value, anchor);
}

/**
 * True when a step of a workflow runs the command the requirement names. A
 * step that never runs, because its condition is false, does not hold it.
 */
function stepHolds(step, requirement) {
  if (step === null || typeof step !== "object") return false;
  if (conditionIsFalsy(step.if)) return false;
  return runValueHolds(step[requirement.key], requirement);
}

/** True when the condition of a step can never be true. */
function conditionIsFalsy(condition) {
  if (condition === false) return true;
  if (typeof condition !== "string") return false;
  const trimmed = condition.trim().toLowerCase();
  return trimmed === "false" || trimmed.includes("${{ false }}");
}

function describeRequirement(requirement) {
  const parts = [];
  if (requirement.contains) parts.push(`hold ${requirement.contains.join(", ")}`);
  if (requirement.notContains) parts.push(`hold none of ${requirement.notContains.join(", ")}`);
  return parts.join(" and ");
}

/**
 * The requirement a run value has to meet, read as the command it has to
 * run. The first entry of `contains` is the command, the rest are the words
 * the run value has to hold.
 */
function describeRunRequirement(requirement) {
  const [anchor, ...rest] = requirement.contains ?? [];
  const parts = [`runs ${anchor}`];
  if (rest.length > 0) parts.push(`holds ${rest.join(", ")}`);
  if (requirement.notContains) parts.push(`holds none of ${requirement.notContains.join(", ")}`);
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
      const result = await run(entry.run);
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

/**
 * The artifact a build produced, read from the path the config names. A path
 * that holds a glob is resolved against the tree.
 */
function readArtifact(file) {
  if (!file.includes("*")) {
    const full = path.join(root, file);
    if (!existsSync(full)) return null;
    return readFileSync(full, "utf8");
  }

  const directory = path.join(root, path.dirname(file));
  if (!existsSync(directory)) return null;
  const pattern = new RegExp(
    `^${path.basename(file).replaceAll(".", "\\.").replaceAll("*", ".*")}$`,
  );
  const found = readdirSync(directory)
    .filter((name) => pattern.test(name))
    .sort();
  if (found.length === 0) return null;
  return readFileSync(path.join(directory, found[0]), "utf8");
}

const checks = {
  async command(check) {
    const command = String(check.run ?? "");
    if (isNoopCommand(command)) {
      return {
        ok: false,
        reason: `the criterion proves nothing: \`${command.trim()}\` exits 0 without checking anything`,
      };
    }
    const script = packageScriptBody(expand(command));
    if (script && isNoopBody(script.body)) {
      return {
        ok: false,
        reason: `the criterion proves nothing: the script ${script.name} only prints, it runs nothing`,
      };
    }
    const result = await run(command);
    if (result.code !== 0) {
      return {
        ok: false,
        reason: `\`${expand(command)}\` exited ${result.code}`,
        detail: tail(result.output),
      };
    }
    if (check.contains && !result.output.includes(check.contains)) {
      return {
        ok: false,
        reason: `\`${expand(command)}\` did not print ${check.contains}`,
        detail: tail(result.output),
      };
    }
    return { ok: true };
  },

  /**
   * Runs the end to end command of the repository. The app has to work when
   * something drives it, and a command that only prints proves nothing.
   */
  async behavioral(check) {
    const command = String(check.run ?? "");
    if (isNoopCommand(command)) {
      return {
        ok: false,
        reason: `the criterion proves nothing: \`${command.trim()}\` exits 0 without driving the app`,
      };
    }
    const script = packageScriptBody(expand(command));
    if (script && isNoopBody(script.body)) {
      return {
        ok: false,
        reason: `the criterion proves nothing: the script ${script.name} only prints, it drives nothing`,
      };
    }
    const result = await run(command);
    if (result.code !== 0) {
      return {
        ok: false,
        reason: `the end to end command \`${expand(command)}\` exited ${result.code}`,
        detail: tail(result.output, 12),
      };
    }
    if (check.contains && !result.output.includes(check.contains)) {
      return {
        ok: false,
        reason: `the end to end command \`${expand(command)}\` did not print ${check.contains}`,
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

  async node(check) {
    // The scratch file lives outside the tree, and it is removed when the
    // check ends, so the check leaves nothing behind anywhere.
    const directory = mkdtempSync(path.join(tmpdir(), "harness-"));
    const file = path.join(directory, "check.mjs");
    try {
      writeFileSync(file, check.script);
      const result = await run(`node ${file}`);
      if (result.code !== 0) {
        return {
          ok: false,
          reason: `the node check exited ${result.code}`,
          detail: tail(result.output),
        };
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
   * Runs the linter against a probe file that breaks each named rule and
   * asserts the linter failed with that rule. The probe is registered in the
   * journal before it is written, so a run that is killed between the write
   * and the restore leaves a record that the next run uses to put the tree
   * back.
   */
  async lintRules(check) {
    const problems = [];
    const probes = check.rules ?? [];

    if (probes.length === 0) {
      return { ok: false, reason: "the check names no rule to prove" };
    }

    for (const probe of probes) {
      const target = path.join(root, probe.path);
      const existed = existsSync(target);
      const content = existed ? readFileSync(target, "utf8") : null;

      pendingFiles.push({ path: target, existed, content });
      for (const directory of directoriesFor(probe.path)) {
        mkdirSync(directory, { recursive: true });
        pendingDirectories.add(directory);
      }
      writeJournal();

      try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, probe.content ?? "");

        const command = probe.run ?? check.run;
        if (!command) {
          problems.push(`${probe.name}: the probe names no command that runs the linter`);
          continue;
        }
        const result = await run(command);
        if (result.code === 0) {
          problems.push(`${probe.name}: the linter exited 0 on a file that breaks ${probe.rule}`);
          continue;
        }
        if (!result.output.includes(probe.rule)) {
          problems.push(
            `${probe.name}: the linter did not report ${probe.rule}, it reported:\n${tail(result.output, 8)}`,
          );
        }
      } finally {
        restoreTree();
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `${problems.length} rules do not bite`,
        detail: problems.join("\n"),
      };
    }
    return { ok: true };
  },

  /**
   * Reads the structure of a YAML file and asserts what must be in it. A
   * command that was deleted fails the check even when its key survives, and a
   * step that only mentions a command fails it too: the command has to be the
   * executable of the step.
   */
  yamlStructure(check) {
    if (!existsSync(check.path)) return { ok: false, reason: `${check.path} is missing` };

    let document;
    try {
      document = parseYamlText(readFileSync(check.path, "utf8"));
    } catch (error) {
      return {
        ok: false,
        reason: `${check.path} is not valid YAML`,
        detail: error.message,
      };
    }

    const problems = [];

    for (const requirement of check.require ?? []) {
      const node = readPath(document, requirement.path);
      if (node === undefined) {
        problems.push(`${requirement.path} is missing from ${check.path}`);
        continue;
      }

      if (requirement.key === undefined) {
        const holds = isRunRequirement(requirement)
          ? runValueHolds(node, requirement)
          : requirementHolds(node, requirement);
        if (!holds) {
          problems.push(
            isRunRequirement(requirement)
              ? `the run value of ${requirement.path} in ${check.path} ${describeRunRequirement(requirement)}`
              : `${requirement.path} in ${check.path} does not ${describeRequirement(requirement)}`,
          );
        }
        continue;
      }

      const elements = Array.isArray(node) ? node : [node];
      const found = elements.some((element) => stepHolds(element, requirement));
      if (!found) {
        problems.push(
          isRunRequirement(requirement)
            ? `no "${requirement.key}" in ${requirement.path} of ${check.path} ${describeRunRequirement(requirement)}`
            : `no "${requirement.key}" in ${requirement.path} of ${check.path} does ${describeRequirement(requirement)}`,
        );
        const values = elements
          .map((element) =>
            element !== null && typeof element === "object" ? element[requirement.key] : undefined,
          )
          .filter((value) => typeof value === "string")
          .map((value) => JSON.stringify(value));
        if (values.length > 0) {
          problems.push(
            `the "${requirement.key}" values of ${requirement.path} are ${values.join(", ")}`,
          );
        }
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

  /**
   * Asserts the built artifact holds what the sources imply. The build
   * command runs first, so a stale artifact cannot pass the check.
   */
  async artifactContains(check) {
    if (check.build) {
      if (isNoopCommand(check.build)) {
        return {
          ok: false,
          reason: `the criterion proves nothing: \`${check.build.trim()}\` exits 0 without building anything`,
        };
      }
      const script = packageScriptBody(expand(check.build));
      if (script && isNoopBody(script.body)) {
        return {
          ok: false,
          reason: `the criterion proves nothing: the script ${script.name} only prints, it builds nothing`,
        };
      }
      const built = await run(check.build);
      if (built.code !== 0) {
        return {
          ok: false,
          reason: `the build command \`${expand(check.build)}\` exited ${built.code}`,
          detail: tail(built.output, 10),
        };
      }
    }

    const content = readArtifact(check.artifact);
    if (content === null) {
      return {
        ok: false,
        reason: `${check.artifact} is missing, the build did not produce it`,
      };
    }

    const missing = (check.contains ?? []).filter((needle) => !content.includes(needle));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `${check.artifact} does not hold: ${missing.join(", ")}`,
      };
    }
    return { ok: true };
  },

  /**
   * Compares a set of names against a set the harness holds. The set lives in
   * this file, so editing the config alone cannot weaken the gate. A missing
   * member, a renamed member and a duplicated member all fail.
   */
  async exactSet(check) {
    const set = BUILTIN_SETS[check.set];
    if (!set) {
      return {
        ok: false,
        reason: `the set ${check.set} is not one the harness holds: ${Object.keys(BUILTIN_SETS).join(", ")}`,
      };
    }

    const members = membersOf(check.set);
    if (members === null) return { ok: false, reason: `the set ${check.set} holds no members` };

    const counts = new Map();
    for (const member of members) counts.set(member, (counts.get(member) ?? 0) + 1);

    const missing = set.filter((member) => !counts.has(member));
    const unexpected = members.filter((member) => !set.includes(member));
    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([member]) => member);

    const problems = [];
    if (missing.length > 0) problems.push(`missing: ${missing.join(", ")}`);
    if (unexpected.length > 0) problems.push(`not one the harness holds: ${unexpected.join(", ")}`);
    if (duplicated.length > 0) problems.push(`duplicated: ${duplicated.join(", ")}`);

    if (check.set === "proofs") {
      const floor = config.minimumProofs;
      if (!Number.isInteger(floor) || floor < 1) {
        problems.push(`minimumProofs is ${floor}, it must be a whole number of at least 1`);
      } else if (floor !== set.length) {
        problems.push(`minimumProofs is ${floor}, the harness holds ${set.length} proof cases`);
      }
    }

    if (problems.length > 0) {
      return {
        ok: false,
        reason: `the ${check.set} set does not hold what the harness holds`,
        detail: problems.join("\n"),
      };
    }

    if (check.run) {
      const result = await run(check.run, { env: check.env });
      if (result.code !== 0) {
        return {
          ok: false,
          reason: `\`${expand(check.run)}\` exited ${result.code}`,
          detail: tail(result.output, 20),
        };
      }
      if (check.contains && !result.output.includes(check.contains)) {
        return {
          ok: false,
          reason: `\`${expand(check.run)}\` did not print ${check.contains}`,
          detail: tail(result.output, 20),
        };
      }
    }

    return { ok: true };
  },
};

/**
 * The sets the harness holds. A set lives in this file, so the config alone
 * cannot change it.
 */
const BUILTIN_SETS = {
  criteria: EXPECTED_CRITERION_IDS,
  proofs: EXPECTED_PROOF_NAMES,
};

function membersOf(set) {
  if (set === "criteria") {
    return criteria.map((criterion) => criterion.id ?? criterion.check?.type ?? "criterion");
  }
  if (set === "proofs") {
    return (config.proofs ?? []).map((proof) => proof.name);
  }
  return null;
}

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

/**
 * The directories a file needs, in the order they have to be made.
 */
function directoriesFor(file) {
  const missing = [];
  let current = path.dirname(path.join(root, file));
  while (current.startsWith(root) && !existsSync(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  return missing.reverse();
}

const selected = only
  ? criteria.filter((criterion) => (criterion.id ?? criterion.check?.type) === only)
  : criteria;

if (only && selected.length === 0 && !GATE_NAMES.includes(only)) {
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

  if (check.type === "command" || check.type === "behavioral" || check.type === "exactSet") {
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

  if (check.type === "artifactContains") {
    const build = String(check.build ?? "").trim();
    if (build === "") {
      problems.push(`${id} builds nothing`);
    } else if (isNoopCommand(build)) {
      problems.push(`${id} builds \`${build}\`, which exits 0 and proves nothing`);
    }
    if (expected.build !== undefined && expand(build) !== expand(expected.build)) {
      problems.push(`${id} builds \`${build}\`, the harness expects \`${expand(expected.build)}\``);
    }
  }

  return problems;
}

let passed = 0;
let failed = 0;

const startedAt = process.hrtime.bigint();

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

/**
 * The criteria list is a set, not a count. A criterion that is deleted,
 * renamed or duplicated fails the score, and the floor in the config must
 * match the set the harness holds, so that lowering the floor does not make a
 * broken score look clean.
 */
const ids = criteria.map((criterion) => criterion.id ?? criterion.check?.type ?? "criterion");
const counts = new Map();
for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

const missing = EXPECTED_CRITERION_IDS.filter((id) => !counts.has(id));
const unexpected = ids.filter((id) => !EXPECTED_CRITERION_IDS.includes(id));
const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);

const minimum = config.minimumCriteria ?? EXPECTED_CRITERION_IDS.length;
const coverage = [];
if (missing.length > 0) coverage.push(`the criteria ${missing.join(", ")} are missing`);
if (unexpected.length > 0) {
  coverage.push(`the criteria ${unexpected.join(", ")} are not one the harness holds`);
}
if (duplicated.length > 0)
  coverage.push(`the criteria ${duplicated.join(", ")} appear more than once`);
if (minimum !== EXPECTED_CRITERION_IDS.length) {
  coverage.push(
    `minimumCriteria is ${minimum}, the harness holds ${EXPECTED_CRITERION_IDS.length} criteria`,
  );
}
if (criteria.length !== EXPECTED_CRITERION_IDS.length) {
  coverage.push(
    `the harness scores ${criteria.length} criteria, the harness holds ${EXPECTED_CRITERION_IDS.length}`,
  );
}

if (coverage.length > 0) {
  console.log("FAIL  coverage  the harness scores the criteria it must hold");
  for (const problem of coverage) console.log(`      ${problem}`);
  failed += 1;
} else {
  // The coverage check is a gate on the criteria list, not a criterion of its
  // own, so it is reported separately and never inflates the score.
  console.log(`PASS  coverage  the harness scores ${criteria.length} criteria`);
}

/**
 * The scorer and the prover must hold the same proof set, and the floor on
 * the proof set must match it, or one of them holds a gate the other does
 * not.
 */
{
  const proverPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "prove-guardrails.mjs",
  );
  const problems = [];

  if (!existsSync(proverPath)) {
    problems.push("the prover is missing, scripts/prove-guardrails.mjs must hold the proof set");
  } else {
    const proverSource = readFileSync(proverPath, "utf8");
    const drift = EXPECTED_PROOF_NAMES.filter((name) => !proverSource.includes(`"${name}"`));
    if (drift.length > 0) {
      problems.push(
        `the prover does not hold: ${drift.join(", ")}. Both files must hold the same proof set.`,
      );
    }
  }

  const floor = config.minimumProofs;
  if (!Number.isInteger(floor) || floor < 1) {
    problems.push(`minimumProofs is ${floor}, it must be a whole number of at least 1`);
  } else if (floor !== EXPECTED_PROOF_NAMES.length) {
    problems.push(
      `minimumProofs is ${floor}, the harness holds ${EXPECTED_PROOF_NAMES.length} proof cases`,
    );
  }

  const configured = (config.proofs ?? []).map((proof) => proof.name);
  const configuredCounts = new Map();
  for (const name of configured) configuredCounts.set(name, (configuredCounts.get(name) ?? 0) + 1);
  const configMissing = EXPECTED_PROOF_NAMES.filter((name) => !configuredCounts.has(name));
  const configUnexpected = configured.filter((name) => !EXPECTED_PROOF_NAMES.includes(name));
  const configDuplicated = [...configuredCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  const setProblems = [];
  if (configMissing.length > 0) setProblems.push(`missing: ${configMissing.join(", ")}`);
  if (configUnexpected.length > 0) {
    setProblems.push(`not one the harness holds: ${configUnexpected.join(", ")}`);
  }
  if (configDuplicated.length > 0) {
    setProblems.push(`duplicated: ${configDuplicated.join(", ")}`);
  }
  if (setProblems.length > 0) {
    problems.push("the proofs set does not hold what the harness holds");
    for (const problem of setProblems) problems.push(problem);
  }

  if (problems.length > 0) {
    console.log("FAIL  proof-set  the scorer and the prover disagree");
    for (const problem of problems) console.log(`      ${problem}`);
    failed += 1;
  } else {
    console.log(
      `PASS  proof-set  the scorer and the prover hold the same set of ${EXPECTED_PROOF_NAMES.length} proofs`,
    );
  }
}

const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
const ceiling = config.maxHarnessSeconds ?? 1800;
console.log(`harness: ${seconds.toFixed(1)}s runtime, the ceiling is ${ceiling}s`);
if (seconds > ceiling) {
  console.log(`FAIL  runtime  the harness took ${seconds.toFixed(1)}s, the ceiling is ${ceiling}s`);
  failed += 1;
}

if (Array.isArray(config.notes) && config.notes.length > 0 && !only) {
  console.log("\nharness notes:");
  for (const note of config.notes) console.log(`  - ${note}`);
}

console.log(`\nharness: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
