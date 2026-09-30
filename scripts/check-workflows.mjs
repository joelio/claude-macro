// Checks every workflow script without running it, then syntax-checks the harness.
// Workflows: meta is a pure literal with name, description and phases; phase() calls and
// meta.phases match both ways; the last phase runs on opus; the body compiles as an async
// function; schemas carry the evidence tags and {source, quote, via} citations; prompts
// include the SOURCES block (exa and context7 first); every agent() call sets effort.
// Comments are stripped first so a comment cannot satisfy a rule.
import fs from 'fs';
import { execFileSync } from 'child_process';
const root = new URL('../', import.meta.url);
const dir = new URL('workflows/', root);
let bad = 0;
const fail = (f, m) => { console.log(`FAIL ${f}: ${m}`); bad++; };
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
  const src = fs.readFileSync(new URL(f, dir), 'utf8');
  const meta = src.match(/^export const meta = (\{[\s\S]*?\n\})/m);
  if (!meta) { fail(f, 'no export const meta'); continue; }
  if (/\$\{|\bDate\.now\(|Math\.random\(/.test(meta[1])) { fail(f, 'meta is not a pure literal'); continue; }
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  if (/\bDate\.now\(|Math\.random\(|new Date\(\)/.test(code)) { fail(f, 'Date.now/Math.random/new Date() break resume'); continue; }
  try {
    const m = Function(`return ${meta[1]}`)();
    if (!m.name || !m.description) throw new Error('meta needs name and description');
    const titles = (m.phases || []).map(p => p.title);
    const called = [...code.matchAll(/\bphase\((['"`])([^'"`]+)\1\)/g)].map(x => x[2]);
    for (const t of called) if (!titles.includes(t)) throw new Error(`phase('${t}') is not in meta.phases`);
    for (const t of titles) if (!called.includes(t)) throw new Error(`meta phase '${t}' has no phase() call`);
    if ((m.phases || []).at(-1)?.model !== 'opus') throw new Error('the last phase must be the adversary on opus');
    if (!/\['measured', 'code', 'sourced', 'inferred'\]/.test(code)) throw new Error('no evidence tag enum (measured, code, sourced, inferred)');
    if (!/required: \['source', 'quote', 'via'\]/.test(code)) throw new Error('no citation schema requiring source, quote and via');
    if (!/\$\{SOURCES\}/.test(code) || !/mcp__exa__/.test(code) || !/context7/.test(code)) throw new Error('prompts must include the SOURCES block (exa and context7 first)');
    const calls = code.split(/\bagent\(/).slice(1);
    calls.forEach((c, i) => {
      const opts = c.slice(0, c.search(/\bschema:/) + 1 || undefined);
      if (!/\bschema:/.test(c)) throw new Error(`agent() call ${i + 1} has no schema`);
      if (!/\beffort:/.test(opts)) throw new Error(`agent() call ${i + 1} does not set effort; it would inherit the session's`);
    });
    Function('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow',
      `return (async () => {${src.replace(/^export const meta/m, 'const meta')}})`);
    console.log(`ok   ${f}`);
  } catch (e) { fail(f, e.message); }
}
// Harness: syntax only.
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.name === 'node_modules' ? [] : e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
for (const p of walk(new URL('harness', root).pathname)) {
  const cmd = p.endsWith('.mjs') ? ['node', ['--check', p]] : p.endsWith('.sh') ? ['bash', ['-n', p]] : null;
  if (!cmd) continue;
  try { execFileSync(cmd[0], cmd[1], { stdio: 'pipe' }); console.log(`ok   ${p.slice(p.indexOf('harness/'))}`); }
  catch (e) { fail(p.slice(p.indexOf('harness/')), String(e.stderr).split('\n')[0]); }
}
process.exit(bad ? 1 : 0);
