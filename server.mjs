import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createCollector,allowedURL,atomicJSON} from './collector.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.RADAR_PREVIEW_PORT||8787);
const web=await realpath(path.join(root,'web'));
const collector=createCollector(root);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
let sourceWriting=false;
const server=http.createServer(async(req,res)=>{
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(403,{error:'Invalid host'});
 if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Cross-site request rejected'});
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'){
   if(req.headers.origin!==`http://${req.headers.host}`||!/^application\/json\b/.test(req.headers['content-type']||''))return send(403,{error:'只允许当前页面操作'});
   if(url.pathname==='/api/scan'){if(collector.running)return send(202,{running:true});collector.scan().catch(e=>console.error('Scan:',e.message));return send(202,{running:true});}
   if(url.pathname==='/api/sources'){
    if(collector.running||sourceWriting)return send(409,{error:'正在读取或保存来源，请稍后再试'});
    sourceWriting=true;
    try{
     let body='';for await(const chunk of req){body+=chunk;if(body.length>64000)return send(413,{error:'内容过大'});}
     const rows=JSON.parse(body);
     if(!Array.isArray(rows)||rows.length>60)throw Error('最多保存 60 个来源');
     const ids=new Set();const sources=rows.map(x=>{
      if(!x||typeof x.id!=='string'||!/^[-\w]{1,80}$/.test(x.id)||ids.has(x.id))throw Error('来源编号无效或重复');ids.add(x.id);
      if(typeof x.name!=='string'||!x.name.trim()||x.name.length>200)throw Error('来源名称无效');
      return {id:x.id,name:x.name.trim(),url:allowedURL(x.url).href,enabled:x.enabled===true};
     });
     if(sources.filter(x=>x.enabled).length>20)throw Error('最多同时启用 20 个来源');
     await atomicJSON(path.join(root,'data/sources.json'),sources);return send(200,{ok:true});
    }finally{sourceWriting=false;}
   }
   return send(404,{error:'Not found'});
  }
  if(!['GET','HEAD'].includes(req.method))return send(405,{error:'Method not allowed'});
  if(url.pathname==='/api/feed'){const feed=JSON.parse(await readFile(path.join(root,'data/feed.json'),'utf8'));return send(200,{...feed,running:collector.running});}
  if(url.pathname==='/api/sources')return send(200,JSON.parse(await readFile(path.join(root,'data/sources.json'),'utf8')));
  let name=decodeURIComponent(url.pathname);if(name==='/')name='/index.html';
  if(name.includes('\\')||name.includes('\0'))return send(404,{error:'Not found'});
  const file=await realpath(path.resolve(web,'.'+name));
  if(!file.startsWith(web+path.sep)||!mime[path.extname(file)])return send(404,{error:'Not found'});
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){send(req.method==='POST'?400:404,{error:req.method==='POST'?e.message:'Not found'});}
});
server.requestTimeout=20000;
server.on('error',e=>{console.error('Cannot start:',e.code);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 console.log(`Econ Radar: http://127.0.0.1:${port}\nKeep this window open. Recruitment scan runs now and every 6 hours.\nPersonal applications stay in this browser; export backups regularly. Ctrl+C to stop.`);
 if(process.env.RADAR_NO_AUTO!=='1'){collector.scan().catch(e=>console.error(e.message));setInterval(()=>collector.scan().catch(e=>console.error(e.message)),6*60*60*1000).unref();}
});
