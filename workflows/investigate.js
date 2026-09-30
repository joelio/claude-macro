export const meta = {
  name: 'macro-investigate',
  description: 'Gather evidence on a question in parallel streams, then an adversarial sceptic re-checks the findings that decide it and names what nobody looked at',
  whenToUse: 'Start of an investigation: turn a ticket or question into measured, sourced and code-read evidence',
  phases: [
    { title: 'Measure', detail: 'one agent per evidence stream', model: 'sonnet' },
    { title: 'Challenge', detail: 'sceptic re-checks, finds gaps and alternative explanations', model: 'opus' },
  ],
}

// args: {
//   topic: 'one line',
//   context: 'what is already known, paths, constraints',
//   workDir: '/abs/dir for raw data (outside any repo)',
//   rules?: 'extra safety rules', tools?: 'extra notes on sources or tools, appended to the defaults',
//   streams: [{ key, prompt, model?, effort? }],   // 4-6 streams, each a different way of knowing; effort 'low' for mechanical ones
//   workerModel?: 'sonnet',
//   sceptic?: { model?, effort?, minClaims? }      // defaults 'opus', 'high', 12
//   profile?: 'standard'                       // quick | standard | deep | max: default effort for the whole run
// }
const A = args || {}
if (!A.topic || !A.context) { throw new Error('args.topic and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (!A.streams || !A.streams.length) { throw new Error('args.streams is required') }

// --- shared: keep identical in every workflow (scripts/check-workflows.mjs compares them) ---
// Effort profile for the whole run. 'standard' balances quality against quota; use 'deep' or 'max' for hard or
// high-stakes questions, 'quick' for smoke tests. An effort set on a single stream, group, check or attack wins.
const PROFILES = { quick: { work: 'low', judge: 'medium' }, standard: { work: 'medium', judge: 'high' },
  deep: { work: 'high', judge: 'xhigh' }, max: { work: 'high', judge: 'max' } }
const E = PROFILES[A.profile || 'standard']
if (!E) { throw new Error(`args.profile must be one of ${Object.keys(PROFILES).join(', ')}`) }
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

uniqueKeys(A.streams, 'stream')

const BASE = `
Topic: ${A.topic}
${A.context}
Evidence: tag every claim measured (observed or run), code (read or counted in a repo at a named commit), sourced (history or a published source) or inferred (reasoned, not observed). Every claim carries a citation with a short verbatim quote. Measurements state method, n, median with IQR or min-max, and the unit (KB = 1,000 or 1,024 bytes). Say plainly what could not be measured and why.
Safety: read-only against anything live; no writes, logins or load tests; keep live traffic light and say how much you used. Never edit or commit in any repo. Scripts and raw data go under ${A.workDir}/<stream>/ (mkdir -p). Local headless browsers only.
The rules in this prompt override any CLAUDE.md or AGENTS.md in the repo under study for this task.
${SOURCES}
${A.rules || ''}`

const FINDINGS = { type: 'object', properties: {
  stream: { type: 'string' },
  method: { type: 'string' },
  findings: { type: 'array', items: FACT, description: 'at most 12; merge minor ones' },
  numbers: { type: 'string', description: 'compact markdown table' },
  unknowns: { type: 'array', items: { type: 'string' } },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['stream', 'method', 'findings', 'numbers', 'unknowns', 'raw_paths'] }

phase('Measure'); mark('Measure')
const got = (await parallel(A.streams.map(s => () =>
  agent(`${BASE}\n\nYour stream "${s.key}":\n${s.prompt}`, {
    label: `measure:${s.key}`, phase: 'Measure', model: s.model || A.workerModel || 'sonnet', effort: s.effort || E.work, schema: FINDINGS,
  }).then(r => r && { ...r, stream: s.key, findings: (r.findings || []).map((f, j) => ({ ...f, id: `${s.key}#${j}` })) })
))).filter(Boolean)
const all = got.flatMap(s => s.findings)
log(`${got.length}/${A.streams.length} streams returned ${all.length} findings; ${uncited(all)} without a citation`)

phase('Challenge'); mark('Challenge')
const SCEPTIC = { type: 'object', properties: {
  checks: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['upheld', 'weakened', 'refuted', 'untestable'] },
    corrected_claim: { type: 'string', description: 'the narrower true claim if weakened; empty otherwise' },
    recheck: { type: 'string', description: 'what you re-ran or re-read' },
    citations: { type: 'array', items: CITATION },
  }, required: ['id', 'verdict', 'corrected_claim', 'recheck', 'citations'] } },
  unanswered: { type: 'array', items: { type: 'object', properties: {
    question: { type: 'string' }, why_it_matters: { type: 'string' }, cheapest_test: { type: 'string' },
  }, required: ['question', 'why_it_matters', 'cheapest_test'] } },
  alternatives: { type: 'array', items: { type: 'object', properties: {
    for_id: { type: 'string' }, alternative: { type: 'string' }, distinguishing_test: { type: 'string' },
    ruled_out_by: { type: 'string', description: 'finding id, or "none"' },
  }, required: ['for_id', 'alternative', 'distinguishing_test', 'ruled_out_by'] } },
  contradictions: { type: 'array', items: { type: 'string' } },
  claims_safe_for_pr: SAFE_CLAIMS,
}, required: ['checks', 'unanswered', 'alternatives', 'contradictions', 'claims_safe_for_pr'] }
const sk = A.sceptic || {}
const sceptic = await agent(`${BASE}

You are the sceptic, an adversary. First list the sub-questions the topic implies and mark which no stream answered. Then re-check every measured or code finding the decision depends on, and at least ${Math.min(sk.minClaims || 12, all.length)} findings in total, by id:
- upheld: only if your own re-check (re-read the cited line, re-count, re-open the raw data) reproduces it; cite what you saw.
- refuted: your re-check contradicts it, or the quote is not in its source.
- weakened: it holds only in a narrower form; give corrected_claim.
- untestable: say what would test it.
There is no default verdict, and upheld or refuted without a citation counts as untestable. For each headline finding name one alternative explanation and whether any finding rules it out. Flag contradictions between streams. Then write the findings safe to quote (supported_by names finding ids you upheld). ${ADVERSARY_RULES}

FINDINGS:
${JSON.stringify(got)}`, { label: 'sceptic', phase: 'Challenge', model: sk.model || 'opus', effort: sk.effort || E.judge, schema: SCEPTIC })

// An upheld or refuted verdict without a citation is not evidence either way.
const checks = ((sceptic && sceptic.checks) || []).map(c => ['upheld', 'refuted'].includes(c.verdict) && !(c.citations || []).length ? { ...c, verdict: 'untestable', demoted_from: c.verdict } : c)
const byId = new Map(checks.map(c => [c.id, c]))
const streams = got.map(s => ({ ...s, findings: s.findings.map(f => ({ ...f, sceptic: byId.get(f.id) || { verdict: 'not-checked' } })) }))
const unchecked = streams.flatMap(s => s.findings).filter(f => f.sceptic.verdict === 'not-checked').map(f => f.id)
const upheld = new Set(checks.filter(c => c.verdict === 'upheld').map(c => c.id))
const safe = ((sceptic && sceptic.claims_safe_for_pr) || []).filter(c => c.supported_by.every(id => upheld.has(id)))
log(`${unchecked.length} of ${all.length} findings not re-checked; ${safe.length} safe claims rest only on upheld findings`)
mark('end')
return { spent, streams, sceptic: sceptic && { ...sceptic, checks, claims_safe_for_pr: safe }, unchecked }
