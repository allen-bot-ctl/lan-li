'use strict';

const fs = require('node:fs');
const path = require('node:path');
const MAX_ROWS = 10000;
const PAGE_SIZE = 25;
const KINDS = new Set(['summarize','retry','rewrite','test','followup']);
const STATUSES = new Set(['success','failed','canceled']);

function providerOf(value) {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.host : ''; } catch { return ''; }
}
function modelName(x) {
  return typeof x === 'string' && x.trim() && x.length <= 200 && !/[\x00-\x1f\x7f]/.test(x) ? x.trim() : '';
}
const token = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
function parseUsage(value) {
  const input = token(value?.prompt_tokens), output = token(value?.completion_tokens), total = token(value?.total_tokens);
  return input === null && output === null && total === null ? null : {input,output,total};
}
function publicRow(row) {
  if (!Number.isSafeInteger(row?.at) || row.at < 0 || row.at > 8.64e15 || !KINDS.has(row.kind) || !STATUSES.has(row.status)) return null;
  const provider = typeof row.provider === 'string' && /^[a-z0-9.:[\]-]+$/i.test(row.provider) ? row.provider : '';
  const requestedModel = modelName(row.requestedModel);
  const model = modelName(row.model) || requestedModel;
  const usage = row.usage ? parseUsage({prompt_tokens:row.usage.input,completion_tokens:row.usage.output,total_tokens:row.usage.total}) : null;
  return {at:row.at,kind:row.kind,status:row.status,provider,model,requestedModel,modelReported:row.modelReported === true,
    durationMs:token(row.durationMs) ?? 0,usage};
}
function summaryOf(rows) {
  const s={requests:rows.length,success:0,failed:0,canceled:0,reported:0,unknown:0,input:0,output:0,total:0,inputReported:0,outputReported:0,totalReported:0};
  for(const r of rows) {
    s[r.status]++;
    if (!r.usage) {s.unknown++;continue;}
    s.reported++;
    for(const k of ['input','output','total']) if (r.usage[k] !== null) {s[k]+=r.usage[k];s[k+'Reported']++;}
  }
  // Saturate only the JSON interoperability boundary, never write invalid sums.
  for(const k of ['input','output','total']) s[k]=s[k+'Reported'] ? Math.min(Number.MAX_SAFE_INTEGER,s[k]) : null;
  return s;
}
function firstDay(period, now) {
  if (period === 'all') return 0;
  const d = new Date(now);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - (period === '30d' ? 29 : period === '7d' ? 6 : 0));
  return d.getTime();
}
function createLlmUsageStore({file, io=fs, now=Date.now} = {}) {
  let rows=[], lineCount=0, storageWarning=false, loaded=false;
  function load() {
    if(loaded || !file) return;
    loaded=true;
    try {
      const contents=io.readFileSync(file,'utf8').split('\n');
      lineCount=contents.length-1;
      rows=contents.filter(Boolean).flatMap(line=>{
        try {const r=publicRow(JSON.parse(line));return r?[r]:[];} catch {storageWarning=true;return [];}
      }).slice(-MAX_ROWS);
    } catch(e) {if(e.code!=='ENOENT') storageWarning=true;}
  }
  function persist(row) {
    if(!file) return;
    let tmp;
    try {
      io.mkdirSync(path.dirname(file),{recursive:true});
      if(lineCount<MAX_ROWS+250) {
        io.appendFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});
        lineCount++;
      } else {
        tmp=file+'.tmp';
        io.writeFileSync(tmp,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
        io.renameSync(tmp,file);lineCount=rows.length;
      }
    } catch {storageWarning=true;if(tmp) try {io.rmSync(tmp,{force:true});} catch {}}
  }
  function record(event) {
    load();
    const requestedModel=modelName(event.requestedModel);
    const real=modelName(event.responseModel);
    const r=publicRow({at:event.at,kind:event.kind,status:event.status,provider:providerOf(event.baseURL),requestedModel,
      model:real || requestedModel,modelReported:Boolean(real),durationMs:event.durationMs,usage:event.usage});
    if(!r) return;
    rows.push(r);
    if(rows.length>MAX_ROWS) rows=rows.slice(-MAX_ROWS);
    persist(r);
  }
  function query(request={}) {
    load();
    const period=['today','7d','30d','all'].includes(request?.period)?request.period:'7d';
    const group=new Map();
    const all=rows.filter(r=>r.at>=firstDay(period,now())).sort((a,b)=>b.at-a.at);
    for(const r of all) {
      const key=JSON.stringify([r.provider,r.model]);if(!group.has(key)) group.set(key,[]);
      group.get(key).push(r);
    }
    const models=[...group.values()].map(rs=>({provider:rs[0].provider,model:rs[0].model,...summaryOf(rs)}))
      .sort((a,b)=>b.requests-a.requests || a.model.localeCompare(b.model));
    const matches=typeof request?.model==='string' && typeof request?.provider==='string' ?
      all.filter(r=>r.model===request.model && r.provider===request.provider) : all;
    const totalPages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    const page=Math.max(1,Math.min(totalPages,token(request?.page) ?? 1));
    return {period,page,totalPages,pageSize:PAGE_SIZE,summary:summaryOf(all),models,tasks:matches.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),storageWarning};
  }
  return {record,query};
}
module.exports={parseUsage,createLlmUsageStore};
