# Harness-engineering research, 1 October 2026

Sources shortlisted from [walkinglabs/awesome-harness-engineering](https://github.com/walkinglabs/awesome-harness-engineering). Fetched text is in the run folder `~/.local/share/macro/macro/2026-10-01-harness-research/`. A Fable pass over the full list added three items.

| Source | Key point (quoted) | Our judgement | Where it landed |
|---|---|---|---|
| [OpenHands: evaluating agent skills](https://openhands.dev/blog/evaluating-agent-skills) | "A no-skill baseline to compare against … That last point is the one teams most often skip." One of their three tasks regressed with the skill. | Adopt | Eval design (backlog) |
| [Anthropic: demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | "20-50 simple tasks drawn from real failures is a great start." A 0% pass rate "is most often a signal of a broken task". Also: agents read git history from earlier trials. | Adopt | Eval design: reference answers, negative controls, pass^k, clean worktrees |
| [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | "token usage by itself explains 80% of the variance". Simple fact-finding needs 1 agent; comparisons need 2-4. Each subagent needs "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries". | Adopt or adapt | Skill: effort scaling and brief template. Eval: a token-matched single-agent arm. |
| [Anthropic: infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise) | "leaderboard differences below 3 percentage points deserve skepticism"; results vary with time of day. | Adopt as procedure | Eval: log infrastructure errors separately, interleave arms |
| [Anthropic: long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Agents may only change a feature's `passes` field; "less likely to … overwrite JSON files compared to Markdown". | Adapt | Claims inventory as `claims.json` (backlog) |
| [completely](https://github.com/23ag1/completely) | "returns FAIL unless evidence proves pass"; "`$ per PASSED task`" | Adopt | `not_run` in every workflow (built); cost per passed task in the eval |
| [forge-harness](https://github.com/chrono-meta/forge-harness) | "`reviewed: false` is not a pass"; missing inputs reported as `scope-missing`, never folded into CLEAR | Adopt | `not_run` (built); `source_missing` in the quote check (backlog) |
| [Spend rails](https://joeyycli.github.io/agent-ops-kit-guide/docs/spend-rails-for-autonomous-agents.html) | "Sub-budgets need their own hard caps, not shared judgment"; "A spend cap with no ledger is unenforceable" | Adapt | Per-agent budgets with a `used` ledger (backlog) |
| [OpenHands: prompt injection](https://openhands.dev/blog/mitigating-prompt-injection-attacks-in-software-agents) (Fable) | Untrusted content can steer agents | Adopt | The shared SOURCES rule (built); the quote check closes the rest |
| [Manus: context engineering](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) (Fable) | Stable prefixes for cache hits | Small gain | Prompts already share a per-run prefix; noted only |
| [HumanLayer: backpressure](https://www.humanlayer.dev/blog/context-efficient-backpressure) (Fable) | Don't burn context on noisy output | Adapt, low priority | Harness output one-liners (backlog) |

The main caution: because tokens explain most of the variance, "macro beats a single agent" is only meaningful against a token-matched single agent that is given macro's rules. If macro doesn't beat that arm, the value is in the discipline, not the parallel agents, and the toolkit should get simpler.
