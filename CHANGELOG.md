# Changelog

## Unreleased

## v0.2.0

Built from three Opus reviews of v0.1 (method, cost, fit) plus research on Ralph loops.

- New workflows: `debug`, which reproduces a bug, falsifies competing hypotheses in parallel and ends with an Opus adjudicator; and `decide`, which gathers evidence per option against criteria, with an `upgrade` mode, and ends with an Opus attack on the leader.
- Method:
  - The sceptic re-checks by id, has no default verdict, and names gaps and alternatives; unexamined findings are marked `not-checked`.
  - Every claim needs a citation.
  - Uncited blocker or serious objections are demoted to questions.
  - Safe-to-quote claims name their evidence.
  - Verify's logic review now runs after the claim groups, with their verdicts.
- Cost:
  - Compact JSON in adversary prompts.
  - A slim verification view for attackers, with optional per-attack `groups`.
  - Per-task effort everywhere.
- Fit:
  - Generic examples across Python, TypeScript, Terraform, ESP32 and identity providers.
  - Web performance moved to an opt-in `packs/web-perf`.
  - General lessons are separated from stack-specific ones.
  - Benchmark kinds: process, browser, device and GPU.
  - Verification steps default to the developer.
- Durable output: a run folder, `REPORT.md` from a template, and a run index.
- The skill fires only on an explicit "macro it" and never on language macros.
- `npm test`:
  - the checker also enforces an identical shared prelude and no indented JSON;
  - `tests/dry-run.mjs` runs every workflow and example with a stubbed agent.
- `scripts/improve.sh`: a bounded Ralph-style loop in which Sonnet implements, `npm test` must pass, and Opus reviews. It never pushes.

## v0.1.0

First personal cut.

- Three workflows: `investigate` (evidence streams, then an Opus sceptic), `verify` (quote-backed claim checks, then Opus attackers) and `change-evidence` (checks, a clean benchmark, then an Opus challenger that writes PR claims and QA steps).
- Tiered cost: Sonnet at `low` effort for mechanical work, Sonnet at `medium` for evidence, Opus at `high` only for the adversary. Effort is always explicit.
- exa and context7 are used first for sources; every citation records `via`.
- `scripts/install.sh` for any machine; `scripts/check-workflows.mjs` enforces the rules.
- Estate-neutral harness: browser/CDP profiling, an A/B import benchmark, an nginx header test and a load-balancer log query.
