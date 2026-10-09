import {allowedURL} from '../collector.mjs';
// A closed field list: never serialize browser backups, applications or source credentials.
const itemFields=['id','title','url','sourceId','sourceName','sourceIds','firstSeenAt','lastSeenAt','verification','deadline','publishedAt','jobType','dateStatus','dateEvidence','status','detailCheckedAt','detailStatus','detailError','ongoing'];
const runFields=['sourceId','name','at','status','found','added','detailFailures','message'];
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
export function publicFeed(feed){
 return {items:(feed.items||[]).filter(x=>{try{allowedURL(x.url);return true;}catch{return false;}}).map(x=>{
  const row=pick(x,itemFields);row.dateEvidence=(x.dateEvidence||[]).filter(e=>['deadline','publishedAt'].includes(e.field)).map(e=>({field:e.field,text:String(e.text||'').slice(0,200)}));return row;
 }),runs:(feed.runs||[]).map(x=>pick(x,runFields)),lastCompletedAt:feed.lastCompletedAt||null};
}
