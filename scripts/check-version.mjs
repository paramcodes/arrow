/**
 * The four files that carry the version of the application, and the check that
 * they name the same version.
 *
 * A release is only sane when the tag, the package manifest, the Rust manifest
 * and the Tauri configuration agree. The version lives in four files:
 *
 *   package.json
 *   apps/desktop/package.json
 *   apps/desktop/src-tauri/Cargo.toml
 *   apps/desktop/src-tauri/tauri.conf.json
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

/** The `version` of the `[package]` table of a Cargo manifest. */
function cargoVersion(relative) {
  const source = readFileSync(path.join(root, relative), "utf8");
  const packageTable = source.match(/^\[package\][\s\S]*?(?=^\[|(?![\s\S]))/m);
  const line = packageTable?.[0].match(/^version\s*=\s*"([^"]+)"/m);
  if (!line) return { version: undefined, problem: "holds no version in its [package] table" };
  return { version: line[1], problem: null };
}

const carriers = [
  { file: "package.json", read: jsonVersion },
  { file: "apps/desktop/package.json", read: jsonVersion },
  { file: "apps/desktop/src-tauri/Cargo.toml", read: cargoVersion },
  { file: "apps/desktop/src-tauri/tauri.conf.json", read: jsonVersion },
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

if (problems.length > 0) {
  console.error("version-agreement: the version files cannot be read");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const versions = new Set(readings.map((reading) => reading.version));

if (versions.size !== 1) {
  console.error("version-agreement: the version files disagree");
  for (const reading of readings) console.error(`  ${reading.file} says ${reading.version}`);
  console.error(`  ARROW_VERSION_ROOT=${root}`);
  process.exit(1);
}

const [version] = versions;
console.log(`version-agreement: the version files agree on ${version}`);
for (const reading of readings) console.log(`  ${reading.file} says ${reading.version}`);
