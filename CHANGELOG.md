# Changelog

## v0.1.0

First personal cut.

- Three workflows: `investigate` (evidence streams, then an Opus sceptic), `verify` (quote-backed claim checks, then Opus attackers) and `change-evidence` (checks, a clean benchmark, then an Opus challenger that writes PR claims and QA steps).
- Tiered cost: Sonnet at `low` effort for mechanical work, Sonnet at `medium` for evidence, Opus at `high` only for the adversary. Effort is always explicit.
- exa and context7 are used first for sources; every citation records `via`.
- `scripts/install.sh` for any machine; `scripts/check-workflows.mjs` enforces the rules.
- Estate-neutral harness: browser/CDP profiling, an A/B import benchmark, an nginx header test and a load-balancer log query.
