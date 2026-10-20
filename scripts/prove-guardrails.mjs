#!/usr/bin/env node
/**
 * Proves the guardrails bite.
 *
 * Each case writes a file that breaks one rule, runs the checker that owns
 * that rule, and asserts the checker failed with the expected message. Every
 * probe file is restored or removed afterwards. A violation that is not caught
 * fails the script.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function expand(text, probe) {
  return String(text)
    .replaceAll("${PM}", packageManager)
    .replaceAll("${PM_EXEC}", execCommand)
    .replaceAll("${DATA_ALIAS}", alias)
    .replaceAll("${PROBE}", probe ?? "");
}

function run(command, probe) {
  try {
    const stdout = execSync(expand(command, probe), {
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

function directoriesFor(file) {
  const missing = [];
  let current = path.dirname(path.join(root, file));
  while (current.startsWith(root) && !existsSync(current)) {
    missing.push(current);
    current = path.dirname(current);
  }
  return missing.reverse();
}

let caught = 0;
let missed = 0;

for (const proof of proofs) {
  const writes = proof.write ?? [];
  const probe = writes[0]?.path ?? "";
  const backups = [];
  const createdDirectories = new Set();

  for (const write of writes) {
    const target = path.join(root, write.path);
    if (existsSync(target)) {
      backups.push({ path: target, content: readFileSync(target, "utf8") });
    }
    for (const directory of directoriesFor(write.path)) {
      mkdirSync(directory, { recursive: true });
      createdDirectories.add(directory);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, expand(write.content, write.path));
  }

  const expectation = proof.expect ?? {};
  const result = run(expectation.run, probe);

  for (const write of writes) {
    const target = path.join(root, write.path);
    const backup = backups.find((item) => item.path === target);
    if (backup) writeFileSync(target, backup.content);
    else rmSync(target, { force: true });
  }
  for (const directory of [...createdDirectories].reverse()) {
    rmSync(directory, { recursive: true, force: true });
  }

  const wantsFailure = (expectation.exit ?? "nonzero") === "nonzero";
  if (wantsFailure && result.code === 0) {
    console.log(`FAIL ${proof.name}: the checker exited 0, so the violation was not caught`);
    missed += 1;
    continue;
  }
  if (!wantsFailure && result.code !== 0) {
    console.log(`FAIL ${proof.name}: the checker exited ${result.code}, it was expected to pass`);
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

  console.log(`PASS ${proof.name}: caught by ${expectation.contains ?? "the checker"}`);
  caught += 1;
}

console.log(`\nprove: ${caught} caught, ${missed} missed`);

if (missed > 0) process.exit(1);
