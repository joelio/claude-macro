// Usage: PKG_DIR=<dir>/ [FILE_A=..] [FILE_B=..] [SEED=..] [N=20] [CHROME_PATH=..] node bench.mjs
// Writes raw.json incrementally; then node analyze.mjs. Arm A is 'full', arm B is 'min'.
import {chromium} from 'playwright';
import fs from 'fs'; import os from 'os'; import {fileURLToPath} from 'url';
import {start} from './server.mjs';

const SEED=+(process.env.SEED||20260930), N=+(process.env.N||20), WARM=2, PORT=8933;
const OUT=fileURLToPath(new URL('./raw.json',import.meta.url));
const EXE=process.env.CHROME_PATH; // unset: Playwright's bundled headless shell
const CONDS={
  unthrottled:{cpu:1,net:null},
  cpu4x:{cpu:4,net:null},
  net20:{cpu:1,net:{offline:false,latency:40,downloadThroughput:20e6/8,uploadThroughput:20e6/8}},
};
const BUILDS=['full','min'], MODES=['plain','trace'];

function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rnd=mulberry32(SEED);
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function heap(c){await c.send('HeapProfiler.collectGarbage');await c.send('HeapProfiler.collectGarbage');
  const {metrics}=await c.send('Performance.getMetrics');return metrics.find(m=>m.name==='JSHeapUsedSize').value;}

async function one(mode,cond,build){
  const cfg=CONDS[cond];
  const b=await chromium.launch(EXE?{executablePath:EXE}:{});   // fresh browser process: no shared V8/HTTP state
  try{
    const ctx=await b.newContext();const p=await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/`);
    const c=await ctx.newCDPSession(p);
    await c.send('Performance.enable');
    await p.evaluate(()=>{window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(e.duration)}).observe({type:'longtask'});});
    const h0=await heap(c);
    let evs=[],done;
    if(mode==='trace'){
      c.on('Tracing.dataCollected',d=>evs.push(...d.value));
      done=new Promise(r=>c.on('Tracing.tracingComplete',r));
      await c.send('Tracing.start',{traceConfig:{includedCategories:['devtools.timeline','v8','disabled-by-default-v8.compile'],recordMode:'recordAsMuchAsPossible'},transferMode:'ReportEvents'});
    }
    if(cfg.cpu!==1)await c.send('Emulation.setCPUThrottlingRate',{rate:cfg.cpu});
    if(cfg.net)await c.send('Network.emulateNetworkConditions',cfg.net);
    const wall=await p.evaluate(async u=>{const t0=performance.now();window.__m=await import(u);return performance.now()-t0;},`http://127.0.0.1:${PORT}/${build}.js`);
    await sleep(150);
    const lt=await p.evaluate(()=>window.__lt);
    const rec={mode,cond,build,wall,longtasks:lt.length,longtaskMax:lt.length?Math.max(...lt):0,longtaskSum:lt.reduce((a,b)=>a+b,0)};
    if(mode==='trace'){
      await c.send('Tracing.end');await done;
      const sum=n=>evs.filter(e=>e.ph==='X'&&e.name===n).reduce((a,e)=>a+e.dur/1000,0);
      const ev=evs.find(e=>e.name==='v8.evaluateModule');
      if(!ev)throw new Error('no v8.evaluateModule trace event; check the trace categories for this Chromium');
      const tid=ev.tid;
      rec.compileModuleMain=sum('v8.compileModule');
      rec.evaluateModule=sum('v8.evaluateModule');
      rec.bgParse=sum('v8.parseOnBackground');
      // main-thread task time from the start of import to the end of module evaluation
      rec.mainTaskContainingEval=evs.filter(e=>e.ph==='X'&&e.name==='RunTask'&&e.tid===tid&&e.ts<=ev.ts&&e.ts+e.dur>=ev.ts+ev.dur).reduce((a,e)=>a+e.dur/1000,0);
      rec.mainCompileAndEval=rec.compileModuleMain+rec.evaluateModule;
    }else{
      if(cfg.cpu!==1)await c.send('Emulation.setCPUThrottlingRate',{rate:1});
      const h1=await heap(c);
      rec.heap0=h0;rec.heap1=h1;rec.heapDelta=h1-h0;
    }
    return rec;
  }finally{await b.close();}
}

const srv=await start(PORT);
const probe=await chromium.launch(EXE?{executablePath:EXE}:{});
const out={seed:SEED,N,WARM,chromium:await probe.version(),os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0]?.model,loadavgStart:os.loadavg(),runs:[],started:new Date().toISOString(),order:[]};
await probe.close();
for(const mode of MODES)for(const cond of Object.keys(CONDS)){
  const plan=[];
  for(const bl of BUILDS)for(let i=0;i<WARM;i++)plan.push({bl,warm:true});
  shuffle(plan);
  const meas=[];for(const bl of BUILDS)for(let i=0;i<N;i++)meas.push({bl,warm:false});
  shuffle(meas);
  for(const s of [...plan,...meas]){
    const r=await one(mode,cond,s.bl);r.warm=s.warm;r.idx=out.runs.length;out.runs.push(r);
    fs.writeFileSync(OUT,JSON.stringify(out));
  }
  console.log('done',mode,cond,new Date().toISOString());
}
out.finished=new Date().toISOString();out.loadavgEnd=os.loadavg();fs.writeFileSync(OUT,JSON.stringify(out));
srv.close();
