/**
 * The files that carry the version of the application, and the check that they
 * name the same version.
 *
 * A release is only sane when the tag, the package manifest, the Rust manifest,
 * the Tauri configuration and the lock file of the crate agree. The version
 * lives in five places:
 *
 *   package.json
 *   apps/desktop/package.json
 *   apps/desktop/src-tauri/Cargo.toml
 *   apps/desktop/src-tauri/tauri.conf.json
 *   apps/desktop/src-tauri/Cargo.lock (the entry of the local package)
 *
 * The lock names the local package by the name in the `[package]` table of the
 * manifest, so the two cannot drift apart without this check failing. A lock
 * that is absent is a failure as well: the crate ships its lock, and a check
 * that skipped a missing file would pass on the tree that lost it.
 *
 * `ARROW_VERSION_ROOT` names the directory the check reads, and it defaults to
 * the working directory. A proof case points it at a temporary tree that holds
 * two versions that disagree, so the proof never overwrites a real file.
 *
 * The workspace packages under `packages/` version on their own, so they are
 * not carriers of the application version and this check does not read them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.ARROW_VERSION_ROOT ?? process.cwd());
const cargoManifest = "apps/desktop/src-tauri/Cargo.toml";
const cargoLock = "apps/desktop/src-tauri/Cargo.lock";

/** The version a file must hold, or the reason it holds none. */
function jsonVersion(relative) {
  const source = readFileSync(path.join(root, relative), "utf8");
  let document;
  try {
    document = JSON.parse(source);
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error.message}`);
  }
  return {
    version: document.version,
    problem: typeof document.version === "string" ? null : "names no version",
  };
}

/** The `[package]` table of a Cargo manifest. */
function cargoPackageTable(relative) {
  const source = readFileSync(path.join(root, relative), "utf8");
  return source.match(/^\[package\][\s\S]*?(?=^\[|(?![\s\S]))/m)?.[0] ?? "";
}

/** The `version` of the `[package]` table of a Cargo manifest. */
function cargoVersion(relative) {
  const line = cargoPackageTable(relative).match(/^version\s*=\s*"([^"]+)"/m);
  if (!line) return { version: undefined, problem: "holds no version in its [package] table" };
  return { version: line[1], problem: null };
}

/** The `version` of the local package in the lock file of the crate. */
function cargoLockVersion(relative) {
  const name = cargoPackageTable(cargoManifest).match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!name)
    return { version: undefined, problem: "cannot be checked, the manifest names no package" };

  const source = readFileSync(path.join(root, relative), "utf8");

  for (const block of source.split(/^\[\[package\]\]\r?\n/m)) {
    const blockName = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (blockName !== name) continue;
    const line = block.match(/^version\s*=\s*"([^"]+)"/m);
    if (!line) return { version: undefined, problem: `holds no version for ${name}` };
    return { version: line[1], problem: null };
  }

  return { version: undefined, problem: `holds no package named ${name}` };
}

const carriers = [
  { file: "package.json", read: jsonVersion },
  { file: "apps/desktop/package.json", read: jsonVersion },
  { file: cargoManifest, read: cargoVersion },
  { file: "apps/desktop/src-tauri/tauri.conf.json", read: jsonVersion },
  { file: cargoLock, read: cargoLockVersion },
];

const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const readings = [];
const problems = [];

for (const carrier of carriers) {
  try {
    const { version, problem } = carrier.read(carrier.file);
    if (problem) {
      problems.push(`${carrier.file} ${problem}`);
      continue;
    }
    if (typeof version !== "string" || !versionPattern.test(version)) {
      problems.push(`${carrier.file} says ${JSON.stringify(version)}, which is not a version`);
      continue;
    }
    readings.push({ file: carrier.file, version });
  } catch (error) {
    problems.push(`${carrier.file} cannot be read: ${error.message}`);
  }
}

const versions = new Set(readings.map((reading) => reading.version));
const disagree = readings.length > 1 && versions.size !== 1;

if (problems.length > 0 || disagree) {
  if (problems.length > 0) {
    console.error("version-agreement: the version files cannot be read");
    for (const problem of problems) console.error(`  ${problem}`);
  }
  if (disagree) {
    console.error("version-agreement: the version files disagree");
    for (const reading of readings) console.error(`  ${reading.file} says ${reading.version}`);
    console.error(`  ARROW_VERSION_ROOT=${root}`);
  }
  process.exit(1);
}

const [version] = versions;
console.log(`version-agreement: the version files agree on ${version}`);
for (const reading of readings) console.log(`  ${reading.file} says ${reading.version}`);
