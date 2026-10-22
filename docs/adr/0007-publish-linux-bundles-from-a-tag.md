# ADR-0007: Publish the Linux bundles from a tag in a workflow of its own

## Context and Problem Statement

Arrow had no downloadable artifact. A reader could clone the repository and build the shell, and
nothing else. The tag `v0.4.0-mvp` named a commit with no file behind it, and the four files that
carry the application version all said `0.1.0` while the tags said `v0.1.0` through `v0.4.0-mvp`.

The Tauri shell already builds Linux bundles: `apps/desktop/package.json` carries a `tauri` script
and `apps/desktop/src-tauri/tauri.conf.json` names the product and the bundle targets. The missing
piece is the publishing path. Which event builds the bundles, which files the release carries, and
where that work lives relative to the merge gate are the questions this record answers.

## Decision Drivers

- A reader must be able to download Arrow and run it without a toolchain.
- A release must correspond to a tag, and a tag that does not name the version of the tree must not
  publish anything.
- The bundle build is slow. It must not slow the pull request gate, which is the one `verify` job in
  `ci.yml` and scores the harness.
- The build must be provable before the first tag exists, because the tag is irreversible enough to
  deserve a dry run.

## Considered Options

- **Build the bundles in `ci.yml` on every pull request.** Rejected. A release profile build of the
  shell costs far more than the score, and the pull request gate would pay it on every change that
  has nothing to do with publishing.
- **Use a third-party release action for the whole flow.** Rejected. The build, the tag check and the
  checksums are the decision, and an action that hides them makes the release body unauditable.
- **Publish from a tag in a workflow of its own, with a dispatch path that builds without
  publishing.** Chosen. The trigger is the release decision, the merge gate is untouched, and the
  dispatch path proves the build before anyone tags.

## Decision Outcome

`.github/workflows/release.yml` runs on a push of a tag matching `v*` and on `workflow_dispatch`.

The `bundle` job checks that the four version files agree, refuses a tag that is not `v` plus the
version of those files and names both in the failure, installs the Linux packages of the
Requirements section of `README.md`, and runs `pnpm exec tauri build --bundles appimage,deb,rpm`.
It keeps the three bundles as workflow artifacts, so a dispatch run proves the build without a
release.

The `release` job runs only for a tag, requires the `bundle` job, computes the size and SHA-256 of
every file, writes them into the release body, and uploads the AppImage, the deb, the rpm and
`SHA256SUMS.txt` with `gh release create`.

The application version lives in four files, and all four say `0.5.0`:

- `package.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`

`scripts/check-version.mjs` reads them through `ARROW_VERSION_ROOT`, which names the directory it
reads and defaults to the working directory, and it fails when they disagree. The harness criterion
`version-agreement` runs it inside the score, so the pull request gate holds it. The proof case
"the version check fails when two files disagree" points the check at a temporary tree, so the proof
never overwrites a real file.

## Consequences

- A tag publishes the three bundles and their checksums. The release body is the record of what the
  tag shipped, and `SHA256SUMS.txt` is the file a reader checks.
- The pull request gate keeps its shape and its cost: `ci.yml` does not change, and the release
  workflow does not run on a pull request.
- A tag that disagrees with the version of the tree publishes nothing, and the failure names the tag
  and the version.
- A version bump is now a four-file change plus the tag, and the score refuses a tree where the
  files disagree.
- The build runs on `ubuntu-latest`. The bundles therefore target the glibc of that runner, which is
  the oldest practical baseline for the WebKitGTK 4.1 packages. A distribution older than the
  runner is out of scope and would need a container.
- Re-running a tag whose release already exists fails at `gh release create`. Deleting the release
  and re-running is the recovery, and a later change could make the step idempotent.

## Confirmation

- `.github/workflows/release.yml` holds the two triggers, the version gate, the three bundle targets
  and the release step.
- The `version-agreement` criterion in `harness.config.json` runs `scripts/check-version.mjs` inside
  the score, and the proof case "the version check fails when two files disagree" proves it bites.
- `node scripts/check-version.mjs` exits 0 on the four files and exits 1 on a temporary tree where
  one of them disagrees.
- The dispatch run of the workflow builds the bundles and publishes no release.
