import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

export function allowedURL(raw){
 const u=new URL(raw);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('只支持学校、政府和 AEA 的标准 HTTP/HTTPS 地址');
 if(!(/\.(edu|gov)\.cn$/i.test(u.hostname)||u.hostname==='aeaweb.org'||u.hostname.endsWith('.aeaweb.org')))throw Error('来源仅支持 edu.cn、gov.cn、aeaweb.org 域名');
 return u;
}
export function publicIPv4(ip){
 const a=ip.split('.').map(Number);
 return a.length===4&&a.every(x=>Number.isInteger(x)&&x>=0&&x<=255)&&![0,10,127].includes(a[0])&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&(a[1]===168||a[1]===0))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&[18,19].includes(a[1]));
}
export async function getHTML(raw,redirects=0){
 const u=allowedURL(raw);
 const addresses=await dns.lookup(u.hostname,{family:4,all:true});
 if(!addresses.length||addresses.some(x=>!publicIPv4(x.address)))throw Error('来源解析到非公网地址，已阻止');
 const address=addresses[0].address;
 return new Promise((resolve,reject)=>{
  const client=u.protocol==='https:'?https:http;
  const req=client.get(u,{headers:{'User-Agent':'EconRadar/1.0 (personal recruitment monitor)','Accept':'text/html,application/xhtml+xml'},lookup:(_host,opts,cb)=>cb(null,opts.all?[{address,family:4}]:address,4)},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){
    res.resume();if(redirects>=4)return reject(Error('重定向过多'));
    try{resolve(getHTML(new URL(res.headers.location,u).href,redirects+1));}catch(e){reject(e);}return;
   }
   if(res.statusCode!==200){res.resume();return reject(Error('HTTP '+res.statusCode));}
   const ct=res.headers['content-type']||'';
   if(!/html|text\//i.test(ct)){res.resume();return reject(Error('来源不是网页'));}
   let size=0;const chunks=[];
   res.on('data',b=>{size+=b.length;if(size>3*1024*1024)req.destroy(Error('网页超过 3 MB'));else chunks.push(b);});
   res.on('end',()=>{
    try{const bytes=Buffer.concat(chunks),head=bytes.subarray(0,3000).toString('ascii');
     const encoding=(ct.match(/charset\s*=\s*["']?([\w-]+)/i)||head.match(/charset\s*=\s*["']?([\w-]+)/i)||[])[1]||'utf-8';
     resolve({html:new TextDecoder(encoding).decode(bytes),url:u.href});
    }catch{reject(Error('网页编码无法识别'));}
   });res.on('error',reject);
  });
  const timer=setTimeout(()=>req.destroy(Error('连接超时（15 秒）')),15000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);
 });
}
function plain(s){return s.replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const i=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return i<=0x10ffff?String.fromCodePoint(i):'';}).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();}
export function extractLinks(html,base,source){
 const out=[],seen=new Set();
 const clean=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi,'');
 for(const m of clean.matchAll(/<a\b([^>]*?)>([^]*?)<\/a\s*>/gi)){
  const href=(m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)||[]).slice(1).find(x=>x!==undefined);
  const title=plain(m[2])||plain((m[1].match(/\btitle\s*=\s*["']([^"']*)/i)||[])[1]||'');
  if(!href||title.length<8||!/(招聘|招收|博士后|引才|人才引进|诚聘|教职|聘任|recruit|vacanc|postdoc|faculty position)/i.test(title))continue;
  let url;try{url=new URL(plain(href),base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;url.hash='';}catch{continue;}
  if(seen.has(url.href))continue;seen.add(url.href);
  out.push({id:createHash('sha256').update(url.href).digest('hex').slice(0,24),title,url:url.href,sourceId:source.id,sourceName:source.name,firstSeenAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),verification:'待核实',deadline:''});
  if(out.length>=150)break;
 }
 return out;
}
export async function atomicJSON(file,data){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2),'utf8');await rename(tmp,file);}
export function createCollector(root,fetcher=getHTML){
 const file=path.join(root,'data/feed.json');let running=false;
 return {get running(){return running;},async scan(){
  if(running)return false;running=true;
  try{
   const sources=JSON.parse(await readFile(path.join(root,'data/sources.json'),'utf8'));
   const feed=JSON.parse(await readFile(file,'utf8'));
   const map=new Map(feed.items.map(x=>[x.id,x]));let runs=[];
   for(const source of sources.filter(x=>x.enabled).slice(0,20)){
    try{
     const {html,url}=await fetcher(source.url);const rows=extractLinks(html,url,source);let added=0;
     for(const row of rows){const old=map.get(row.id);if(old){map.set(row.id,{...old,title:row.title,lastSeenAt:row.lastSeenAt});}else{map.set(row.id,row);added++;}}
     runs.push({sourceId:source.id,name:source.name,at:new Date().toISOString(),status:rows.length?'已读取':'未提取到招聘链接',found:rows.length,added,message:rows.length?'标题命中不代表当前仍在招聘，请打开原文核实。':'网页可能需要登录、动态加载，或页面没有可识别的招聘链接。请人工核对。'});
    }catch(e){runs.push({sourceId:source.id,name:source.name,at:new Date().toISOString(),status:'读取失败',found:0,added:0,message:e.message});}
   }
   await atomicJSON(file,{items:[...map.values()],runs,lastCompletedAt:new Date().toISOString()});return true;
  }finally{running=false;}
 }};
}
