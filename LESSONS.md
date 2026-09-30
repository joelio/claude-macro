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
