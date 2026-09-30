export const meta = {
  name: 'macro-verify',
  description: 'Check every claim in a report or change against cited primary sources, logic-check it, then attack each recommendation',
  whenToUse: 'Before a report or PR goes to other people: confirm, correct and cite every claim',
  phases: [
    { title: 'Verify', detail: 'one agent per claim group, quotes required', model: 'sonnet' },
    { title: 'Attack', detail: 'adversaries argue against each recommendation', model: 'opus' },
  ],
}

// args: {
//   target: 'what is being verified: a report path, a commit (git -C <repo> show <sha>), a PR',
//   context: 'background, paths, what is already established',
//   workDir?: '/abs/dir for fetched sources and raw data (outside any repo)',
//   tools?: 'extra notes on sources or tools, appended to the defaults',
//   rules?: 'extra safety rules',
//   groups: [{ key, prompt, model?, effort? }], // e.g. specs, security, platform, codebase, data, logic; defaults workerModel, 'medium'.
//                                               // Give the logic group model 'opus', effort 'high': it is an adversary.
//   attacks?: [{ key, prompt, effort? }],       // one per recommendation; effort defaults 'high'. Omitted: one attack on the conclusions
//   workerModel?: 'sonnet',           // claim groups
//   attackModel?: 'opus'              // attackers; keep it at least as strong as the workers
// }
const A = args || {}
if (!A.target || !A.context) { throw new Error('args.target and args.context are required') }
if (A.workDir && !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path') }
if (!A.groups || !A.groups.length) { throw new Error('args.groups is required') }
// No recommendations to attack still gets an adversary: one attack on the overall conclusions.
const ATTACKS = A.attacks && A.attacks.length ? A.attacks
  : [{ key: 'conclusions', prompt: 'Target: the overall conclusions of the target and any ranking or recommendation it makes.' }]
if (!A.attacks || !A.attacks.length) { log('no args.attacks: running one attack on the overall conclusions') }

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
Target: ${A.target}
${A.context}

Evidence standard: every verdict needs a citation with a short verbatim quote (URL or file:line). No quote, no "confirmed". If sources disagree, say so.
${SOURCES}
Safety: read-only everywhere; do not modify or commit to any repo; keep any live traffic light and say how much you used; local headless browsers only.${A.workDir ? ` Save fetched sources and raw data under ${A.workDir}/<group>/.` : ''}
${A.rules || ''}`

const CLAIMS = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    claims: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' },
      verdict: { type: 'string', enum: ['confirmed', 'partly', 'wrong', 'unverifiable'] },
      kind: { type: 'string', enum: ['measured', 'code', 'sourced', 'inferred'], description: 'how the verdict is known' },
      correction: { type: 'string', description: 'exact corrected wording if not confirmed, else empty' },
      citations: { type: 'array', items: { type: 'object', properties: {
        source: { type: 'string' }, quote: { type: 'string' },
        via: { type: 'string', enum: ['context7', 'exa', 'webfetch', 'curl', 'repo', 'package-source', 'raw-data', 'other'] },
      }, required: ['source', 'quote', 'via'] } },
    }, required: ['id', 'claim', 'verdict', 'kind', 'correction', 'citations'] } },
    new_facts: { type: 'array', items: { type: 'string' } },
  },
  required: ['group', 'claims', 'new_facts'],
}

phase('Verify')
const verified = (await parallel(A.groups.map(g => () =>
  agent(`${BASE}\n\nGroup "${g.key}":\n${g.prompt}`, { label: `verify:${g.key}`, phase: 'Verify', model: g.model || A.workerModel || 'sonnet', effort: g.effort || 'medium', schema: CLAIMS })
    .then(r => r && { ...r, group: g.key })
))).filter(Boolean)
log(`${verified.length}/${A.groups.length} groups returned`)

const ATTACK = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    attacks: { type: 'array', items: { type: 'object', properties: {
      argument: { type: 'string' },
      strength: { type: 'string', enum: ['fatal', 'serious', 'minor', 'fails'] },
      evidence: { type: 'string' }, mitigation: { type: 'string' },
    }, required: ['argument', 'strength', 'evidence', 'mitigation'] } },
    survives: { type: 'boolean' },
    revised_recommendation: { type: 'string' },
  },
  required: ['target', 'attacks', 'survives', 'revised_recommendation'],
}

phase('Attack')
const attacks = (await parallel(ATTACKS.map(t => () =>
  agent(`${BASE}\n\n${t.prompt}\nArgue AGAINST it as hard as you honestly can. Call an argument "fails" only if you can cite why.\n\nVERIFICATION RESULTS:\n${JSON.stringify(verified, null, 1)}`,
    { label: `attack:${t.key}`, phase: 'Attack', model: A.attackModel || 'opus', effort: t.effort || 'high', schema: ATTACK })
))).filter(Boolean)

return { verified, attacks }
