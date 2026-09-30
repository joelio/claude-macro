# macro

A way of running an engineering investigation with Claude Code workflows: many cheap agents gather evidence in parallel, each claim is tagged by how it is known, and a stronger model tries to break the result before anyone acts on it.

It works on any codebase and question: performance, security posture, a config change, a library upgrade, "is this report right?". The examples come from a web performance investigation that went from "the page loads too much" to two evidence-backed PRs, a cited report and production traffic numbers in a day.

```
 question / ticket
        │
        ▼
 ┌──────────────┐  4-6 Sonnet agents, one way of knowing each
 │ investigate  │  (network, CPU, code map, history, compat, usage)
 └──────┬───────┘  then an Opus sceptic re-checks the headline claims
        │ report (you write it; agents gather)
        ▼
 ┌──────────────┐  one Sonnet agent per claim group, quotes required
 │   verify     │  (specs, security, platform, codebase, data, logic)
 └──────┬───────┘  then Opus argues against each recommendation
        │ corrected report, ranked options
        ▼
 ┌──────────────┐  parallel checks (bytes, equivalence, build, platform)
 │change-evidence│ benchmark alone on a quiet machine
 └──────┬───────┘  Opus review writes safe PR claims, QA and engineer steps
        │
        ▼
 draft PR + preview-environment measurement (you run it)
```

## Install

Needs Claude Code, Node 18+ and git. Docker and `bq`/`gcloud` are optional (only the nginx and BigQuery harnesses use them).

```sh
git clone <this repo> && cd <repo>
export EXA_API_KEY=...        # optional: lifts exa's free-tier rate limit
export CONTEXT7_API_KEY=...   # optional
scripts/install.sh            # or --check to see what is missing, --no-harness to skip npm/Playwright
```

The installer is safe to re-run. It:

- links the skill into `~/.claude/skills/`;
- adds the **exa** MCP server (web search, page fetch, code context) and the **context7** MCP server (library docs) at user scope, so they load in whichever repo you investigate;
- installs the harness and Playwright's headless shell;
- parse-checks the workflows.

It leaves MCP servers you already have alone unless you pass `--update-mcp`. Restart Claude Code afterwards.

Every workflow prompt tells agents to use context7 for library behaviour, exa to find specs and vendor docs, `web_fetch_exa` for the exact text they quote and `get_code_context_exa` for real-world usage. Agents fall back to WebFetch or curl when a tool is rate-limited, and each citation records which one was used in `via`.

## Rules the agents follow

- **Evidence tags.** Every claim is `measured`, `code`, `sourced` or `inferred`. A tag that overstates certainty is a defect.
- **Citations.** A verdict needs a URL or `file:line` and a short verbatim quote. No quote, no "confirmed".
- **Numbers.** Method, n, median with IQR or min-max. Say whether KB is 1,000 or 1,024.
- **Safety.** Read-only against live systems, light traffic, no repo edits or commits by agents, raw data outside the repo. The one exception: change-evidence may create git-ignored build output in the change's worktree.
- **Adversary last.** The strongest model reviews, and its job is to break things, not summarise.
- **Models and effort.** Menial checks run on Sonnet at `low` effort, evidence workers on Sonnet at `medium`, and only the adversary on Opus at `high`. Effort is always set explicitly, because an omitted one inherits the session's. Override per task in `args` (`effort` on a stream, check or group; `workerModel`, `attackModel`, `reviewModel`, `sceptic.model`); the adversary is stronger than the workers by default and never weaker. In verify, give the `logic` group `"model": "opus", "effort": "high"`: it acts as an adversary.

## Running one

The `macro` skill (`skills/macro/SKILL.md`, linked by the installer) picks the right workflow and builds its args. From any repo, say "macro it" or "run the macro workflow on …". To drive a workflow by hand, ask Claude Code, for example:

> Run the workflow at `<repo>/workflows/verify.js` with args from `<repo>/examples/verify-report.json`.

or pass `scriptPath` and `args` to the Workflow tool directly. Examples in `examples/` are the real runs this was distilled from, with estate-specific paths left as placeholders.

## Cost seen in practice

| Run | Agents | Subagent tokens | Wall time |
|---|---|---|---|
| investigate (6 streams + sceptic) | 7 | 467k | 6.6 min |
| verify (7 groups + 2 attacks, 123 claims) | 9 | 896k | 7.1 min |
| change-evidence (3 checks + benchmark + Opus) | 5 | 321k | 12.1 min |
| mobile analysis (3 + Opus review) | 4 | 323k | 6.4 min |
| config-change verify (5 + Opus attack, BigQuery) | 6 | 528k | 9.1 min |

Keep a run under 10 agents unless asked. Scope each agent to one question.

## What's here

| Path | What |
|---|---|
| `workflows/investigate.js` | Evidence streams, then a sceptic |
| `workflows/verify.js` | Cited claim checks, then adversaries per recommendation |
| `workflows/change-evidence.js` | Checks, optional clean benchmark, Opus review with PR claims and QA steps |
| `examples/` | `args` for each workflow from real runs |
| `harness/browser/` | Playwright + CDP scripts: cold-load profile, real warm-cache test, throttled WebView emulation. Settings come from env (`ASSET_MATCH`, `ASSET_PREFIX`, `EMBED_HEADER`, `WEBVIEW_UA`, `OUT_DIR`) and each output records browser, OS, CPU and load |
| `harness/bench-import/` | A/B module import benchmark: fresh browser per run, seeded interleave, bootstrap CI |
| `harness/nginx-headers/` | Run your nginx configs in Docker against a stand-in upstream and assert status and headers from a cases file |
| `harness/bigquery/` | Parameterised load-balancer log query: downloads and bytes of one asset by client type |
| `skills/macro/` | Claude Code skill that triggers the workflows (link into `~/.claude/skills/`) |
| `docs/citations.md` | Evidence tags, quote-required citations, the source ladder, fetching when tools fail |
| `docs/adversarial.md` | Sceptic, logic reviewer, attackers and challenger: when to use each and what they caught |
| `LESSONS.md` | Traps that cost time, and how the agents did |
| `CLAUDE.md` | Conventions for editing this repo (`AGENTS.md` links to it) |
| `scripts/install.sh` | Per-developer install and `--check`: skill link, exa and context7 MCP servers, harness |
| `scripts/check-workflows.mjs` | Checks each workflow (pure meta, two-way phase match, Opus last, evidence tags, `{source, quote, via}` citations, exa and context7 in prompts, effort on every agent) and syntax-checks the harness |

Browser scripts use Playwright's headless shell, or `CHROME_PATH` if set. Each script's header comment lists its arguments and environment variables.
