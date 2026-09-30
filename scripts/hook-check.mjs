// PostToolUse hook for this repo: after an Edit or Write to a workflow, example, test or check script,
// run the checks. On failure, exit 2 so Claude sees the output and fixes it before moving on.
import { execFileSync } from 'child_process';
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let file = '';
  try { file = JSON.parse(input).tool_input?.file_path || ''; } catch { process.exit(0); }
  if (!/\/(workflows|examples|tests|packs\/[^/]+\/examples)\/|scripts\/check-workflows\.mjs$/.test(file)) process.exit(0);
  try {
    execFileSync('node', ['scripts/check-workflows.mjs'], { stdio: 'pipe' });
    execFileSync('node', ['tests/dry-run.mjs'], { stdio: 'pipe' });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').filter(l => l && !l.startsWith('ok')).join('\n');
    process.stderr.write(`npm test fails after editing ${file}:\n${out}\n`);
    process.exit(2);
  }
});
