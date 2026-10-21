#!/usr/bin/env node
/**
 * Proves the harness can fail.
 *
 * The harness is a set of checks. A set of checks that never fails is
 * decoration. This script copies the harness into a scratch tree, breaks the
 * copy seven ways, and asserts the scorer fails on every one of them.
 *
 * The copy is broken in the ways a real change breaks it:
 *
 * - a command criterion runs a command that exits 0 and proves nothing,
 * - a criterion is deleted and another is duplicated, so the count holds,
 * - the proof set is emptied,
 * - a proof case is renamed,
 * - the criteria floor is lowered,
 * - the proof floor is lowered,
 * - a criterion holds a check type the scorer does not know.
 *
 * Every mutation must make the scorer fail, and the failure must name the
 * thing that was broken. The script exits non-zero when a mutation passes.
 *
 * The tree of the run is never touched. The scratch tree holds a copy of the
 * harness, and the copy is what gets broken. The copy is scored against the
 * tree of the repository, so the checks read the real files, and only the
 * configuration of the copy is broken.
 *
 * The run owns the tree while it runs. It takes the same exclusive lock the
 * scorer and the prover take, so a self proof and a score cannot interleave.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] ?? scriptRoot);

const configPath = path.join(root, "harness.config.json");
const scorerPath = path.join(root, "scripts", "harness-score.mjs");
const proverPath = path.join(root, "scripts", "prove-guardrails.mjs");

for (const file of [configPath, scorerPath, proverPath]) {
  if (!existsSync(file)) {
    console.error(`prove-harness: ${file} is missing`);
    process.exit(1);
  }
}

/**
 * The lock of the tree.
 *
 * The lock is the lock of the scorer and of the prover. A self proof that
 * runs while a score runs would read a tree that the score has half
 * replaced, so the two cannot be in the tree at the same time.
 */
const lockPath = path.join(
  os.tmpdir(),
  `arrow-harness-tree-lock-${createHash("sha256").update(root).digest("hex").slice(0, 12)}.lock`,
);

/** The milliseconds a run waits for the lock before it refuses to run. */
const lockWaitMs = Number(process.env.HARNESS_LOCK_WAIT_MS ?? 30_000);

/** The milliseconds after which a lock without a readable owner is stale. */
const lockStaleMs = Number(process.env.HARNESS_LOCK_STALE_MS ?? 60_000);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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

function describeLockHolder() {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    const seconds = Math.max(0, Math.round((Date.now() - (holder.startedAt ?? Date.now())) / 1000));
    return `the run with the pid ${holder.pid}, which has held the lock for ${seconds} seconds`;
  } catch {
    return "a run whose holder cannot be read";
  }
}

function inheritedLockOwner() {
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

function releaseLock() {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    if (holder?.pid !== process.pid) return;
  } catch {
    return;
  }
  rmSync(lockPath, { force: true });
}

const inheritedOwner = inheritedLockOwner();

if (inheritedOwner !== null) {
  // An ancestor of this run owns the tree.
} else if (!acquireLock()) {
  console.error(
    `prove-harness: another run holds the lock of this tree and did not finish within ${lockWaitMs} ms: ${describeLockHolder()}`,
  );
  process.exit(1);
}

process.on("exit", () => releaseLock());

/**
 * The mutations.
 *
 * Each one names the text the failure must hold. The text is what a reader
 * needs to know which break was caught, so a mutation that fails with an
 * unrelated message does not count as caught.
 */
const mutations = [
  {
    name: "a command criterion runs a no-op",
    target: "theme-discipline",
    expect: "exits 0 and proves nothing",
    apply(config) {
      const criterion = config.criteria.find((candidate) => candidate.id === "theme-discipline");
      if (!criterion) throw new Error("the config holds no theme discipline criterion");
      criterion.check.run = "true";
      return `the criterion ${criterion.id} now runs true`;
    },
  },
  {
    name: "a criterion is deleted and another is duplicated",
    target: "coverage",
    expect: "appear more than once",
    apply(config) {
      const deleted = config.criteria.pop();
      const duplicated = config.criteria[0];
      config.criteria.push(JSON.parse(JSON.stringify(duplicated)));
      return `${deleted.id} was deleted and ${duplicated.id} was duplicated`;
    },
  },
  {
    name: "the proof set is emptied",
    target: "proof-set",
    expect: "proofs set",
    apply(config) {
      config.proofs = [];
      return "the proof set holds no case";
    },
  },
  {
    name: "a proof case is renamed",
    target: "proof-set",
    expect: "not one the harness holds",
    apply(config) {
      const proof = config.proofs[0];
      proof.name = `${proof.name} (renamed)`;
      return `the proof ${proof.name} was renamed`;
    },
  },
  {
    name: "the criteria floor is lowered",
    target: "coverage",
    expect: "minimumCriteria is",
    apply(config) {
      const before = config.minimumCriteria;
      config.minimumCriteria = Math.max(1, before - 3);
      return `the criteria floor went from ${before} to ${config.minimumCriteria}`;
    },
  },
  {
    name: "the proof floor is lowered",
    target: "proof-set",
    expect: "minimumProofs is",
    apply(config) {
      const before = config.minimumProofs;
      config.minimumProofs = Math.max(1, before - 6);
      return `the proof floor went from ${before} to ${config.minimumProofs}`;
    },
  },
  {
    name: "a criterion holds an unknown check type",
    target: "theme-discipline",
    expect: "unknown check type",
    apply(config) {
      const criterion = config.criteria.find((candidate) => candidate.id === "theme-discipline");
      criterion.check.type = "vibes";
      return `the criterion ${criterion.id} now holds the check type vibes`;
    },
  },
];

const scratch = mkdtempSync(path.join(tmpdir(), "harness-self-proof-"));
let failed = 0;
let treeCount = 0;

/**
 * Copies the harness into a scratch tree.
 *
 * The copy resolves the dependencies of the repository it came from, because
 * the scorer reads the YAML of a workflow file and the copy must be able to
 * load that parser. The dependency directory is linked into the tree, so the
 * copy holds the same packages as the repository without a second install.
 */
function copyHarness() {
  treeCount += 1;
  const tree = path.join(scratch, `tree-${treeCount}`);
  const scripts = path.join(tree, "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(configPath, path.join(tree, "harness.config.json"));
  copyFileSync(scorerPath, path.join(scripts, "harness-score.mjs"));
  copyFileSync(proverPath, path.join(scripts, "prove-guardrails.mjs"));

  const dependencies = path.join(root, "node_modules");
  if (existsSync(dependencies)) {
    symlinkSync(dependencies, path.join(tree, "node_modules"), "dir");
  }

  return tree;
}

function score(tree, only) {
  const config = path.join(tree, "harness.config.json");
  const scope = only ? ` --only ${only}` : "";
  try {
    const stdout = execSync(
      `node ${path.join(tree, "scripts", "harness-score.mjs")} ${root}${scope}`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        cwd: root,
        env: {
          ...process.env,
          HARNESS_CONFIG: config,
          HARNESS_TREE_LOCK_OWNER: String(process.pid),
        },
      },
    );
    return { code: 0, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return {
      code: typeof error.status === "number" ? error.status : 1,
      output,
    };
  }
}

/**
 * The baseline is the copy the mutations are compared against. It must be
 * green, or a mutation that fails proves nothing: the copy was already
 * broken.
 *
 * The baseline is scored once for every target the mutations use, and the
 * target is a gate or a cheap criterion. A baseline that scored every
 * criterion would run the whole gate again, and the proof of a broken
 * harness does not need a passing whole gate to mean something.
 */
const baselines = new Map();

function baselineFor(target) {
  if (baselines.has(target)) return baselines.get(target);
  const result = score(copyHarness(), target);
  baselines.set(target, result);
  return result;
}

for (const target of new Set(mutations.map((mutation) => mutation.target))) {
  const baseline = baselineFor(target);
  if (baseline.code !== 0) {
    console.error(
      `prove-harness: the unmutated copy of ${target} scored with exit ${baseline.code}, so the mutations prove nothing`,
    );
    for (const line of baseline.output.split("\n").slice(0, 30)) console.error(`  ${line}`);
    console.error(
      "prove-harness: fix the harness until it scores clean, then run the self proof again",
    );
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  }
}

console.log(
  `prove-harness: the unmutated copy scored clean for ${[...baselines.keys()].join(", ")}`,
);

for (const mutation of mutations) {
  const tree = copyHarness();
  const configFile = path.join(tree, "harness.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  let change;
  try {
    change = mutation.apply(config);
  } catch (error) {
    console.log(`FAIL ${mutation.name}: ${error.message}`);
    failed += 1;
    rmSync(tree, { recursive: true, force: true });
    continue;
  }
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  const result = score(tree, mutation.target);
  rmSync(tree, { recursive: true, force: true });

  if (result.code === 0) {
    console.log(`FAIL ${mutation.name}: the scorer still passed, so the harness cannot fail`);
    failed += 1;
    continue;
  }
  if (!result.output.includes(mutation.expect)) {
    console.log(`FAIL ${mutation.name}: the scorer failed without naming ${mutation.expect}`);
    for (const line of result.output.split("\n").slice(0, 20)) console.log(`  ${line}`);
    failed += 1;
    continue;
  }
  const baseline = baselines.get(mutation.target);
  if (baseline.output.includes(mutation.expect)) {
    console.log(
      `FAIL ${mutation.name}: the unmutated copy already held ${mutation.expect}, so the mutation proved nothing`,
    );
    failed += 1;
    continue;
  }

  console.log(`PASS ${mutation.name}: ${change}, and the scorer failed on it`);
}

rmSync(scratch, { recursive: true, force: true });

console.log(
  `\nprove-harness: ${mutations.length - failed} of ${mutations.length} mutations were caught`,
);

if (failed > 0) process.exit(1);
