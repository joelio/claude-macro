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
//   profile?: 'standard'                       // quick | standard | deep | max: default effort for the whole run
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
uniqueKeys(A.groups, 'group'); uniqueKeys(A.attacks, 'attack')

const BASE = `
Target: ${A.target}
${A.context}
Evidence: every verdict needs a citation with a short verbatim quote (URL or file:line). No quote, no "confirmed". If sources disagree, cite both and say which wins.
Safety: read-only everywhere; never edit or commit in any repo; keep live traffic light and say how much you used; local headless browsers only. Save fetched sources and raw data under ${A.workDir}/<group>/.
The rules in this prompt override any CLAUDE.md or AGENTS.md in the repo under study for this task.
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

phase('Verify'); mark('Verify')
const verified = (await parallel(A.groups.map(g => () =>
  agent(`${BASE}\n\nGroup "${g.key}":\n${g.prompt}`, { label: `verify:${g.key}`, phase: 'Verify', model: g.model || A.workerModel || 'sonnet', effort: g.effort || E.work, schema: CLAIMS })
    .then(r => r && { ...r, group: g.key, claims: (r.claims || []).map(c => ({ ...c, id: `${g.key}:${c.id}` }))
      // No quote, no "confirmed".
      .map(c => c.verdict === 'confirmed' && !(c.citations || []).length ? { ...c, verdict: 'unverifiable', demoted_from: 'confirmed' } : c) })
))).filter(Boolean)
const claims = verified.flatMap(g => g.claims)
const counts = claims.reduce((n, c) => ({ ...n, [c.verdict]: (n[c.verdict] || 0) + 1 }), {})
log(`${verified.length}/${A.groups.length} groups returned ${claims.length} claims: ${JSON.stringify(counts)}; ${uncited(claims)} without a citation`)

// Adversaries get a slim view. Quotes stay wherever a wrong one would matter: disputed claims and confirmed
// measured or code claims. Confirmed sourced or inferred claims keep only their sources. An attack limited to
// some groups still sees every other group's claims, without quotes.
const slimClaim = (c, quotes) => ({ id: c.id, claim: c.claim, verdict: c.verdict, kind: c.kind,
  ...(c.verdict !== 'confirmed' ? { correction: c.correction } : {}),
  ...(quotes ? { citations: c.citations.map(x => ({ source: x.source, quote: x.quote })) } : { sources: c.citations.map(x => x.source) }) })
const slim = (gs, only) => gs.map(g => ({ group: g.group, new_facts: g.new_facts, claims: g.claims.map(c =>
  slimClaim(c, (!only || only.includes(g.group)) && (c.verdict !== 'confirmed' || ['measured', 'code'].includes(c.kind)))) }))

phase('Attack'); mark('Attack')
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
  () => agent(`${BASE}\n\nLogic review, an adversary. ${L.prompt || ''}\nFor each conclusion or recommendation in the target: its premises and each premise's verdict from the results below; whether it follows; hidden assumptions, overgeneralisation, confounders, missing alternatives, and tags stronger than the evidence. A conclusion resting on a wrong or unverifiable premise is unsupported. In claims_safe_for_pr, supported_by lists claim ids exactly as given. ${ADVERSARY_RULES}\n\nVERIFICATION RESULTS (compact; open a source if you need the text of a confirmed claim):\n${JSON.stringify(slim(verified))}`,
    { label: 'logic', phase: 'Attack', model: L.model || A.attackModel || 'opus', effort: L.effort || E.judge, schema: LOGIC }),
  ...(A.attacks || []).map(t => () =>
    agent(`${BASE}\n\n${t.prompt}\nArgue AGAINST it as hard as you honestly can: security, operations, benefit, cheaper alternatives. ${ADVERSARY_RULES}\n\nVERIFICATION RESULTS (compact):\n${JSON.stringify(slim(verified, t.groups))}`,
      { label: `attack:${t.key}`, phase: 'Attack', model: A.attackModel || 'opus', effort: t.effort || E.judge, schema: ATTACK })
      .then(r => r && { ...r, target: t.key, objections: demote(r.objections) })),
])
const attacked = attacks.filter(Boolean)
if (logic) {
  logic.conclusions = logic.conclusions.map(c => ({ ...c, objections: demote(c.objections) }))
  // Logic wrote its safe claims without seeing the attacks. Keep only claims resting on confirmed verdicts, and
  // mark every claim contested while any attack has an uncited-proof blocker or serious objection standing.
  const confirmed = new Set(claims.filter(c => c.verdict === 'confirmed').map(c => c.id))
  const contested = attacked.filter(a => a.objections.some(o => ['blocker', 'serious'].includes(o.severity))).map(a => a.target)
  const before = logic.claims_safe_for_pr.length
  logic.claims_safe_for_pr = logic.claims_safe_for_pr.filter(c => c.supported_by.every(id => confirmed.has(id)))
    .map(c => contested.length ? { ...c, contested_by: contested } : c)
  log(`${before - logic.claims_safe_for_pr.length} safe claims dropped (not resting on confirmed verdicts); contested by: ${contested.join(', ') || 'none'}`)
}
mark('end')
return { spent, counts, verified, logic, attacks: attacked }
