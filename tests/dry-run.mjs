// Runs every workflow end to end against every example args file with a stubbed agent(), at no token cost.
// Three passes per example:
//   full   - every schema field filled, first enum value, one item per array;
//   sparse - empty arrays where the schema allows, enum values varied by call;
//   null   - each agent in turn returns null (as when it fails or is skipped); it must appear in not_run.
// Each example also runs under the quick, deep and max profiles (an unknown profile must be rejected), and with a
// tiny shared budget, which must be stated in every prompt and reported as an overrun.
// Fails on a thrown error, undefined or [object Object] in a prompt, an agent without model, effort or schema,
// more than 10 agents, or (full pass) a last agent that is not the adversary on opus.
// Examples are matched by file name: examples/<workflow>-*.json and packs/*/examples/<workflow>-*.json.
//
// Estimate a real run before spending tokens:  node tests/dry-run.mjs --estimate <args.json> <workflow>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflows = fs.readdirSync(path.join(root, 'workflows')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
const exampleDirs = [path.join(root, 'examples'), ...fs.readdirSync(path.join(root, 'packs'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => path.join(root, 'packs', d.name, 'examples'))].filter(d => fs.existsSync(d));
const examples = exampleDirs.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => path.join(d, f)));
// Placeholders: a value starting with <X> becomes an absolute path (/x); a <x> inside a value becomes plain x.
const readArgs = f => JSON.parse(fs.readFileSync(f, 'utf8')
  .replace(/"<([A-Za-z_]+)>/g, (_, k) => `"/${k.toLowerCase()}`).replace(/<([A-Za-z_]+)>/g, (_, k) => k.toLowerCase()));

function fake(s, mode, n, key = 'x') {
  if (!s) return 'x';
  if (s.enum) return mode === 'sparse' ? s.enum[n % s.enum.length] : s.enum[0];
  switch (s.type) {
    case 'object': return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, fake(v, mode, n, k)]));
    case 'array': return Array.from({ length: mode === 'sparse' ? (s.minItems || 0) : Math.max(1, s.minItems || 0) }, (_, i) => fake(s.items, mode, n + i, `${key}${i}`));
    case 'boolean': return mode !== 'sparse';
    case 'number': case 'integer': return 1;
    default: return `${key}-value`;
  }
}

async function runOnce(w, args, mode, nullAt = -1) {
  const src = fs.readFileSync(path.join(root, 'workflows', `${w}.js`), 'utf8');
  const calls = [], problems = [], prompts = [];
  const agent = async (prompt, o = {}) => {
    const n = calls.length; calls.push(o); prompts.push(prompt);
    const m = /undefined|\[object Object\]/.exec(prompt);
    if (m) problems.push(`${o.label}: prompt contains ${m[0]}`);
    if (!o.model || !o.effort || !o.schema) problems.push(`${o.label}: missing ${['model', 'effort', 'schema'].filter(k => !o[k]).join(', ')}`);
    return n === nullAt ? null : fake(o.schema, mode, n);
  };
  const parallel = async thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(e => { problems.push(`thunk threw: ${e.message}`); return null; })));
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (it, i) => { let r = it; for (const s of stages) r = await s(r, it, i); return r; }));
  const budget = { total: null, spent: () => calls.length * 1000, remaining: () => Infinity };
  const run = new (Object.getPrototypeOf(async () => {}).constructor)('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
    src.replace(/^export const meta/m, 'const meta'));
  let out;
  try { out = await run(args, agent, parallel, pipeline, () => {}, () => {}, budget, async () => null); } catch (e) { problems.push(`threw: ${e.message}`); }
  if (!problems.length && !out) problems.push('returned nothing');
  if (calls.length > 10) problems.push(`${calls.length} agents; the limit is 10 unless the user asks`);
  return { calls, problems, out, prompts };
}

// Unit check on the shared demote(): uncited blocker, serious and refuted become questions; cited ones stay.
{
  const src = fs.readFileSync(path.join(root, 'workflows', `${workflows[0]}.js`), 'utf8');
  const shared = src.match(/\/\/ --- shared:[\s\S]*?\/\/ --- end shared ---/)[0];
  const { demote, quoteStatus } = new Function('A', 'budget', 'log', `${shared}\nreturn { demote, quoteStatus }`)({}, { spent: () => 0 }, () => {});
  const qs = quoteStatus({ results: [{ ref: 'verify:c1.0', status: 'not-found' }, { ref: 'verify:c2.1', status: 'found' }, { ref: 's#3.0', status: 'source-missing' }] });
  if (qs.get('verify:c1') !== 'not-found' || qs.has('verify:c2') || qs.get('s#3') !== 'source-missing') { console.log('FAIL quoteStatus(): failed quotes not mapped to claim ids'); process.exitCode = 1; }
  else console.log('ok   quoteStatus() unit check');
  const out = demote([{ severity: 'blocker', citations: [] }, { severity: 'refuted' }, { severity: 'serious', citations: [{}] }, { severity: 'minor', citations: [] }]);
  const want = ['question', 'question', 'serious', 'minor'];
  if (out.map(o => o.severity).join() !== want.join()) { console.log(`FAIL demote(): got ${out.map(o => o.severity)}, want ${want}`); process.exitCode = 1; }
  else console.log('ok   demote() unit check');
}

if (process.argv[2] === '--estimate') {
  const [file, w] = process.argv.slice(3);
  if (!file || !workflows.includes(w)) { console.error(`usage: node tests/dry-run.mjs --estimate <args.json> <${workflows.join('|')}>`); process.exit(2); }
  const { calls, problems } = await runOnce(w, readArgs(file), 'full');
  const tiers = calls.reduce((t, c) => ({ ...t, [`${c.model}/${c.effort}`]: (t[`${c.model}/${c.effort}`] || 0) + 1 }), {});
  console.log(`${w}: ${calls.length} agents (${Object.entries(tiers).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  console.log(calls.map(c => `  ${c.label}: ${c.model}/${c.effort}`).join('\n'));
  if (problems.length) { console.log(`problems: ${problems.join('; ')}`); process.exit(1); }
  console.log('Counts that depend on agent output (debug hypotheses) are shown at their minimum. Compare with the README cost table; opus/high agents dominate the cost.');
  process.exit(0);
}

let bad = 0; const fail = (w, m) => { console.log(`FAIL ${w}: ${m}`); bad++; };
for (const w of workflows) {
  const mine = examples.filter(e => path.basename(e).startsWith(`${w}-`) && !workflows.some(o => o !== w && o.startsWith(`${w}-`) && path.basename(e).startsWith(`${o}-`)));
  if (!mine.length) { fail(w, 'no example args file'); continue; }
  for (const ex of mine) {
    const name = `${w} ${path.relative(root, ex)}`, args = readArgs(ex);
    const full = await runOnce(w, args, 'full');
    const last = full.calls.at(-1);
    if (!last || last.model !== 'opus') full.problems.push(`last agent is ${last && last.label} on ${last && last.model}, not the adversary on opus`);
    const sparse = await runOnce(w, args, 'sparse');
    // Profiles: every profile runs clean, and 'max' puts the last agent (the adversary) at max unless the example pins it.
    for (const profile of ['quick', 'deep', 'max']) {
      const r = await runOnce(w, { ...args, profile }, 'full');
      r.problems.forEach(p => full.problems.push(`profile ${profile}: ${p}`));
      if (profile === 'max' && r.calls.at(-1)?.effort !== 'max' && !JSON.stringify(args).includes('"effort"')) full.problems.push(`profile max left the adversary at ${r.calls.at(-1)?.effort}`);
    }
    // Budgets: a tiny shared limit must be stated in prompts and reported as an overrun (every fake agent uses 1).
    const tight = await runOnce(w, { ...args, budgets: { modelCalls: 1, gets: 1 } }, 'full');
    tight.problems.forEach(p => full.problems.push(`budgets: ${p}`));
    if (!(tight.out && tight.out.usage && tight.out.usage.over.length)) full.problems.push('a shared-limit overrun was not reported in usage.over');
    if (!tight.prompts.every(p => p.includes('Shared limits for this run'))) full.problems.push('not every prompt states the shared-limit shares');
    // Optional recheck stage (verify, change-evidence): must run clean; the agent limit doesn't apply, since the user asked for it.
    const rc = await runOnce(w, { ...args, recheck: true }, 'full');
    rc.problems.filter(p => !/agents; the limit/.test(p)).forEach(p => full.problems.push(`recheck: ${p}`));
    const bad = await runOnce(w, { ...args, profile: 'turbo' }, 'full');
    if (!bad.problems.some(p => /profile must be one of/.test(p))) full.problems.push('an unknown profile was not rejected');
    const nulls = [];
    for (let k = 0; k < full.calls.length; k++) {
      const r = await runOnce(w, args, 'full', k);
      if (r.problems.length) nulls.push(`agent ${k} (${full.calls[k].label}) null: ${r.problems.join(', ')}`);
      // A failed agent must be reported, never silently dropped (default-fail).
      else if (!(r.out && Array.isArray(r.out.not_run) && r.out.not_run.length)) nulls.push(`agent ${k} (${full.calls[k].label}) returned null but not_run is empty`);
    }
    const problems = [...full.problems, ...sparse.problems.map(p => `sparse: ${p}`), ...nulls];
    if (problems.length) fail(name, problems.join('; '));
    else console.log(`ok   ${name} (${full.calls.length} agents: ${full.calls.map(c => `${c.model}/${c.effort}`).join(' ')}; sparse and null passes clean)`);
  }
}
process.exit(bad || process.exitCode ? 1 : 0);
