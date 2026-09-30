# macro

Claude Code workflows for engineering investigations that rest on evidence. You ask a question about a codebase, a bug, a change, a report or a choice; parallel agents gather cited evidence, and a stronger model then tries to break the answer before you act on it.

## Why it is different

- **Parallel, cited evidence.** Several Sonnet agents each take one way of knowing: measure it, read the code, read the history, read the spec. Every claim is tagged `measured`, `code`, `sourced` or `inferred` and carries a citation with a verbatim quote. No quote, no "confirmed": the scripts demote uncited verdicts rather than trust them.
- **Then an adversary.** Every run ends with an Opus agent whose only job is to break the result: a sceptic that re-checks findings by id, a logic reviewer, an attacker per recommendation, a change challenger or a debug adjudicator. It is held to the same standard: an objection without a citation becomes a question.
- **Only what survives is quotable.** The adversary's `claims_safe_for_pr` sentences, each naming its evidence, are the only ones meant for a PR, commit or report summary.

## Quick start

```sh
git clone git@github.com:joelio/claude-macro.git
cd claude-macro
export EXA_API_KEY=...        # optional: lifts exa's free-tier rate limit; stored in your OS keychain
export CONTEXT7_API_KEY=...   # optional
scripts/install.sh
```

Restart Claude Code. Then, in any repo, say **"macro it: run the smoke example"**. That runs `examples/investigate-smoke.json`: 3 agents at low effort, about 170k tokens and under a minute. When it works, ask a real question: **"macro it: <your question>"**.

The installer needs Claude Code, Node 18 or later and git. It links the skill, adds the `exa` and `context7` MCP servers at user scope, and runs the tests. It is safe to re-run; `--check` reports without changing anything. See [Getting started](docs/guide/getting-started.md).

## The five workflows

| Workflow | Use it when | Shape | Agents |
|---|---|---|---|
| `investigate` | You need to understand a problem or ticket before deciding anything | 4-6 evidence streams, a quote check, then an Opus sceptic that re-checks findings by id and names gaps and alternatives | streams + 2 |
| `verify` | A report, README, PR or set of claims is about to go to other people | An inventory of every claim, claim groups with quote-required verdicts, a quote check, then an Opus logic review and one attacker per recommendation | groups + 3 + attacks |
| `change-evidence` | A change is committed locally and needs proof before or alongside a draft PR | Parallel checks, an optional clean benchmark, then an Opus challenger that writes the safe claims and verification steps | checks + benchmark + 1 |
| `debug` | A bug, crash, flaky test or regression whose cause is not known | Reproduce plus competing hypotheses, parallel attempts to falsify each, then an Opus adjudicator with a cited cause-to-symptom chain | 2 + hypotheses + 1 |
| `decide` | A choice between options, or a dependency upgrade | Evidence per option against fixed criteria, then an Opus attack on the leader and a ranking | options + shared + 1 |

Chains are normal: investigate, then decide or debug, then change-evidence for the fix, then verify the write-up. Each is described in [Workflows](docs/guide/workflows.md).

## What a run gives you

Everything lands in a run folder, `~/.local/share/macro/<project>/<YYYY-MM-DD>-<slug>/`, outside any repo:

| File | What |
|---|---|
| `args.json` | The arguments the run used, so you can re-run or adjust it |
| `result.json` | The workflow's full return value, with the run id, transcript directory and wall time added |
| `REPORT.md` | The report, from `docs/report-template.md`: answer, deciding evidence with citations and re-check verdicts, what the adversary changed, what is not established, next steps, safe-to-quote sentences, method |
| `did-it-help.md` | Four headings for you to fill in within a day; the retro reads it |
| `<stream>/` | Raw data, saved sources and scripts from each agent |
| `UAT.md` | After `change-evidence`, the results of walking through the verification steps |

`~/.local/share/macro/INDEX.md` gets one line per run: date, project, workflow, question, verdict and path. Later runs on the same project feed those lines back in.

A real example: a `verify` run over a Rust CLI's README and getting-started guide returned 61 claims (43 confirmed, 14 partly, 4 unverifiable, none wrong) and found that the guide did not work end to end, because it never said to install the CLI it depends on. Six agents, 511k tokens, 5.8 minutes. A blind `debug` run, given only the symptom of a bug whose fix was hidden, named the real root cause and most of a second, contributing one.

## Cost and effort

Models and effort are tiered. Sonnet does the evidence work (`low` for mechanical tasks such as counts and builds, `medium` otherwise); Opus at `high` judges. `"profile"` in `args` shifts the whole run:

| Profile | Workers | Adversary | For |
|---|---|---|---|
| `quick` | `low` | `medium` | Smoke tests |
| `standard` (default) | `medium` | `high` | Most runs |
| `deep` | `high` | `xhigh` | Hard questions |
| `max` | `high` | `max` | High stakes |

An effort set on a single stream, group, check or attack overrides the profile. `"budgets"` (for example `{ "modelCalls": 15, "gets": 10 }`) splits shared limits across the agents, and the result's `usage` flags any overrun. Before any run, `node tests/dry-run.mjs --estimate <args.json> <workflow>` lists the agents and tiers at no token cost.

Cost seen in practice:

| Run | Agents | Subagent tokens | Wall time |
|---|---|---|---|
| investigate (6 streams + sceptic) | 7 | 467k | 6.6 min |
| verify (7 groups + 2 attacks, 123 claims) | 9 | 896k | 7.1 min |
| change-evidence (3 checks + benchmark + Opus) | 5 | 321k | 12.1 min |
| config-change verify (5 + Opus attack) | 6 | 528k | 9.1 min |
| v0.2 verify, cluck docs (4 groups + Opus logic + 1 attack, 61 claims) | 6 | 511k | 5.8 min |
| v0.2 investigate smoke (2 low streams + sceptic) | 3 | 168k | 0.8 min |
| v0.2 debug, blind test of a known bug (reproduce + 5 hypotheses + Opus) | 8 | 543k | 11.3 min |

The first four rows predate v0.2's compact adversary payloads, which should cut Attack-phase input by roughly 40% (an estimate, not yet measured). Runs stay at 10 agents or fewer unless you ask for more; the dry run enforces the limit.

## Guides

- [Getting started](docs/guide/getting-started.md): install, keys, `--check`, packs, a smoke run, a first real run, reading the report.
- [Workflows](docs/guide/workflows.md): each workflow's stages, args, a real example and what comes back.
- [Running well](docs/guide/running-well.md): scoping, effort profiles, estimates, lessons via `tools`, safety rules, chaining.
- [Improving](docs/guide/improving.md): `did-it-help.md`, the retro, the self-improvement loop, packs.
- [Troubleshooting](docs/guide/troubleshooting.md): the problems we hit and their fixes.
- [The eval](evals/README.md): does macro beat a single agent? Tasks with known answers, three arms, deterministic graders.

Method notes: [citations](docs/citations.md), [adversarial review](docs/adversarial.md), the [report template](docs/report-template.md) and [LESSONS.md](LESSONS.md). Maintainer notes are in `CLAUDE.md`; versions in `CHANGELOG.md`.

## Layout

| Path | What |
|---|---|
| `workflows/` | The five workflow scripts; each documents its `args` in a header comment |
| `examples/` | Example `args`, named `<workflow>-*.json` |
| `skills/macro/` | The trigger skill, linked by the installer |
| `docs/` | Method notes, the report template and these guides |
| `packs/` | Optional stack-specific harnesses (`web-perf`, `infra`); `packs/README.md` says how to write one |
| `improve/` | The self-improvement prompts and backlog |
| `scripts/` | `install.sh`, `improve.sh`, `exa-headers.sh`, `check-workflows.mjs` |
| `tests/dry-run.mjs` | Zero-token run of every workflow and example, and `--estimate` |
| `evals/` | The eval: tasks with answer keys, graders (self-tested by `npm test`), the single-agent baseline and trial preparation |
