# Workflows

Five workflows, one per kind of question. Each is a script in `workflows/`, takes its inputs from `args`, and ends with an adversary on Opus. This page covers each one's stages, args, a real example and what comes back. The args are taken from the header comment of each script; if the two ever differ, the script wins.

Common to all five:

- `workDir` must be an absolute path outside any repo. Raw data, saved sources and clones go under it, one directory per agent.
- `rules` (optional) appends safety rules to every prompt; `tools` (optional) appends notes on sources and tools.
- `profile` (optional) is one of `quick`, `standard`, `deep` or `max` and sets the default effort for the run. In the tables below, "work" and "judge" mean the profile's worker and adversary effort: `medium` and `high` under `standard`. An `effort` on a single item overrides the profile.
- Keys (`streams[].key`, `groups[].key`, and so on) must be unique.
- `budgets` (optional), such as `{ "modelCalls": 15, "gets": 10 }`, sets shared limits for the run. Parallel agents can't see each other's spend, so the script splits each limit: workers share 80% and adversaries 20%, and every prompt states the shares.
- Every result includes:
  - `spent`: output tokens per phase;
  - `usage`: `{ limits, used, over }`, summed from what each agent reports it used; `over` lists any overrun;
  - `not_run`: agents that failed or were skipped. A non-empty `not_run` means the run is incomplete, and the report must say so.
- Every citation is `{source, quote, via}`, where `via` is one of `context7`, `exa`, `webfetch`, `curl`, `repo`, `package-source`, `raw-data` or `other`.
- Every objection has a `severity` of `blocker`, `serious`, `minor`, `question` or `refuted`. A blocker, serious or refuted objection without a citation is demoted to `question`, with `demoted_from` recording what it was.
- `claims_safe_for_pr` is a list of `{sentence, supported_by}`; each sentence names the evidence ids behind its numbers.

| Workflow | Question | Agents |
|---|---|---|
| [investigate](#investigate) | What is going on here? | streams + 1 |
| [verify](#verify) | Is this write-up right? | groups + 1 + attacks |
| [change-evidence](#change-evidence) | Is this change right, and what can I say about it? | checks + benchmark + 1 |
| [debug](#debug) | Why does this happen? | 2 + hypotheses + 1 |
| [decide](#decide) | Which option, or should we upgrade? | options + shared + 1 |

## investigate

`workflows/investigate.js`

### When

Use it at the start: a ticket, a slow command, a surprising number, a "why does every page load this?" It turns the question into measured, code-read and sourced findings and tells you what nobody looked at.

Do not use it when you already have a hypothesis to test (`debug`), a finished write-up to check (`verify`) or options to rank (`decide`). Do not use it for one small question a single agent could answer.

### Stages

| Phase | Agents | Model | Effort |
|---|---|---|---|
| Measure | one per stream, in parallel | `streams[].model`, else `workerModel`, else `sonnet` | `streams[].effort`, else work |
| Quotes | the quote check (skip with `quoteCheck: false`) | `workerModel`, else `sonnet` | `low` |
| Challenge | the sceptic | `sceptic.model`, else `opus` | `sceptic.effort`, else judge |

The quote check finds each citation's quote in its source (the saved copy, the file at the commit, or the URL) and marks findings whose quote wasn't found (`quote_check: not-found`, `wrong-line` or `source-missing`). A missing source is reported, never counted as found. The sceptic re-checks those before upholding them.

The sceptic first lists the sub-questions the topic implies and marks which no stream answered. Then it re-checks findings by id: at least `minClaims` of them (default 12, capped at the number of findings), and every measured or code finding the decision depends on. `upheld` needs its own re-check to reproduce the finding, with a citation; without one the script records `untestable`. It names one alternative explanation per headline finding, flags contradictions between streams, and writes the safe claims. A safe claim may rest on upheld findings, or on weakened ones in their corrected form, marked `rests_on_corrected`.

### Args

| Arg | Required | Meaning |
|---|---|---|
| `topic` | yes | The question, in one line |
| `context` | yes | What is already known: paths, constraints, prior findings |
| `workDir` | yes | Absolute directory for raw data |
| `streams` | yes | `[{ key, prompt, model?, effort? }]`. Four to six, each a different way of knowing. `"effort": "low"` for mechanical ones |
| `sceptic` | no | `{ model?, effort?, minClaims? }`; defaults `opus`, judge, 12 |
| `workerModel` | no | Default model for streams; `sonnet` |
| `rules`, `tools`, `profile` | no | As above |

### Example

`examples/investigate-cli-startup.json`:

```json
{
  "topic": "`<cli> --help` takes about 1.8 s; where does the time go?",
  "context": "Python CLI at <REPO> (entry point <module>:main), installed with pipx. Suspect: eager imports.",
  "workDir": "<HOME>/.local/share/macro/<project>/<runId>-cli-startup",
  "streams": [
    { "key": "import-time", "effort": "low", "prompt": "python -X importtime -c 'import <module>' n=10: top 15 modules by cumulative time, median and min-max. Save raw output." },
    { "key": "code-map", "prompt": "Which imports on the --help path are eager and could be deferred? file:line for each, and what imports them." },
    { "key": "history", "prompt": "git log -S and blame: when did startup get slow, and which commits added the heavy imports?" },
    { "key": "packaging", "effort": "low", "prompt": "Entry-point shim overhead: time the console script vs python -m <module> --help, n=20 each." }
  ]
}
```

Five agents: two Sonnet `low`, two Sonnet `medium`, one Opus `high`. `examples/investigate-smoke.json` is the three-agent install check.

### What comes back

```
{ spent, usage, not_run, streams, sceptic, unchecked }
```

- `streams[]`: each stream's `method`, `findings`, `numbers` (a markdown table), `unknowns` and `raw_paths`. Every finding has an `id` (`<stream>#<n>`), a `kind` tag, `evidence`, `citations`, and the sceptic's verdict joined on as `sceptic.verdict`.
- `sceptic.checks[]`: `id`, `verdict`, `corrected_claim` (when weakened), `recheck` (what it re-ran) and `citations`.
- `sceptic.unanswered[]`: sub-questions no stream answered, each with `why_it_matters` and `cheapest_test`.
- `sceptic.alternatives[]`: one alternative explanation per headline finding, with a `distinguishing_test` and what `ruled_out_by` it, or `none`.
- `sceptic.contradictions[]` and `sceptic.claims_safe_for_pr[]`. The script keeps only safe claims whose `supported_by` ids were all upheld.
- `unchecked[]`: finding ids the sceptic did not examine; they carry `verdict: not-checked`.

Reading the verdicts: `upheld` means the sceptic reproduced it; `weakened` means it holds in the narrower form in `corrected_claim`; `refuted` means the re-check contradicted it or the quote was not in its source; `untestable` means nobody can currently say. In the smoke run the sceptic checked all ten findings: six upheld, three weakened, one untestable, and it found a quote that was missing from its saved source.

## verify

`workflows/verify.js`

### When

Use it before a report, README, PR description or set of claims goes to other people, and again before it circulates widely. It confirms, corrects and cites every claim, then asks whether the conclusions follow.

Do not use it to gather new evidence about a system; that is `investigate`. Do not use it on a change that has not been written up yet; that is `change-evidence`.

### Stages

| Phase | Agents | Model | Effort |
|---|---|---|---|
| Inventory | one agent lists every checkable claim and assigns each to exactly one group (skip with `inventory: false`) | `workerModel`, else `sonnet` | `low` |
| Verify | one per group, in parallel; each must return a verdict for every claim it was given | `groups[].model`, else `workerModel`, else `sonnet` | `groups[].effort`, else work |
| Quotes | the quote check (skip with `quoteCheck: false`) | `workerModel`, else `sonnet` | `low` |
| Attack | the logic review, plus one attacker per entry in `attacks`, in parallel | logic: `logic.model`, else `attackModel`, else `opus`; attackers: `attackModel`, else `opus` | logic: `logic.effort`, else judge; attackers: `attacks[].effort`, else judge |

The logic review always runs, even with no `attacks`. It works from the groups' verdicts: for each conclusion in the target, its premises and their verdicts, whether it follows, hidden assumptions, confounders, missing alternatives, and tags stronger than the evidence. Each attacker argues against one recommendation as hard as it honestly can. Attackers and the logic review get a slim view of the verdicts: quotes stay where a wrong one would matter (disputed claims, and confirmed measured or code claims), other confirmed claims keep only their sources. An attack's `groups` limits which groups it sees with quotes; it still sees the rest without them.

### Args

| Arg | Required | Meaning |
|---|---|---|
| `target` | yes | What is being verified: a report path, a commit (`git -C <repo> show <sha>`), a PR |
| `context` | yes | Background, paths, what is already established |
| `workDir` | yes | Absolute directory for fetched sources and raw data |
| `groups` | yes | `[{ key, prompt, model?, effort? }]`, for example specs, security, platform, codebase, data. A group may not be keyed `logic` |
| `logic` | no | `{ prompt?, model?, effort? }`; extra instructions for the logic review, which runs regardless |
| `inventory`, `quoteCheck` | no | Both default on; `false` skips the stage |
| `recheck` | no | Default off. When on, a mechanical agent re-opens the citations behind the adversaries' blocker and serious objections and their safe claims, after the attack |
| `attacks` | no | `[{ key, prompt, effort?, groups? }]`, one per recommendation. `groups` must name existing group keys |
| `workerModel`, `attackModel` | no | Defaults `sonnet` and `opus` |
| `rules`, `tools`, `profile` | no | As above |

### Example

`examples/verify-readme-claims.json`:

```json
{
  "target": "The README at <REPO>/README.md (read it fully first)",
  "context": "TypeScript library at <REPO>, read-only. Published as <package> on npm.",
  "workDir": "<HOME>/.local/share/macro/<project>/<runId>-verify-readme",
  "groups": [
    { "key": "api", "prompt": "Every documented function, option and default: does it match src/ at HEAD? Cite both." },
    { "key": "compat", "effort": "low", "prompt": "Every support claim (Node versions, ESM/CJS, browsers) against package.json engines, exports and the CI matrix." },
    { "key": "benchmarks", "prompt": "Re-run the README benchmark in a clone under the work dir, n=20; compare with the stated numbers, same units." }
  ],
  "logic": { "prompt": "Pay attention to comparisons with other libraries and any 'fastest' or 'zero-cost' wording." }
}
```

Four agents. The pack example `packs/web-perf/examples/verify-report.json` adds two attacks and reaches nine.

### What comes back

```
{ spent, usage, not_run, counts, inventory, missed, quotes, verified, logic, attacks, recheck }
```

- `inventory.claims[]` and `missed[]`: every checkable claim the inventory found, and those no group returned a verdict for. The logic review sees `missed` as never verified.
- `quotes`: the quote check's per-citation status; claims whose quote wasn't found carry `quote_check` and can't support a safe claim.
- `recheck`: when on, `holds`, `contradicted` or `unsupported` per adversary item. A contradicted item is for you to decide, not an automatic reversal.
- `counts`: claims by verdict, for example `{ confirmed: 43, partly: 14, unverifiable: 4 }`. That line goes into the report's Method section.
- `verified[]`: per group, its `claims[]` and `new_facts[]`. Each claim has an `id` (`<group>:<where in the target>`), the `claim`, a `verdict`, a `kind` tag for how the verdict is known, a `correction` with the exact wording when not confirmed, and `citations`.
- `logic.conclusions[]`: each with `premises[]` (each premise's `claim_ids` and `status`), `follows` (`yes`, `partly`, `no`), `objections[]` and `revised`, the conclusion the evidence supports. Plus `missing_alternatives[]` and `claims_safe_for_pr[]`.
- `attacks[]`: per attack, `objections[]`, `survives` (true or false) and `revised_recommendation`.

Reading the verdicts: `confirmed` needs a citation; a confirmed verdict without one is recorded as `unverifiable` with `demoted_from: confirmed`. `partly` and `wrong` come with the corrected wording. A conclusion whose premises include a `wrong` or `unverifiable` claim is unsupported, and `follows` says so. Safe claims are filtered after the attacks: only those resting on confirmed verdicts whose quotes were found survive. A claim is marked `contested_by` an attack with a standing blocker or serious objection only if it rests on a group that attack read, or an objection names one of its ids. In the cluck run, the guide's "five minutes" promise came back `follows: no` and the redaction recommendation `survives: false`.

## change-evidence

`workflows/change-evidence.js`

### When

Use it when a change is committed locally and you want evidence before or alongside a draft PR: does it do what it says, does it build, what does it cost, what is safe to claim about it, and how should someone else verify it.

Do not use it on an uncommitted diff, or when the question is still "what should the change be" (`investigate` or `decide`).

### Stages

| Phase | Agents | Model | Effort |
|---|---|---|---|
| Check | one per check, in parallel | `workerModel`, else `sonnet` | `checks[].effort`, else work |
| Benchmark | one, only if `benchmark` is given; it runs alone so timings are clean | `workerModel`, else `sonnet` | `benchmark.effort`, else work |
| Challenge | the reviewer | `reviewModel`, else `opus` | `reviewEffort`, else judge |
| Recheck | optional (`recheck: true`): re-opens the citations behind the reviewer's blocker and serious objections and its safe claims | `workerModel`, else `sonnet` | `low` |

The benchmark agent gets design rules by `kind`: `process` (hyperfine or equivalent, warm-ups discarded, fresh process per run), `browser` (fresh browser process per run), `device` (n boots or cycles on the same power source, timestamps from the serial log, one test at a time) or `gpu` (discard first runs, pin clocks, record driver and firmware versions). All kinds interleave arms in a seeded shuffle, n of at least 20 per arm per condition, and report median, IQR, min-max and a bootstrap 95% CI of the median difference.

In the change's worktree, agents may create only build output that git ignores.

### Args

| Arg | Required | Meaning |
|---|---|---|
| `change` | yes | Branch, commit and a one-line summary; how to read the diff |
| `context` | yes | Why, what is measured already, paths |
| `workDir` | yes | Absolute directory for scripts and raw data |
| `checks` | yes | `[{ key, prompt, effort? }]`; `low` for mechanical checks |
| `benchmark` | no | `{ prompt, kind?, effort? }`; `kind` is `process` (default), `browser`, `device` or `gpu`. Omit when timing is not the question |
| `qaAudience` | no | Who verifies and with what; default "the developer, locally" |
| `recheck` | no | Default off; see Stages |
| `workerModel`, `reviewModel`, `reviewEffort` | no | Defaults `sonnet`, `opus`, judge |
| `rules`, `tools`, `profile` | no | As above |

### Example

`examples/change-evidence-terraform-moved.json`:

```json
{
  "change": "Branch refactor/<name>, commit <sha> in <REPO>: split modules/<x> into two modules with moved blocks (git -C <REPO> show <sha>).",
  "context": "Terraform <version>, AWS provider <version>. The refactor must not replace or destroy anything.",
  "workDir": "<HOME>/.local/share/macro/<project>/<runId>-tf-moved",
  "rules": "Only terraform init and plan with -lock=false in a copy of the repo under the work dir, using read-only credentials. Never apply; no state writes.",
  "checks": [
    { "key": "plan", "effort": "low", "prompt": "terraform plan -refresh=false on the change: quote the summary line; it must be 0 to add, 0 to change, 0 to destroy." },
    { "key": "moved-blocks", "prompt": "Every resource address that changed has a moved block; list old -> new with file:line, and any address with none." }
  ]
}
```

Three agents. The pack example `packs/web-perf/examples/change-evidence-minified-vendor.json` adds a browser benchmark and a QA audience and reaches five.

### What comes back

```
{ spent, usage, not_run, evidence, challenge, recheck }
```

- `evidence[]`: one entry per check plus the benchmark, each with `method`, `results[]`, `numbers_table`, `risks[]` and `raw_paths[]`. Each result has an `id` (`<check>#<n>`), a `kind` tag, `citations`, and a `bearing`: `supports-change`, `neutral`, `against-change` or `blocker`. The worker rates bearing; the reviewer decides.
- `challenge.objections[]`, by severity, and `challenge.stats_review` of the numbers.
- `challenge.claims_safe_for_pr[]`: the sentences for the PR description, each naming result ids.
- `challenge.verification_steps[]`: for `qaAudience`, each with an expected result. `challenge.engineer_steps[]`: steps needing access the verifiers lack.
- `challenge.verdict`: `ship-as-draft`, `fix-first` or `do-not-ship`.

After the run the skill offers to walk you through `verification_steps` one at a time and writes the outcome to `UAT.md`; a failed step becomes a next step.

## debug

`workflows/debug.js`

### When

Use it for a bug, crash, flaky test, regression or wrong output whose cause is not known. It reproduces the symptom, lists competing hypotheses, tries to falsify each in parallel and ends with an adjudicator that must explain every part of the symptom, including rate, timing and environment.

Do not use it when the cause is already known and you want to prove the fix (`change-evidence`), or for a bug a single agent can see in one read.

### Stages

| Phase | Agents | Model | Effort |
|---|---|---|---|
| Hypothesise | `reproduce` and `hypothesise`, in parallel | `workerModel`, else `sonnet` | work |
| Falsify | one per hypothesis; those needing the exclusive resource run one at a time, the rest in parallel | `workerModel`, else `sonnet` | work |
| Adjudicate | the adversary | `judgeModel`, else `opus` | `judgeEffort`, else judge |

`reproduce` finds the smallest reliable reproduction, runs it at least five times if it may be intermittent, and does not look for the cause. `hypothesise` reads the failing path, git history and the pinned dependencies' changelogs and issue trackers, and lists up to `maxHypotheses` falsifiable hypotheses, at least one outside the code under study. Your own `hypotheses` are always tested first; generated ones fill the remaining slots, up to `max(maxHypotheses, yours)` and never more than six.

Each falsifier tries to prove its hypothesis false with the cheapest decisive test. `falsified` needs a measured or code fact that contradicts it; `survived` means a test that could have failed did not. A `survived` whose `could_have_failed` is false is recorded as `inconclusive`.

Code changes (logging, a flag, a bisect) happen in `git clone --local` copies under `workDir`, with uncommitted work applied and untracked files copied over. The prompt tells agents to share build caches where the toolchain allows and never to time anything while others build.

### Args

| Arg | Required | Meaning |
|---|---|---|
| `symptom` | yes | Observed versus expected, how often, since when |
| `context` | yes | Stack, versions, what was tried, recent changes, paths |
| `repo` | yes | Absolute path of the repo under study; never edited |
| `workDir` | yes | Absolute directory for copies, logs and raw data |
| `repro` | no | A known command or steps that show the bug |
| `versions` | no | Toolchain, CLI and dependency versions now, and when the code last worked. Hypothesise then includes an environment-drift hypothesis if anything is newer than the code |
| `hypotheses` | no | `[{ key, statement, test?, exclusive? }]`, your own suspects |
| `maxHypotheses` | no | Total tested, including yours; default 5, hard cap 6 |
| `exclusive` | no | A resource only one test may use at a time, for example a dev board on a serial port, the one GPU, port 5432 |
| `workerModel`, `judgeModel`, `judgeEffort` | no | Defaults `sonnet`, `opus`, judge |
| `rules`, `tools`, `profile` | no | As above |

### Example

`examples/debug-flaky-pytest.json`:

```json
{
  "symptom": "tests/test_train.py::test_resume fails about 1 in 10 on CI, never locally.",
  "context": "Python <version>, pytest with xdist on CI (-n 4). The test writes a checkpoint and resumes from it.",
  "repo": "<REPO>",
  "workDir": "<HOME>/.local/share/macro/<project>/<runId>-flaky-resume",
  "repro": "pytest -p no:randomly tests/test_train.py -x --count 30 (pytest-repeat), and again with -n 4",
  "hypotheses": [
    { "key": "tmp-collision", "statement": "Workers under xdist share a checkpoint path and overwrite each other" },
    { "key": "unseeded-workers", "statement": "DataLoader workers are not seeded, so resumed batches differ" }
  ],
  "maxHypotheses": 4
}
```

The estimate shows six agents: two in Hypothesise, three falsifiers (your two plus the minimum one generated), the adjudicator. A real run tests up to `maxHypotheses`. `examples/debug-esp32-wifi-reconnect.json` shows `exclusive` for a board on a serial port.

### What comes back

```
{ spent, usage, not_run, reproduction, hypotheses, tested, verdict }
```

- `reproduction`: `reproduced` (`always`, `intermittent`, `no`), the `steps`, the `rate` as k of n, the `environment`, `facts[]` and `raw_paths[]`.
- `hypotheses[]`: what was tested, each with `statement`, `kill_test`, `prior` and `needs_exclusive`.
- `tested[]`: per hypothesis, `test_run`, `outcome` (`falsified`, `survived`, `inconclusive`), `could_have_failed`, `facts[]`, `settle_with` if inconclusive, and `fix_if_true`.
- `verdict`: `root_cause` in one sentence or "not established"; `confidence` (`established`, `probable`, `open`); `chain[]`, the cited links from cause to symptom; `objections[]`; `unexplained[]`; `rechecks[]` it ran itself; `fix_direction`; `regression_test`, one that fails now and should pass after the fix; `tdd_plan`, ordered red/green steps for the fix; `negative_control`, evidence that the repro flips when only the cause is toggled (without one, confidence is capped at `probable`); `claims_safe_for_pr[]`; and `next_step` (`fix`, `test-more`, `rethink`).

Read `confidence` with `unexplained` and `negative_control`. `established` with an empty `unexplained` list is a cause you can act on; `probable` with entries means the chain has a gap the report's "Not established" section will name.

## decide

`workflows/decide.js`

### When

Use it for a technical choice that should rest on evidence rather than taste: a library, a design, an identity provider, or whether to take a dependency upgrade now. Every option is judged against the same criteria, and the adversary attacks the leader.

Do not use it with a single option or without the status quo; the script requires at least two options and the examples always include "stay". Do not use it before you can name the criteria and their weights; the skill will ask.

### Stages

| Phase | Agents | Model | Effort |
|---|---|---|---|
| Evidence | one per option, plus one per shared stream, all in parallel | `workerModel`, else `sonnet` | `options[].effort` or `shared[].effort`, else work |
| Attack | the adversary | `attackModel`, else `opus` | `attackEffort`, else judge |

Each option agent rates only its option against every criterion and looks hardest for its dealbreakers. Shared streams gather option-independent evidence, such as a usage map of the dependency. With `kind: "upgrade"` every agent is also told to read the pinned version from the lockfile, quote every breaking change and deprecation between pinned and target, grep the repo for each affected API, check runtime and toolchain minimums and transitive conflicts, check advisories for both versions, and, if safe, install the target in a clone and run the build and tests.

The adversary names the leader, argues against it, steelmans the runner-up and the status quo, checks each `strong` and `fails` rating against its facts, and re-opens the cheapest decisive source itself. A `must` criterion rated `fails` or `unknown` disqualifies an option unless the adversary shows otherwise. If an option's agent failed, the adversary is told it was not assessed and must say so in the ranking rather than assume.

### Args

| Arg | Required | Meaning |
|---|---|---|
| `question` | yes | The decision in one line |
| `context` | yes | Stack, pinned versions, constraints, what matters and what does not |
| `workDir` | yes | Absolute directory for clones, fetched sources and raw data |
| `criteria` | yes | `[{ key, weight, measure }]`; `weight` is `must`, `high` or `low` (default `high`) |
| `options` | yes | `[{ key, prompt, effort? }]`, two to four, always including the status quo |
| `repo` | no | Absolute path of the repo the decision affects; read-only |
| `kind` | no | `research` or `upgrade` |
| `shared` | no | `[{ key, prompt, effort? }]`, option-independent streams |
| `workerModel`, `attackModel`, `attackEffort` | no | Defaults `sonnet`, `opus`, judge |
| `rules`, `tools`, `profile` | no | As above |

### Example

`examples/decide-upgrade-terraform-aws.json`:

```json
{
  "question": "Move hashicorp/aws from <pinned> to 6.x now?",
  "context": "Terraform <version> at <REPO>; one production and one staging workspace.",
  "workDir": "<HOME>/.local/share/macro/<project>/<runId>-aws-6x",
  "repo": "<REPO>",
  "kind": "upgrade",
  "criteria": [
    { "key": "plan-clean", "weight": "must", "measure": "terraform plan in a copy shows no replacements or destroys" },
    { "key": "effort", "weight": "high", "measure": "files and resources that need edits" },
    { "key": "advisories", "weight": "high", "measure": "open advisories or known regressions for the target version" }
  ],
  "options": [
    { "key": "stay", "prompt": "Stay on <pinned>: support window, open advisories, what we lose by waiting." },
    { "key": "upgrade-6x", "prompt": "Upgrade to the latest 6.x: breaking changes that touch our resources, and a plan in a copy." }
  ],
  "shared": [ { "key": "usage", "effort": "low", "prompt": "Every resource and data source type used, with file:line." } ],
  "rules": "Only terraform init and plan with -lock=false against a copy; never apply; no state writes."
}
```

Four agents. `examples/decide-auth-provider.json` is a `research` decision between three identity providers.

### What comes back

```
{ spent, usage, not_run, options, shared, missing, decision }
```

- `options[]`: per option, a `summary`, `criteria[]` with a `rating` (`strong`, `adequate`, `weak`, `fails`, `unknown`) and the `facts[]` behind it, `adoption_cost` with its basis, `dealbreakers[]` and `raw_paths[]`.
- `shared[]`: each shared stream's `findings[]`.
- `missing[]`: option keys whose agent returned nothing.
- `decision`: `leader_before_attack`; `objections[]` targeted at option keys; `rating_corrections[]`, ratings the evidence did not support; `ranking[]` with `rank` and `why`; the `decision`; `confidence` (`clear`, `lean`, `toss-up`); `reversible`, how hard it is to undo and the cheapest trial; `would_change_it[]`; `first_steps[]`; `claims_safe_for_pr[]`.

Read `confidence` alongside `would_change_it`. A `lean` with a short, cheap `would_change_it` list is an invitation to go and get that evidence before committing; `reversible` tells you whether you can afford to skip it.
