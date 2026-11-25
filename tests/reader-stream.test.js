'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {completeStream}=require('../electron/reader-llm');
const u={prompt_tokens:3,completion_tokens:7,total_tokens:10};
const choice=(delta,finish_reason=null,usage)=>({model:'deepseek-flash',choices:[{index:0,delta,finish_reason}],usage});
const frame=(entry)=>`data: ${typeof entry==='string'?entry:JSON.stringify(entry)}\r\n\r\n`;
const bytes=(s)=>new TextEncoder().encode(s);
const configuration={apiKey:'synthetic',model:'deepseek-flash',baseURL:'https://api.deepseek.com/v1'};
const setup=(f,extras={})=>{
  const ledger=[], deltas=[], calls=[];
  const promise=completeStream({messages:[{role:'user',content:'synthetic'}],configuration,
    reportUsage:r=>ledger.push(r), onDelta:d=>deltas.push(d),
    fetchImpl:async (url,opts)=>{calls.push({url,opts}); return f();},...extras});
  return {promise,ledger,deltas,calls};
};
const body=(chunks)=>(async function*(){for(const c of chunks) yield bytes(c);})();
test('SSE UTF-8/CRLF 分片, reasoning 不发出, 真正逐块, 正常结束保留搜索和 DeepSeek 同块用量',async()=>{
  const metadata={annotations:[{type:'url_citation',url_citation:{url:'https://example.com/source',title:'来源'}}],
    server_tool_calls:[{calls:[{type:'deepseek_web_search',status:'completed'}]}]};
  const full=bytes(': keepalive\r\n'+frame(choice({reasoning_content:'private reasoning'}))+frame(choice({content:'你'})));
  let first, release;
  const gotFirst=new Promise(r=>{first=r;});
  const barrier=new Promise(r=>{release=r;});
  const deltas=[];
  const q=setup(()=>({ok:true,body:(async function*(){
    for(let i=0;i<full.length;i+=1) yield full.slice(i,i+1);
    await barrier;
    yield bytes(frame(choice({content:'好'}))+frame(choice(metadata,'stop',u))+frame('[DONE]'));
  })()}),{webSearch:true,onDelta:d=>{deltas.push(d);first();}});
  await gotFirst;
  assert.deepEqual(deltas,['你']);
  assert.equal(q.ledger.length,0);
  release();
  assert.deepEqual(await q.promise,{answer:'你好',webSearch:{status:'used',sources:[{title:'来源',url:'https://example.com/source'}]}});
  assert.deepEqual(deltas,['你','好']);
  const request=JSON.parse(q.calls[0].opts.body);
  assert.equal(request.stream,true);
  assert.deepEqual(request.stream_options,{include_usage:true});
  assert.deepEqual(request.tools,[{type:'deepseek_web_search'}]);
  assert.equal(q.calls[0].opts.redirect,'error');
  assert.equal(q.ledger.length,1);
  assert.deepEqual(q.ledger[0].usage,{input:3,output:7,total:10});
});
test('OpenAI 独立 usage 块、异常中断、长度截断、非 JSON SSE 数据均无重试',async()=>{
  const ok=setup(()=>({ok:true,body:body([frame(choice({content:'a'})),frame(choice({},'stop')),frame({choices:[],usage:u}),frame('[DONE]')])}));
  assert.equal(await ok.promise,'a');
  assert.deepEqual(ok.ledger[0].usage,{input:3,output:7,total:10});
  for(const end of [[],[frame(choice({},'length')),frame('[DONE]')],['data: not-json\n\n']]) {
    const q=setup(()=>({ok:true,body:body([frame(choice({content:'partial'})),...end])}));
    await assert.rejects(q.promise);
    assert.deepEqual(q.deltas,['partial']);
    assert.equal(q.calls.length,1);
    assert.equal(q.ledger.length,1);
    assert.equal(q.ledger[0].status,'failed');
  }
});
test('取消不完成且尝试仅计一次；未发取消不计',async()=>{
  const abort=new AbortController();
  const q=setup(()=>({ok:true,body:body([frame(choice({content:'first'})),frame(choice({content:'never'},'stop')),frame('[DONE]')])}),{signal:abort.signal,onDelta:()=>abort.abort()});
  await assert.rejects(q.promise,e=>e.code==='canceled');
  assert.equal(q.ledger.length,1);
  assert.equal(q.ledger[0].status,'canceled');
  const before=setup(()=>null,{signal:abort.signal});
  await assert.rejects(before.promise,e=>e.code==='canceled');
  assert.equal(before.ledger.length,0);
  assert.equal(before.calls.length,0);
});
test('同一请求返回明确结束 JSON 时只呈现最终答案，非完整 JSON 拒绝',async()=>{
  const provider=(finish_reason)=>({ok:true,headers:new Headers({'content-type':'application/json; charset=utf-8'}),
    json:async()=>({choices:[{finish_reason,message:{content:'整条答案'}}],usage:u})});
  const q=setup(()=>provider('stop'));
  assert.equal(await q.promise,'整条答案');
  assert.equal(q.calls.length,1);
  assert.deepEqual(q.deltas,[]);
  assert.equal(q.ledger[0].status,'success');
  const invalid=setup(()=>provider(null));
  await assert.rejects(invalid.promise,e=>e.code==='incomplete');
  assert.deepEqual(invalid.deltas,[]);
  assert.equal(invalid.calls.length,1);
});
