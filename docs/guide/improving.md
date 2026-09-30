# Improving

The toolkit learns from real runs in three steps: you record whether a run helped, a retro turns those records into lessons and backlog items, and a bounded loop works through the backlog. Packs hold what is specific to one stack.

## did-it-help.md

After every run the skill creates `<workDir>/did-it-help.md` as a draft for you to correct within a day. It has four headings:

- what the run said;
- what turned out to be true;
- what you would not have found alone;
- how many of the adversary's blocker or serious objections held.

Fill it in honestly, especially the third heading. A run whose "would not have found alone" is empty is a run that cost tokens for nothing, and the retro looks for that pattern.

## The retro

```sh
scripts/improve.sh --retro
```

One headless Opus run at `high` effort reads `improve/RETRO.md` and then your real runs under `~/.local/share/macro/`: `INDEX.md`, and for each run folder since the last retro its `did-it-help.md`, `REPORT.md` and the `spent` field in `result.json`. The last retro's date is the last `Retro <date>` line under `## Unreleased` in `CHANGELOG.md`; with none, it reads every run.

It looks for patterns across runs, not one-offs: an objection type that keeps being demoted, a phase whose token share is out of line with its value, a source tool that keeps failing, a stack hint every run needed. Each lesson and backlog item it writes cites the run folders that show it. A pattern seen in one run is a note, not an item.

It may change only three files: `LESSONS.md`, `improve/BACKLOG.md` and `CHANGELOG.md`. The script, not the model, commits them, and only if the model changed nothing else and ended with its `RESULT:` line. Otherwise the changes are discarded. The skill suggests a retro every few runs.

## The self-improvement loop

```sh
scripts/improve.sh [iterations]
```

Runs a bounded, Ralph-style loop over `improve/BACKLOG.md`, three iterations by default. Each iteration:

1. A fresh headless Sonnet run at `medium` effort reads `improve/PROMPT.md`, takes the first open item (`- [ ]`) in the backlog, does at most five context7 or exa lookups, makes the smallest change that completes it, runs `npm test`, and ends with `RESULT: done <item>`, `RESULT: blocked <item>` or `RESULT: empty`. If `npm test` fails it escalates: a different approach, then reading the checker and dry run and building a reproduction, then giving up after three attempts.
2. The script commits the working tree as `improve: <item>` if the result was `done`. The model has no git write access.
3. The gate re-runs the checker and the dry run from a pristine copy of `scripts/`, `tests/` and `package.json` taken at the start of the loop, against the new `workflows/`, `examples/` and `packs/`. A commit that fails is reverted.
4. A headless Opus run at `high` effort reads `improve/REVIEW.md` (also from the pristine copy), reviews `git show HEAD` against `CLAUDE.md` and the method docs, runs `npm test` itself, and ends with `VERDICT: keep` or `VERDICT: revert - <reason>`. A revert resets the commit.

A reverted, refused or blocked item is marked `- [!]` in the backlog with the reason, and that marking is committed, so the next iteration moves on.

At the end the script prints the commits and how to review them: `git log -p <start>..HEAD`. Merge when happy.

### Safety design

- **The script commits, never the model.** Workers are allowed `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, the test commands, `git status`, `git diff`, `git log`, `ls`, and the exa and context7 tools. The reviewer gets less. Both run in `dontAsk` permission mode with project-only settings, so personal allow rules cannot widen the scope.
- **Pristine gates.** The checker, the dry run, `package.json` and the three prompts are copied from the start commit before the first iteration. Every gate and every prompt runs from that copy, so a worker cannot loosen what judges it.
- **Protected paths.** A commit that touches `scripts/`, `tests/`, `package.json`, `improve/PROMPT.md`, `improve/REVIEW.md`, `improve/RETRO.md` or `.claude/` is reverted and its item blocked with "needs a human".
- **No push.** Git's push URL for `origin` is pointed at a path that cannot exist for the whole loop, and `git push` is on the disallowed-tools list as well.
- **No secrets.** `~/.claude.json`, `~/.claude/`, `~/.ssh/`, `~/.aws/`, `~/.config/` and `~/.netrc` are disallowed reads.
- **A budget.** `MAX_USD_PER_RUN` (default 3) caps each headless run.
- **A clean start.** The loop refuses to run on a dirty tree or when `npm test` already fails. On `main` it creates a unique `improve/<timestamp>` branch first.

`CLAUDE_BIN` overrides the `claude` path, as for the installer.

### The backlog

`improve/BACKLOG.md` has one item per iteration, top first: `- [ ]` open, `- [x]` done, `- [!]` blocked. Items that would need changes to `scripts/`, `tests/` or `package.json` are for a human. Add your own items at the end, with the evidence for them (a run folder, a report line).

### The write-time hook

In this repo, `.claude/settings.json` runs `scripts/hook-check.mjs` after every `Edit` or `Write`. If the file is a workflow, an example, a test, a pack example or the checker, the hook runs the checker and the dry run and blocks with the failure until it is fixed. That is what stops an edit in a Claude Code session from drifting away from the rules.

## Packs

A pack is everything specific to one stack: harness scripts, example args and the traps that stack has cost us. The core stays estate-neutral; paths, hosts, tables, asset names and dates go in `args`, environment variables or placeholders.

The one pack today is `packs/web-perf/`: Playwright and CDP profiling (cold load, real warm cache, throttled WebView), an A/B module import benchmark with seeded interleaving and a bootstrap CI, an nginx header test in Docker, and a parameterised GCP load-balancer log query. Its `README.md` lists each script's arguments and its `LESSONS.md` the browser, CDP, nginx, Helm and Kubernetes traps.

### What a pack contains

| Path | Purpose | Who reads it |
|---|---|---|
| `packs/<name>/README.md` | What is in the pack and how each script is parameterised. An optional line `optional-tools: <cmd> <cmd>` names CLIs the installer should look for and report | You, and `install.sh --pack` |
| `packs/<name>/harness/` | The scripts. A `package.json` there makes `install.sh --pack` run `npm install`; if it mentions `playwright`, the Chromium headless shell is installed too | The agents, from prompts in your args |
| `packs/<name>/examples/<workflow>-*.json` | Example args. The dry run picks these up alongside `examples/`, so every pack example is run against every profile and every null-agent case in `npm test` | You, when writing args; the tests |
| `packs/<name>/LESSONS.md` | Stack-specific traps. The skill reads it before measuring and copies the relevant bullets into `tools` | The skill |

The checker syntax-checks every `.mjs` (`node --check`) and `.sh` (`bash -n`) under `packs/`, skipping `node_modules`.

### Adding one

1. Create `packs/<name>/` with a `README.md`, a `harness/` and at least one example named for a workflow.
2. Keep every script's inputs in environment variables or arguments, with the header comment listing them, and raw output going to an `OUT_DIR`.
3. Run `npm test`. The example must pass the dry run, including its 10-agent limit.
4. Start a `LESSONS.md` with the first trap you hit.
5. Install it with `scripts/install.sh --pack <name>` and tell the skill to use it by putting the harness paths in your args' prompts.
