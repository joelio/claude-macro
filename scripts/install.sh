#!/bin/bash
# Installs or checks everything the macro skill and workflows need, for one developer.
# Safe to re-run. Usage:
#   scripts/install.sh              install what is missing
#   scripts/install.sh --check      report only, change nothing
#   scripts/install.sh --update-mcp also replace existing exa/context7 servers with the recommended config
#   scripts/install.sh --pack web-perf   also install a pack's harness (npm, Playwright); repeatable
# Optional keys: EXA_API_KEY (lifts exa's free-tier rate limit) is stored in the OS keychain (macOS Keychain or
# Linux secret-tool) and sent by scripts/exa-headers.sh at connect time, never written to ~/.claude.json.
# An existing key embedded in the exa URL is migrated there. CONTEXT7_API_KEY goes in a header as before.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd); SKILL=macro
CHECK=0; UPDATE=0; PACKS=()
while [ $# -gt 0 ]; do case $1 in --check) CHECK=1;; --update-mcp) UPDATE=1;; --pack) PACKS+=("${2:?--pack needs a name}"); shift;; --no-harness) ;; *) echo "unknown option $1"; exit 2;; esac; shift; done
EXA_TOOLS=web_search_exa,web_fetch_exa,get_code_context_exa,crawling_exa
ok() { echo "  ok    $*"; }; todo() { echo "  todo  $*"; missing=1; }; missing=0
# Never print secrets: mask API keys in URLs and header values when echoing commands.
mask() { sed -E 's/(exaApiKey=|[Aa][Pp][Ii]_?[Kk][Ee][Yy][=:] ?)[^& "]+/\1<redacted>/g'; }
run() { if [ $CHECK = 1 ]; then todo "$(echo "$*" | mask)"; else echo "  run   $(echo "$*" | mask)"; ( set -o pipefail; "$@" 2>&1 | mask ) || { echo "  FAIL  $(echo "$*" | mask)"; missing=1; }; fi; }

echo "Prerequisites"
# claude is often a shell alias to a local install, which scripts cannot see; CLAUDE_BIN overrides.
CLAUDE=${CLAUDE_BIN:-$(command -v claude || true)}; [ -z "$CLAUDE" ] && [ -x "$HOME/.claude/local/claude" ] && CLAUDE="$HOME/.claude/local/claude"
[ -n "$CLAUDE" ] || { echo "  FAIL  Claude Code CLI not found (set CLAUDE_BIN): https://docs.claude.com/en/docs/claude-code"; exit 1; }
if ver=$("$CLAUDE" --version 2>&1) && [ -n "$ver" ]; then ok "claude $(echo "$ver" | head -1)"
else echo "  FAIL  $CLAUDE does not run: $(echo "$ver" | head -1)"; echo "        fix Claude Code first (for a local install: cd ~/.claude/local && node node_modules/@anthropic-ai/claude-code/install.cjs)"; exit 1; fi
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then ok "node $(node -v)"; else echo "  FAIL  node 18+ is required"; exit 1; fi

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
    ok "$name"
    return
  fi
  [ -n "$cur" ] && run "$CLAUDE" mcp remove "$name" -s user
  if [ -n "$hdr" ]; then run "$CLAUDE" mcp add --scope user --transport http "$name" "$url" --header "$hdr"
  else run "$CLAUDE" mcp add --scope user --transport http "$name" "$url"; fi
}
if [ $UPDATE = 1 ] && ! "$CLAUDE" mcp list >/dev/null 2>&1; then echo "  FAIL  cannot read MCP config; not changing anything"; exit 1; fi
# exa: the API key lives in the OS keychain and is sent by scripts/exa-headers.sh at connect time, so it never
# appears in ~/.claude.json or `claude mcp list`. Older installs had it in the URL; --update-mcp migrates them.
store_key() { # service key
  if command -v security >/dev/null; then security add-generic-password -a "$USER" -s "$1" -w "$2" -U
  elif command -v secret-tool >/dev/null; then printf '%s' "$2" | secret-tool store --label="$1" service "$1"
  else echo "  WARN  no keychain found; export EXA_API_KEY in your shell profile instead"; return 1; fi
}
add_exa() { run "$CLAUDE" mcp add-json --scope user exa "{\"type\":\"http\",\"url\":\"https://mcp.exa.ai/mcp?tools=$EXA_TOOLS\",\"headersHelper\":\"$REPO/scripts/exa-headers.sh\"}"; }
cur_exa=$("$CLAUDE" mcp get exa 2>/dev/null || true)
url_key=$(echo "$cur_exa" | sed -n 's/.*exaApiKey=\([A-Za-z0-9-]*\).*/\1/p' | head -1)
key=${EXA_API_KEY:-$url_key}
if [ -n "$cur_exa" ] && echo "$cur_exa" | grep -q exa-headers.sh && [ -z "$url_key" ] && [ $UPDATE = 0 ]; then
  ok "exa (key from keychain via scripts/exa-headers.sh)"
elif [ -n "$cur_exa" ] && [ $UPDATE = 0 ]; then
  echo "  WARN  exa is not using the keychain helper$([ -n "$url_key" ] && echo '; its key is in the URL and shows in claude mcp list'); re-run with --update-mcp"; missing=1
else
  if [ -n "$key" ]; then
    if [ $CHECK = 1 ]; then todo "store the exa key in the keychain"; else store_key claude-macro-exa "$key" >/dev/null && ok "exa key stored in the keychain (service claude-macro-exa)"; fi
  fi
  [ -n "$cur_exa" ] && run "$CLAUDE" mcp remove exa -s user
  add_exa
fi
add_mcp context7 "https://mcp.context7.com/mcp" ${CONTEXT7_API_KEY:+"CONTEXT7_API_KEY: $CONTEXT7_API_KEY"}

for pack in ${PACKS[@]+"${PACKS[@]}"}; do
  dir="$REPO/packs/$pack"; echo "Pack $pack"
  [ -d "$dir" ] || { echo "  FAIL  no pack $pack (have: $(ls "$REPO/packs" | tr '\n' ' '))"; missing=1; continue; }
  if [ -f "$dir/harness/package.json" ]; then
    if [ -d "$dir/harness/node_modules" ]; then ok "npm packages"; else run npm --prefix "$dir/harness" install; fi
    if grep -q playwright "$dir/harness/package.json"; then
      if ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"/chromium_headless_shell-* >/dev/null 2>&1 \
         || ls "$HOME/.cache/ms-playwright"/chromium_headless_shell-* >/dev/null 2>&1; then ok "Playwright headless shell"
      else run bash -c "cd '$dir/harness' && npx playwright install chromium-headless-shell"; fi
    fi
  fi
  for t in $(sed -n 's/^optional-tools: //p' "$dir/README.md" 2>/dev/null); do
    command -v "$t" >/dev/null && ok "$t" || echo "  skip  $t not found (only some of this pack's scripts need it)"
  done
done

echo "Workflows"
if tests=$(cd "$REPO" && node scripts/check-workflows.mjs && node tests/dry-run.mjs 2>&1); then echo "$tests" | grep -v '^ok' | sed 's/^/  /'; ok "npm test ($(echo "$tests" | grep -c '^ok') checks)"
else echo "$tests" | grep -v '^ok' | sed 's/^/  /'; echo "  FAIL  npm test"; missing=1; fi
[ $missing = 0 ] && echo "Ready." || echo "Some items need attention (see above)."
exit $missing
