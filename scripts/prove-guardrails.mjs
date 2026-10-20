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
 * The script never passes while proving nothing. The proof set must hold at
 * least `minimumProofs` cases, and at least that many must run and be caught.
 * The floor lives in `harness.config.json`, so the scorer and the prover can
 * never disagree about it.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
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

if (!Number.isInteger(minimumProofs) || minimumProofs < 1) {
  console.error(`prove: ${configPath} must set minimumProofs to a whole number of at least 1`);
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
 */
const journalPath = path.join(
  os.tmpdir(),
  `arrow-prove-journal-${createHash("sha256").update(root).digest("hex").slice(0, 12)}.json`,
);

let pendingFiles = [];
let pendingDirectories = new Set();

function writeJournal() {
  try {
    writeFileSync(journalPath, JSON.stringify({ root, pendingFiles }, null, 2));
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

  rmSync(journalPath, { force: true });
}

/**
 * A run that was killed outright cannot clean up after itself. The journal it
 * left behind holds the content of every file it overwrote, so the next run
 * puts the tree back before it writes anything of its own.
 */
function recoverStaleProbes() {
  if (!existsSync(journalPath)) return;

  try {
    const stale = JSON.parse(readFileSync(journalPath, "utf8"));
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

  rmSync(journalPath, { force: true });
}

function onSignal(signal) {
  if (runningChild) {
    runningChild.kill("SIGKILL");
    runningChild = null;
  }
  restoreTree();
  console.error(`\nprove: ${signal} received, the tree was restored`);
  process.exit(128 + (os.constants.signals[signal] ?? 0));
}

recoverStaleProbes();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => onSignal(signal));
}

process.on("exit", restoreTree);

process.on("uncaughtException", (error) => {
  restoreTree();
  console.error(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  restoreTree();
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
      const target = path.join(root, write.path);
      const existed = existsSync(target);
      pendingFiles.push({
        path: target,
        existed,
        content: existed ? readFileSync(target, "utf8") : "",
      });
      for (const directory of directoriesFor(write.path)) {
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
