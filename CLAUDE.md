# macro

Reusable Claude Code workflows for evidence-based engineering investigations, plus the harnesses they drive. Read `README.md` for the method, `docs/citations.md` and `docs/adversarial.md` for the two disciplines every workflow follows, and `LESSONS.md` before measuring anything.

## Layout

- `workflows/*.js` — Workflow tool scripts. Inputs come from `args`; see `examples/` for real ones.
- `packs/<name>/` — optional stack-specific harness, examples and LESSONS (e.g. `web-perf`). Installed with `scripts/install.sh --pack <name>`.
- `improve/` and `scripts/improve.sh` — the bounded self-improvement loop and its backlog.
- `tests/dry-run.mjs` — zero-token end-to-end run of every workflow against every example. `npm test` runs it with the checker.
- `skills/macro/SKILL.md` — the trigger skill, symlinked from `~/.claude/skills/macro`. Keep it in step with the workflows, and refer to repo files by path relative to the repo, never an absolute path.
- `scripts/install.sh` — per-developer install and `--check`. Anything a workflow or harness newly depends on goes in here and in README's Install section.
- `scripts/check-workflows.mjs` — checks every workflow (pure meta, two-way phase match, Opus last, evidence tags, `{source, quote, via}` citations, the SOURCES block, effort on every agent) and syntax-checks the harness. Run `npm test` after any edit.

## Writing workflows

- Plain JavaScript, not TypeScript. `export const meta = {...}` first, as a pure literal with `name`, `description` and `phases` whose titles match the `phase()` calls.
- No `Date.now()`, `Math.random()` or `new Date()` anywhere; they break resume. Pass timestamps and seeds in `args`.
- Default to `parallel()` for independent streams and one barrier before the sceptic or adversary, which need everything together.
- Models and effort are tiered to balance quality against token quota. Always set `effort`: an omitted effort inherits the session's, which may be high.
  - Mechanical work (counting bytes, re-checking file:line, running a build, re-deriving numbers): `sonnet`, effort `low`.
  - Evidence workers (measuring, reading code, finding sources): `sonnet`, effort `medium`.
  - Adversary or final reviewer: `opus`, effort `high`. Opus is only for the stage that judges.
  - `args` may override any of these per task. Never make the adversary weaker than the workers, and don't raise worker effort above `medium` without a reason.
- Keep a run under 10 agents unless the user asks for more.
- Every worker returns a schema built from the shared prelude (`FACT`, `CITATIONS`, `OBJECTION`, `SAFE_CLAIMS`). The prelude between `// --- shared:` and `// --- end shared ---` must be byte-identical in every workflow; edit one, copy to all.
- Every workflow has at least one example in `examples/` or a pack, named `<workflow>-*.json`, so the dry run covers it.
- Adversary prompts carry compact JSON (`JSON.stringify(x)`), and verify's attackers get a slim view.
- Keep workflows and harness scripts estate-neutral. Paths, hosts, tables, asset names, user agents, header names and dates go in `args`, environment variables, parameters or placeholders, never in the script.
- exa and context7 are dependencies (installed at user scope by `scripts/install.sh`). Every workflow includes the `SOURCES` block telling agents to use them first, and every citation records `via`. Workflows must still finish with WebFetch or curl alone when those tools are rate-limited or missing.
- Portability: this runs on other developers' machines against other repos. No absolute paths, usernames or machine-specific binaries; resolve the repo from the skill link, and the Claude binary and browsers from the environment.

## Citation and adversarial methods

These are what make the output trustworthy; don't write a workflow without them.

- Every worker schema has an evidence tag (`measured`, `code`, `sourced`, `inferred`) and citations as `{source, quote}` pairs. No quote, no "confirmed". See `docs/citations.md`.
- Every workflow validates its required `args` up front (absolute `workDir`, no `undefined` in prompts) and ends with an adversarial stage on a stronger model; verify adds one even when no attacks are passed: sceptic, logic reviewer, per-recommendation attacker or change challenger. See `docs/adversarial.md` for which to use.
- Only the adversary's `claims_safe_for_pr` sentences go into PR descriptions.

## Rules that go into every prompt

- Read-only against live systems; light traffic; say how much was used.
- Agents never edit, stash, reset or commit in the repo under study. Exceptions: git-ignored build output in a change's worktree during change-evidence, and disposable `git clone --local` copies under the run folder. Raw data goes to the run folder, `~/.local/share/macro/<project>/<date>-<slug>/`.
- Local headless browsers only.
- Cite primary sources: context7 for libraries, exa to find and fetch specs and docs, curl when they rate-limit.

## Changing this repo

- Add a trap to `LESSONS.md` whenever a measurement or tool misled us, with the fix.
- Update the cost table in `README.md` when a run is notably bigger or smaller.
- Never commit secrets, API keys, internal hostnames or customer data. Examples use placeholders.
- Commit as the user's GitHub noreply identity. Remote: private repo joelio/claude-macro (main). Versions are tagged `vX.Y.Z` with an entry in `CHANGELOG.md`.
