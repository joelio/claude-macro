// Mobile WebView emulation: cold load of a page, throttled network and CPU. If your app's WebView
// sends a header on the document request (loadRequest), set EMBED_HEADER and it is sent there only.
// Records total transfer, one tracked asset (name, bytes, cache-control) and load timings.
// Usage: ASSET_MATCH=<url substring> [EMBED_HEADER=name] [EMBED_VALUE=true] [WEBVIEW_UA=..] [OUT_DIR=.] node webview-throttled.mjs <url> <label> [n]
import { chromium } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const exe = process.env.CHROME_PATH; // unset: Playwright's bundled headless shell
const [url, label, nArg] = process.argv.slice(2);
const n = +(nArg || 5);
const asset = process.env.ASSET_MATCH;
if (!url || !label || !asset) { console.error('usage: ASSET_MATCH=<url substring> node webview-throttled.mjs <url> <label> [n]'); process.exit(2); }
const embed = process.env.EMBED_HEADER, embedValue = process.env.EMBED_VALUE || 'true';
const UA = process.env.WEBVIEW_UA || 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36';
const outDir = process.env.OUT_DIR || '.'; const KNOBS = { url, n, asset, ua: UA, embed: embed || null, chrome: exe || 'playwright default' };
const envRecord = async b => ({ browser: await b.version(), os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, loadavg: os.loadavg(), knobs: KNOBS });
let env;
const NETS = { slow4g: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }, fast4g: { latency: 40, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } };
const out = [];
for (let i = 0; i < n; i++) {
  for (const net of Object.keys(NETS)) {
    const b = await chromium.launch(exe ? { executablePath: exe } : {}); env ||= await envRecord(b);
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    // Header on the document request only, as a WebView loadRequest sends it. Routing disables the HTTP cache,
    // which is harmless here because every load is cold.
    if (embed) await ctx.route(u => u.href === url, r => r.continue({ headers: { ...r.request().headers(), [embed.toLowerCase()]: embedValue } }));
    const p = await ctx.newPage(); const s = await ctx.newCDPSession(p);
    await s.send('Network.enable');
    await s.send('Network.emulateNetworkConditions', { offline: false, ...NETS[net] });
    await s.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const reqs = new Map(); let total = 0, count = 0;
    s.on('Network.responseReceived', e => reqs.set(e.requestId, { url: e.response.url, cc: e.response.headers['cache-control'] }));
    let lastFinish = 0; const tStart = Date.now();
    s.on('Network.loadingFinished', e => { total += e.encodedDataLength; count++; lastFinish = Date.now() - tStart; const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.doneMs = Date.now() - tStart; } });
    const t0 = Date.now();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
    const nav = await p.evaluate(() => { const e = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) }; });
    const hit = [...reqs.values()].find(r => r.url.includes(asset));
    out.push({ run: i, net, requests: count, totalBytes: total, asset: hit?.url.split('/').pop(), assetBytes: hit?.bytes, assetCC: hit?.cc, ...nav, assetDoneMs: hit?.doneMs, allDoneMs: lastFinish });
    await b.close();
  }
}
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `mobile-${label}.json`), JSON.stringify({ env, runs: out }, null, 1));
const med = a => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
for (const net of Object.keys(NETS)) {
  const r = out.filter(o => o.net === net); const f = k => r.map(o => o[k]);
  console.log(label, net, 'n=' + r.length, 'reqs', med(f('requests')), 'totalKB', (med(f('totalBytes')) / 1000).toFixed(0), 'assetKB', (med(f('assetBytes')) / 1000).toFixed(0), 'dcl', med(f('dcl')), `[${Math.min(...f('dcl'))}-${Math.max(...f('dcl'))}]`, 'load', med(f('load')), `[${Math.min(...f('load'))}-${Math.max(...f('load'))}]`, 'assetDone', med(f('assetDoneMs')), `[${Math.min(...f('assetDoneMs'))}-${Math.max(...f('assetDoneMs'))}]`, 'allDone', med(f('allDoneMs')), `[${Math.min(...f('allDoneMs'))}-${Math.max(...f('allDoneMs'))}]`, r[0].asset, r[0].assetCC);
}
