# Getting started

This page takes you from a fresh clone to your first real run and a report you can read. Everything here is done by `scripts/install.sh` and the `macro` skill; nothing needs editing by hand.

## What you need

- Claude Code (the `claude` CLI). The installer finds it on your `PATH`, or at `~/.claude/local/claude`; set `CLAUDE_BIN` if it lives elsewhere.
- Node 18 or later.
- git.

Optional, but worth having:

- An exa API key. Without one, exa runs anonymously and rate-limits a parallel fan-out within minutes.
- A context7 API key.
- Docker, `bq` and `gcloud` for some scripts in the `web-perf` pack.

## Install

```sh
git clone git@github.com:joelio/claude-macro.git
cd claude-macro
export EXA_API_KEY=...        # optional
export CONTEXT7_API_KEY=...   # optional
scripts/install.sh
```

Then restart Claude Code so it picks up the skill and the MCP servers.

The installer is safe to re-run. It prints one line per item, `ok`, `run`, `todo`, `WARN`, `skip` or `FAIL`, and ends with `Ready.` or `Some items need attention (see above).` It does the following, in order.

1. **Prerequisites.** Runs `claude --version` and checks Node is 18 or later. If `claude` is found but does not run, it stops and tells you how to repair a local install (see [Troubleshooting](troubleshooting.md)).
2. **Skill.** Links `~/.claude/skills/macro` to `<REPO>/skills/macro`. If something else is already at that path it warns and leaves it alone.
3. **MCP servers, at user scope,** so they load in whatever repo you investigate.
   - **exa**, with the tools `web_search_exa`, `web_fetch_exa`, `get_code_context_exa` and `crawling_exa`. The server entry names `<REPO>/scripts/exa-headers.sh` as its `headersHelper`; Claude Code runs that script at connect time to get the `x-api-key` header. The key itself is never written to `~/.claude.json`.
   - **context7**, with a `CONTEXT7_API_KEY` header if you exported one.
   - Existing servers are left as they are unless you pass `--update-mcp`.
4. **Workflows.** Runs the checker and the dry run (`npm test`) and reports how many checks passed.

### Where the exa key goes

If `EXA_API_KEY` is set when you run the installer, the key is stored in your OS keychain under the service name `claude-macro-exa`: the macOS Keychain via `security`, or the Linux secret service via `secret-tool`. `scripts/exa-headers.sh` reads it from there each time Claude Code connects to exa. If neither keychain tool exists, the installer warns and asks you to export `EXA_API_KEY` in your shell profile instead; the helper falls back to the environment variable.

Because the key is fetched at connect time, `claude mcp list` and `claude mcp get exa` never show it. Older installs put the key in the exa URL; `scripts/install.sh --update-mcp` migrates it into the keychain.

### Checking an install

```sh
scripts/install.sh --check
```

`--check` reports what is missing and changes nothing. Items it would install appear as `todo`. A typical clean result:

```
Prerequisites
  ok    claude 2.1.x (Claude Code)
  ok    node v22.x
Skill
  ok    ~/.claude/skills/macro -> <REPO>/skills/macro
MCP servers (user scope, so they load in whatever repo you investigate)
  ok    exa (key from keychain via scripts/exa-headers.sh)
  ok    context7
Workflows
  ok    npm test (24 checks)
Ready.
```

### Packs

A pack is a stack-specific harness with its own examples and lessons. Packs are installed only when you ask:

```sh
scripts/install.sh --pack web-perf
```

That installs the pack's npm packages under `packs/web-perf/harness/`, installs Playwright's Chromium headless shell if the harness depends on Playwright, and reports which of the pack's optional tools (`docker`, `bq`, `gcloud` for `web-perf`) are on your `PATH`. `--pack` can be repeated. See [Improving](improving.md#packs) for what a pack contains.

## A first smoke run

Open Claude Code in any repo and say:

> macro it: run the smoke example

The skill runs `examples/investigate-smoke.json`: two Sonnet streams at `low` effort (one counts `agent(` calls in this repo's workflows, one asks context7 what Playwright says about `page.route` and the HTTP cache), then an Opus sceptic at `low`. Three agents. In practice it took 48 seconds and about 168k subagent tokens.

It checks the whole path at once: the skill loads, the Workflow tool runs the script, context7 answers, citations carry `via`, and the sceptic's verdicts are joined back onto the findings. If any of those fail, [Troubleshooting](troubleshooting.md) covers what we have seen.

While it runs, Claude tells you in a few lines what each agent covers. When it finishes you get the path of the report.

## A first real run

Say `macro it:` followed by your question. Two things make the run worth its cost:

- **Scope.** One question per run, and one question per agent. "Is this README accurate at v0.1.0?" is a run. "Make the docs better" is not.
- **Context.** Say what is already known, where the code is, and what must not happen (no API spend, no writes, at most n requests). The skill scouts inline first and puts what it finds in `context`, and interviews you one question at a time for anything the workflow needs that it cannot look up.

Before spending tokens it writes the arguments to the run folder as `args.json`, runs `node tests/dry-run.mjs --estimate` on them, and tells you the agent count. An explicit "macro it" is your opt-in; otherwise it names the workflow, the count and the expected cost and waits for a yes.

A real first run: a `verify` of a small Rust CLI's `README.md` and `docs/getting-started.md`, with four claim groups (config, behaviour, install, external), a logic review and one attack on the README's secret-redaction claim. The rules said no model calls and at most 10 GETs to GitHub. Six agents, 5.8 minutes, 511k subagent tokens. The report's answer paragraph read, in part:

> Mostly accurate: of 61 claims, 43 were confirmed, 14 partly true and 4 unverifiable, and none were outright wrong. But getting-started does not work end to end for a new user.

The gap was a missing install step for the CLI the tool depends on. The redaction claim did not survive the attack: several common secret formats passed through unredacted, each shown with a citation into the source.

## Reading the report

`REPORT.md` follows `docs/report-template.md`. Read it in this order.

| Section | What it tells you |
|---|---|
| Header line | Date, workflow, agent count, tokens, wall time and the run folder |
| **Answer** | One paragraph: the adversary's verdict or decision, using its enum values verbatim (`ship-as-draft`, `established`, `clear`, and so on) |
| **Evidence that decides it** | A table of the claims the answer rests on, each with its tag, its citation (source and quote) and the adversary's re-check verdict: `upheld`, `weakened`, `refuted`, `untestable` or `not-checked` |
| **What the adversary changed** | Objections by severity, ratings or claims it corrected, what it re-ran. Uncited blocker or serious objections appear here as questions, marked as demoted |
| **Not established** | Findings nobody re-checked, untestable claims, unexplained symptoms, open questions. Read this before acting; it is where the run is honest about its limits |
| **Next steps** | The fix direction, the first steps, a regression test, or the cheapest test that would change the answer |
| **Safe to quote** | The `claims_safe_for_pr` sentences, verbatim, each naming its evidence. These are the only sentences meant for a PR, commit or summary |
| **Method** | Streams or groups, models and effort, live traffic used, verdict counts, the quote spot-check |

Two habits pay off. Check the adversary's own claims against the measured evidence, as the skill does; in one early run Opus asserted something the evidence had already disproved. And treat the Method section's quote spot-check as a health signal: the skill greps five quotes against their sources and records how many it found.

## What else is in the run folder

- `result.json`: the workflow's full return value, plus the run id, the transcript directory and the wall time. The `spent` field holds output-token counts at each phase boundary; they are cumulative for the orchestrator's turn, so the differences between marks are the per-phase numbers.
- `did-it-help.md`: four headings for you to fill in within a day. [Improving](improving.md) explains where it goes.
- One directory per stream, group, check or hypothesis, holding raw data and the fetched text of every quoted source.
- `UAT.md`, after a `change-evidence` run, if you accepted the offer to walk through the verification steps.

And `~/.local/share/macro/INDEX.md` gains one line: date, project, workflow, question, verdict, path.
