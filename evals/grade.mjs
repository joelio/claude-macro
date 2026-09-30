// Deterministic grader for the macro eval. Every arm's output is normalised to the same shape, then scored
// against the task's answer key (tasks/<task>/answers.json).
//   node evals/grade.mjs <task> <output.json>     score one trial; prints JSON
//   node evals/grade.mjs --summary <run-dir>      aggregate <run-dir>/results.jsonl by task and arm
//   node evals/grade.mjs --self-test              each task's reference answer must pass and its bad answer must fail
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const key = task => JSON.parse(fs.readFileSync(path.join(here, 'tasks', task, 'answers.json'), 'utf8'));

// Flagged items: claims judged partly or wrong, plus any problems or objections, as text to match against.
function normalise(out) {
  const o = out.output || out;
  const claims = o.claims || (o.verified || []).flatMap(g => g.claims || []);
  const flagged = claims.filter(c => ['partly', 'wrong'].includes(c.verdict)).map(c => `${c.claim} ${c.correction || ''}`);
  const extra = [...(o.problems || []).map(p => p.problem || ''),
    ...((o.logic && o.logic.conclusions) || []).flatMap(c => [...(c.objections || []).map(x => `${x.objection} ${x.fix_or_test || ''}`), c.follows !== 'yes' ? c.revised || '' : '']),
    ...(o.attacks || []).flatMap(a => (a.objections || []).filter(x => x.severity !== 'refuted').map(x => x.objection))];
  const wrong = claims.filter(c => c.verdict === 'wrong').length, partly = claims.filter(c => c.verdict === 'partly').length;
  const v = o.verdict || o;
  const debugText = [v.root_cause, ...(v.chain || []).map(c => typeof c === 'string' ? c : c.claim), v.fix_direction].filter(Boolean).join(' ');
  return { flagged: [...flagged, ...extra], wrong, partly, debugText };
}

export function score(task, out) {
  const k = key(task), n = normalise(out), re = s => new RegExp(s, 'is');
  if (k.kind === 'debug') {
    const found = k.causes.filter(c => re(c.fix).test(n.debugText)).map(c => c.id);
    return { task, kind: 'debug', found, missed: k.causes.map(c => c.id).filter(i => !found.includes(i)), recall: found.length / k.causes.length, pass: found.length === k.causes.length };
  }
  if (!k.planted.length) { // negative control: a clean report
    return { task, kind: 'clean', wrongFlags: n.wrong, partlyFlags: n.partly, pass: n.wrong === 0 };
  }
  const found = k.planted.filter(p => n.flagged.some(t => re(p.where).test(t) && re(p.fix).test(t))).map(p => p.id);
  return { task, kind: 'planted', found, missed: k.planted.map(p => p.id).filter(i => !found.includes(i)),
    recall: found.length / k.planted.length, wrongFlags: n.wrong, partlyFlags: n.partly, pass: found.length === k.planted.length };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === '--self-test') {
  let bad = 0;
  for (const task of fs.readdirSync(path.join(here, 'tasks'))) {
    const k = key(task), r = score(task, k.reference), w = score(task, k.bad);
    const ok = r.pass && !w.pass && (r.recall === undefined || r.recall === 1) && (w.recall === undefined || w.recall === 0 || task === 'debug-22');
    console.log(`${ok ? 'ok  ' : 'FAIL'} eval grader ${task}: reference ${JSON.stringify({ pass: r.pass, recall: r.recall })}, bad ${JSON.stringify({ pass: w.pass, recall: w.recall })}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === '--summary') {
  const rows = fs.readFileSync(path.join(a, 'results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const groups = {};
  for (const r of rows) (groups[`${r.task}\t${r.arm}`] ||= []).push(r);
  console.log('task\tarm\ttrials\tpass\tmean recall\twrong flags\tmean tokens\ttokens per pass');
  for (const [g, rs] of Object.entries(groups)) {
    const passes = rs.filter(r => r.score.pass).length, tok = rs.reduce((s, r) => s + (r.tokens || 0), 0);
    const rec = rs.filter(r => r.score.recall !== undefined);
    console.log(`${g}\t${rs.length}\t${passes}/${rs.length}\t${rec.length ? (rec.reduce((s, r) => s + r.score.recall, 0) / rec.length).toFixed(2) : '-'}\t${rs.reduce((s, r) => s + (r.score.wrongFlags || 0), 0)}\t${Math.round(tok / rs.length)}\t${passes ? Math.round(tok / passes) : '-'}`);
  }
} else if (cmd && a) {
  console.log(JSON.stringify(score(cmd, JSON.parse(fs.readFileSync(a, 'utf8')))));
} else {
  console.error('usage: node evals/grade.mjs <task> <output.json> | --summary <run-dir> | --self-test'); process.exit(2);
}
