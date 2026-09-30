// Cold loads of a page, unthrottled and 4x CPU: total transfer, plus one tracked asset's bytes,
// cache-control and main-thread self time.
// Usage: ASSET_MATCH=<url substring> [OUT_DIR=.] [CHROME_PATH=..] node cold-load-profile.mjs <url> <label> [n]
import { chromium } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const exe = process.env.CHROME_PATH; // unset: Playwright's bundled headless shell
const url = process.argv[2], label = process.argv[3], n = +(process.argv[4] || 5);
const asset = process.env.ASSET_MATCH;
if (!url || !label || !asset) { console.error('usage: ASSET_MATCH=<url substring> node cold-load-profile.mjs <url> <label> [n]'); process.exit(2); }
const outDir = process.env.OUT_DIR || '.'; const KNOBS = { url, n, asset, chrome: exe || 'playwright default' };
const envRecord = async b => ({ browser: await b.version(), os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, loadavg: os.loadavg(), knobs: KNOBS });
let env;
const out = [];
for (let i = 0; i < n; i++) {
  for (const cpu of [1, 4]) {
    const b = await chromium.launch(exe ? { executablePath: exe } : {}); env ||= await envRecord(b);
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const s = await ctx.newCDPSession(p);
    await s.send('Network.enable'); await s.send('Profiler.enable');
    await s.send('Profiler.setSamplingInterval', { interval: 200 });
    await s.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const reqs = new Map(); let total = 0, count = 0;
    s.on('Network.responseReceived', e => reqs.set(e.requestId, { url: e.response.url, cc: e.response.headers['cache-control'] || e.response.headers['Cache-Control'] }));
    s.on('Network.loadingFinished', e => { total += e.encodedDataLength; count++; const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
    await s.send('Profiler.start');
    await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(3000);
    const { profile } = await s.send('Profiler.stop');
    const dt = profile.timeDeltas; const self = {};
    const byId = new Map(profile.nodes.map(nd => [nd.id, nd]));
    profile.samples.forEach((id, k) => { const u = byId.get(id).callFrame.url; if (u) self[u] = (self[u] || 0) + (dt[k] || 0) / 1000; });
    const hit = [...reqs.values()].find(r => r.url.includes(asset));
    const aSelf = Object.entries(self).filter(([u]) => u.includes(asset)).reduce((a, [, v]) => a + v, 0);
    out.push({ run: i, cpu, requests: count, totalBytes: total, assetUrl: hit?.url.split('/').pop(), assetBytes: hit?.bytes, assetCC: hit?.cc, assetSelfMs: +aSelf.toFixed(1) });
    await b.close();
  }
}
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ env, runs: out }, null, 1));
const med = a => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
for (const cpu of [1, 4]) {
  const r = out.filter(o => o.cpu === cpu);
  console.log(label, `cpu${cpu}x`, 'n=' + r.length, 'reqs', med(r.map(o => o.requests)), 'totalKB', (med(r.map(o => o.totalBytes)) / 1000).toFixed(0), 'assetKB', (med(r.map(o => o.assetBytes)) / 1000).toFixed(0), 'assetSelfMs med', med(r.map(o => o.assetSelfMs)), 'range', Math.min(...r.map(o => o.assetSelfMs)), '-', Math.max(...r.map(o => o.assetSelfMs)), r[0].assetUrl);
}
