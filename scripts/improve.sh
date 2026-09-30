#!/bin/bash
# Bounded self-improvement loop, Ralph-style. Each iteration:
#   1. a fresh headless Sonnet run (improve/PROMPT.md) takes the top item in improve/BACKLOG.md, researches
#      lightly, implements it, passes `npm test` and commits locally;
#   2. the gate re-runs the checks from a pristine copy taken at start, so a worker cannot loosen them;
#   3. a headless Opus run (improve/REVIEW.md, also from the pristine copy) keeps or reverts the commit.
# Commits touching the loop's own gates (scripts/, tests/, package.json, improve/*.md except BACKLOG) are refused.
# Never pushes. Usage: scripts/improve.sh [iterations=3]
# Env: MAX_USD_PER_RUN (default 3) caps each headless run; CLAUDE_BIN overrides the claude path.
set -euo pipefail
N=${1:-3}; MAX_USD=${MAX_USD_PER_RUN:-3}
REPO=$(cd "$(dirname "$0")/.." && pwd); cd "$REPO"
CLAUDE=${CLAUDE_BIN:-$(command -v claude || true)}; [ -z "$CLAUDE" ] && [ -x "$HOME/.claude/local/claude" ] && CLAUDE="$HOME/.claude/local/claude"
[ -n "$CLAUDE" ] || { echo "claude CLI not found; set CLAUDE_BIN"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean; commit or stash first"; exit 1; }
npm test --silent >/dev/null || { echo "npm test fails before starting; fix that first"; exit 1; }
if [ "$(git branch --show-current)" = main ]; then git switch -q -c "improve/$(date +%Y%m%d-%H%M)"; fi
START=$(git rev-parse HEAD)

# Pristine gate: checks, tests and prompts as they were at start.
PRISTINE=$(mktemp -d); trap 'rm -rf "$PRISTINE"' EXIT
git archive "$START" scripts tests package.json improve/PROMPT.md improve/REVIEW.md | tar -x -C "$PRISTINE"
gate() { local g; g=$(mktemp -d "$PRISTINE/gate.XXXX"); cp -R "$PRISTINE/scripts" "$PRISTINE/tests" "$PRISTINE/package.json" "$g/"
  cp -R workflows examples packs "$g/"; (cd "$g" && node scripts/check-workflows.mjs && node tests/dry-run.mjs) >/dev/null 2>&1; }
PROTECTED='^(scripts/|tests/|package\.json$|improve/(PROMPT|REVIEW)\.md$|\.claude/)'

block() { # reason: mark the first open backlog item [!] and commit that
  REASON="$1" awk '!done && /^- \[ \]/ { sub(/^- \[ \]/, "- [!]"); print; print "  Blocked: " ENVIRON["REASON"]; done=1; next } { print }' \
    improve/BACKLOG.md > improve/BACKLOG.md.tmp && mv improve/BACKLOG.md.tmp improve/BACKLOG.md
  git add improve/BACKLOG.md && git commit -qm "improve: block item: $1"
}
clean() { if [ -n "$(git status --porcelain)" ]; then echo "  discarding uncommitted leftovers"; git checkout -q -- . && git clean -fdq; fi; }

# Headless runs: dontAsk refuses anything not listed; project-only settings so personal allow rules don't widen
# the scope; git itself cannot push (push URL points nowhere).
COMMON=(--permission-mode dontAsk --setting-sources project --max-budget-usd "$MAX_USD"
  --disallowedTools "Bash(git push:*)" "Read(~/.claude.json)" "Read(~/.claude/**)" "Read(~/.ssh/**)" "Read(~/.aws/**)" "Read(~/.config/**)" "Read(~/.netrc)")
WORKER_TOOLS=("Read(./**)" "Edit(./**)" "Write(./**)" Glob Grep WebFetch "Bash(npm test)" "Bash(npm test --silent)"
  "Bash(node scripts/check-workflows.mjs)" "Bash(node tests/dry-run.mjs)" "Bash(node tests/dry-run.mjs --estimate:*)"
  "Bash(git add -A)" "Bash(git commit -m:*)" "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git checkout -- .)" "Bash(git clean -fd)" "Bash(ls:*)"
  mcp__exa__web_search_exa mcp__exa__web_fetch_exa mcp__exa__get_code_context_exa mcp__context7__resolve-library-id mcp__context7__query-docs)
REVIEW_TOOLS=("Read(./**)" Glob Grep "Bash(npm test)" "Bash(npm test --silent)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git log:*)")
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.pushurl GIT_CONFIG_VALUE_0=/dev/null/push-disabled-by-improve
echo "branch $(git branch --show-current), $N iterations, max \$$MAX_USD per run"

for i in $(seq 1 "$N"); do
  grep -q '^- \[ \]' improve/BACKLOG.md || { echo "backlog empty"; break; }
  item=$(grep -m1 '^- \[ \]' improve/BACKLOG.md | cut -c1-100)
  echo "== iteration $i/$N: $item"
  before=$(git rev-parse HEAD)
  out=$("$CLAUDE" -p "$(cat "$PRISTINE/improve/PROMPT.md")" --model sonnet --effort medium "${COMMON[@]}" --allowedTools "${WORKER_TOOLS[@]}" 2>&1 || true)
  result=$(echo "$out" | grep '^RESULT:' | tail -1 || true)
  echo "  ${result:-no RESULT line; last output: $(echo "$out" | tail -1 | cut -c1-200)}"
  clean
  if [ "$(git rev-parse HEAD)" = "$before" ]; then
    [[ "$result" == "RESULT: blocked"* ]] && block "${result#RESULT: blocked }"
    [[ "$result" == "RESULT: empty"* ]] && break
    continue
  fi
  if git diff --name-only "$before" HEAD | grep -Eq "$PROTECTED"; then
    echo "  touches the loop's own gates; reverting"; git reset -q --hard "$before"; block "touches scripts/, tests/, package.json or improve prompts; needs a human"; continue
  fi
  if ! gate; then echo "  pristine checks fail; reverting"; git reset -q --hard "$before"; block "failed the pristine checks"; continue; fi
  review=$("$CLAUDE" -p "$(cat "$PRISTINE/improve/REVIEW.md")" --model opus --effort high "${COMMON[@]}" --allowedTools "${REVIEW_TOOLS[@]}" 2>&1 || true)
  verdict=$(echo "$review" | grep '^VERDICT:' | tail -1 || true)
  echo "  ${verdict:-VERDICT: missing (kept; review it yourself)}"
  clean
  if [[ "$verdict" == "VERDICT: revert"* ]]; then git reset -q --hard "$before"; block "reverted by review: ${verdict#VERDICT: revert - }"; fi
done
echo; git log --oneline "$START..HEAD"
echo "Review with: git log -p $START..HEAD   Merge when happy; nothing was pushed."
