export const meta = {
  name: 'macro-change-evidence',
  description: 'Prove a code change: parallel checks, an optional benchmark on a quiet machine, then an adversarial review (Opus by default) that writes the PR claims and QA steps',
  whenToUse: 'A change is committed locally and needs evidence before or alongside a draft PR',
  phases: [
    { title: 'Check', detail: 'bytes, equivalence, build, platform checks in parallel', model: 'sonnet' },
    { title: 'Benchmark', detail: 'runs alone so timings are clean', model: 'sonnet' },
    { title: 'Challenge', detail: 'adversarial review, PR claims, QA steps', model: 'opus' },
  ],
}

// args: {
//   change: 'branch, commit and one-line summary; how to read the diff',
//   context: 'why, what is measured already, paths',
//   workDir: '/abs/dir for scripts and raw data (outside any repo)',
//   rules?: 'extra safety rules',
//   tools?: 'extra notes on sources or tools, appended to the defaults',
//   checks: [{ key, prompt, effort? }],   // effort defaults to 'medium'; 'low' for mechanical checks
//   benchmark?: { prompt, effort? },            // omit when timing is not the question
//   qaAudience?: 'who runs QA and what they can use (e.g. the UI and dashboards only, no cluster access)',
//   workerModel?: 'sonnet',           // checks and benchmark
//   reviewModel?: 'opus', reviewEffort?: 'high'   // the challenger
// }
const A = args || {}
if (!A.change || !A.context) { throw new Error('args.change and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (!A.checks || !A.checks.length) { throw new Error('args.checks is required') }

const SOURCES = `
Sources (exa and context7 are installed at user scope by the repo's scripts/install.sh; use them first):
- Load them: ToolSearch "select:mcp__exa__web_search_exa,mcp__exa__web_fetch_exa,mcp__exa__get_code_context_exa,mcp__context7__resolve-library-id,mcp__context7__query-docs". If those names are not found, ToolSearch "exa" and "context7" and use what matches.
- Library, framework, SDK or CLI behaviour: context7 first (resolve-library-id, then query-docs), at the version the project pins.
- Specs, standards, vendor docs, changelogs, known issues: exa web_search_exa to find the page, then web_fetch_exa for the exact text you quote.
- How an API is used in practice, or a library's source: exa get_code_context_exa.
- Search results are leads, not citations. Quote the fetched primary text. For version-specific behaviour, the installed package source settles it.
- If a tool is rate-limited or missing, fall back to WebFetch or curl of the primary source (RFC .txt, googlesource ?format=TEXT, raw GitHub at a tag) and record that in \`via\`.
${A.tools || ''}`

const BASE = `
Change: ${A.change}
${A.context}
Rules: read-only on everything live. You may create only build output that git ignores in the change's worktree, and must not edit tracked files or commit. Scripts and results go under ${A.workDir}/<task>/. Local headless browsers only.
Science: state method, n, median with IQR or min-max; state the unit (KB = 1,000 or 1,024 bytes); tag each claim measured, code, sourced or inferred; every claim cites a source (file:line, URL or raw-data file and field) with a short verbatim quote; say what could not be tested.
${SOURCES}
${A.rules || ''}`

const RESULT = {
  type: 'object',
  properties: {
    task: { type: 'string' }, method: { type: 'string' },
    results: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' },
      kind: { type: 'string', enum: ['measured', 'code', 'sourced', 'inferred'] },
      evidence: { type: 'string' },
      citations: { type: 'array', items: { type: 'object', properties: {
        source: { type: 'string' }, quote: { type: 'string' },
        via: { type: 'string', enum: ['context7', 'exa', 'webfetch', 'curl', 'repo', 'package-source', 'raw-data', 'other'] },
      }, required: ['source', 'quote', 'via'] } },
      verdict: { type: 'string', enum: ['supports-change', 'neutral', 'against-change', 'blocker'] },
    }, required: ['claim', 'kind', 'evidence', 'citations', 'verdict'] } },
    numbers_table: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    raw_paths: { type: 'array', items: { type: 'string' } },
  },
  required: ['task', 'method', 'results', 'numbers_table', 'risks', 'raw_paths'],
}

phase('Check')
const checks = (await parallel(A.checks.map(c => () =>
  agent(`${BASE}\n\nTask "${c.key}":\n${c.prompt}`, { label: `check:${c.key}`, phase: 'Check', model: A.workerModel || 'sonnet', effort: c.effort || 'medium', schema: RESULT })
    .then(r => r && { ...r, task: c.key })
))).filter(Boolean)

let bench = null
if (A.benchmark) {
  phase('Benchmark')
  bench = await agent(`${BASE}\n\nTask "benchmark" (you run alone; start no other heavy processes):\n${A.benchmark.prompt}
Design rules: fresh process per run (a fresh browser process for browser work), discard warm-ups, interleave arms in a seeded shuffle (write your own PRNG, record the seed), n >= 20 per arm per condition, report median, IQR, min-max and a bootstrap 95% CI of the median difference. Record machine details and ambient load.`,
    { label: 'benchmark', phase: 'Benchmark', model: A.workerModel || 'sonnet', effort: A.benchmark.effort || 'medium', schema: RESULT })
}
const all = [...checks, bench].filter(Boolean)

phase('Challenge')
const CHALLENGE = {
  type: 'object',
  properties: {
    objections: { type: 'array', items: { type: 'object', properties: {
      objection: { type: 'string' },
      severity: { type: 'string', enum: ['blocker', 'serious', 'minor', 'refuted'] },
      evidence: { type: 'string' }, fix_or_test: { type: 'string' },
    }, required: ['objection', 'severity', 'evidence', 'fix_or_test'] } },
    stats_review: { type: 'string' },
    claims_safe_for_pr: { type: 'array', items: { type: 'string' } },
    qa_steps: { type: 'array', items: { type: 'string' } },
    engineer_steps: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['ship-as-draft', 'fix-first', 'do-not-ship'] },
  },
  required: ['objections', 'stats_review', 'claims_safe_for_pr', 'qa_steps', 'engineer_steps', 'verdict'],
}
const challenge = await agent(`${BASE}

You are the adversarial reviewer. Try hard to find reasons the change is wrong or risky, or that its evidence is weak. Re-run cheap checks yourself. An objection needs evidence as much as a claim does. Then write the claims that are safe to put in the PR (exact sentences with numbers), QA steps for ${A.qaAudience || 'QA'} with an expected result each, engineer-only steps, and a verdict.

EVIDENCE:
${JSON.stringify(all, null, 1)}`, { label: 'challenge', phase: 'Challenge', model: A.reviewModel || 'opus', effort: A.reviewEffort || 'high', schema: CHALLENGE })

return { evidence: all, challenge }
