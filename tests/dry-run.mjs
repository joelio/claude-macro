// Runs every workflow end to end against every example args file, with a stubbed agent() that returns
// schema-valid fake output. Catches runtime errors, undefined or [object Object] in prompts, agent calls
// without a model, effort or schema, and a last call that is not the adversary. Costs no tokens.
// Examples are matched to workflows by file name: examples/<workflow>-*.json and packs/*/examples/<workflow>-*.json.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflows = fs.readdirSync(path.join(root, 'workflows')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
const exampleDirs = [path.join(root, 'examples'), ...fs.readdirSync(path.join(root, 'packs'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => path.join(root, 'packs', d.name, 'examples'))].filter(d => fs.existsSync(d));
const examples = exampleDirs.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => path.join(d, f)));

function fake(s, key = 'x') {
  if (!s) return 'x';
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'object': return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, fake(v, k)]));
    case 'array': return Array.from({ length: Math.max(1, s.minItems || 0) }, (_, i) => fake(s.items, `${key}${i}`));
    case 'boolean': return true;
    case 'number': case 'integer': return 1;
    default: return `${key}-value`;
  }
}

let bad = 0; const fail = (w, m) => { console.log(`FAIL ${w}: ${m}`); bad++; };
for (const w of workflows) {
  const src = fs.readFileSync(path.join(root, 'workflows', `${w}.js`), 'utf8');
  const mine = examples.filter(e => path.basename(e).startsWith(`${w}-`) && !workflows.some(o => o !== w && o.startsWith(`${w}-`) && path.basename(e).startsWith(`${o}-`)));
  if (!mine.length) { fail(w, 'no example args file'); continue; }
  for (const ex of mine) {
    const name = `${w} ${path.relative(root, ex)}`; const calls = []; const problems = [];
    const agent = async (prompt, o = {}) => {
      calls.push(o);
      if (/undefined|\[object Object\]/.test(prompt)) problems.push(`${o.label}: prompt contains ${prompt.match(/undefined|\[object Object\]/)[0]}`);
      if (!o.model || !o.effort || !o.schema) problems.push(`${o.label}: missing ${['model', 'effort', 'schema'].filter(k => !o[k]).join(', ')}`);
      return fake(o.schema);
    };
    const parallel = async thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(e => { problems.push(`thunk threw: ${e.message}`); return null; })));
    const pipeline = async (items, ...stages) => Promise.all(items.map(async (it, i) => { let r = it; for (const s of stages) r = await s(r, it, i); return r; }));
    const budget = { total: null, spent: () => 0, remaining: () => Infinity };
    const run = new (Object.getPrototypeOf(async () => {}).constructor)('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
      src.replace(/^export const meta/m, 'const meta'));
    try {
      // Placeholders at the start of a value ("<HOME>/...", "<REPO>") become absolute paths, as the skill would fill them.
      const args = JSON.parse(fs.readFileSync(ex, 'utf8').replace(/"<([A-Z_]+)>/g, (_, k) => `"/${k.toLowerCase()}`));
      const out = await run(args, agent, parallel, pipeline, () => {}, () => {}, budget, async () => null);
      if (!out) problems.push('returned nothing');
      const last = calls.at(-1);
      if (!last || last.model !== 'opus') problems.push(`last agent is ${last && last.label} on ${last && last.model}, not the adversary on opus`);
      if (calls.length > 10) problems.push(`${calls.length} agents; keep runs under 10 unless asked`);
    } catch (e) { problems.push(`threw: ${e.message}`); }
    if (problems.length) fail(name, problems.join('; ')); else console.log(`ok   ${name} (${calls.length} agents: ${calls.map(c => `${c.model}/${c.effort}`).join(' ')})`);
  }
}
process.exit(bad ? 1 : 0);
