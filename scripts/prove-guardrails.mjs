#!/usr/bin/env node
/**
 * Proves the guardrails bite.
 *
 * Each case writes a file that breaks one rule, runs the checker that owns
 * that rule, and asserts the checker failed with the expected message. Every
 * probe file is restored or removed afterwards, on every exit path: a normal
 * run, a thrown error, an interrupt, a termination. A violation that is not
 * caught fails the script.
 *
 * A case may also require the checker to pass (`exit: "zero"`). Those cases
 * prove that a guardrail still holds, for example that a workspace alias
 * resolves to a real entry point.
 *
 * Only one run may own a tree at a time. The run takes an exclusive lock
 * before it touches the tree, so two overlapping runs cannot fight over the
 * same probe files, and the run that waits never leaves a probe behind.
 *
 * The script never passes while proving nothing. The proof set must hold the
 * exact cases the harness holds, a case that is deleted, renamed or duplicated
 * fails the run, and `minimumProofs` must match that set. The set lives in
 * this file and the floor lives in `harness.config.json`, so the scorer and
 * the prover can never disagree about it and editing the config alone cannot
 * weaken the gate.
 *
 * The tree of the run is the tree that owns this script, not the directory the
 * command was started from. A run started from the wrong directory would
 * otherwise write its probe files into another checkout.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
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
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] ?? scriptRoot);
process.chdir(root);

const configPath = process.env.HARNESS_CONFIG ?? "harness.config.json";

if (!existsSync(configPath)) {
  console.error(`prove: ${configPath} is missing`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const packageManager = config.packageManager ?? "pnpm";
const execCommand = config.commands?.exec ?? `${packageManager} exec`;
const alias = config.layers?.data?.alias ?? "@/db";
const proofs = Array.isArray(config.proofs) ? config.proofs : [];
const minimumProofs = config.minimumProofs;

/**
 * The proof cases the harness holds. The list lives in this file, not only in
 * `harness.config.json`, so that editing the config alone cannot weaken the
 * gate: a proof case that is deleted, renamed or duplicated fails the run.
 *
 * Adding a proof case is allowed. It is a deliberate act of editing this
 * list and of raising `minimumProofs` in the same commit.
 */
const EXPECTED_PROOF_NAMES = [
  "a workspace package imports the Tauri API",
  "a workspace package imports the desktop app",
  "a workspace package imports the desktop app by its package name",
  "the source tree carries an inline lint config",
  "the source tree carries a ts-expect-error",
  "the source tree carries a skipped test",
  "the source tree parses raw JSON",
  "a component hardcodes a color",
  "a component hardcodes a named color",
  "the workspace ui alias resolves to its entry point",
  "a component hardcodes a Tailwind default-palette utility",
  "a component hardcodes a modern color function",
  "a component hardcodes a bare channel triplet",
  "a stylesheet outside the old scan bounds is scanned",
  "a color literal inside the token package is allowed",
  "a workspace package reaches the desktop app with a dynamic import",
  "a workspace package reaches the desktop app with require",
  "the webview bundle reads a key from the environment",
  "the webview stores a key in browser storage",
  "the webview logs a key",
  "one file imports two state tiers",
  "a file reaches a state tier with a computed import",
  "a file reaches a state tier with a computed require",
  "the local gate criterion fails when the hook commands lose their run lines",
  "the ci criterion fails when the workflow stops running the harness",
  "the escape hatch criterion fails when the rules are switched off",
  "the ratchet criterion fails when the procedure is deleted",
  "the mistake log criterion fails when the rows are deleted",
  "a workspace package reaches the desktop app with a computed import",
  "a workspace package reaches the desktop app with a template import",
  "the entry point criterion fails when the compiler options lose their strictness",
  "the entry point criterion fails when the browser smoke spec is gutted",
  "the entry point criterion fails when a rule names an unrelated path",
  "the coverage criterion fails when a criterion is deleted and another is duplicated",
  "the prover fails when a proof case is deleted and another is duplicated",
  "the harness fails when a command criterion runs a no-op",
  "the tailwind build scans the shared ui package",
  "a file with no state tier owns a computed import",
  "the prover refuses a second run while the lock is held",
  "the store test that skips the reset is caught",
  "the shell content padding that leaves eight pixels is caught",
  "the ci criterion fails when the workflow stops running the end to end suite",
  "the ci criterion fails when the verify step only echoes the command",
  "the ci criterion fails when the verify step swallows the failure",
  "the ci criterion fails when the verify step is commented out",
  "the local gate criterion fails when the lint command is only a comment",
  "the extensions prop that is dropped after the mount is caught",
  "a content change that loses the caret is caught",
  "the active line case fails when the active line is not painted",
  "the delete confirmation of a dirty file is caught",
  "the theme cascade of the editor settings is caught",
  "the behavioral criterion fails when the end to end command only prints",
  "the artifact criterion fails when the build output misses the source",
  "the second toolchain criterion fails when the rust gate only prints",
  "the scorer refuses a second run while the tree lock is held",
  "the harness fails when it takes longer than the ceiling",
  "the next run restores the probe file of a run that was killed",
  "the command registry that grew an action without a spy for it is caught",
  "the dialog permission lives in a capability of its own",
];

if (!Number.isInteger(minimumProofs) || minimumProofs < 1) {
  console.error(`prove: ${configPath} must set minimumProofs to a whole number of at least 1`);
  process.exit(1);
}

if (minimumProofs !== EXPECTED_PROOF_NAMES.length) {
  console.error(
    `prove: minimumProofs is ${minimumProofs}, the harness holds ${EXPECTED_PROOF_NAMES.length} proof cases`,
  );
  process.exit(1);
}

const names = proofs.map((proof) => proof.name);
const nameCounts = new Map();
for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);

const missingNames = EXPECTED_PROOF_NAMES.filter((name) => !nameCounts.has(name));
const unexpectedNames = names.filter((name) => !EXPECTED_PROOF_NAMES.includes(name));
const duplicatedNames = [...nameCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([name]) => name);

if (missingNames.length > 0 || unexpectedNames.length > 0 || duplicatedNames.length > 0) {
  console.error("prove: the proof set does not hold the cases the harness holds");
  if (missingNames.length > 0) console.error(`  missing: ${missingNames.join(", ")}`);
  if (unexpectedNames.length > 0) console.error(`  unexpected: ${unexpectedNames.join(", ")}`);
  if (duplicatedNames.length > 0) console.error(`  duplicated: ${duplicatedNames.join(", ")}`);
  process.exit(1);
}

if (proofs.length < minimumProofs) {
  console.error(
    `prove: the proof set holds ${proofs.length} cases, at least ${minimumProofs} are required`,
  );
  process.exit(1);
}

function expand(text, probe) {
  return String(text)
    .replaceAll("${PM}", packageManager)
    .replaceAll("${PM_EXEC}", execCommand)
    .replaceAll("${DATA_ALIAS}", alias)
    .replaceAll("${PROOF_COUNT}", String(EXPECTED_PROOF_NAMES.length))
    .replaceAll("${TREE_ROOT}", root)
    .replaceAll("${TREE_HASH}", treeHash)
    .replaceAll("${PROBE}", probe ?? "");
}

/**
 * The checker runs in a child process without blocking the event loop. A
 * blocking call would swallow the interrupt that stops this script, which is
 * the one signal the operator can always send.
 */
let runningChild = null;

function run(command, probe) {
  return new Promise((resolve) => {
    const child = spawn(expand(command, probe), {
      shell: true,
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The children of this run run against the same tree, so they are
        // told that the tree is owned and must not take the lock again.
        HARNESS_TREE_LOCK_OWNER: String(lockOwnerPid ?? process.pid),
      },
    });
    runningChild = child;

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      if (runningChild === child) runningChild = null;
      resolve({ code: 1, output: `${output}${error.message}`.trim() });
    });
    child.on("close", (code) => {
      if (runningChild === child) runningChild = null;
      resolve({ code: typeof code === "number" ? code : 1, output: output.trim() });
    });
  });
}

function directoriesFor(file) {
  const missing = [];
  // A path outside the tree has its directories already, and the tree must
  // not grow a directory for it.
  if (path.isAbsolute(file)) return missing;
  let current = path.dirname(path.join(root, file));
  while (current.startsWith(root) && !existsSync(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  return missing.reverse();
}

/**
 * The journal holds the state of the files the runner is about to overwrite.
 * It lives outside the tree, so a run that is killed outright still leaves a
 * record that the next run restores.
 *
 * The name of the journal holds the pid of the run that wrote it, so two runs
 * that are killed in the same tree leave two journals and neither of them
 * loses the record of the other. The next run restores every journal of the
 * tree and removes them.
 */
const treeHash = createHash("sha256").update(root).digest("hex").slice(0, 12);
const journalPrefix = `arrow-prove-journal-${treeHash}-`;
const journalPath = path.join(os.tmpdir(), `${journalPrefix}${process.pid}.json`);

/**
 * The journals of this tree that a killed run left behind.
 *
 * The journal of a run that is still alive belongs to that run, and a run
 * that repairs the tree must not touch the files that run is holding. Only
 * the journals of runs that are gone are repaired.
 */
function journalPaths() {
  const prefixes = [journalPrefix, `arrow-harness-tree-journal-${treeHash}-`];
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

/**
 * The lock of the run.
 *
 * Two runs of the prover on one tree fight over the same probe files and the
 * same journal, and the loser leaves a probe behind in the tree, which then
 * fails the format check. The lock makes the tree the resource of one run:
 * the second run waits for the first to finish and refuses when the wait
 * runs out.
 *
 * The lock lives outside the tree, so a run that was killed outright cannot
 * leave it in the repository. A lock whose owner is gone is broken, so a
 * killed run never blocks the next one.
 *
 * The path may be set with `PROVE_LOCK_PATH`, so a proof case can hold the
 * lock of a tree on purpose. A run uses one lock per tree.
 */
const lockPath = resolveLockPath();

function resolveLockPath() {
  const override = process.env.PROVE_LOCK_PATH;
  if (!override) {
    // The lock is the lock of the tree, and the scorer of the harness holds
    // the same one. A score and a proof run on one tree cannot interleave,
    // so a run never reads a tree that a probe has half replaced.
    return path.join(
      os.tmpdir(),
      `arrow-harness-tree-lock-${createHash("sha256").update(root).digest("hex").slice(0, 12)}.lock`,
    );
  }
  return path.isAbsolute(override) ? override : path.join(root, override);
}

/** The milliseconds a run waits for the lock before it refuses to run. */
const lockWaitMs = Number(process.env.PROVE_LOCK_WAIT_MS ?? 30_000);

/** The milliseconds after which a lock without a readable owner is stale. */
const lockStaleMs = Number(process.env.PROVE_LOCK_STALE_MS ?? 60_000);

/** Sleeps without blocking the event loop for longer than it has to. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * True when the lock belongs to a process that is gone.
 *
 * A run that was killed outright leaves its lock behind. The lock of a live
 * process is never broken, and a lock that cannot be read is only broken
 * when it is older than every run can take.
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
 * The pid that already owns the lock of this tree, when an ancestor of this
 * run owns it.
 *
 * The scorer of the harness runs the prover inside the score, so the child
 * prover is told that the tree is already owned. The two do not wait for each
 * other, and a proof run that a score runs cannot fight over the probe files.
 */
function inheritedLockOwner() {
  // A run that names a lock of its own must take that lock, even when an
  // ancestor owns the tree. A case that proves the refusal of a second run
  // names the lock on purpose, and a run that skipped it would write probe
  // files into the tree of the run that holds it.
  if (process.env.PROVE_LOCK_PATH) return null;
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
 * Takes the lock of the tree.
 *
 * The lock is created with the exclusive flag, so exactly one run can hold
 * it. A second run waits for the first to finish. A lock whose owner is gone
 * is broken by renaming it, which only one run can win, so two runs can never
 * break the same lock and enter the tree together.
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
 * Releases the lock of the run.
 *
 * Only the owner releases the lock, so a run that lost the lock to a broken
 * stale lock never removes the lock of the run that holds it now.
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
 * Restores every file the runner touched and removes every directory it made.
 * It is safe to call twice, and it is called on every exit path.
 */
function restoreTree() {
  for (const entry of [...pendingFiles].reverse()) {
    try {
      if (entry.existed) writeFileSync(entry.path, entry.content);
      else rmSync(entry.path, { force: true });
    } catch (error) {
      console.error(`prove: could not restore ${entry.path}: ${error.message}`);
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
          `prove: restored ${stale.pendingFiles.length} probe file(s) left behind by an earlier run`,
        );
      }
    } catch (error) {
      console.error(`prove: could not read the probe journal: ${error.message}`);
    }

    rmSync(file, { force: true });
  }
}

function onSignal(signal) {
  if (runningChild) {
    runningChild.kill("SIGKILL");
    runningChild = null;
  }
  restoreTree();
  releaseLock();
  console.error(`\nprove: ${signal} received, the tree was restored`);
  process.exit(128 + (os.constants.signals[signal] ?? 0));
}

/**
 * The run owns the tree before it touches it.
 *
 * The lock is taken before the stale probes are repaired, so two runs can
 * never repair the same probe at the same time.
 *
 * A run that an ancestor of it owns the tree for does not take the lock a
 * second time. The scorer of the harness runs the prover inside the score,
 * and the two must not wait for each other.
 */
const inheritedOwner = inheritedLockOwner();

if (inheritedOwner !== null) {
  lockOwnerPid = inheritedOwner;
} else {
  if (!acquireLock()) {
    console.error(
      `prove: another run holds the lock of this tree and did not finish within ${lockWaitMs} ms: ${describeLockHolder()}`,
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

let caught = 0;
let missed = 0;

for (const proof of proofs) {
  const writes = proof.write ?? [];
  const probe = writes[0]?.path ?? "";

  try {
    for (const write of writes) {
      // A write path is inside the tree unless it names an absolute path. The
      // journal of a killed run lives outside the tree, and a case has to be
      // able to write one to prove that the next run repairs the tree.
      const writePath = expand(write.path, write.path);
      const target = path.isAbsolute(writePath) ? writePath : path.join(root, writePath);
      const existed = existsSync(target);
      pendingFiles.push({
        path: target,
        existed,
        content: existed ? readFileSync(target, "utf8") : "",
      });
      for (const directory of directoriesFor(writePath)) {
        mkdirSync(directory, { recursive: true });
        pendingDirectories.add(directory);
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, expand(write.content, write.path));
    }
    writeJournal();

    const expectation = proof.expect ?? {};
    const result = await run(expectation.run, probe);
    const expectedExit = expectation.exit ?? "nonzero";

    if (expectedExit !== "nonzero" && expectedExit !== "zero") {
      console.log(`FAIL ${proof.name}: the expectation names an unknown exit: ${expectedExit}`);
      missed += 1;
      continue;
    }
    if (expectedExit === "nonzero" && result.code === 0) {
      console.log(`FAIL ${proof.name}: the checker exited 0, so the violation was not caught`);
      missed += 1;
      continue;
    }
    if (expectedExit === "zero" && result.code !== 0) {
      console.log(
        `FAIL ${proof.name}: the checker exited ${result.code}, it was expected to pass\n${result.output}`,
      );
      missed += 1;
      continue;
    }
    if (expectation.contains && !result.output.includes(expectation.contains)) {
      console.log(
        `FAIL ${proof.name}: expected ${expectation.contains} in the output, got:\n${result.output}`,
      );
      missed += 1;
      continue;
    }

    const detail =
      expectedExit === "zero"
        ? "the guardrail still holds"
        : `caught by ${expectation.contains ?? "the checker"}`;
    console.log(`PASS ${proof.name}: ${detail}`);
    caught += 1;
  } finally {
    restoreTree();
  }
}

console.log(`\nprove: ${caught} caught, ${missed} missed`);

if (missed > 0) process.exit(1);

if (caught < minimumProofs) {
  console.error(`prove: only ${caught} proofs ran, at least ${minimumProofs} must run`);
  process.exit(1);
}
