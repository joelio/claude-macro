export const meta = {
  name: 'macro-verify',
  description: 'Check every claim in a report or change against cited primary sources, then a logic review and attackers work from the verdicts',
  whenToUse: 'Before a report or PR goes to other people: confirm, correct and cite every claim',
  phases: [
    { title: 'Verify', detail: 'one agent per claim group, quotes required', model: 'sonnet' },
    { title: 'Attack', detail: 'logic review plus one attacker per recommendation, all given the verdicts', model: 'opus' },
  ],
}

// args: {
//   target: 'what is being verified: a report path, a commit (git -C <repo> show <sha>), a PR',
//   context: 'background, paths, what is already established',
//   workDir: '/abs/dir for fetched sources and raw data (outside any repo)',
//   rules?: 'extra safety rules', tools?: 'extra notes on sources or tools, appended to the defaults',
//   groups: [{ key, prompt, model?, effort? }],      // e.g. specs, security, platform, codebase, data; defaults workerModel, 'medium'
//   logic?: { prompt?, model?, effort? },           // always runs after the groups; defaults 'opus', 'high'
//   attacks?: [{ key, prompt, effort?, groups? }],  // one per recommendation; groups limits which verdicts it reads (all by default)
//   workerModel?: 'sonnet', attackModel?: 'opus'
// }
const A = args || {}
if (!A.target || !A.context) { throw new Error('args.target and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (!A.groups || !A.groups.length) { throw new Error('args.groups is required') }
if (A.groups.some(g => g.key === 'logic')) { throw new Error('logic is a built-in stage; pass args.logic instead of a logic group') }
for (const t of A.attacks || []) for (const k of t.groups || []) {
  if (!A.groups.some(g => g.key === k)) { throw new Error(`attack ${t.key}: unknown group ${k}`) }
}

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
Target: ${A.target}
${A.context}
Evidence: every verdict needs a citation with a short verbatim quote (URL or file:line). No quote, no "confirmed". If sources disagree, cite both and say which wins.
Safety: read-only everywhere; never edit or commit in any repo; keep live traffic light and say how much you used; local headless browsers only. Save fetched sources and raw data under ${A.workDir}/<group>/.
${SOURCES}
${A.rules || ''}`

const CLAIMS = { type: 'object', properties: {
  group: { type: 'string' },
  claims: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', description: 'where the claim is in the target, e.g. "s3.2" or "L120"' },
    claim: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'partly', 'wrong', 'unverifiable'] },
    kind: { type: 'string', enum: ['measured', 'code', 'sourced', 'inferred'], description: 'how the verdict is known' },
    correction: { type: 'string', description: 'exact corrected wording if not confirmed, else empty' },
    citations: CITATIONS,
  }, required: ['id', 'claim', 'verdict', 'kind', 'correction', 'citations'] } },
  new_facts: { type: 'array', items: { type: 'string' } },
}, required: ['group', 'claims', 'new_facts'] }

phase('Verify')
const verified = (await parallel(A.groups.map(g => () =>
  agent(`${BASE}\n\nGroup "${g.key}":\n${g.prompt}`, { label: `verify:${g.key}`, phase: 'Verify', model: g.model || A.workerModel || 'sonnet', effort: g.effort || 'medium', schema: CLAIMS })
    .then(r => r && { ...r, group: g.key, claims: r.claims.map(c => ({ ...c, id: `${g.key}:${c.id}` })) })
))).filter(Boolean)
const claims = verified.flatMap(g => g.claims)
const counts = claims.reduce((n, c) => ({ ...n, [c.verdict]: (n[c.verdict] || 0) + 1 }), {})
log(`${verified.length}/${A.groups.length} groups returned ${claims.length} claims: ${JSON.stringify(counts)}; ${uncited(claims)} without a citation`)

// Adversaries get a slim view: confirmed claims keep their sources, disputed ones keep quotes and corrections.
const slim = gs => gs.map(g => ({ group: g.group, new_facts: g.new_facts, claims: g.claims.map(c => c.verdict === 'confirmed'
  ? { id: c.id, claim: c.claim, verdict: c.verdict, kind: c.kind, sources: c.citations.map(x => x.source) }
  : { id: c.id, claim: c.claim, verdict: c.verdict, kind: c.kind, correction: c.correction, citations: c.citations.map(x => ({ source: x.source, quote: x.quote })) }) }))
const forAttack = t => !t.groups ? verified : verified.map(g => t.groups.includes(g.group) ? g
  : { ...g, claims: g.claims.filter(c => c.verdict !== 'confirmed') })

phase('Attack')
const LOGIC = { type: 'object', properties: {
  conclusions: { type: 'array', items: { type: 'object', properties: {
    conclusion: { type: 'string' },
    premises: { type: 'array', items: { type: 'object', properties: {
      premise: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['confirmed', 'partly', 'wrong', 'unverifiable', 'not-checked'] },
    }, required: ['premise', 'claim_ids', 'status'] } },
    follows: { type: 'string', enum: ['yes', 'partly', 'no'] },
    objections: { type: 'array', items: OBJECTION },
    revised: { type: 'string', description: 'the conclusion the evidence supports' },
  }, required: ['conclusion', 'premises', 'follows', 'objections', 'revised'] } },
  missing_alternatives: { type: 'array', items: { type: 'string' } },
  claims_safe_for_pr: SAFE_CLAIMS,
}, required: ['conclusions', 'missing_alternatives', 'claims_safe_for_pr'] }
const ATTACK = { type: 'object', properties: {
  target: { type: 'string' },
  objections: { type: 'array', items: OBJECTION },
  survives: { type: 'boolean' },
  revised_recommendation: { type: 'string' },
}, required: ['target', 'objections', 'survives', 'revised_recommendation'] }
const L = A.logic || {}
const [logic, ...attacks] = await parallel([
  () => agent(`${BASE}\n\nLogic review, an adversary. ${L.prompt || ''}\nFor each conclusion or recommendation in the target: its premises and each premise's verdict from the results below; whether it follows; hidden assumptions, overgeneralisation, confounders, missing alternatives, and tags stronger than the evidence. A conclusion resting on a wrong or unverifiable premise is unsupported. ${ADVERSARY_RULES}\n\nVERIFICATION RESULTS (compact; open a source if you need the text of a confirmed claim):\n${JSON.stringify(slim(verified))}`,
    { label: 'logic', phase: 'Attack', model: L.model || A.attackModel || 'opus', effort: L.effort || 'high', schema: LOGIC }),
  ...(A.attacks || []).map(t => () =>
    agent(`${BASE}\n\n${t.prompt}\nArgue AGAINST it as hard as you honestly can: security, operations, benefit, cheaper alternatives. ${ADVERSARY_RULES}\n\nVERIFICATION RESULTS (compact):\n${JSON.stringify(slim(forAttack(t)))}`,
      { label: `attack:${t.key}`, phase: 'Attack', model: A.attackModel || 'opus', effort: t.effort || 'high', schema: ATTACK })
      .then(r => r && { ...r, target: t.key, objections: demote(r.objections) })),
])
if (logic) { logic.conclusions = logic.conclusions.map(c => ({ ...c, objections: demote(c.objections) })) }
return { counts, verified, logic, attacks: attacks.filter(Boolean) }
