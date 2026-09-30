// Real browser cache (no page.route): first open vs repeat opens in the same profile.
// desktop: cold load, then reload and a fresh navigation. webview: Android WebView UA, throttled,
// optional header on the document only (EMBED_HEADER), optional cookie clearing between opens
// (CLEAR_COOKIES=1) for apps that start each WebView session without cookies.
// Usage: [ASSET_PREFIX=/assets/] [EMBED_HEADER=name] [EMBED_VALUE=true] [CLEAR_COOKIES=1] [WEBVIEW_UA=..] [OUT_DIR=.] node warm-cache.mjs <url> <label> [n]
import { chromium } from 'playwright';
import fs from 'fs'; import os from 'os'; import path from 'path';
const exe = process.env.CHROME_PATH; // unset: Playwright's bundled headless shell
const [url, label, nArg] = process.argv.slice(2); const n = +(nArg || 5);
const assetPrefix = process.env.ASSET_PREFIX || '/assets/';
if (!url || !label) { console.error('usage: node warm-cache.mjs <url> <label> [n]'); process.exit(2); }
const embed = process.env.EMBED_HEADER, embedValue = process.env.EMBED_VALUE || 'true', clearCookies = process.env.CLEAR_COOKIES === '1';
const UA = process.env.WEBVIEW_UA || 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36';
const outDir = process.env.OUT_DIR || '.'; const KNOBS = { url, n, assetPrefix, ua: UA, embed: embed || null, clearCookies, chrome: exe || 'playwright default' };
const envRecord = async b => ({ browser: await b.version(), os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, loadavg: os.loadavg(), knobs: KNOBS });
let env;
const out = [];
async function load(ctx, s, how) {
  const p = ctx.pages()[0] || await ctx.newPage();
  let bytes = 0, net = 0, cached = 0, assetNet = 0; const t0 = Date.now(); let last = 0;
  const onResp = e => { if (e.response.fromDiskCache || e.response.fromPrefetchCache) cached++; };
  const onFin = e => { bytes += e.encodedDataLength; last = Date.now() - t0; };
  const onReq = e => { if (!e.request.url.startsWith('data:') && !e.request.url.startsWith('blob:')) net++; if (e.request.url.includes(assetPrefix)) assetNet++; };
  s.on('Network.responseReceived', onResp); s.on('Network.loadingFinished', onFin); s.on('Network.requestWillBeSent', onReq);
  if (how === 'reload') await p.reload({ waitUntil: 'networkidle', timeout: 300000 });
  else await p.goto(url, { waitUntil: 'networkidle', timeout: 300000 });
  s.off('Network.responseReceived', onResp); s.off('Network.loadingFinished', onFin); s.off('Network.requestWillBeSent', onReq);
  return { how, requests: net, assetRequests: assetNet, fromDiskCache: cached, transferKB: Math.round(bytes / 1000), lastByteMs: last };
}
for (let i = 0; i < n; i++) {
  for (const mode of ['desktop', 'webview']) {
    const b = await chromium.launch(exe ? { executablePath: exe } : {}); env ||= await envRecord(b);
    const ctx = await b.newContext(mode === 'webview' ? { userAgent: UA, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {});
    const p = await ctx.newPage(); const s = await ctx.newCDPSession(p);
    await s.send('Network.enable');
    if (mode === 'webview') {
      // Header on the document request only, via raw CDP Fetch (Playwright's route() would disable the cache).
      if (embed) {
        await s.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
        s.on('Fetch.requestPaused', e => s.send('Fetch.continueRequest', { requestId: e.requestId, headers: [...Object.entries(e.request.headers).map(([name, value]) => ({ name, value })), { name: embed, value: embedValue }] }).catch(() => {}));
      }
      await s.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
      await s.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const first = await load(ctx, s, 'goto');
    if (mode === 'webview' && clearCookies) await ctx.clearCookies();
    const second = await load(ctx, s, mode === 'desktop' ? 'reload' : 'goto');
    if (mode === 'webview' && clearCookies) await ctx.clearCookies();
    const third = await load(ctx, s, 'goto');
    out.push({ run: i, mode, first, second, third });
    await b.close();
  }
}
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `warm-${label}.json`), JSON.stringify({ env, runs: out }, null, 1));
const med = a => { a = [...a].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
for (const mode of ['desktop', 'webview']) for (const k of ['first', 'second', 'third']) {
  const r = out.filter(o => o.mode === mode).map(o => o[k]); const f = x => r.map(o => o[x]);
  console.log(label, mode, k, r[0].how, 'n=' + r.length, 'reqs', med(f('requests')), 'assetReqs', med(f('assetRequests')), 'diskCache', med(f('fromDiskCache')), 'transferKB', med(f('transferKB')), `[${Math.min(...f('transferKB'))}-${Math.max(...f('transferKB'))}]`, 'lastByteMs', med(f('lastByteMs')), `[${Math.min(...f('lastByteMs'))}-${Math.max(...f('lastByteMs'))}]`);
}
