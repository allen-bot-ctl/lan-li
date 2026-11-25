'use strict';
const {test}=require('node:test');
const a=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLlmUsageStore,parseUsage}=require('../electron/llm-usage');
const {complete,ping}=require('../electron/reader-llm');
const cfg={baseURL:'https://api.example.org/private/path?opaque=abc',model:'requested',apiKey:'secret-fixture'};
const success=(usage,model='returned',content='正文')=>({ok:true,json:async()=>({usage,model,choices:[{message:{content}}]})});

test('不伪造漏报或合计；零有效，缓存和推理不重复加算',()=>{
 a.equal(parseUsage({prompt_tokens:-1,completion_tokens:1.2,total_tokens:'2'}),null);
 a.deepEqual(parseUsage({prompt_tokens:0,completion_tokens:2,prompt_tokens_details:{cached_tokens:10}}),{input:0,output:2,total:null});
});

test('每个实际 API 调用只记录一次；正文失败仍保留上报数，ping JSON 缺失保持成功',async()=>{
 const e=[], reportUsage=x=>e.push(x);
 const args={system:'机密提示词',user:'机密正文',configuration:cfg,reportUsage};
 a.equal(await complete({...args,fetchImpl:async()=>success({total_tokens:5})}),'正文');
 await a.rejects(complete({...args,kind:'retry',fetchImpl:async()=>success({total_tokens:7},'actual','')}),x=>x.code==='empty');
 a.equal(await ping({configuration:cfg,reportUsage,fetchImpl:async()=>({ok:true,json:async()=>{throw Error('bad JSON');}})}),true);
 await a.rejects(complete({...args,fetchImpl:async()=>({ok:false,status:401})}),x=>x.status===401);
 await a.rejects(complete({...args,fetchImpl:async()=>{throw Error('sensitive failure');}}),x=>x.code==='network');
 const before=new AbortController();before.abort();
 await a.rejects(complete({...args,signal:before.signal,fetchImpl:()=>a.fail('pre-abort cannot send')}),x=>x.code==='canceled');
 const during=new AbortController();
 await a.rejects(complete({...args,kind:'rewrite',signal:during.signal,fetchImpl:async()=>{during.abort();throw Object.assign(new Error('abort'),{name:'AbortError'});}}),x=>x.code==='canceled');
 a.deepEqual(e.map(x=>[x.kind,x.status,x.usage?.total]),[
  ['summarize','success',5],['retry','failed',7],['test','success',undefined],['summarize','failed',undefined],['summarize','failed',undefined],['rewrite','canceled',undefined]]);
 a.ok(e.every(x=>!JSON.stringify(x).match(/secret-fixture|机密|private|opaque|sensitive/)));
 a.equal(e[0].responseModel,'returned');
 a.equal(await complete({...args,reportUsage:()=>{throw Error('disk full');},fetchImpl:async()=>success(null)}),'正文');
});

test('台账重开保留，同名模型按域拆分，区间/分页只读，不持久化敏感或任意字段',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lanli-usage-'));
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const file=path.join(dir,'llm-usage.jsonl'), time=new Date(2026,10,28,12).getTime(), now=()=>time;
 const ledger=createLlmUsageStore({file,now});
 const input={kind:'summarize',status:'success',baseURL:cfg.baseURL,requestedModel:'alias',responseModel:'same',durationMs:17,usage:{input:0,output:3,total:3},apiKey:cfg.apiKey,text:'private'};
 ledger.record({...input,at:time});
 for(let i=0;i<26;i++) ledger.record({...input,at:time-i-1,baseURL:'https://second.example.org',status:'failed',usage:null});
 ledger.record({...input,at:new Date(2026,10,10,12).getTime()});
 const stored=fs.readFileSync(file,'utf8');
 a.doesNotMatch(stored,/private|secret|opaque|https:/);
 const again=createLlmUsageStore({file,now});
 const today=again.query({period:'today'});
 a.equal(today.summary.requests,27);
 a.equal(today.summary.input,0);
 a.equal(today.summary.unknown,26);
 a.equal(today.models.length,2);
 a.ok(today.models.some(x=>x.provider==='api.example.org'));
 a.equal(today.totalPages,2);
 const filter=again.query({period:'7d',model:'same',provider:'second.example.org',page:2});
 a.equal(filter.tasks.length,1);
 a.equal(filter.tasks[0].requestedModel,'alias');
 a.equal(filter.summary.requests,27);
 a.equal(again.query({period:'30d'}).summary.requests,28);
});

test('磁盘失败保留当前会话计量和可见提醒，不抛出',()=>{
 const ledger=createLlmUsageStore({file:'/fixture/ledger',io:{
  readFileSync:()=>{throw Object.assign(Error(),{code:'ENOENT'});},
  mkdirSync:()=>{throw Error('EACCES');}
 }});
 ledger.record({at:Date.now(),kind:'test',status:'success',baseURL:'https://example.org',requestedModel:'m',durationMs:0,usage:null});
 a.equal(ledger.query().summary.requests,1);
 a.equal(ledger.query().summary.total,null);
 a.equal(ledger.query().storageWarning,true);
});
