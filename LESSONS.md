# Lessons

Traps that cost time, and how the agents did. Stack-specific traps live with their pack (`packs/*/LESSONS.md`).

## General traps

- **Installers echo secrets.** A command echo printed an API key embedded in a URL into the transcript. Mask keys in anything a script prints (scripts/install.sh mask()).
- **An agent's `git checkout`, `stash` or `reset` in the repo under study destroys uncommitted work.** Workflows forbid it; changes happen in `git clone --local` copies under the work dir.
- **A merged config change is not a deployed one.** Check what is running, not what is on main.
- **Warm-up skews the first runs** (JIT, disk cache, GPU clocks, CPU boost). Discard warm-ups and interleave arms.
- **A shared device serialises work.** A serial monitor holds the port; one flashing task at a time. The debug workflow's `exclusive` arg exists for this.
- **KB vs KiB** produced a wrong "47%" that should have been 48.7%. State the unit.
- **One machine, tight IQR** means repeatable, not representative. Report deltas, not absolute times, when arms run on different infrastructure.

- **A shared budget in a prompt doesn't hold across parallel agents.** "At most 15 model calls in total" became 18, because no agent could see the others' use. Split budgets per agent in the script.
- **Blind debug tests need the fix erased, not just checked out.** Clone, reset to the parent, delete remotes, tags and other branches, expire reflogs and `gc --prune=now`, then confirm with `git cat-file -e <fix>` that the fix is gone.

- **Schemas are checked at the tool-call layer, and the model retries on a mismatch.** The Workflow runtime forces a StructuredOutput call and validates it against the JSON Schema, so `required` and `enum` hold and `agent()` returns a validated object; `required` must be a subset of `properties`, or the call throws at `agent()` (source: the `workflow-authoring` skill, "validation happens at the tool-call layer so the model retries on mismatch"; I found no runtime doc that names `minItems` specifically, so treat it as enforced the same way but unconfirmed). Consequence: `minItems` on `CITATIONS` would force a quote on every fact and invite invented ones, so v0.2 leaves it off and the scripts log `uncited` counts instead (investigate, verify, debug, decide). The dry run builds fake data from `minItems` but doesn't test the runtime. A retry costs tokens, so keep schemas lean.
- **GPU work is asynchronous, so a wall-clock timer around a call measures the launch, not the work.** Time with device events, or synchronize before reading the clock (PyTorch CUDA notes: "time measurements without synchronizations are not accurate"). On an ESP32 the ROM and second-stage bootloader run before the app, so say which boot stage a serial-log span covers (ESP-IDF startup guide). Neither page gives a warm-up count or clock-pinning advice, so those rules in `BENCH_RULES` are unsourced.

- **dontAsk matches Bash commands as written.** In the loop's first run, three of seven items were blocked because the worker ran `npm test` with pipes or flags that no allow rule matched, so its own gate was refused. Allow the forms a model really uses (`Bash(npm test:*)`), and say in the prompt to run commands plainly.

## Sources and tools

- Exa's free tier rate-limits a parallel fan-out within minutes. Set `EXA_API_KEY` before `scripts/install.sh`. Otherwise agents fall back to curl of primary sources: RFC text, `chromium.googlesource.com/...?format=TEXT` (base64), raw GitHub at a tag.
- context7 is reliable for framework docs (Turbo, Stimulus, Chart.js, cytoscape, Playwright).
- `gcloud`/`bq` need an interactive login; have the human run it with `! gcloud auth login`, then dry-run every query and cap bytes billed.

## How the agents did

- Sonnet workers were accurate on direct measurement and code reads, and candid about their own invalid methods.
- They slipped on cross-referencing: counts off by one or two, a missed call site, a guessed frequency presented as a number.
- The logic agent (no lookups, just premises and conclusions) found the most important problems: overstated evidence tags, two problems merged into one, no user-visible timing.
- The Opus adversary caught real design errors (an unnecessary `proxy_hide_header` plan, a wrong ordering constraint), and once asserted a fact the earlier evidence had already disproved. Read its output as critically as anyone else's.
- The sceptic step pays for itself. Keep it.
- A fresh verify pass over a report that had already been verified still found 4 wrong claims and flipped the option ranking, mostly by joining evidence from later runs. Worth doing before a report is circulated widely.
