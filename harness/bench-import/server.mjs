// Serves two builds of a file gzipped with no-store. Set GZIP_LEVEL to match your asset pipeline (default 9).
import http from 'http'; import fs from 'fs'; import zlib from 'zlib'; import path from 'path'; import {fileURLToPath} from 'url';
// Directory holding the files to compare, e.g. node_modules/@vendor/pkg/
const PKG=process.env.PKG_DIR;
if(!PKG){console.error('set PKG_DIR');process.exit(2);}
// Arm A and arm B file names inside PKG_DIR.
const FILES={'/full.js':process.env.FILE_A||'bundle.js','/min.js':process.env.FILE_B||'bundle.min.js'};
const gz={}; for(const [u,f] of Object.entries(FILES)) gz[u]=zlib.gzipSync(fs.readFileSync(path.join(PKG,f)),{level:+(process.env.GZIP_LEVEL||9)});
const PAGE='<!doctype html><meta charset=utf-8><title>b</title><body>';
export function start(port=8931){return new Promise(r=>{const s=http.createServer((q,res)=>{
  const p=q.url.split('?')[0];
  if(p==='/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});return res.end(PAGE);}
  if(gz[p]){res.writeHead(200,{'content-type':'text/javascript','content-encoding':'gzip','content-length':gz[p].length,'cache-control':'no-store'});return res.end(gz[p]);}
  res.writeHead(404);res.end();
}).listen(port,'127.0.0.1',()=>r(s));});}
export const SIZES=Object.fromEntries(Object.entries(gz).map(([k,v])=>[k,v.length]));
if(process.argv[1]===fileURLToPath(import.meta.url)){await start();console.log(SIZES);}
