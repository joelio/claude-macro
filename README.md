# macro

Evidence-based engineering investigations with Claude Code workflows. Many Sonnet agents gather evidence in parallel, and every claim is tagged by how it is known and cited with a verbatim quote. A stronger model (Opus) then tries to break the result before you act on it.

It works on any codebase and question: a slow CLI, a flaky test, an ESP32 that won't reconnect, a Terraform provider upgrade, picking an identity provider, or "is this report right?".

```
 question ──► investigate ──► decide / debug ──► change-evidence ──► verify the write-up
              streams +       options or         checks + bench +    claim groups +
              Opus sceptic    hypotheses +       Opus challenger     Opus logic + attackers
                              Opus adversary
```

## Quick start

```sh
git clone git@github.com:joelio/claude-macro.git ~/src/claude-macro
export EXA_API_KEY=...           # optional: lifts exa's free-tier rate limit
~/src/claude-macro/scripts/install.sh
```

Restart Claude Code. Then, in any repo, say **"macro it: <your question>"**. For a cheap first run that checks the install, say "macro it: run the smoke example". That runs `examples/investigate-smoke.json`: 3 agents at low effort.

Needs Claude Code, Node 18+ and git. The installer is safe to re-run. It:

- links the skill;
- adds the **exa** MCP server (search, fetch, code context) and **context7** (library docs) at user scope;
- runs the tests.

Existing MCP servers are left alone unless you pass `--update-mcp`. Use `--check` to see what is missing, and `--pack web-perf` to add a pack's harness.

## Workflows

| Workflow | For | Shape | Agents |
|---|---|---|---|
| `investigate` | Understanding a problem or ticket | 4-6 evidence streams, then an Opus sceptic. The sceptic re-checks every finding the decision rests on, marks the rest `not-checked`, and names unanswered questions and alternative explanations | 5-7 |
| `verify` | A report, README, PR or claim set | Claim groups with quote-required verdicts, then an Opus logic review and one attacker per recommendation. Adversaries get the verdicts in a slim form | 4-10 |
| `change-evidence` | A committed change | Parallel checks and an optional clean benchmark (`process`, `browser`, `device`, `gpu`), then an Opus challenger that writes the claims safe to quote and the verification steps | 3-6 |
| `debug` | A bug, crash, flaky test or regression | Reproduction plus competing hypotheses, parallel attempts to falsify each (serialised on a shared device), then an Opus adjudicator with a cited cause-to-symptom chain and a regression test | 4-8 |
| `decide` | Choosing between options, or an upgrade | Evidence per option against fixed criteria (`kind: upgrade` adds breaking-change, advisory and build-in-a-clone checks), then an Opus attack on the leader and a ranking | 3-7 |

Each workflow's `args` are documented at the top of its script; `examples/` has one or more per workflow. Results go to a run folder under `~/.local/share/macro/<project>/`, with a `REPORT.md` from `docs/report-template.md` and an entry in `~/.local/share/macro/INDEX.md`.

## Rules the agents follow

- **Evidence tags.** Every claim is `measured`, `code`, `sourced` or `inferred`. A tag that overstates certainty is a defect.
- **Citations.** Claims carry `{source, quote, via}`. No quote, no "confirmed": the scripts demote an uncited confirmed verdict to unverifiable, and an uncited upheld or refuted verdict to untestable. Workers may leave citations empty rather than invent a quote. `via` records whether context7, exa, WebFetch or curl found it.
- **Sources.** context7 for library behaviour, exa to find specs and vendor docs, `web_fetch_exa` for the exact text quoted, and curl when a tool is rate-limited.
- **Numbers.** Method, n, median with IQR or min-max, and the unit.
- **Safety.** Read-only against live systems with light traffic. Agents never edit, stash, reset or commit in the repo under study; code changes happen in disposable clones under the run folder.
- **Adversary last, and held to the same standard.** An uncited blocker or serious objection is demoted to a question. Only `claims_safe_for_pr` sentences, each naming its evidence, go to other people.
- **Cost tiers.** Sonnet at `low` effort for mechanical work and `medium` for evidence; Opus at `high` only for the adversary. Effort is always explicit (an omitted one inherits the session's), and adversary prompts carry compact JSON. For a hard or high-stakes question, set `"profile": "deep"` (workers high, adversary xhigh) or `"max"` (workers high, adversary max); `"quick"` suits smoke tests. Per-task `effort` still overrides the profile. Override models in `args` if needed, but never make the adversary weaker than the workers.

## Self-improvement loop

`scripts/improve.sh [n]` runs a bounded, Ralph-style loop on this repo, n iterations (3 by default):

1. Each iteration is a fresh headless Sonnet run in `dontAsk` mode with a narrow tool list; git cannot push. It takes the top item in `improve/BACKLOG.md`, does at most 5 context7 or exa lookups, makes the change, passes `npm test` and commits on an `improve/*` branch.
2. The checks are re-run from a pristine copy taken at start, and commits that touch the loop's own gates (`scripts/`, `tests/`, `package.json`, the improve prompts) are refused, so a worker can't loosen what judges it. An Opus run then reviews the commit and keeps or reverts it. A reverted or refused item is blocked with the reason.
3. `MAX_USD_PER_RUN` (3 by default) caps each headless run's spend.

It never pushes; review with `git log -p main..HEAD`.

`scripts/improve.sh --retro` runs one Opus retro over your real runs: `~/.local/share/macro/INDEX.md`, each run's `did-it-help.md`, and the token numbers. It adds lessons and backlog items only for patterns seen across runs, each citing the runs that show it. It may change only `LESSONS.md`, the backlog and the changelog.

In this repo, a project hook (`.claude/settings.json`) runs the checks after every edit to a workflow, example or test, and blocks with the failure until it is fixed.

`npm test` is the loop's pass/fail check, and it costs no tokens:

- `scripts/check-workflows.mjs` statically checks each workflow: pure meta, both-way phase match, Opus last, the evidence-tag enum, `{source, quote, via}` citations, the identical shared prelude, effort on every agent, no indented JSON in prompts, and harness syntax.
- `tests/dry-run.mjs` runs every workflow against every example with a stubbed `agent()`, three times: full output, sparse output, and with each agent in turn returning null. It also unit-checks `demote()`. `--estimate <args.json> <workflow>` shows a real run's agents and tiers before you spend tokens.

## Packs

Stack-specific harnesses live in `packs/<name>/` with their own examples and lessons. They are installed only on request.

| Pack | What |
|---|---|
| `packs/web-perf/` | Playwright and CDP profiling, an A/B import benchmark, an nginx header test in Docker, and a load-balancer log query |

## Cost seen in practice

| Run | Agents | Subagent tokens | Wall time |
|---|---|---|---|
| investigate (6 streams + sceptic) | 7 | 467k | 6.6 min |
| verify (7 groups + 2 attacks, 123 claims) | 9 | 896k | 7.1 min |
| change-evidence (3 checks + benchmark + Opus) | 5 | 321k | 12.1 min |
| config-change verify (5 + Opus attack) | 6 | 528k | 9.1 min |

These runs predate v0.2's compact adversary payloads, which should cut Attack-phase input by roughly 40% (estimate, not yet measured). Keep a run to 10 agents or fewer unless asked (the dry run enforces it), and scope each agent to one question.

## Layout

| Path | What |
|---|---|
| `workflows/` | The five workflow scripts |
| `examples/` | Example `args`, named `<workflow>-*.json` |
| `skills/macro/` | The trigger skill (linked by the installer) |
| `docs/` | Citation method, adversarial method, report template |
| `packs/` | Optional stack-specific harnesses |
| `improve/` | Self-improvement prompt, review prompt and backlog |
| `scripts/` | `install.sh`, `improve.sh`, `check-workflows.mjs` |
| `tests/dry-run.mjs` | Zero-token end-to-end run of every workflow and example |
| `LESSONS.md` | General traps and how the agents did |
| `CHANGELOG.md` | Versions |
