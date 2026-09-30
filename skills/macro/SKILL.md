---
name: macro
description: Run the evidence-based "macro" investigation workflows. Parallel worker agents gather or verify evidence with tagged, quote-backed citations, then a stronger adversary tries to break the result. Use when the user says "macro", "macro it", "the macro workflow", or asks to investigate, verify and cite, or prove a change with parallel agents and an adversarial review.
---

# macro

Invoking this skill is the user's opt-in to run a Workflow.

The method, rules and harnesses live in the repo this skill belongs to; call its root `<repo>` below. Find it from this skill's base directory (shown when the skill loads) with `git -C "$(dirname "$(readlink -f <skill-dir>/SKILL.md)")" rev-parse --show-toplevel`. That works whether the skill is symlinked, in `~/.claude/skills/` or in a project's `.claude/skills/`, as long as it still sits inside a clone of the repo. Read `<repo>/CLAUDE.md` first, then `docs/citations.md` and `docs/adversarial.md`, and `LESSONS.md` before measuring anything.

## Preflight

- If `ToolSearch "exa"` or `ToolSearch "context7"` finds nothing, or the run needs `harness/` and `<repo>/harness/node_modules` is missing, tell the user to run `<repo>/scripts/install.sh` and restart Claude Code. Only continue without exa and context7 if they agree; agents then fall back to WebFetch and curl, which is slower and cites less well.

## Pick the workflow

| The user wants | Script | Shape |
|---|---|---|
| To understand a problem or ticket | `<repo>/workflows/investigate.js` | 4-6 evidence streams, then a sceptic |
| A report, PR or claim set checked and cited | `<repo>/workflows/verify.js` | claim groups with quote-required citations, then attackers per recommendation |
| Proof that a committed change is right before or during a draft PR | `<repo>/workflows/change-evidence.js` | parallel checks, optional clean benchmark, a challenger writing PR claims, QA and engineer steps |

Chains are normal: investigate, write it up, verify, then change-evidence for each fix.

## Run it

1. Scout inline first: read the ticket, find the files, establish what is already known. Put that in `context`.
2. Write `args` from the closest example in `<repo>/examples/`. Replace every placeholder. Estate details (paths, hosts, asset names, tables) go in args, not in the script.
3. Call the Workflow tool with `scriptPath` set to the script and `args` as a JSON object (not a string).
4. Keep it under 10 agents unless the user asks for more. Tier the cost: give mechanical streams, checks or groups (counts, file:line re-checks, builds, byte sizes) `"effort": "low"`; leave evidence work at the default (Sonnet, `medium`); the adversary defaults to Opus at `high`. Change models only if the user asks, and never make the adversary weaker than the workers.
5. While it runs, tell the user in a few lines what each agent covers. Don't predict results.
6. When it lands, read the full output (the journal if the summary is truncated), check the adversary's claims against the measured evidence, and fix anything it got wrong before reporting.

## Rules carried into every run

- Evidence tags `measured`, `code`, `sourced`, `inferred`; citations are source plus verbatim quote.
- Read-only against live systems, light traffic, no logins; agents never edit or commit the repo under study; raw data under `~/.local/share/<project>/`.
- Only the adversary's `claims_safe_for_pr` sentences go into a PR. QA steps use only what `qaAudience` says QA can use; steps that need cluster or shell access go under Engineer verification.
- Opening PRs, pushing, adding labels (such as ones that create preview environments) or posting to tickets still needs the user's go-ahead for that specific action.

## After a run

- Add any new trap to `<repo>/LESSONS.md` and a cost row to `<repo>/README.md` if the run was unusual. Run `node <repo>/scripts/check-workflows.mjs` after editing a workflow.
