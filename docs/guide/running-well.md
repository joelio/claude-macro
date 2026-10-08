# Running well

A run costs between roughly 150k and 900k tokens. Most of what decides whether that is money well spent happens before the first agent starts.

## Scope the question

- **One question per run.** The adversary judges one answer. "Why is `--help` slow?" is a run; "audit the CLI" is several.
- **One question per agent.** Each stream, group, check or option should be a different way of knowing the same thing: measure it, read the code, read the history, read the spec. Two agents asking the same thing waste tokens; one agent asked three things answers each worse.
- **Say what is already known.** The `context` field carries it. The skill scouts inline first (reads the ticket, finds the files) and puts that there, so agents do not rediscover it.
- **Settle the args before running.** Vague args waste a whole run. For `decide`, that means criteria with weights and the status quo as an option. For `debug`, your own suspects and any shared device. For `verify`, which claims each group owns. The skill asks you one question at a time, with a recommended answer, until every field is settled.
- **Name the limits.** `rules` is where "no API spend", "at most 10 GETs" and "only `terraform plan` in a copy" go. Agents quote how much live traffic they used.
- **Keep it under 10 agents.** The dry run refuses more unless you have asked for it. Larger questions chain better than they scale.

## Effort profiles

Every agent has an explicit effort, because an omitted one inherits the session's, which may be high. The default tiering is Sonnet at `medium` for evidence work, Sonnet at `low` for mechanical work, and Opus at `high` for the adversary. `"profile"` in `args` moves the defaults for the whole run:

| Profile | Workers | Adversary | When |
|---|---|---|---|
| `quick` | `low` | `medium` | Smoke tests and install checks |
| `standard` | `medium` | `high` | The default; most questions |
| `deep` | `high` | `xhigh` | A hard question where the workers' reading matters |
| `max` | `high` | `max` | High stakes, where the judgement is worth the most tokens |

Three rules apply on top of the profile:

- An `effort` on a single stream, group, check, option or attack overrides it. Give mechanical tasks (counts, byte sizes, file:line re-checks, builds) `"effort": "low"` whatever the profile.
- Change models only when you have a reason, and never make the adversary weaker than the workers. `workerModel`, `mechanicalModel`, `attackModel`, `reviewModel`, `judgeModel` and per-stream `model` exist for that. A `low` task that needs judgement (request counting in a browser, timing with statistics, a security inventory) should say `"model": "sonnet"`, or it runs on Haiku.
- An unknown profile name is rejected before any agent runs.

## Estimate before you spend

```sh
node <REPO>/tests/dry-run.mjs --estimate <workDir>/args.json <workflow>
```

This runs the workflow with a stubbed `agent()` and costs no tokens. It lists every agent with its model and effort, and it validates the args: a missing required field, a relative `workDir`, duplicate keys, an unknown profile or an attack naming a group that does not exist all fail here rather than mid-run. For example:

```
verify: 4 agents (2 sonnet/medium, 1 haiku/low, 1 opus/high)
  verify:api: sonnet/medium
  verify:compat: haiku/low
  verify:benchmarks: sonnet/medium
  logic: opus/high
```

Counts that depend on agent output, such as `debug`'s hypotheses, are shown at their minimum. Opus agents dominate the cost, so compare the count against the table in the README.

The example files use placeholders such as `<HOME>` and `<REPO>`; the estimator substitutes those, so you can estimate an example directly.

## Feed in lessons through `tools`

`tools` is free text appended to the sources section of every agent's prompt. The skill uses it for:

- the trap bullets from `LESSONS.md`, and from the pack's `LESSONS.md` if you are using one;
- this project's lines from `~/.local/share/macro/INDEX.md`, so a second run knows what the first found;
- stack hints: `CARGO_TARGET_DIR=<workDir>/target`, `. $IDF_PATH/export.sh`, `uv venv`, or "the mock runner needs no model".

A hint from a real run: "save the fetched text of every quote you cite under the work dir, because a quote missing from its saved source counts as untestable." That went into `tools` for the next run.

## Safety rules

These are in every prompt, and the prompt states that they override any `CLAUDE.md` or `AGENTS.md` in the repo under study.

- **Read-only against anything live.** No writes, logins, sign-ups or load tests. Traffic stays light, and each agent says how much it used. Put hard caps in `rules`.
- **Agents never edit, stash, reset, checkout or commit in the repo under study.** A `git checkout` or `stash` by an agent destroys uncommitted work, which is why this is absolute. The two exceptions are git-ignored build output in a change's worktree during `change-evidence`, and disposable copies.
- **Disposable clones.** When an agent needs to change code (add logging, flip a flag, bisect, install an upgrade), it works in `git clone --local <repo> <workDir>/<task>/src`, brings over uncommitted work with `git diff HEAD --binary | git apply`, and copies untracked files the bug needs. `decide` in `upgrade` mode never changes the repo's lockfile; it installs the target in a clone.
- **Raw data goes to the run folder,** `~/.local/share/macro/<project>/<date>-<slug>/`, never into a repo.
- **Local headless browsers only.**
- **Shared devices are serialised.** `debug`'s `exclusive` arg names a resource only one test may hold (a dev board on a serial port, the one GPU, a database port); hypotheses that need it are tested one at a time, and the holder is told to release it before returning.
- **Opening PRs, pushing, adding labels or posting to tickets** still needs your go-ahead for that specific action, even after a run.

## Chaining workflows

A run's `claims_safe_for_pr`, raw data and INDEX line are meant to feed the next one:

1. **investigate** turns a ticket into measured, sourced and code-read findings, with what nobody looked at listed under "Not established".
2. **decide** or **debug** takes the findings forward: choose between the options the investigation surfaced, or root-cause the symptom it narrowed.
3. **change-evidence** proves the fix once it is committed locally, and writes the sentences safe for the PR and the steps for whoever verifies it.
4. **verify** checks the write-up before it circulates. A fresh verify over a report that had already been verified still found four wrong claims and flipped an option ranking, mostly by joining evidence from later runs.

Pass the earlier run's report path and raw-data directory in `context` (the `web-perf` pack's `verify-report.json` example does exactly that), and its INDEX line in `tools`.
