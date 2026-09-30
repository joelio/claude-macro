export const meta = {
  name: 'macro-eval-single',
  description: 'Eval baseline: one Opus agent answers a task, either plainly (arm A) or with macro\'s evidence and self-attack discipline (arm C)',
  whenToUse: 'Only as an arm of the macro eval (evals/README.md)',
  phases: [{ title: 'Answer', detail: 'one agent', model: 'opus' }],
}

// args: { prompt, kind: 'claims' | 'debug', mode: 'plain' | 'discipline', workDir, effort? }
// Arm A: mode plain, effort high. Arm C: mode discipline, effort max, as a token-matched single agent.
const A = args || {}
if (!A.prompt || !['claims', 'debug'].includes(A.kind) || !['plain', 'discipline'].includes(A.mode) || !A.workDir) {
  throw new Error('args.prompt, kind (claims|debug), mode (plain|discipline) and workDir are required')
}
const CLAIMS_OUT = { type: 'object', properties: {
  claims: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, claim: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'partly', 'wrong', 'unverifiable'] },
    correction: { type: 'string', description: 'exact corrected wording if not confirmed, else empty' },
    evidence: { type: 'string' },
  }, required: ['id', 'claim', 'verdict', 'correction', 'evidence'] } },
  problems: { type: 'array', items: { type: 'object', properties: { problem: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'serious', 'minor'] } }, required: ['problem', 'severity'] } },
}, required: ['claims', 'problems'] }
const DEBUG_OUT = { type: 'object', properties: {
  root_cause: { type: 'string' }, confidence: { type: 'string', enum: ['established', 'probable', 'open'] },
  chain: { type: 'array', items: { type: 'string' } }, fix_direction: { type: 'string' },
}, required: ['root_cause', 'confidence', 'chain', 'fix_direction'] }
const DISCIPLINE = `
Work like this:
- Tag every claim you make measured, code, sourced or inferred, and back it with a source (file:line at a named commit, a URL, or a data file) and a short verbatim quote. No quote, no "confirmed".
- Use context7 for library behaviour and exa or WebFetch for specs and docs; quote the fetched text.
- When you have an answer, attack it as hard as you honestly can: re-run the cheapest decisive check, look for alternative explanations, and correct anything that does not survive. Report only what survives.`
const out = await agent(`${A.prompt}\n\nScratch files go under ${A.workDir}/ (mkdir -p). Never edit or commit in the target repo.${A.mode === 'discipline' ? DISCIPLINE : ''}`,
  { label: `single:${A.mode}`, phase: 'Answer', model: 'opus', effort: A.effort || (A.mode === 'discipline' ? 'max' : 'high'), schema: A.kind === 'claims' ? CLAIMS_OUT : DEBUG_OUT })
return { arm: A.mode === 'plain' ? 'A' : 'C', not_run: out ? [] : ['single'], output: out }
