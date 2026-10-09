import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedURL,canonicalURL,extractLinks,extractDetails,classifyJob,recruitmentStatus} from '../collector.mjs';
import {publicFeed} from '../scripts/public-feed.mjs';
test('official CASS domains are allowed with strict suffix boundary',()=>{
 for(const url of ['https://iple.cssn.cn/','https://www.cass.cn/','https://naes.org.cn/'])assert.doesNotThrow(()=>allowedURL(url));
 for(const url of ['https://cass.cn.evil.com','https://evilcssn.cn','https://user:password@iple.cssn.cn','https://sydwgkzp.cn/cass'])assert.throws(()=>allowedURL(url));
});
test('canonical notice URLs merge tracking, fragments and RUC navigation aliases',()=>{
 const a=canonicalURL('https://hr.ruc.edu.cn/bsjg/bwryglbgs/bwtzgg/abc.htm?utm_source=x#top');
 assert.equal(a,'https://hr.ruc.edu.cn/zpxx/abc.htm');
 const rows=extractLinks('<a href="/zpxx/abc.htm">应用经济学院招聘启事</a><a href="/bsjg/bwryglbgs/bwtzgg/abc.htm">应用经济学院招聘启事</a><a href="https://evil.com/job">经济学院教师招聘</a>','https://hr.ruc.edu.cn/',{id:'ruc',name:'人大'});
 assert.equal(rows.length,1);
});
test('support jobs never become faculty jobs merely because the unit is economics',()=>{
 assert.equal(classifyJob('应用经济学院招聘启事 科研助理 劳务派遣'),'行政或辅助');
 assert.equal(classifyJob('经济研究所公开招聘专业技术人员'),'性质待核实');
 assert.equal(classifyJob('教师招聘 教学科研岗'),'学术岗位');
 assert.equal(classifyJob('博士后招收公告'),'博士后');
 assert.equal(classifyJob('教师招聘 同时招聘行政助理'),'混合岗位');
});
test('extracts labelled publication and deadlines; ignores footer dates and invalid dates',()=>{
 const d=extractDetails('<article>发布日期：2026.09.24 应聘者请于2026年10月15日前提交材料。</article><footer>2029年1月1日</footer>','应用经济学院招聘启事');
 assert.equal(d.publishedAt,'2026-09-24');assert.equal(d.deadline,'2026-10-15');assert.equal(d.dateEvidence.length,2);
 assert.equal(extractDetails('报名截止日期：2026年2月29日','招聘').deadline,'');
 assert.equal(extractDetails('2026年10月15日 版权所有','招聘').publishedAt,'');
 assert.equal(extractDetails('报名时间：自2026年5月23日至2026年6月5日17：00。','招聘').deadline,'2026-06-05');
});
test('multiple deadlines and future publication remain unresolved',()=>{
 const d=extractDetails('报名截止日期：2026年10月15日。报名截止日期：2026年10月20日。','招聘');
 assert.equal(d.deadline,'');assert.match(d.dateStatus,/多个/);
 assert.equal(recruitmentStatus({title:'招聘',deadline:'2026-10-08'},'2026-10-09'),'已截止');
 assert.equal(recruitmentStatus({title:'招聘',deadline:'2026-10-09'},'2026-10-09'),'有效性待核实');
 assert.equal(recruitmentStatus({title:'招聘',publishedAt:'2026-12-01'},'2026-10-09'),'发布时间异常');
});
test('public export drops applications, contacts, consultations and nested private fields',()=>{
 const f=publicFeed({jobs:[{notes:'SECRET'}],consultations:[{person:'SECRET'}],items:[{id:'1',title:'招聘',url:'https://hr.ruc.edu.cn/zpxx/a.htm',notes:'SECRET',contacts:['SECRET'],dateEvidence:[{field:'deadline',text:'2026年10月15日',person:'SECRET'}]}],runs:[],lastCompletedAt:null});
 assert.equal(JSON.stringify(f).includes('SECRET'),false);assert.equal(f.items.length,1);
});

import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCollector} from '../collector.mjs';
import {execFileSync} from 'node:child_process';
test('failed detail refresh preserves verified dates; shared notices merge source provenance',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'radar-refresh-'));
 try{
  await mkdir(path.join(root,'data'));
  await writeFile(path.join(root,'data/sources.json'),JSON.stringify([{id:'a',name:'A',url:'https://hr.ruc.edu.cn/list',enabled:true},{id:'b',name:'B',url:'https://hr.ruc.edu.cn/list2',enabled:true}]));
  await writeFile(path.join(root,'data/feed.json'),JSON.stringify({items:[],runs:[]}));
  let failed=false;const c=createCollector(root,async url=>{
   if(url.includes('/list'))return {url,html:'<a href="/zpxx/a.htm">应用经济学院招聘启事</a>'};
   if(failed)throw Error('detail unavailable');
   return {url,html:'<article>发布日期：2026年9月24日 应聘者请于2026年10月15日前提交。 科研助理</article>'};
  });
  await c.scan();failed=true;await c.scan();
  const feed=JSON.parse(await readFile(path.join(root,'data/feed.json')));
  assert.equal(feed.items.length,1);assert.equal(feed.items[0].deadline,'2026-10-15');assert.equal(feed.items[0].jobType,'行政或辅助');assert.deepEqual(feed.items[0].sourceIds,['a','b']);assert.equal(feed.items[0].detailStatus,'读取失败');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Pages build includes only public assets and strips historical private reference data',async()=>{
 execFileSync(process.execPath,['scripts/build-pages.mjs']);
 const files=await readdir('dist/web');assert.equal(files.includes('references'),false);
 assert.equal(await readFile('dist/web/reference-data.js','utf8'),'window.RADAR_SEED={references:[],resources:[],links:[]};\n');
 const feed=JSON.parse(await readFile('dist/web/public/feed.json'));assert.ok(Array.isArray(feed.items));assert.ok(Array.isArray(feed.runs));
});
test('detail limit rotates to previously unvisited notices on the next scan',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'radar-rotate-'));
 try{
  await mkdir(path.join(root,'data'));await writeFile(path.join(root,'data/sources.json'),JSON.stringify([{id:'a',name:'A',url:'https://test.edu.cn/list',enabled:true}]));await writeFile(path.join(root,'data/feed.json'),JSON.stringify({items:[],runs:[]}));
  const visited=[];const collector=createCollector(root,async url=>{
   if(url.endsWith('/list'))return {url,html:[1,2,3,4,5].map(n=>`<a href="/job${n}">2026年经济学院教师招聘公告${n}</a>`).join('')};
   visited.push(url);return {url,html:'教师岗位'};
  });
  await collector.scan();assert.equal(visited.length,4);await collector.scan();assert.ok(visited.includes('https://test.edu.cn/job5'));
 }finally{await rm(root,{recursive:true,force:true});}
});
