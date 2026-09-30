export const meta = {
  name: 'macro-change-evidence',
  description: 'Prove a code change: parallel checks, an optional clean benchmark, then an adversarial review (Opus by default) that writes the claims safe to quote and the verification steps',
  whenToUse: 'A change is committed locally and needs evidence before or alongside a draft PR',
  phases: [
    { title: 'Check', detail: 'correctness, build, size, platform checks in parallel', model: 'sonnet' },
    { title: 'Benchmark', detail: 'runs alone so timings are clean', model: 'sonnet' },
    { title: 'Challenge', detail: 'adversarial review, safe claims, verification steps', model: 'opus' },
  ],
}

// args: {
//   change: 'branch, commit and one-line summary; how to read the diff',
//   context: 'why, what is measured already, paths',
//   workDir: '/abs/dir for scripts and raw data (outside any repo)',
//   rules?: 'extra safety rules', tools?: 'extra notes on sources or tools, appended to the defaults',
//   checks: [{ key, prompt, effort? }],               // effort defaults to 'medium'; 'low' for mechanical checks
//   benchmark?: { prompt, kind?, effort? },           // kind: 'process' (default) | 'browser' | 'device' | 'gpu'; omit when timing is not the question
//   qaAudience?: 'who verifies and with what',        // default: the developer, locally
//   workerModel?: 'sonnet', reviewModel?: 'opus', reviewEffort?: 'high'
// }
const A = args || {}
if (!A.change || !A.context) { throw new Error('args.change and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (!A.checks || !A.checks.length) { throw new Error('args.checks is required') }

// --- shared: keep identical in every workflow (scripts/check-workflows.mjs compares them) ---
const SOURCES = `
Sources (exa and context7 are installed at user scope by the macro repo's scripts/install.sh; use them first):
- Load them: ToolSearch "select:mcp__exa__web_search_exa,mcp__exa__web_fetch_exa,mcp__exa__get_code_context_exa,mcp__context7__resolve-library-id,mcp__context7__query-docs". If those names are not found, ToolSearch "exa" and "context7" and use what matches.
- Library, framework, SDK or CLI behaviour: context7 first (resolve-library-id, then query-docs), at the version the project pins.
- Specs, standards, vendor docs, changelogs, known issues: exa web_search_exa to find the page, then web_fetch_exa for the exact text you quote.
- How an API is used in practice, or a library's source: exa get_code_context_exa.
- Search results are leads, not citations. Quote the fetched primary text. For version-specific behaviour, the installed package source settles it.
- If a tool is rate-limited or missing, fall back to WebFetch or curl of the primary source (RFC .txt, googlesource ?format=TEXT, raw GitHub at a tag) and record that in \`via\`.
- Save fetched text you quote under the work directory so the quote can be re-checked offline.
${A.tools || ''}`

const CITATION = { type: 'object', properties: {
  source: { type: 'string', description: 'file:line at a named commit, a URL, or a raw-data file and field' },
  quote: { type: 'string', description: 'verbatim; the shortest span that proves the point, about 40 words at most' },
  via: { type: 'string', enum: ['context7', 'exa', 'webfetch', 'curl', 'repo', 'package-source', 'raw-data', 'other'] },
}, required: ['source', 'quote', 'via'] }
const CITATIONS = { type: 'array', minItems: 1, items: CITATION, description: 'one citation; two only if sources disagree or the claim needs both. An inferred claim cites what it is reasoned from' }
const FACT = { type: 'object', properties: {
  claim: { type: 'string' },
  kind: { type: 'string', enum: ['measured', 'code', 'sourced', 'inferred'] },
  evidence: { type: 'string', description: 'method, n, median with IQR or min-max, unit' },
  citations: CITATIONS,
}, required: ['claim', 'kind', 'evidence', 'citations'] }
// Adversaries: an objection without a citation is a question, not a finding.
const OBJECTION = { type: 'object', properties: {
  target: { type: 'string', description: 'the option, recommendation, claim id or change it is about' },
  objection: { type: 'string' },
  severity: { type: 'string', enum: ['blocker', 'serious', 'minor', 'question', 'refuted'] },
  citations: { type: 'array', items: CITATION },
  fix_or_test: { type: 'string' },
}, required: ['target', 'objection', 'severity', 'citations', 'fix_or_test'] }
const SAFE_CLAIMS = { type: 'array', items: { type: 'object', properties: {
  sentence: { type: 'string', description: 'exact wording for a PR, commit or report, with numbers and units' },
  supported_by: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'ids or sources of the evidence behind every number in the sentence' },
}, required: ['sentence', 'supported_by'] } }
const ADVERSARY_RULES = `Severity: blocker and serious need at least one citation; without one, use "question". "refuted" (you tried and the objection fails) also needs a citation. Re-run the cheapest decisive check yourself rather than arguing from summaries. Only sentences in claims_safe_for_pr may be quoted to other people, and each names the evidence behind its numbers.`
const demote = os => (os || []).map(o => ['blocker', 'serious'].includes(o.severity) && !(o.citations || []).length
  ? { ...o, severity: 'question', demoted_from: o.severity } : o)
const uncited = facts => facts.filter(f => !(f.citations || []).length).length
// --- end shared ---

const BASE = `
Change: ${A.change}
${A.context}
Rules: read-only on everything live. In the change's worktree you may create only build output that git ignores; never edit tracked files or commit. Scripts and results go under ${A.workDir}/<task>/. Local headless browsers only.
Evidence: tag each claim measured, code, sourced or inferred; each cites a source with a short verbatim quote. State method, n, median with IQR or min-max and the unit. Say what could not be tested.
${SOURCES}
${A.rules || ''}`

const RESULT = { type: 'object', properties: {
  task: { type: 'string' }, method: { type: 'string' },
  results: { type: 'array', items: { type: 'object', properties: {
    ...FACT.properties,
    bearing: { type: 'string', enum: ['supports-change', 'neutral', 'against-change', 'blocker'], description: 'what the finding bears on; the reviewer decides' },
  }, required: [...FACT.required, 'bearing'] } },
  numbers_table: { type: 'string' },
  risks: { type: 'array', items: { type: 'string' } },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['task', 'method', 'results', 'numbers_table', 'risks', 'raw_paths'] }

phase('Check')
const checks = (await parallel(A.checks.map(c => () =>
  agent(`${BASE}\n\nTask "${c.key}":\n${c.prompt}\nReport what you found; do not argue for or against the change.`,
    { label: `check:${c.key}`, phase: 'Check', model: A.workerModel || 'sonnet', effort: c.effort || 'medium', schema: RESULT })
    .then(r => r && { ...r, task: c.key })
))).filter(Boolean)

const BENCH_RULES = {
  process: 'hyperfine or an equivalent: warm-up runs discarded, fresh process per run.',
  browser: 'fresh browser process per run, no shared HTTP or V8 state; discard warm-ups.',
  device: 'n boots or cycles on the same power source; timestamps from the serial log; one test on the device at a time.',
  gpu: 'discard the first runs; pin clocks if possible; record driver, CUDA and firmware versions.',
}
let bench = null
if (A.benchmark) {
  phase('Benchmark')
  const kind = A.benchmark.kind || 'process'
  bench = await agent(`${BASE}\n\nTask "benchmark" (you run alone; start no other heavy processes):\n${A.benchmark.prompt}
Design rules: ${BENCH_RULES[kind] || BENCH_RULES.process} Interleave arms in a seeded shuffle (write your own PRNG, record the seed), n >= 20 per arm per condition, report median, IQR, min-max and a bootstrap 95% CI of the median difference. Record machine details and ambient load.`,
    { label: 'benchmark', phase: 'Benchmark', model: A.workerModel || 'sonnet', effort: A.benchmark.effort || 'medium', schema: RESULT })
}
const all = [...checks, bench].filter(Boolean)

phase('Challenge')
const CHALLENGE = { type: 'object', properties: {
  objections: { type: 'array', items: OBJECTION },
  stats_review: { type: 'string' },
  claims_safe_for_pr: SAFE_CLAIMS,
  verification_steps: { type: 'array', items: { type: 'string' }, description: `for ${A.qaAudience || 'the developer, locally'}, each with an expected result` },
  engineer_steps: { type: 'array', items: { type: 'string' }, description: 'steps needing access the verifiers lack; empty if none' },
  verdict: { type: 'string', enum: ['ship-as-draft', 'fix-first', 'do-not-ship'] },
}, required: ['objections', 'stats_review', 'claims_safe_for_pr', 'verification_steps', 'engineer_steps', 'verdict'] }
const challenge = await agent(`${BASE}

You are the adversarial reviewer. Try hard to find reasons the change is wrong or risky, or that its evidence is weak. ${ADVERSARY_RULES} Then write the claims safe to quote (supported_by names task and result index, e.g. "bytes#2"), verification steps for ${A.qaAudience || 'the developer, locally'} with an expected result each, any engineer-only steps, and a verdict.

EVIDENCE:
${JSON.stringify(all)}`, { label: 'challenge', phase: 'Challenge', model: A.reviewModel || 'opus', effort: A.reviewEffort || 'high', schema: CHALLENGE })
if (challenge) { challenge.objections = demote(challenge.objections) }

return { evidence: all, challenge }
