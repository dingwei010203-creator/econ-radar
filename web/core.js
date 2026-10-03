(function(root){
'use strict';
const stages=['待准备','准备材料','已投递','笔试','面试','Job talk','已获 Offer','已结束'];
const materials=['个人简历','求职信','代表作 / JMP','研究计划','教学陈述','学历证明'];
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function days(s,now=today()){return validDate(s)?Math.round((Date.parse(s+'T00:00:00Z')-Date.parse(now+'T00:00:00Z'))/86400000):null;}
function safeURL(s){try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function id(){return globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function newJob(data={}){return {id:id(),school:'',department:'',role:'',city:'',field:'',url:'',deadline:'',stage:'待准备',priority:'普通',appliedAt:'',interviewAt:'',followupAt:'',referenceMethod:'未确认',referenceDue:'',referenceState:'未联系',materials:[],notes:'',source:'手动添加',verified:false,salary:'',tenure:'',teaching:'',history:[],createdAt:new Date().toISOString(),...data};}
const fields=['school','department','role','city','field','url','deadline','stage','priority','appliedAt','interviewAt','followupAt','referenceMethod','referenceDue','referenceState','notes','source','salary','tenure','teaching'];
function validateJob(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.id!=='string'||!x.id||x.id.length>150)throw Error('记录编号无效');
 const j=newJob({id:x.id});
 for(const k of fields){if(x[k]!==undefined){if(typeof x[k]!=='string'||x[k].length>20000)throw Error('字段格式不正确：'+k);j[k]=x[k];}}
 if(!j.school.trim())throw Error('请填写学校或机构');
 if(!stages.includes(j.stage))throw Error('投递阶段无效');
 for(const k of ['deadline','appliedAt','interviewAt','followupAt','referenceDue'])if(j[k]&&!validDate(j[k]))throw Error('日期无效：'+k);
 if(j.url&&!safeURL(j.url))throw Error('招聘链接必须是有效的 HTTP/HTTPS 地址');
 j.verified=x.verified===true;
 j.materials=Array.isArray(x.materials)?x.materials.filter(m=>materials.includes(m)):[];
 j.history=Array.isArray(x.history)?x.history.filter(h=>h&&typeof h.at==='string'&&typeof h.text==='string').slice(-300).map(h=>({at:h.at.slice(0,40),text:h.text.slice(0,1000)})):[];
 j.createdAt=typeof x.createdAt==='string'?x.createdAt.slice(0,40):j.createdAt;
 return j;
}
function duplicate(a,b){if(a.source&&b.source&&a.source!=='手动添加'&&a.source===b.source)return true;return ['school','department','role'].every(k=>(a[k]||'').trim().toLowerCase()===(b[k]||'').trim().toLowerCase());}
function tasks(jobs,now=today()){
 const list=[];
 for(const j of jobs){if(['已结束','已获 Offer'].includes(j.stage))continue;
  const targets=[['followupAt','跟进'],['interviewAt',j.stage==='Job talk'?'Job talk':'面试'],['referenceDue','推荐信']];
  if(['待准备','准备材料'].includes(j.stage))targets.push(['deadline','投递截止']);
  for(const [key,label] of targets){if(key==='referenceDue'&&j.referenceState==='已完成')continue;const d=days(j[key],now);if(d!==null&&d<=14)list.push({id:j.id,school:j.school,date:j[key],label,days:d});}
 }
 return list.sort((a,b)=>a.date.localeCompare(b.date));
}
function csv(rows){return '\ufeff'+rows.map(r=>r.map(x=>{let s=String(x??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
function parseCSV(text){
 const rows=[];let row=[],v='',quote=false;
 text=text.replace(/^\ufeff/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){v+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=c;}
 if(quote)throw Error('CSV 引号未闭合');row.push(v);if(row.some(Boolean))rows.push(row);return rows;
}
function importCSV(text){
 const rows=parseCSV(text);if(rows.length<2)throw Error('CSV 需要表头和数据');
 const map={'学校':'school','机构':'school','学校或机构':'school','学院':'department','院系':'department','岗位':'role','城市':'city','研究方向':'field','专业':'field','招聘链接':'url','网址':'url','截止日期':'deadline','截止时间':'deadline','阶段':'stage','投递日期':'appliedAt','面试日期':'interviewAt','跟进日期':'followupAt','备注':'notes','推荐信截止':'referenceDue','推荐信方式':'referenceMethod','推荐信状态':'referenceState'};
 const heads=rows[0].map(h=>map[h.trim()]||fields.includes(h.trim())&&h.trim()||null);
 if(!heads.includes('school'))throw Error('找不到“学校”列，请使用提供的 CSV 模板');
 return rows.slice(1).map((r,i)=>{const j=newJob({source:'CSV 导入'});r.forEach((v,k)=>{if(heads[k])j[heads[k]]=v.trim();});if(!j.stage)j.stage='待准备';try{return validateJob(j);}catch(e){throw Error('第 '+(i+2)+' 行：'+e.message);}});
}
function backup(text){const x=JSON.parse(text);if(x.version!==1||!Array.isArray(x.jobs)||x.jobs.length>10000)throw Error('不是有效的求职备份');const jobs=x.jobs.map(validateJob);if(new Set(jobs.map(j=>j.id)).size!==jobs.length)throw Error('备份有重复编号');return {jobs,hidden:Array.isArray(x.hidden)?x.hidden.filter(s=>typeof s==='string').slice(0,10000):[],keywords:typeof x.keywords==='string'?x.keywords.slice(0,1000):''};}
root.RadarCore={stages,materials,today,validDate,days,safeURL,id,newJob,validateJob,duplicate,tasks,csv,parseCSV,importCSV,backup};
})(typeof window==='object'?window:globalThis);
