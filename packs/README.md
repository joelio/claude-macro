# Writing a pack

A pack is an optional, stack-specific set of harness scripts, examples and lessons. Workflows stay estate-neutral; a pack holds what is specific to a stack. `web-perf` and `infra` are the models.

```
packs/<name>/
  README.md        what the pack is, a path table, and an optional-tools: line
  LESSONS.md       traps for this stack (optional; read before measuring)
  examples/        <workflow>-*.json args files
  harness/         scripts; harness/package.json if they need npm packages
```

## README.md

- One sentence on what it investigates, then `Install with scripts/install.sh --pack <name>`.
- A line `optional-tools: tool1 tool2` (space separated, at the start of the line). `scripts/install.sh` reports each as ok or skipped; nothing is installed for you.
- A table of paths with the environment variables each script reads.

## Harness scripts

- Read-only against live systems. No apply, delete, edit or restart. Say so in the header comment.
- Header comment gives usage and every argument or environment variable. Paths, hosts and names come from env or arguments, never the script.
- Raw output goes to `OUT_DIR` (a run folder), and the script prints a short summary. Never write into the repo under study.
- `.sh` files must pass `bash -n` and `.mjs` files `node --check`; `npm test` checks both.
- If the harness needs npm packages, add `harness/package.json`; the installer runs `npm install` and, when it names playwright, installs the headless shell.

## Examples

- Name them `<workflow>-*.json` (investigate, verify, debug, decide, change-evidence) so `npm test` dry-runs them against the workflow.
- Use placeholders for everything estate-specific: `<REPO>`, `<HOME>`, `<runId>`. A leading `<X>` in a value is substituted by the dry run.
- Keep each within the 10-agent limit.

## LESSONS.md

Add a bullet each time a tool or measurement misled you, with the fix. The skill passes the pack's traps into `tools`.
