#!/bin/bash
# Read-only Terraform plan diff: what would change, without locking state or applying anything.
# Usage: TF_DIR=<root module> OUT_DIR=<run folder> run.sh [extra terraform plan args, e.g. -var-file=x.tfvars]
# Writes plan.bin, plan.json and plan.txt to OUT_DIR and prints one summary line per changed resource.
# Needs terraform and jq. -lock=false so it never blocks a real apply; it never runs apply or state commands.
set -eu
TF_DIR=${TF_DIR:?root module dir}; OUT_DIR=${OUT_DIR:?run folder}
mkdir -p "$OUT_DIR"
terraform -chdir="$TF_DIR" plan -lock=false -input=false -no-color -out="$OUT_DIR/plan.bin" "$@" > "$OUT_DIR/plan.txt"
terraform -chdir="$TF_DIR" show -json "$OUT_DIR/plan.bin" > "$OUT_DIR/plan.json"
jq -r '[.resource_changes[] | select(.change.actions != ["no-op"] and .change.actions != ["read"])] as $c
  | ($c[] | "\(.change.actions | join("+"))\t\(.address)"),
    "total: \($c | length) changed of \(.resource_changes | length); raw output in '"$OUT_DIR"'"' "$OUT_DIR/plan.json"
