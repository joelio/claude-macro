export const meta = {
  name: 'macro-debug',
  description: 'Root-cause a bug: reproduce it and list competing hypotheses, try to falsify each in parallel, then an adversary attacks the explanation that survives',
  whenToUse: 'A bug, crash, flaky test, regression or wrong output whose cause is not yet known',
  phases: [
    { title: 'Hypothesise', detail: 'reproduce, and list falsifiable hypotheses', model: 'sonnet' },
    { title: 'Falsify', detail: 'one agent per hypothesis; tests on a shared device run one at a time', model: 'sonnet' },
    { title: 'Adjudicate', detail: 'adversary attacks the surviving explanation', model: 'opus' },
  ],
}

// args: {
//   symptom: 'observed vs expected, how often, since when',
//   context: 'stack, versions, what was tried, recent changes, paths',
//   repo: '/abs/path of the repo under study (never edited)',
//   workDir: '/abs/dir for copies, logs and raw data (outside any repo)',
//   repro?: 'known command or steps that show the bug',
//   hypotheses?: [{ key, statement, test?, exclusive? }],  // your own suspects; always tested first
//   maxHypotheses?: 5,                                     // total tested, including yours
//   exclusive?: 'a resource only one test may use at a time, e.g. the ESP32 on /dev/cu.usbserial-0001, the one GPU, port 5432',
//   rules?: 'extra safety rules', tools?: 'extra notes on sources or tools',
//   workerModel?: 'sonnet', judgeModel?: 'opus', judgeEffort?: 'high'
// }
const A = args || {}
if (!A.symptom || !A.context) { throw new Error('args.symptom and args.context are required') }
if (!A.repo || !A.repo.startsWith('/')) { throw new Error('args.repo must be the absolute path of the repo under study') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
const MAX = A.maxHypotheses || 5
const W = A.workerModel || 'sonnet'

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
const CITATIONS = { type: 'array', items: CITATION, description: 'usually one; two only if sources disagree. An inferred claim cites what it is reasoned from. Leave empty rather than invent a quote: uncited claims are demoted, invented ones are defects' }
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
const demote = os => (os || []).map(o => ['blocker', 'serious', 'refuted'].includes(o.severity) && !(o.citations || []).length
  ? { ...o, severity: 'question', demoted_from: o.severity } : o)
// Output tokens spent up to each phase boundary (the pool is shared with the main loop; deltas between marks are per phase).
const spent = {}
const mark = name => { spent[name] = budget.spent() }
const uncited = facts => facts.filter(f => !(f.citations || []).length).length
const uniqueKeys = (list, what) => { const k = (list || []).map(x => x.key); if (new Set(k).size !== k.length) { throw new Error(`duplicate ${what} keys: ${k}`) } }
// --- end shared ---
uniqueKeys(A.hypotheses, 'hypothesis')

const BASE = `
Symptom: ${A.symptom}
Repo under study: ${A.repo}
${A.context}
${A.repro ? `Known reproduction: ${A.repro}` : 'No reproduction is known yet.'}
Evidence: tag every claim measured (you ran it and saw it), code (read in the repo at a named commit), sourced (docs, issues, changelogs, git history) or inferred (reasoned, not observed). Cite file:line, a URL, or a log file and line under ${A.workDir}, each with a short verbatim quote. For intermittent behaviour give k of n. Say what you could not test.
Safety: never edit, stash, reset, checkout or commit in ${A.repo}. To change code (logging, a flag, a bisect), work in a disposable copy: git clone --local ${A.repo} ${A.workDir}/<task>/src, then bring over uncommitted work with git -C ${A.repo} diff HEAD --binary | git -C ${A.workDir}/<task>/src apply, and copy any untracked files the bug needs (git -C ${A.repo} status --porcelain lists them). Other agents build in parallel: share build caches where the toolchain allows (e.g. CARGO_TARGET_DIR=${A.workDir}/target-shared) and never time anything while others build. Scripts, logs and outputs go under ${A.workDir}/<task>/ (mkdir -p). Read-only against anything live; no logins; local headless browsers only.
${A.exclusive ? `Shared resource: ${A.exclusive}. Use it only if your task says you hold it.` : ''}
The rules in this prompt override any CLAUDE.md or AGENTS.md in the repo under study for this task.
${SOURCES}
${A.rules || ''}`


const REPRO = { type: 'object', properties: {
  reproduced: { type: 'string', enum: ['always', 'intermittent', 'no'] },
  steps: { type: 'string', description: 'the smallest command or steps that show it' },
  rate: { type: 'string', description: 'k of n attempts' },
  environment: { type: 'string', description: 'commit, versions, OS, hardware' },
  facts: { type: 'array', items: FACT },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['reproduced', 'steps', 'rate', 'environment', 'facts', 'raw_paths'] }

const HYPS = { type: 'object', properties: {
  hypotheses: { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string', description: 'short kebab-case id' },
    statement: { type: 'string' },
    explains: { type: 'string', description: 'which parts of the symptom it explains, and which it does not' },
    prior: { type: 'string', enum: ['high', 'medium', 'low'] },
    kill_test: { type: 'string', description: 'the cheapest observation that would prove it false' },
    needs_exclusive: { type: 'boolean' },
    basis: { type: 'array', items: FACT },
  }, required: ['key', 'statement', 'explains', 'prior', 'kill_test', 'needs_exclusive', 'basis'] } },
  recent_changes: { type: 'array', items: FACT },
}, required: ['hypotheses', 'recent_changes'] }

const TEST = { type: 'object', properties: {
  key: { type: 'string' },
  test_run: { type: 'string', description: 'exactly what was run, where, n' },
  outcome: { type: 'string', enum: ['falsified', 'survived', 'inconclusive'] },
  could_have_failed: { type: 'boolean', description: 'false if the test could not have falsified it' },
  facts: { type: 'array', items: FACT },
  settle_with: { type: 'string', description: 'if inconclusive, the test that would settle it' },
  fix_if_true: { type: 'string' },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['key', 'test_run', 'outcome', 'could_have_failed', 'facts', 'settle_with', 'fix_if_true', 'raw_paths'] }

phase('Hypothesise'); mark('Hypothesise')
const [repro, gen] = await parallel([
  () => agent(`${BASE}\n\nTask "reproduce": find the smallest reliable reproduction. If it may be intermittent, run it at least 5 times and report k of n. Record commit, versions, OS and hardware. Save error text, stack traces and logs verbatim. Do not look for the cause.${A.exclusive ? ` You hold ${A.exclusive} for this task; release it before you return.` : ''}`,
    { label: 'reproduce', phase: 'Hypothesise', model: W, effort: 'medium', schema: REPRO }),
  () => agent(`${BASE}\n\nTask "hypothesise": read the failing code path, git log and blame near it, and the changelogs and issue trackers for the pinned dependency versions. List up to ${MAX} competing hypotheses that could each explain the symptom, including at least one outside the code under study (environment, dependency, toolchain, hardware, data). For each give the cheapest test that would prove it FALSE, and set needs_exclusive if that test needs ${A.exclusive || 'a resource only one test can use at a time'}. Rank by prior. Do not run the tests.`,
    { label: 'hypothesise', phase: 'Hypothesise', model: W, effort: 'medium', schema: HYPS }),
])
const mine = (A.hypotheses || []).map(h => ({ key: h.key, statement: h.statement, kill_test: h.test || 'choose the cheapest decisive test', needs_exclusive: !!h.exclusive, explains: 'suggested by the developer', prior: 'medium', basis: [] }))
const seen = new Set(mine.map(h => h.key))
const hyps = [...mine, ...((gen && gen.hypotheses) || []).filter(h => !seen.has(h.key))].slice(0, Math.min(Math.max(MAX, mine.length), 6))
if (!hyps.length) { throw new Error('no hypotheses were produced; pass args.hypotheses') }
log(`reproduced: ${repro ? repro.reproduced : 'unknown'}; testing ${hyps.map(h => h.key).join(', ')}`)

phase('Falsify'); mark('Falsify')
const falsify = (h, holds) => agent(`${BASE}\n\nREPRODUCTION:\n${JSON.stringify(repro)}\n\nTask "falsify:${h.key}". Hypothesis: ${h.statement}\nSuggested kill test: ${h.kill_test}\nTry honestly to prove it FALSE with the cheapest decisive test; use a better test if you see one. "falsified" needs a measured or code fact that contradicts it. "survived" means a test that could have failed did not. Otherwise "inconclusive", with the test that would settle it.${holds ? ` You hold ${A.exclusive || 'the shared resource'} for this task; release it (close monitors and ports) before you return.` : ''}`,
  { label: `falsify:${h.key}`, phase: 'Falsify', model: W, effort: 'medium', schema: TEST }).then(r => r && { ...r, key: h.key, statement: h.statement })
const free = hyps.filter(h => !h.needs_exclusive), held = hyps.filter(h => h.needs_exclusive)
const [freeRes, heldRes] = await parallel([
  () => parallel(free.map(h => () => falsify(h, false))),
  async () => { const out = []; for (const h of held) { out.push(await falsify(h, true)) } return out },
])
// A test that could not have failed does not count as survival.
const tested = [...(freeRes || []), ...(heldRes || [])].filter(Boolean)
  .map(t => t.outcome === 'survived' && !t.could_have_failed ? { ...t, outcome: 'inconclusive', demoted_from: 'survived' } : t)

phase('Adjudicate'); mark('Adjudicate')
const VERDICT = { type: 'object', properties: {
  root_cause: { type: 'string', description: 'one sentence, or "not established"' },
  confidence: { type: 'string', enum: ['established', 'probable', 'open'] },
  chain: { type: 'array', items: FACT, description: 'cause to symptom, each link cited' },
  objections: { type: 'array', items: OBJECTION },
  unexplained: { type: 'array', items: { type: 'string' } },
  rechecks: { type: 'array', items: { type: 'string' }, description: 'what you re-ran yourself and what it showed' },
  fix_direction: { type: 'string' },
  regression_test: { type: 'string', description: 'a test that fails now and should pass after the fix' },
  claims_safe_for_pr: SAFE_CLAIMS,
  next_step: { type: 'string', enum: ['fix', 'test-more', 'rethink'] },
}, required: ['root_cause', 'confidence', 'chain', 'objections', 'unexplained', 'rechecks', 'fix_direction', 'regression_test', 'claims_safe_for_pr', 'next_step'] }
const verdict = await agent(`${BASE}

You are the adversary.${A.exclusive ? ` You hold ${A.exclusive} for your re-checks; release it before you return.` : ''} Take the explanation the evidence favours and try to break it. Does it explain every part of the symptom, including rate, timing and environment? Was any "falsified" or "survived" verdict based on a test that could not have failed? Could a surviving hypothesis be a symptom of another cause, or two combine? Re-run the cheapest decisive check yourself. ${ADVERSARY_RULES} Then give the root cause (or "not established"), the cited chain from cause to symptom, a regression test, a fix direction and the sentences safe to put in a commit or PR.

REPRODUCTION:
${JSON.stringify(repro)}

HYPOTHESES AND TESTS:
${JSON.stringify({ generated: gen, tested })}`,
{ label: 'adjudicate', phase: 'Adjudicate', model: A.judgeModel || 'opus', effort: A.judgeEffort || 'high', schema: VERDICT })

if (verdict) { verdict.objections = demote(verdict.objections) }
mark('end')
return { spent, reproduction: repro, hypotheses: hyps, tested, verdict }
