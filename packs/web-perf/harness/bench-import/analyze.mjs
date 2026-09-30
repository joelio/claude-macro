import fs from 'fs';
const DIR=process.env.OUT_DIR||'.'; // same OUT_DIR as bench.mjs
const raw=JSON.parse(fs.readFileSync(DIR+'/raw.json'));
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const q=(s,p)=>{const i=(s.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return s[l]+(s[h]-s[l])*(i-l);};
const sorted=a=>[...a].sort((x,y)=>x-y);
const med=a=>q(sorted(a),.5);
function boot(a,b,seed){const r=mulberry32(seed),d=[];for(let k=0;k<10000;k++){const x=[],y=[];for(let i=0;i<a.length;i++)x.push(a[Math.floor(r()*a.length)]);for(let i=0;i<b.length;i++)y.push(b[Math.floor(r()*b.length)]);d.push(med(y)-med(x));}d.sort((x,y)=>x-y);return[d[249],d[9749]];}
function erf(x){const t=1/(1+.3275911*Math.abs(x));const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return x>=0?y:-y;}
function mwu(a,b){const all=[...a.map(v=>[v,0]),...b.map(v=>[v,1])].sort((x,y)=>x[0]-y[0]);const n=all.length,ranks=new Array(n);let tie=0;
  for(let i=0;i<n;){let j=i;while(j+1<n&&all[j+1][0]===all[i][0])j++;const r=(i+j)/2+1;for(let k=i;k<=j;k++)ranks[k]=r;const t=j-i+1;tie+=t**3-t;i=j+1;}
  let R=0;all.forEach((x,i)=>{if(x[1]===0)R+=ranks[i];});const n1=a.length,n2=b.length;const U=R-n1*(n1+1)/2;
  const mu=n1*n2/2,sd=Math.sqrt(n1*n2/12*((n+1)-tie/(n*(n-1))));
  if(sd===0)return{U,p:1};const z=(Math.abs(U-mu)-.5)/sd;return{U,p:1-erf(z/Math.SQRT2)};}
const METRICS={plain:['wall','longtasks','longtaskMax','longtaskSum','heap1','heapDelta'],trace:['wall','compileModuleMain','evaluateModule','mainCompileAndEval','mainTaskContainingEval','bgParse','longtasks','longtaskMax']};
const f=(v,d=1)=>v.toFixed(d);
let md='| mode | cond | metric | full med [IQR] (min-max) | min med [IQR] (min-max) | diff min-full, 95% CI | MWU p | ratio |\n|-|-|-|-|-|-|-|-|\n';const res=[];
for(const mode of ['plain','trace'])for(const cond of ['unthrottled','cpu4x','net20'])for(const m of METRICS[mode]){
  const get=b=>raw.runs.filter(r=>r.mode===mode&&r.cond===cond&&r.build===b&&!r.warm).map(r=>r[m]);
  const A=get('full'),B=get('min');if(A.length!==B.length||!A.length)continue;
  const sc=m.startsWith('heap')?1/1048576:1,d=m.startsWith('heap')?2:1;
  const sa=sorted(A).map(x=>x*sc),sb=sorted(B).map(x=>x*sc);
  const [lo,hi]=boot(sa,sb,raw.seed+7);const {p}=mwu(sa,sb);
  const s=x=>`${f(q(x,.5),d)} [${f(q(x,.25),d)}-${f(q(x,.75),d)}] (${f(x[0],d)}-${f(x[x.length-1],d)})`;
  const dm=q(sb,.5)-q(sa,.5);
  md+=`| ${mode} | ${cond} | ${m} | ${s(sa)} | ${s(sb)} | ${f(dm,d)} [${f(lo,d)}, ${f(hi,d)}] | ${p<1e-4?'<1e-4':p.toFixed(4)} | ${f(q(sb,.5)/q(sa,.5),2)} |\n`;
  res.push({mode,cond,m,n:sa.length,full:sa,min:sb,dm,lo,hi,p});
}
fs.writeFileSync(DIR+'/results.md',md);fs.writeFileSync(DIR+'/results.json',JSON.stringify(res));
console.log(md);
