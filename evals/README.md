# Eval: does macro beat a single agent?

Design from docs/research/2026-10-01-harness-engineering.md: OpenHands' no-skill baseline, Anthropic's evals and infrastructure-noise guidance, and a token-matched arm, because token use explains most of the variance in quality.

## Arms

| Arm | What runs | How |
|---|---|---|
| A | One Opus agent at `high`, task prompt only | Workflow `evals/single.js`, `mode: "plain"` |
| B | macro, the task's workflow at the `standard` profile | Workflow `workflows/<task.macro.workflow>.js` with `task.macro.args` |
| C | One Opus agent at `max`, with macro's discipline (evidence tags, quoted citations, then attack its own answer) | Workflow `evals/single.js`, `mode: "discipline"` |

If B doesn't beat C per token, the value is in the discipline rather than the parallel agents, and the toolkit should get simpler.

## Tasks

Each has a reference answer and a known-bad answer. `node evals/grade.mjs --self-test` (part of `npm test`) proves every grader passes the reference and fails the bad answer before any tokens are spent.

| Task | Kind | Known answer |
|---|---|---|
| `planted-report` | claims | 7 planted errors in a fictional results report: a Wald interval labelled 95%, "four" areas that are five, a wrong percentage, a total that doesn't match its rows, a p-value below its floor, a wrong density, wrong review hours |
| `clean-report` | negative control | The same report with every number correct. Pass means zero claims judged wrong |
| `cluck-docs` | claims | 5 real problems in cluck's docs at `a74d588`, confirmed in dogfood run 1 |
| `debug-22` | debug | The two causes of cluck bug #22, with the fix stripped from the target's history |

## Running a trial

1. `evals/prepare.sh <task> <run-dir>/<task>/<arm>-<n>` builds a clean target, with no history beyond the task's commit.
2. Replace `<TARGET>` and `<WORKDIR>` in `tasks/<task>/task.json` with `<trial>/target` and `<trial>/work`.
3. Run the arm with the Workflow tool. Arms A and C use `evals/single.js` with `{ prompt, kind, mode, workDir }`; arm B uses the macro workflow and args.
4. Save the Workflow's return value to `<trial>/output.json`, and note `subagent_tokens` from its usage.
5. `node evals/grade.mjs <task> <trial>/output.json`, then append `{ task, arm, trial, tokens, score }` as one line to `<run-dir>/results.jsonl`.
6. `node evals/grade.mjs --summary <run-dir>` gives pass counts, mean recall, false flags, mean tokens and tokens per pass by task and arm.

Rules for fairness:
- Every arm gets the same tools and limits.
- Every prompt forbids reading `evals/`.
- Interleave arms rather than running one arm's trials in a batch.
- Log infrastructure failures (rate limits, outages) separately and re-run them; don't count them as agent failures.
- Read a sample of transcripts from each arm, to confirm the failures are fair.

## Run it from a clean session

Workflow agents inherit the session's context: the CLAUDE.md files in the session's working directory and above, and fragments of the conversation. The pilot ran in a session whose working directory's CLAUDE.md describes macro's method, and arm A's agents quoted the user's latest message. So arm A wasn't truly plain.

For tier 0, start a new Claude Code session in a neutral directory with no CLAUDE.md (for example `~/.local/share/macro/eval/`), check that `~/.claude/CLAUDE.md` doesn't carry method instructions, and run every arm from there.

## Results

- [Pilot, 1 October 2026](results/2026-10-01-pilot.md): all three arms pass both report tasks, so the report is a ceiling task. B costs about 5 times A, and C about 2 times.

## Sizes

- **Pilot:** `planted-report` and `clean-report` × 3 arms × 1 trial, about 2M tokens. It checks the tasks and graders against real output.
- **Tier 0**, revised after the pilot: `cluck-docs` and `debug-22` × 3 arms × 3 trials, plus `clean-report` × 3 arms × 1, about 5M tokens. The synthetic `planted-report` is now a regression check only. Tier 0 can show only large effects; a difference of less than one task's worth is noise.

Report pass^3 (every trial passes), and cost per passed task.
