import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';

export function allowedURL(raw){
 const u=new URL(raw);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('只支持学校、政府和 AEA 的标准 HTTP/HTTPS 地址');
 if(!(/\.(edu|gov)\.cn$/i.test(u.hostname)||['aeaweb.org','cass.cn','cssn.cn','naes.org.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))))throw Error('来源仅支持学校、政府、AEA 和已核实的社科院官方域名');
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
export function plain(s){return s.replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const i=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return i<=0x10ffff?String.fromCodePoint(i):'';}).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();}
export function extractLinks(html,base,source){
 const out=[],seen=new Set();
 const clean=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi,'');
 for(const m of clean.matchAll(/<a\b([^>]*?)>([^]*?)<\/a\s*>/gi)){
  const href=(m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)||[]).slice(1).find(x=>x!==undefined);
  const title=plain(m[2])||plain((m[1].match(/\btitle\s*=\s*["']([^"']*)/i)||[])[1]||'');
  if(!href||title.length<8||!/(招聘|招收|博士后|引才|人才引进|诚聘|教职|聘任|recruit|vacanc|postdoc|faculty position)/i.test(title))continue;
  let url;try{url=new URL(canonicalURL(new URL(plain(href),base).href));allowedURL(url.href);}catch{continue;}
  if(seen.has(url.href))continue;seen.add(url.href);
  out.push({id:createHash('sha256').update(url.href).digest('hex').slice(0,24),title,url:url.href,sourceId:source.id,sourceName:source.name,firstSeenAt:new Date().toISOString(),lastSeenAt:new Date().toISOString(),verification:'待核实',deadline:'',publishedAt:'',jobType:classifyJob(title),dateEvidence:[],sourceIds:[source.id]});
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
   const map=new Map();for(const x of feed.items){try{const url=canonicalURL(x.url);const id=urlID(url);map.set(id,{...x,id,url});}catch{}}let runs=[];
   for(const source of sources.filter(x=>x.enabled).slice(0,20)){
    try{
     const {html,url}=await fetcher(source.url);const rows=extractLinks(html,url,source).sort((a,b)=>(map.get(a.id)?.detailCheckedAt||'').localeCompare(map.get(b.id)?.detailCheckedAt||''));let added=0;
     let detailFailures=0;
     for(const [index,row] of rows.entries()){
      const old=map.get(row.id);let details={};
      try{if(index>=4)throw Error("本轮详情读取上限，等待下次扫描");const detail=await fetcher(row.url);details=extractDetails(detail.html,row.title);details.detailCheckedAt=new Date().toISOString();details.detailStatus='已读取';}
      catch(e){if(index<4)detailFailures++;details=index>=4?{detailStatus:'本轮未读取'}:{detailStatus:'读取失败',detailError:e.message,detailCheckedAt:new Date().toISOString()};}
      map.set(row.id,{...row,...old,title:row.title,lastSeenAt:row.lastSeenAt,...details,firstSeenAt:old?.firstSeenAt||row.firstSeenAt,sourceIds:[...new Set([...(old?.sourceIds||[]),source.id])]});if(!old)added++;
     }
     runs.push({sourceId:source.id,name:source.name,at:new Date().toISOString(),status:rows.length?'已读取':'未提取到招聘链接',found:rows.length,added,detailFailures,message:rows.length?'标题命中不代表当前仍在招聘，请打开原文核实。':'网页可能需要登录、动态加载，或页面没有可识别的招聘链接。请人工核对。'});
    }catch(e){runs.push({sourceId:source.id,name:source.name,at:new Date().toISOString(),status:'读取失败',found:0,added:0,message:e.message});}
   }
   await atomicJSON(file,{items:[...map.values()].map(x=>({...x,status:recruitmentStatus(x)})),runs,lastCompletedAt:new Date().toISOString()});return true;
  }finally{running=false;}
 }};
}

export function canonicalURL(raw){
 const u=allowedURL(raw);u.hash='';
 for(const k of [...u.searchParams.keys()])if(/^(utm_|from$|spm$|fbclid$)/i.test(k))u.searchParams.delete(k);
 u.searchParams.sort();
 // RUC exposes the same notice under two navigation paths.
 if(u.hostname==='hr.ruc.edu.cn')u.pathname=u.pathname.replace('/bsjg/bwryglbgs/bwtzgg/','/zpxx/');
 return u.href;
}
function urlID(url){return createHash('sha256').update(url).digest('hex').slice(0,24);}
export function classifyJob(text){
 const support=/(行政|管理人员|综合业务|科研助理|项目助理|财务助理|教辅|劳务派遣|非事业编制工作人员)/.test(text);
 const academic=/(教师岗位|教师招聘|教学科研岗|科研岗位|研究岗位|专职研究|助理教授|副教授|教授招聘|研究员招聘|教职|faculty position|人才引进)/i.test(text);
 if(support&&academic)return '混合岗位';
 if(support)return '行政或辅助';
 if(/博士后|postdoc/i.test(text))return '博士后';
 if(academic)return '学术岗位';
 return '性质待核实';
}
export function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
const datePattern='(20\\d{2})\\s*[年./-]\\s*(\\d{1,2})\\s*[月./-]\\s*(\\d{1,2})\\s*日?';
function dates(text){return [...text.matchAll(new RegExp(datePattern,'g'))].map(m=>({date:`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`,raw:m[0]})).filter(x=>validDate(x.date));}
export function extractDetails(html,title){
 const clean=html.replace(/<head\b[^>]*>[^]*?<\/head>/gi,'').replace(/<(script|style|nav|footer)\b[^>]*>[^]*?<\/\1>/gi,'');
 // Prefer an article block, never derive a publication date from copyright/footer years.
 const article=(clean.match(/<article\b[^>]*>([^]*?)<\/article>/i)||[])[1]||clean;
 const fullText=plain(article);const titleIndex=fullText.indexOf(title);const text=titleIndex>=0?fullText.slice(titleIndex+title.length):fullText;const dateEvidence=[];
 const pub=(html.match(/<meta\b[^>]*name=["'](?:pubdate|publishdate|publication_date|Article\.PublishDate)["'][^>]*content=["']([^"']+)/i)||[])[1]
  ||(text.match(/(?:发布时间|发布日期|发表时间|发文时间|日期)\s*[:：]?\s*(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?)/)||[])[1]||'';
 const publishedAt=dates(pub)[0]?.date||'';
 if(publishedAt)dateEvidence.push({field:'publishedAt',text:pub.slice(0,120)});
 const candidates=[];
 for(const m of text.matchAll(new RegExp('(?:报名截止(?:日期|时间)?|申请截止(?:日期|时间)?|报名时间|报名期限|应聘者请于|应聘人员请于|自(?=\\s*20\\d{2}))[^。；;]{0,180}','g'))){
  const ds=dates(m[0]);if(ds.length){candidates.push(ds.at(-1).date);dateEvidence.push({field:'deadline',text:m[0].slice(0,200)});}
 }
 const unique=[...new Set(candidates)];
 const deadline=unique.length===1?unique[0]:'';
 const links=[];for(const m of html.matchAll(/href=["']([^"']+\.(?:pdf|xlsx?|docx?)(?:\?[^"']*)?)["']/gi))links.push(m[1]);
 return {publishedAt,deadline,dateEvidence,jobType:classifyJob(title+' '+text),verification:'原文自动提取，待人工核实',dateStatus:unique.length>1?'多个截止日期，需按岗位核实':deadline?'明确日期已提取':'截止日期待核实',attachments:links.slice(0,20),ongoing:/本招聘公告常年有效|长期有效|常年招聘/.test(text)};
}
export function recruitmentStatus(row,now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 if(row.publishedAt&&row.publishedAt>now)return '发布时间异常';
 if(/拟聘|面试公告|笔试公告|录用|结果公示/.test(row.title))return '招聘进程公告';
 if(validDate(row.deadline)&&row.deadline<now)return '已截止';
 if(row.ongoing===true&&!row.deadline)return '原文声明常年有效';
 return '有效性待核实';
}
