#!/bin/bash
# Installs or checks everything the macro skill and workflows need, for one developer.
# Safe to re-run. Usage:
#   scripts/install.sh              install what is missing
#   scripts/install.sh --check      report only, change nothing
#   scripts/install.sh --update-mcp also replace existing exa/context7 servers with the recommended config
#   scripts/install.sh --no-harness skip npm and Playwright (workflows that only read and cite)
# Optional keys, read from the environment when set: EXA_API_KEY (lifts exa's free-tier rate limit),
# CONTEXT7_API_KEY. Note that `claude mcp add` stores them in your user config (~/.claude.json).
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd); SKILL=macro
CHECK=0; UPDATE=0; HARNESS=1
for a in "$@"; do case $a in --check) CHECK=1;; --update-mcp) UPDATE=1;; --no-harness) HARNESS=0;; *) echo "unknown option $a"; exit 2;; esac; done
EXA_TOOLS=web_search_exa,web_fetch_exa,get_code_context_exa,crawling_exa
ok() { echo "  ok    $*"; }; todo() { echo "  todo  $*"; missing=1; }; missing=0
run() { if [ $CHECK = 1 ]; then todo "$*"; else echo "  run   $*"; "$@" || { echo "  FAIL  $*"; missing=1; }; fi; }

echo "Prerequisites"
# claude is often a shell alias to a local install, which scripts cannot see; CLAUDE_BIN overrides.
CLAUDE=${CLAUDE_BIN:-$(command -v claude || true)}; [ -z "$CLAUDE" ] && [ -x "$HOME/.claude/local/claude" ] && CLAUDE="$HOME/.claude/local/claude"
[ -n "$CLAUDE" ] && ok "claude $("$CLAUDE" --version 2>/dev/null | head -1)" || { echo "  FAIL  Claude Code CLI not found (set CLAUDE_BIN): https://docs.claude.com/en/docs/claude-code"; exit 1; }
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then ok "node $(node -v)"; else echo "  FAIL  node 18+ is required"; exit 1; fi
for t in docker bq gcloud; do command -v $t >/dev/null && ok "$t (optional)" || echo "  skip  $t not found (optional: only harness/nginx-headers and harness/bigquery need it)"; done

echo "Skill"
link="$HOME/.claude/skills/$SKILL"; want="$REPO/skills/$SKILL"
if [ -L "$link" ] && [ "$(readlink "$link")" = "$want" ]; then ok "$link -> $want"
elif [ -e "$link" ]; then echo "  WARN  $link exists and is not a link to $want; leaving it alone"; missing=1
else mkdir -p "$HOME/.claude/skills" 2>/dev/null; run ln -s "$want" "$link"; fi

echo "MCP servers (user scope, so they load in whatever repo you investigate)"
add_mcp() { # name url [header]
  local name=$1 url=$2 hdr=${3:-} cur
  cur=$("$CLAUDE" mcp get "$name" 2>/dev/null)
  if [ -n "$cur" ] && [ $UPDATE = 0 ]; then
    if [ "$name" = exa ] && ! grep -q get_code_context_exa <<<"$cur"; then
      echo "  WARN  exa is installed without get_code_context_exa; re-run with --update-mcp to enable it"; missing=1
    else ok "$name"; fi
    return
  fi
  [ -n "$cur" ] && run "$CLAUDE" mcp remove "$name" -s user
  if [ -n "$hdr" ]; then run "$CLAUDE" mcp add --scope user --transport http "$name" "$url" --header "$hdr"
  else run "$CLAUDE" mcp add --scope user --transport http "$name" "$url"; fi
}
if [ $UPDATE = 1 ] && [ -z "${EXA_API_KEY:-}" ] && "$CLAUDE" mcp get exa 2>/dev/null | grep -q exaApiKey; then
  echo "  WARN  your exa server has an API key but EXA_API_KEY is not set; set it first or the key is lost"; exit 1
fi
add_mcp exa "https://mcp.exa.ai/mcp?tools=$EXA_TOOLS${EXA_API_KEY:+&exaApiKey=$EXA_API_KEY}"
add_mcp context7 "https://mcp.context7.com/mcp" ${CONTEXT7_API_KEY:+"CONTEXT7_API_KEY: $CONTEXT7_API_KEY"}

if [ $HARNESS = 1 ]; then
  echo "Harness"
  if [ -d "$REPO/harness/node_modules/playwright" ]; then ok "harness npm packages"; else run npm --prefix "$REPO/harness" install; fi
  if ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"/chromium_headless_shell-* >/dev/null 2>&1 \
     || ls "$HOME/.cache/ms-playwright"/chromium_headless_shell-* >/dev/null 2>&1; then ok "Playwright headless shell"
  else run bash -c "cd '$REPO/harness' && npx playwright install chromium-headless-shell"; fi
fi

echo "Workflows"
node "$REPO/scripts/check-workflows.mjs" | sed 's/^/  /'
[ $missing = 0 ] && echo "Ready." || echo "Some items need attention (see above)."
exit $missing
