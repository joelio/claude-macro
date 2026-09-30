# Troubleshooting

Problems we have hit, each with the fix that worked. Start with `scripts/install.sh --check`; it reports most of them.

## exa or context7 is missing

**Symptom.** The skill's preflight finds nothing for `ToolSearch "exa"` or `ToolSearch "context7"`, or `install.sh --check` lists one of them as `todo`. Agents that do run record `via: webfetch` or `via: curl` for everything.

**Fix.** Run `<REPO>/scripts/install.sh` and restart Claude Code. The servers are added at user scope, so they load in every repo. If you choose to continue without them, agents fall back to WebFetch and curl of primary sources, which is slower and rate-limits sooner.

If the server is listed but not connecting, `claude mcp get exa` shows its config. The exa entry should have a `headersHelper` pointing at `<REPO>/scripts/exa-headers.sh`. Run that script by hand: it prints `{"x-api-key":"..."}` when it finds a key and `{}` when it does not. `{}` means anonymous access, which works but is rate-limited.

## The exa key shows in `claude mcp list`

**Symptom.** `install.sh --check` prints:

```
WARN  exa is not using the keychain helper; its key is in the URL and shows in claude mcp list; re-run with --update-mcp
```

Older installs passed the key as `exaApiKey=` in the server URL, where `claude mcp list` and `claude mcp get` print it. An installer once echoed such a URL into a transcript.

**Fix.**

```sh
scripts/install.sh --update-mcp
```

The installer reads the key out of the existing URL, stores it in your keychain under the service `claude-macro-exa`, removes the old server entry and adds one that uses `scripts/exa-headers.sh`. If `claude mcp list` itself fails, `--update-mcp` refuses to change anything rather than risk losing config.

Until then, do not paste `claude mcp list` or `claude mcp get` output anywhere. The skill is told the same. The installer masks anything that looks like an API key in the commands it echoes.

## A local `claude` that does not run

**Symptom.** The installer stops at the first step:

```
FAIL  /path/to/claude does not run: <error>
      fix Claude Code first (for a local install: cd ~/.claude/local && node node_modules/@anthropic-ai/claude-code/install.cjs)
```

The installer looks for `claude` on your `PATH`, then at `~/.claude/local/claude`. A `claude` that is a shell alias is invisible to scripts; a local install whose binary is stale fails `claude --version`.

**Fix.** Repair the local install with the command the message gives, or point the scripts at a working binary:

```sh
CLAUDE_BIN=/path/to/claude scripts/install.sh
```

`improve.sh` honours `CLAUDE_BIN` too. The installer refuses to touch MCP config when it cannot read it, so a broken binary does not corrupt `~/.claude.json`.

## `scriptPath` is refused

**Symptom.** The Workflow tool refuses `scriptPath` set to `<REPO>/workflows/<name>.js` when the script lies outside the session's directory.

**Fix.** The skill's fallback: read the script and pass its text as `script` instead, with the same `args` object. Nothing else changes; the workflows resolve everything they need from `args`.

## The dry run fails

`npm test` runs `scripts/check-workflows.mjs` and then `tests/dry-run.mjs`. `--estimate` runs the same dry run on your args. Each prints `FAIL <workflow or example>: <reason>`; the reasons and what they mean:

| Message | Cause |
|---|---|
| `args.<field> ... is required`, `args.workDir must be an absolute path` | A required arg is missing, or `workDir` (or `repo`) is relative. Fix the args file |
| `duplicate <kind> keys` | Two streams, groups, checks, options, attacks or hypotheses share a `key` |
| `args.profile must be one of quick, standard, deep, max` | A misspelt profile |
| `logic is a built-in stage; pass args.logic instead of a logic group` | A `verify` group keyed `logic` |
| `attack <key>: unknown group <name>` | A `verify` attack's `groups` names a group that does not exist |
| `prompt contains undefined` or `[object Object]` | A prompt interpolates an arg that is missing or is an object where a string was expected |
| `missing model, effort` or `schema` | An agent call without one of the three; every agent must set effort explicitly |
| `N agents; the limit is 10 unless the user asks` | Too many streams, groups, options or attacks in one run |
| `last agent is ... not the adversary on opus` | An example that overrides the adversary's model to something else |
| `shared prelude differs from <file>; copy it exactly` | Only after editing a workflow: the block between `// --- shared:` and `// --- end shared ---` must be byte-identical in all five |
| `no example args file` | A workflow without an `examples/<workflow>-*.json` |

The dry run also runs each example with sparse output, under every profile, and with each agent in turn returning null. A failure prefixed `sparse:`, `profile <name>:` or `agent <n> (<label>) null:` means the workflow itself mishandles that case, which is a bug in `workflows/` rather than in your args.

If you are editing inside this repo, `.claude/settings.json` runs the same checks after every edit to a workflow, example or test and blocks until they pass; the message starts `npm test fails after editing <file>:`.

## Rate limits

**Symptom.** Part-way through a run, exa calls start failing or stalling, and agents note it in their `method` or switch to `via: curl`. Exa's free tier rate-limits a parallel fan-out within minutes.

**Fix.** Set `EXA_API_KEY` before running `scripts/install.sh`, or run `install.sh --update-mcp` with it set, so the key goes into the keychain. Until then the prompts already tell agents what to do: fall back to fetching the primary text directly and record it in `via`:

- RFCs: `https://www.rfc-editor.org/rfc/rfcNNNN.txt`
- Chromium docs and source: `https://chromium.googlesource.com/<path>?format=TEXT` (base64; decode it)
- GitHub at a tag: `https://raw.githubusercontent.com/<org>/<repo>/<tag>/<path>`
- Gems and packages: the installed copy, cited by path and version

A run finishes without exa or context7; it just cites less well. For BigQuery in the `web-perf` pack, `gcloud` and `bq` need an interactive login; run `! gcloud auth login` yourself, then dry-run every query and cap bytes billed.

## A run came back with agents missing

**Symptom.** The workflow's log says `3/4 streams returned`, `groups returned` fewer than you passed, or `decide`'s result has names in `missing`. An agent that fails or is skipped returns null, and the workflows drop nulls and carry on so the adversary still runs on what exists. The adversary is told which options were not assessed; for other workflows the gap shows as absent streams or groups in `result.json`.

**Where to look.** `result.json` records the transcript directory, under `~/.claude/projects/<project>/<session>/subagents/workflows/<runId>/`. In it:

- `journal.jsonl`: one `started` line per agent with its `label` and `phase`, and one `result` line when it returned. An agent with a `started` line and no `result` is the one that failed.
- `agent-<id>.jsonl`: that agent's full transcript, with `agent-<id>.meta.json` naming its label, phase and model.

The skill reads the journal when the summary is truncated, and you can do the same to see what the missing agent was doing when it stopped. The fix is usually one of: a prompt that asked for something the agent could not do under the rules (a login, a write), a tool that was rate-limited, or a schema field it could not fill. Re-run with the prompt narrowed or the lesson added to `tools`.
