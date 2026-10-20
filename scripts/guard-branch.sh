#!/usr/bin/env bash
#
# Refuses work on the default branch. Set HARNESS_ALLOW_DEFAULT_BRANCH=1 to
# override, for example when the default branch is the only branch a first
# commit can land on.

set -euo pipefail

if [ "${HARNESS_ALLOW_DEFAULT_BRANCH:-0}" = "1" ]; then
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

case "$branch" in
  main|master)
    echo "refusing to commit on $branch" >&2
    echo "create a task branch first: git checkout -b <task>/<name>" >&2
    exit 1
    ;;
esac
