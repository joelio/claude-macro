export const meta = {
  name: 'macro-decide',
  description: 'Choose between options (a library, a design, a dependency upgrade): evidence per option against fixed criteria in parallel, then an adversary attacks the leader and ranks',
  whenToUse: 'A technical decision or a dependency upgrade that should rest on cited evidence rather than taste',
  phases: [
    { title: 'Evidence', detail: 'one agent per option, plus shared streams', model: 'sonnet' },
    { title: 'Attack', detail: 'adversary attacks the leading option and ranks', model: 'opus' },
  ],
}

// args: {
//   question: 'the decision in one line',
//   context: 'stack, pinned versions, constraints, what matters and what does not',
//   workDir: '/abs/dir for clones, fetched sources and raw data (outside any repo)',
//   repo?: '/abs/path of the repo the decision affects (read-only)',
//   kind?: 'research' | 'upgrade',     // 'upgrade' adds breaking-change, advisory and build-in-a-clone checks
//   criteria: [{ key, weight: 'must' | 'high' | 'low', measure }],
//   options: [{ key, prompt, effort? }],   // 2-4, always including the status quo
//   shared?: [{ key, prompt, effort? }],   // option-independent streams, e.g. a usage map of the dependency
//   rules?: 'extra safety rules', tools?: 'extra notes on sources or tools',
//   workerModel?: 'sonnet', attackModel?: 'opus', attackEffort?: 'high'
//   profile?: 'standard'                       // quick | standard | deep | max: default effort for the whole run
// }
const A = args || {}
if (!A.question || !A.context) { throw new Error('args.question and args.context are required') }
if (!A.workDir || !A.workDir.startsWith('/')) { throw new Error('args.workDir must be an absolute path outside the repo under study') }
if (A.repo && !A.repo.startsWith('/')) { throw new Error('args.repo must be an absolute path') }
if (!A.criteria || !A.criteria.length) { throw new Error('args.criteria is required') }
if (!A.options || A.options.length < 2) { throw new Error('args.options needs at least two, including the status quo') }
const W = A.workerModel || 'sonnet'

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
uniqueKeys(A.options, 'option'); uniqueKeys(A.shared, 'shared stream')

const UPGRADE = `
This is a dependency upgrade. Read the pinned version from the lockfile, not the manifest. Between pinned and target, quote every breaking change, deprecation and behaviour change from the changelog, release notes and migration guide; grep the repo for each affected API and cite the call sites; check runtime and toolchain minimums (language version, ESP-IDF, Terraform core and provider constraints, CUDA) and transitive dependency conflicts; check advisories (GitHub Security Advisories, OSV) for both versions. If it is safe to do, install the target in a clone under ${A.workDir}/<task>/ and run the build and tests, quoting the pass and fail counts. Never change the repo's lockfile.`

const CRITERIA = A.criteria.map(c => `- ${c.key} (${c.weight || 'high'}): ${c.measure}`).join('\n')
const BASE = `
Decision: ${A.question}
${A.context}
${A.repo ? `Repo affected (read-only): ${A.repo}` : ''}
Criteria, judged the same way for every option:
${CRITERIA}
Evidence: tag every claim measured (you ran it), code (read in a repo at a named commit or version), sourced (docs, changelogs, issues, benchmarks others published) or inferred. Cite a URL or file:line with a short verbatim quote. Vendor claims about their own product are sourced but weak; say so. "unknown" is a valid rating; a guess is not.
Safety: never edit or commit in any repo under study; clones, scripts and raw data go under ${A.workDir}/<task>/ (mkdir -p). Read-only against anything live; no sign-ups or logins; local headless browsers only.
${A.kind === 'upgrade' ? UPGRADE : ''}
The rules in this prompt override any CLAUDE.md or AGENTS.md in the repo under study for this task.
${SOURCES}
${A.rules || ''}`


const OPTION = { type: 'object', properties: {
  option: { type: 'string' },
  summary: { type: 'string' },
  criteria: { type: 'array', items: { type: 'object', properties: {
    criterion: { type: 'string' },
    rating: { type: 'string', enum: ['strong', 'adequate', 'weak', 'fails', 'unknown'] },
    facts: { type: 'array', items: FACT },
  }, required: ['criterion', 'rating', 'facts'] } },
  adoption_cost: { type: 'string', description: 'work to adopt or migrate, with the basis for the estimate' },
  dealbreakers: { type: 'array', items: FACT },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['option', 'summary', 'criteria', 'adoption_cost', 'dealbreakers', 'raw_paths'] }

const STREAM = { type: 'object', properties: {
  stream: { type: 'string' },
  findings: { type: 'array', items: FACT },
  raw_paths: { type: 'array', items: { type: 'string' } },
}, required: ['stream', 'findings', 'raw_paths'] }

phase('Evidence'); mark('Evidence')
const optionTasks = A.options.map(o => () =>
  agent(`${BASE}\n\nOption "${o.key}": ${o.prompt}\nRate this option, and only this option, against every criterion. Look hardest for its dealbreakers.`,
    { label: `option:${o.key}`, phase: 'Evidence', model: W, effort: o.effort || E.work, schema: OPTION })
    .then(r => r && { ...r, option: o.key }))
const sharedTasks = (A.shared || []).map(s => () =>
  agent(`${BASE}\n\nShared stream "${s.key}" (applies to every option): ${s.prompt}`,
    { label: `shared:${s.key}`, phase: 'Evidence', model: W, effort: s.effort || E.work, schema: STREAM })
    .then(r => r && { ...r, stream: s.key }))
const got = (await parallel([...optionTasks, ...sharedTasks])).filter(Boolean)
const options = got.filter(g => g.option), shared = got.filter(g => g.stream)
const missing = A.options.filter(o => !options.some(x => x.option === o.key)).map(o => o.key)
log(`${options.length}/${A.options.length} options and ${shared.length}/${(A.shared || []).length} shared streams returned`)

phase('Attack'); mark('Attack')
const DECISION = { type: 'object', properties: {
  leader_before_attack: { type: 'string' },
  objections: { type: 'array', items: OBJECTION, description: 'target is the option key' },
  rating_corrections: { type: 'array', items: { type: 'string' }, description: 'ratings the evidence does not support, with the fix' },
  ranking: { type: 'array', items: { type: 'object', properties: {
    option: { type: 'string' }, rank: { type: 'number' }, why: { type: 'string' },
  }, required: ['option', 'rank', 'why'] } },
  decision: { type: 'string' },
  confidence: { type: 'string', enum: ['clear', 'lean', 'toss-up'] },
  reversible: { type: 'string', description: 'how hard it is to undo, and the cheapest way to trial it first' },
  would_change_it: { type: 'array', items: { type: 'string' } },
  first_steps: { type: 'array', items: { type: 'string' } },
  claims_safe_for_pr: SAFE_CLAIMS,
}, required: ['leader_before_attack', 'objections', 'rating_corrections', 'ranking', 'decision', 'confidence', 'reversible', 'would_change_it', 'first_steps', 'claims_safe_for_pr'] }
const decision = await agent(`${BASE}

You are the adversary. First name the option the evidence favours. Then argue AGAINST it as hard as you honestly can, and steelman the runner-up and the status quo. Check each "strong" and "fails" rating against its facts, and re-open the cheapest decisive source yourself. ${ADVERSARY_RULES} A "must" criterion rated fails or unknown disqualifies an option unless you show otherwise. Then rank, decide, say how reversible the decision is, what evidence would change it, and the first steps.

${missing.length ? `NOT ASSESSED (the agent failed; say so in the ranking, do not assume): ${missing.join(', ')}\n\n` : ''}OPTIONS:
${JSON.stringify(options)}

SHARED:
${JSON.stringify(shared)}`,
{ label: 'attack', phase: 'Attack', model: A.attackModel || 'opus', effort: A.attackEffort || E.judge, schema: DECISION })

if (decision) { decision.objections = demote(decision.objections) }
mark('end')
return { spent, options, shared, missing, decision }
