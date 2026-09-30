#!/bin/bash
# Read-only drift check: what `kubectl apply` would change, using a server-side diff.
# Usage: KUBE_CONTEXT=<context> OUT_DIR=<run folder> run.sh <manifest file or dir> [extra kubectl diff args]
# `kubectl diff` exits 0 for no changes, 1 for changes and >1 for errors. Nothing is applied.
# Writes diff.txt to OUT_DIR and prints the changed objects plus a count.
set -u
KUBE_CONTEXT=${KUBE_CONTEXT:?kubectl context}; OUT_DIR=${OUT_DIR:?run folder}
SRC=${1:?manifest file or dir}; shift
mkdir -p "$OUT_DIR"
kubectl --context "$KUBE_CONTEXT" diff --server-side -f "$SRC" "$@" > "$OUT_DIR/diff.txt" 2> "$OUT_DIR/diff.err"; rc=$?
[ $rc -gt 1 ] && { echo "kubectl diff failed ($rc): $(head -3 "$OUT_DIR/diff.err")"; exit $rc; }
grep '^diff ' "$OUT_DIR/diff.txt" | awk '{print $NF}' | sort -u
echo "changed objects: $(grep -c '^diff ' "$OUT_DIR/diff.txt"); raw output in $OUT_DIR"
exit 0
