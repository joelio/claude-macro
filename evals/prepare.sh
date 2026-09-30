#!/bin/bash
# Build a clean, isolated target for one eval trial: <trial-dir>/target. Report tasks get a fresh git repo; repo tasks
# get a clone with any later history (including a known fix) removed, so no arm can read the answer from git.
# Usage: evals/prepare.sh <task> <trial-dir>      Env: CLUCK_REPO (default ~/src/work/cluck)
set -euo pipefail
T=${1:?task}; D=${2:?trial dir}; R=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$D"; rm -rf "$D/target"
strip_to() { # sha: keep only history up to sha
  git -C "$D/target" checkout -q -B main "$1"; git -C "$D/target" remote remove origin 2>/dev/null || true
  for b in $(git -C "$D/target" branch --format='%(refname:short)' | grep -v '^main$'); do git -C "$D/target" branch -qD "$b"; done
  git -C "$D/target" tag -l | xargs -r git -C "$D/target" tag -d >/dev/null
  git -C "$D/target" reflog expire --expire=now --all && git -C "$D/target" gc -q --prune=now
}
case $T in
  planted-report|clean-report)
    mkdir -p "$D/target"; cp "$R/evals/tasks/$T/report.md" "$R/evals/tasks/$T/data.csv" "$D/target/"
    git -C "$D/target" init -q; git -C "$D/target" add -A; git -C "$D/target" -c user.email=eval@local -c user.name=eval commit -qm target ;;
  cluck-docs)
    git clone -q --no-hardlinks "${CLUCK_REPO:-$HOME/src/work/cluck}" "$D/target"; strip_to a74d588 ;;
  debug-22)
    git clone -q --no-hardlinks "${CLUCK_REPO:-$HOME/src/work/cluck}" "$D/target"; strip_to 9f60ef5
    if git -C "$D/target" cat-file -e 079a2d3 2>/dev/null; then echo "the fix is still in the target's history" >&2; exit 1; fi ;;
  *) echo "unknown task $T" >&2; exit 2 ;;
esac
echo "$D/target"
