#!/bin/bash
# Bounded self-improvement loop, Ralph-style. Each iteration is a fresh headless Claude run on Sonnet
# (improve/PROMPT.md) that takes the top item from improve/BACKLOG.md, researches lightly, implements it,
# passes `npm test` and commits locally. An Opus run (improve/REVIEW.md) then reviews that commit; a
# "revert" verdict undoes it and records the reason in the backlog. Never pushes.
# Usage: scripts/improve.sh [iterations=3]
# Env: MAX_USD_PER_RUN (default 3) caps each headless run's spend; CLAUDE_BIN overrides the claude path.
set -euo pipefail
N=${1:-3}; MAX_USD=${MAX_USD_PER_RUN:-3}
REPO=$(cd "$(dirname "$0")/.." && pwd); cd "$REPO"
CLAUDE=${CLAUDE_BIN:-$(command -v claude || true)}; [ -z "$CLAUDE" ] && [ -x "$HOME/.claude/local/claude" ] && CLAUDE="$HOME/.claude/local/claude"
[ -n "$CLAUDE" ] || { echo "claude CLI not found; set CLAUDE_BIN"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean; commit or stash first"; exit 1; }
npm test --silent >/dev/null || { echo "npm test fails before starting; fix that first"; exit 1; }
if [ "$(git branch --show-current)" = main ]; then git switch -q -c "improve/$(date +%Y%m%d-%H%M)"; fi
echo "branch $(git branch --show-current), $N iterations, max \$$MAX_USD per run"

WORKER_TOOLS=(Read Edit Write Glob Grep WebFetch "Bash(npm test:*)" "Bash(node:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git status:*)"
  "Bash(git diff:*)" "Bash(git log:*)" "Bash(git checkout -- .)" "Bash(git clean -fd)" "Bash(curl:*)" "Bash(ls:*)"
  mcp__exa__web_search_exa mcp__exa__web_fetch_exa mcp__exa__get_code_context_exa mcp__context7__resolve-library-id mcp__context7__query-docs)
REVIEW_TOOLS=(Read Glob Grep "Bash(npm test:*)" "Bash(node:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git log:*)")

for i in $(seq 1 "$N"); do
  grep -q '^- \[ \]' improve/BACKLOG.md || { echo "backlog empty"; break; }
  echo "== iteration $i/$N: $(grep -m1 '^- \[ \]' improve/BACKLOG.md | cut -c1-100)"
  before=$(git rev-parse HEAD)
  out=$("$CLAUDE" -p "$(cat improve/PROMPT.md)" --model sonnet --effort medium --permission-mode acceptEdits \
        --allowedTools "${WORKER_TOOLS[@]}" --disallowedTools "Bash(git push:*)" --max-budget-usd "$MAX_USD" 2>&1 || true)
  echo "$out" | grep '^RESULT:' || echo "  (no RESULT line; last output: $(echo "$out" | tail -1 | cut -c1-200))"
  if [ -n "$(git status --porcelain)" ]; then echo "  uncommitted leftovers; discarding"; git checkout -q -- . && git clean -fdq; fi
  [ "$(git rev-parse HEAD)" = "$before" ] && continue
  if ! npm test --silent >/dev/null; then
    echo "  npm test fails after the commit; reverting"; git reset -q --hard "$before"; continue
  fi
  review=$("$CLAUDE" -p "$(cat improve/REVIEW.md)" --model opus --effort high --allowedTools "${REVIEW_TOOLS[@]}" --max-budget-usd "$MAX_USD" 2>&1 || true)
  verdict=$(echo "$review" | grep '^VERDICT:' | tail -1)
  echo "  ${verdict:-VERDICT: missing (kept; review it yourself)}"
  if [[ "$verdict" == "VERDICT: revert"* ]]; then
    title=$(git log -1 --format=%s | sed 's/^improve: //')
    git reset -q --hard "$before"
    # Block the item with the reviewer's reason so the next iteration moves on; a human can reopen it.
    REASON="${verdict#VERDICT: revert - }" awk '!done && /^- \[ \]/ { sub(/^- \[ \]/, "- [!]"); print; print "  Reverted by review: " ENVIRON["REASON"]; done=1; next } { print }' \
      improve/BACKLOG.md > improve/BACKLOG.md.tmp && mv improve/BACKLOG.md.tmp improve/BACKLOG.md
    git add improve/BACKLOG.md && git commit -qm "improve: block $title after review"
  fi
done
echo; git log --oneline "main..HEAD" 2>/dev/null || true
echo "Review with: git log -p main..HEAD   Merge when happy; nothing was pushed."
