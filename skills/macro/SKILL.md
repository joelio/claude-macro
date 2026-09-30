---
name: macro
description: Runs the evidence-based macro workflows - parallel Sonnet agents gather cited evidence, then an Opus adversary tries to break the result. Runs are expensive (roughly 150k-900k tokens). Use only when the user explicitly says "macro it", "/macro", "run the macro workflow", or asks for a multi-agent investigation, verification, root-cause debug or decision with cited evidence and an adversarial review. Do not use for C, C++, Rust, Elixir, Vim, Excel or keyboard macros, or for ordinary single-agent debugging or questions.
---

# macro

An explicit "macro it", "/macro" or "run the macro workflow" is the user's opt-in to run a Workflow. Otherwise, name the workflow, the agent count and the expected cost (README cost table) and wait for a yes.

The method, rules and workflows live in the repo this skill belongs to; call its root `<repo>`. Find it from this skill's base directory (shown when the skill loads): `git -C "$(dirname "$(readlink -f <skill-dir>/SKILL.md)")" rev-parse --show-toplevel`. Read `<repo>/CLAUDE.md` first, then `docs/citations.md` and `docs/adversarial.md`, and `LESSONS.md` (plus the pack's `LESSONS.md`) before measuring anything.

## Preflight

- If `ToolSearch "exa"` or `ToolSearch "context7"` finds nothing, tell the user to run `<repo>/scripts/install.sh` and restart Claude Code. Continue without them only if they agree; agents then fall back to WebFetch and curl.
- If the run needs a pack's harness (e.g. `packs/web-perf/harness`) and its `node_modules` is missing, the install is `<repo>/scripts/install.sh --pack <name>`.

## Pick the workflow

| The user wants | Script | Shape |
|---|---|---|
| To understand a problem or ticket | `workflows/investigate.js` | 4-6 evidence streams, then an Opus sceptic that re-checks findings and names gaps and alternatives |
| A report, README, PR or claim set checked and cited | `workflows/verify.js` | claim groups with quote-required citations, then an Opus logic review and attackers working from the verdicts |
| Proof a committed change is right | `workflows/change-evidence.js` | parallel checks, optional clean benchmark (process, browser, device or GPU), then an Opus challenger writing safe claims and verification steps |
| The root cause of a bug, crash, flaky test or regression | `workflows/debug.js` | reproduce plus competing hypotheses, parallel falsification (serialised on a shared device), then an Opus adjudicator |
| A choice between options, or a dependency upgrade | `workflows/decide.js` | evidence per option against fixed criteria, then an Opus attack on the leader and a ranking |

Chains are normal: investigate, then decide or debug, then change-evidence for the fix, then verify the write-up.

## Run it

1. Scout inline first: read the ticket, find the files, establish what is already known. Put that in `context`.
2. Pick a run folder: `~/.local/share/macro/<project>/<YYYY-MM-DD>-<slug>/` (today's date from the shell). It is the `workDir`.
3. Write `args` from the closest file in `<repo>/examples/` or `<repo>/packs/*/examples/`. Replace every `<PLACEHOLDER>`; estate details (paths, hosts, asset names, tables) go in args, never in a script.
4. Tier the cost: `"effort": "low"` for mechanical streams, checks or groups (counts, file:line re-checks, builds, byte sizes); the default is Sonnet at `medium`; the adversary is Opus at `high`. Change models only if the user asks, and never make the adversary weaker than the workers. Keep it under 10 agents unless the user asks for more.
5. Call the Workflow tool with `scriptPath` set to `<repo>/workflows/<name>.js` and `args` as a JSON object (not a string).
6. While it runs, tell the user in a few lines what each agent covers. Don't predict results.

## After a run

1. Write the full return value to `<workDir>/result.json`, then `<workDir>/REPORT.md` from `<repo>/docs/report-template.md`. Read the journal if the summary is truncated.
2. Check the adversary's own claims against the measured evidence and fix anything it got wrong; say so in the report.
3. Append one line to `~/.local/share/macro/INDEX.md`: date, project, workflow, question, verdict, path. Give the user the report path.
4. Copy the report into the project (e.g. `docs/investigations/`) only if the user asks.
5. Add any new trap to `<repo>/LESSONS.md` (or the pack's) and a cost row to `<repo>/README.md` if the run was unusual.

## Rules carried into every run

- Evidence tags `measured`, `code`, `sourced`, `inferred`; citations are source, verbatim quote and `via`.
- Read-only against live systems, light traffic, no logins. Agents never edit, stash, reset or commit in the repo under study; code changes happen in disposable clones under `workDir`.
- Only the adversary's `claims_safe_for_pr` sentences go into a PR, commit or report summary. Uncited serious objections are shown as questions.
- Opening PRs, pushing, adding labels or posting to tickets still needs the user's go-ahead for that specific action.
