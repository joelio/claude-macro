export const meta = {
  name: 'macro-investigate',
  description: 'Gather evidence on a question in parallel streams, then a sceptic tries to refute the headline claims',
  whenToUse: 'Start of an investigation: turn a ticket or question into measured, sourced and code-read evidence',
  phases: [
    { title: 'Measure', detail: 'one agent per evidence stream', model: 'sonnet' },
    { title: 'Challenge', detail: 'sceptic re-runs cheap checks', model: 'opus' },
  ],
}

// args: {
//   topic: 'one line',
//   context: 'what is already known, paths, constraints',
//   workDir: '/abs/dir for raw data (outside any repo)',
//   rules?: 'extra safety rules for this estate',
//   tools?: 'extra notes on sources or tools, appended to the defaults',
//   streams: [{ key, prompt, model?, effort? }],   // 4-6 streams; effort 'low' for mechanical ones
//   workerModel?: 'sonnet',                        // default for streams
//   sceptic?: { model?, effort?, maxClaims? }      // defaults 'opus', 'high'
// }
const A = args || {}
if (!A.topic || !A.context) { throw new Error('args.topic and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (!A.streams || !A.streams.length) { throw new Error('args.streams is required') }

const SOURCES = `
Sources (exa and context7 are installed at user scope by the repo's scripts/install.sh; use them first):
- Load them: ToolSearch "select:mcp__exa__web_search_exa,mcp__exa__web_fetch_exa,mcp__exa__get_code_context_exa,mcp__context7__resolve-library-id,mcp__context7__query-docs". If those names are not found, ToolSearch "exa" and "context7" and use what matches.
- Library, framework, SDK or CLI behaviour: context7 first (resolve-library-id, then query-docs), at the version the project pins.
- Specs, standards, vendor docs, changelogs, known issues: exa web_search_exa to find the page, then web_fetch_exa for the exact text you quote.
- How an API is used in practice, or a library's source: exa get_code_context_exa.
- Search results are leads, not citations. Quote the fetched primary text. For version-specific behaviour, the installed package source settles it.
- If a tool is rate-limited or missing, fall back to WebFetch or curl of the primary source (RFC .txt, googlesource ?format=TEXT, raw GitHub at a tag) and record that in \`via\`.
${A.tools || ''}`

const EVIDENCE = `
Evidence standard:
- Tag every claim measured (observed or run), code (read or counted in a repo), sourced (history or a published source) or inferred (reasoned, not observed).
- Measurements state method, sample size and median with min-max or IQR. Say plainly what could not be measured and why.
- Every claim carries citations: a source (file:line at a named commit, URL, or raw-data file and field) plus a short verbatim quote. No quote, no confirmation. Prefer primary sources: specs, official docs, source at a pinned version.
- Units: say whether KB means 1,000 or 1,024 bytes.`

const SAFETY = `
Safety:
- Read-only against anything live. No writes, no logins, no load tests. Keep live traffic light and say how much you used.
- Do not modify any repo or commit. Scripts and raw data go under ${A.workDir}/<stream>/ (mkdir -p).
- Local headless browsers only; never open a GUI browser.
${A.rules || ''}`

const FINDINGS = {
  type: 'object',
  properties: {
    stream: { type: 'string' },
    method: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' },
      kind: { type: 'string', enum: ['measured', 'code', 'sourced', 'inferred'] },
      evidence: { type: 'string' },
      citations: { type: 'array', items: { type: 'object', properties: {
        source: { type: 'string' }, quote: { type: 'string' },
        via: { type: 'string', enum: ['context7', 'exa', 'webfetch', 'curl', 'repo', 'package-source', 'raw-data', 'other'] },
      }, required: ['source', 'quote', 'via'] } },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['claim', 'kind', 'evidence', 'citations', 'confidence'] } },
    numbers: { type: 'string', description: 'compact markdown table' },
    risks_or_unknowns: { type: 'array', items: { type: 'string' } },
    raw_data_paths: { type: 'array', items: { type: 'string' } },
  },
  required: ['stream', 'method', 'findings', 'numbers', 'risks_or_unknowns', 'raw_data_paths'],
}

phase('Measure')
const got = (await parallel(A.streams.map(s => () =>
  agent(`Topic: ${A.topic}\n\n${A.context}\n${EVIDENCE}\n${SOURCES}\n${SAFETY}\n\nYour stream "${s.key}":\n${s.prompt}`, {
    label: `measure:${s.key}`, phase: 'Measure', model: s.model || A.workerModel || 'sonnet', effort: s.effort || 'medium', schema: FINDINGS,
  }).then(r => r && { ...r, stream: s.key })
))).filter(Boolean)
log(`${got.length}/${A.streams.length} streams returned`)

phase('Challenge')
const SKEPTIC = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: { type: 'object', properties: {
      stream: { type: 'string' }, claim: { type: 'string' },
      verdict: { type: 'string', enum: ['upheld', 'weakened', 'refuted', 'untestable'] },
      reason: { type: 'string' }, recheck_evidence: { type: 'string' },
    }, required: ['stream', 'claim', 'verdict', 'reason', 'recheck_evidence'] } },
    contradictions_between_streams: { type: 'array', items: { type: 'string' } },
    missing_evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['checks', 'contradictions_between_streams', 'missing_evidence'],
}
const sk = A.sceptic || {}
const skeptic = await agent(`Topic: ${A.topic}\n\n${A.context}\n${EVIDENCE}\n${SOURCES}\n${SAFETY}

You are the sceptic. Pick the ${sk.maxClaims || 12} claims that matter most for the decision and try to refute each with a cheap re-check (re-read the cited line, re-count, re-open saved raw data). Default to "weakened" when the evidence does not support the number as stated. Flag contradictions between streams and missing evidence.

FINDINGS:
${JSON.stringify(got, null, 1)}`, { label: 'sceptic', phase: 'Challenge', model: sk.model || 'opus', effort: sk.effort || 'high', schema: SKEPTIC })

return { streams: got, skeptic }
