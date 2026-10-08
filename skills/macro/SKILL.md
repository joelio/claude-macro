---
name: macro
description: Runs the evidence-based macro workflows - parallel Sonnet agents gather cited evidence, then an Opus adversary tries to break the result. Runs are expensive (roughly 150k-900k tokens). Use only when the user explicitly says "macro it", "/macro", "run the macro workflow", or asks for a multi-agent investigation, verification, root-cause debug or decision with cited evidence and an adversarial review. Do not use for C, C++, Rust, Elixir, Vim, Excel or keyboard macros, or for ordinary single-agent debugging or questions.
---

# macro

An explicit "macro it", "/macro" or "run the macro workflow" is the user's opt-in to run a Workflow. Otherwise, name the workflow, the agent count and the expected cost and wait for a yes. Get the count from `node <repo>/tests/dry-run.mjs --estimate <args.json> <workflow>` (zero tokens; it also validates the args) and the cost from the README table.

The method, rules and workflows live in the repo this skill belongs to; call its root `<repo>`. Find it from this skill's base directory (shown when the skill loads): `git -C "$(dirname "$(readlink -f <skill-dir>/SKILL.md)")" rev-parse --show-toplevel`. Always read the chosen workflow's header comment (its args) and `LESSONS.md` (plus the pack's). Read `CLAUDE.md`, `docs/citations.md` and `docs/adversarial.md` when you write the report, or before a `deep` or `max` run; a `quick` smoke run doesn't need them.

## Preflight

- Check tools with ToolSearch or `<repo>/scripts/install.sh --check`. Never print `claude mcp list` or `claude mcp get` output: older installs embedded API keys in server URLs.
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
   - If the target lives on GitHub, check its visibility and releases read-only (`gh repo view --json visibility`, `gh release list`) and put the answer in `context`, so agents don't spend traffic on 404s.
   - For `debug`, record the toolchain, CLI and dependency versions now in `versions`, and when the code last worked if known.
   - If the args are underspecified, interview the user one question at a time, each with your recommended answer. Look up anything the code can answer instead of asking.
   - Underspecified args include `decide` criteria and their weights, `debug` hypotheses and the shared device, and `verify` groups.
   - Stop when every field the workflow needs is settled. Vague args waste a whole run.
2. Pick a run folder: `mkdir -p ~/.local/share/macro/<project>/<YYYY-MM-DD>-<slug>/` (today's date from the shell). It is the `workDir`. Save the args there as `args.json`.
3. Write `args` from the closest file in `<repo>/examples/` or `<repo>/packs/*/examples/`. Replace every `<PLACEHOLDER>`; estate details (paths, hosts, asset names, tables) go in args, never in a script. Put what earlier runs learned into `tools`: the relevant trap bullets from `LESSONS.md` (and the pack's), and this project's lines from `~/.local/share/macro/INDEX.md`. Add stack hints there too (e.g. `CARGO_TARGET_DIR`, `. $IDF_PATH/export.sh`, `uv venv`).
4. Tier the cost:
   - Give mechanical streams, checks or groups (counts, file:line re-checks, builds, byte sizes) `"effort": "low"`; they run on Haiku, as do the quote check and recheck. Add `"model": "sonnet"` to a low-effort task that needs judgement (browser request counting, timings with statistics, security inventories).
   - The default is Sonnet at `medium` and the adversary Opus at `high`.
   - For a hard or high-stakes question, suggest `"profile": "deep"` or `"max"` and say that it costs more; use `"quick"` for smoke tests.
   - Scale the number of agents to the question, following Anthropic's multi-agent research guidance (docs/research/2026-10-01-harness-engineering.md):
     - a simple fact-finding question doesn't need macro; answer it directly;
     - a direct comparison needs 2-4 streams, groups or options;
     - only broad, many-sided questions need 5 or more.
   - Give each agent an objective, what to return, which sources to use and where its task stops. Vague briefs make agents duplicate each other's work. Change models only if the user asks, and never make the adversary weaker than the workers. Keep it under 10 agents unless the user asks for more.
5. Run `node <repo>/tests/dry-run.mjs --estimate <workDir>/args.json <workflow>`; fix any problem it reports. Note the time (`date +%s`). Call the Workflow tool with `scriptPath` set to `<repo>/workflows/<name>.js` and `args` as a JSON object (not a string). If `scriptPath` outside the session is refused, read the script and pass it as `script`.
6. While it runs, tell the user in a few lines what each agent covers. Don't predict results.

## After a run

1. Write the full return value to `<workDir>/result.json`, with the run id, the transcript directory and the wall time added. Then write `<workDir>/REPORT.md` from `<repo>/docs/report-template.md`; the return value's `spent` field is cumulative output tokens (for the whole orchestrator turn) at each phase boundary, so report the differences between marks. Read the journal if the summary is truncated.
2. Check `not_run`: any agent listed there failed or was skipped. Say so in the report's Method and "Not established" sections, and never present the run as complete. Then check the adversary's own claims against the measured evidence, fix anything it got wrong, and say so in the report. Spot-check five quotes: grep each against its source and record how many were found in the report's Method section.
3. Append one line to `~/.local/share/macro/INDEX.md`: date, project, workflow, question, verdict, path. Give the user the report path. Every few runs, suggest `<repo>/scripts/improve.sh --retro` so the lessons from real runs reach the backlog.
4. Offer a cross-model second opinion if `owl` is installed and the user agrees (it calls external models): `owl ask -f <workDir>/REPORT.md --format standard > <workDir>/second-opinion.md`, with the report prefixed by "List claims in this report you believe are false, each with a reason, and nothing else." Put the disagreements under "Not established".
5. Create `<workDir>/did-it-help.md` for the user to fill within a day. It has four headings:
   - what the run said;
   - what turned out to be true;
   - what you would not have found alone;
   - how many of the adversary's blocker or serious objections held.
6. After `change-evidence`, offer a walk-through of `verification_steps`, one at a time: "Here is what should happen: … Does it?"
   - "yes", "y" or an empty reply passes the step; anything else is logged as an issue.
   - Write the results to `<workDir>/UAT.md`, and turn any failures into next steps.
7. Copy the report into the project (e.g. `docs/investigations/`) only if the user asks.
8. Add any new trap to `<repo>/LESSONS.md` (or the pack's) and a cost row to `<repo>/README.md` for each workflow's first real runs.

## Rules carried into every run

- Evidence tags `measured`, `code`, `sourced`, `inferred`; citations are source, verbatim quote and `via`.
- Read-only against live systems, light traffic, no logins. Agents never edit, stash, reset or commit in the repo under study; code changes happen in disposable clones under `workDir`.
- Only the adversary's `claims_safe_for_pr` sentences go into a PR, commit or report summary. Uncited serious objections are shown as questions.
- Opening PRs, pushing, adding labels or posting to tickets still needs the user's go-ahead for that specific action.
