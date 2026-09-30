#!/bin/sh
# headersHelper for the exa MCP server: prints {"x-api-key": "..."} for Claude Code at connect time, so the
# key is never stored in ~/.claude.json or shown by `claude mcp list`. Looks in the macOS Keychain, then the
# Linux secret service, then $EXA_API_KEY. Prints {} (anonymous, rate-limited) if none is found.
k=""
command -v security >/dev/null 2>&1 && k=$(security find-generic-password -s claude-macro-exa -w 2>/dev/null)
[ -z "$k" ] && command -v secret-tool >/dev/null 2>&1 && k=$(secret-tool lookup service claude-macro-exa 2>/dev/null)
[ -z "$k" ] && k="${EXA_API_KEY:-}"
case "$k" in *[!A-Za-z0-9-]*) k="";; esac   # keys are uuid-like; refuse anything that could break the JSON
if [ -n "$k" ]; then printf '{"x-api-key":"%s"}\n' "$k"; else printf '{}\n'; fi
