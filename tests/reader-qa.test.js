'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createReaderQa} = require('../electron/reader-qa');
const {createReaderStore} = require('../electron/reader-core');
const {complete} = require('../electron/reader-llm');
const {createLlmUsageStore} = require('../electron/llm-usage');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lanli-qa-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const store = createReaderStore({root});
  const source = '原文报道：第五章中是蓝色的一只小鸟。';
  store.save({id:'r_a',title:'原文章',status:'done',markdown:'原摘要',text:source});
  store.save({id:'r_b',title:'其它文章',status:'done',markdown:'另一个摘要',text:'另一个独立原文'});
  const cfg = {baseURL:'https://qa.test/v1', model:'test-model', apiKey:'test-api-key'};
  const usage = createLlmUsageStore({file:path.join(root,'usage.jsonl')});
  const requests=[];
  let respond = async () => ({
    ok:true,json:async () => ({choices:[{message:{content:'蓝色'}}],usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7}})
  });
  const build = (io) => createReaderQa({store,keys:{config:()=>cfg},complete,io,
    llmFetch:()=>async (url, opts) => { requests.push(JSON.parse(opts.body)); return respond(url,opts); },
    reportUsage:usage.record
  });
  const send = (qa,question,id='r_a',requestId='test-1') => qa.send({id,question,requestId},1);
  return {root, store, source, cfg, requests, build, send, setResponse:(f)=>{respond=f;}};
}

test('追问读取不联网，同文章多轮使用实际原文与历史，重启恢复且另一文章隔离', async (t) => {
  const f = fixture(t);
  const qa = f.build();
  assert.deepEqual(qa.get('r_a'),{ok:true,turns:[],available:true,webSearchAvailable:false});
  assert.equal(f.requests.length,0);
  assert.equal((await f.send(qa,'鸟是什么颜色？')).ok,true);
  const loaded = f.build();
  assert.equal(loaded.get('r_a').turns[0].answer,'蓝色');
  assert.deepEqual(loaded.get('r_b').turns,[]);
  assert.equal((await f.send(loaded,'第几章提到的？')).turns.length,2);
  const msg = f.requests[1].messages;
  assert.deepEqual(msg.map(m=>m.role),['system','user','assistant','user']);
  assert.equal(msg[1].content,'鸟是什么颜色？');
  assert.equal(msg[2].content,'蓝色');
  assert.ok(msg[3].content.includes(f.source));
  assert.ok(msg[3].content.endsWith('第几章提到的？'));
  assert.equal(f.store.get('r_a').markdown,'原摘要');
  const data = fs.readFileSync(path.join(f.root,'usage.jsonl'),'utf8');
  assert.deepEqual(data.trim().split('\n').map(l=>JSON.parse(l).kind),['followup','followup']);
  assert.ok(!data.includes(f.source) && !data.includes(f.cfg.apiKey));
});

test('拒绝非法请求、空问题和缺失配置，不调用模型；失败、取消与并发不污染对话', async (t) => {
  const f = fixture(t), qa = f.build();
  assert.equal((await f.send(qa,' ','r_a')).code,'invalid');
  assert.equal((await f.send(qa,'问题','../r_a')).code,'invalid');
  f.cfg.apiKey='';
  assert.equal((await f.send(qa,'问题')).code,'no-key');
  assert.equal(f.requests.length,0);
  f.cfg.apiKey='fake';
  f.setResponse(async ()=>({ok:false,status:500}));
  assert.equal((await f.send(qa,'问题')).code,'provider');
  assert.deepEqual(qa.get('r_a').turns,[]);
  f.setResponse(async (_url,{signal})=>new Promise((resolve,reject)=> {
    signal.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'})),{once:true});
  }));
  const pending = f.send(qa,'即将取消');
  assert.equal((await f.send(qa,'第二个')).code,'busy');
  qa.cancel({id:'r_a',requestId:'test-1'},2);
  qa.cancel({id:'r_a',requestId:'test-1'},1);
  assert.equal((await pending).code,'canceled');
  assert.deepEqual(qa.get('r_a').turns,[]);
  assert.equal(f.requests.length,2);
});

test('原子保存失败不覆盖历史、不遗留临时文件，文章删除取消待处理请求', async (t) => {
  const f = fixture(t), qa = f.build();
  assert.equal((await f.send(qa,'先保存')).ok,true);
  const fakeFs = Object.create(fs);
  fakeFs.renameSync=()=>{throw new Error('synthetic fs');};
  assert.equal((await f.send(f.build(fakeFs),'不应落盘')).code,'storage');
  const location=path.join(f.root,'r_a');
  assert.deepEqual(fs.readdirSync(location).sort(),['meta.json','qa.json','text.txt']);
  assert.deepEqual(f.build().get('r_a').turns.map(r=>r.question),['先保存']);
  f.setResponse(async (_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'})),{once:true});
  }));
  const pending = f.send(qa,'删除文章时取消');
  qa.remove('r_a');
  f.store.remove('r_a');
  assert.equal((await pending).code,'canceled');
  assert.equal(qa.get('r_a').code,'not-found');
});

test('DeepSeek 联网只对合格的追问启用，证据按真实工具调用保存，单条关可退出', async (t) => {
  const f=fixture(t), qa=f.build();
  f.cfg.baseURL='https://api.deepseek.com/v1';
  f.cfg.model='deepseek-flash';
  assert.equal(qa.get('r_a').webSearchAvailable,false);
  f.cfg.webSearchEnabled=true;
  assert.equal(qa.get('r_a').webSearchAvailable,true);
  const citation = (url,title='资料')=>({type:'url_citation',url_citation:{url,title,start_index:0,end_index:2}});
  f.setResponse(async (url, opts) => {
    assert.equal(url.href,'https://api.deepseek.com/v1/chat/completions');
    assert.equal(opts.redirect,'error');
    return {ok:true,json:async()=>({choices:[{message:{
      content:'蓝色，外部来源另附。',
      server_tool_calls:[{index:0,calls:[{type:'deepseek_web_search',status:'completed',action:{queries:['不存的搜索词']}}]}],
      annotations:[citation('https://example.com/art'),citation('javascript:alert(1)'),citation('https://x:y@example.com/'),
        citation('https://example.com/art'),citation(`https://example.com/${f.cfg.apiKey}`)]
    }}]})};
  });
  const result=await f.send(qa,'本次可以搜');
  assert.deepEqual(f.requests[0].tools,[{type:'deepseek_web_search'}]);
  assert.deepEqual(f.requests[0].thinking,{type:'disabled'});
  assert.equal('tool_choice' in f.requests[0],false);
  assert.deepEqual(result.turns[0].webSearch,{status:'used',sources:[{url:'https://example.com/art',title:'资料'}]});
  assert.deepEqual(f.build().get('r_a').turns,result.turns);
  const bytes=fs.readFileSync(path.join(f.root,'r_a','qa.json'),'utf8');
  assert.ok(!bytes.includes('queries') && !bytes.includes('javascript') && !bytes.includes(f.cfg.apiKey));
  f.setResponse(async (_url,opts)=> {
    assert.equal(opts.redirect,undefined);
    return {ok:true,json:async()=>({choices:[{message:{content:'只依据原文'}}]})};
  });
  const off=await qa.send({id:'r_a',question:'仅用原文',requestId:'opt-out',webSearch:false},1);
  assert.equal('tools' in f.requests[1],false);
  assert.equal('webSearch' in off.turns[1],false);
  assert.ok(!JSON.stringify(f.requests[1]).includes('server_tool_calls'));
});

test('结构化响应区分未搜索、失败和未知，不用答案正文猜测', () => {
  const {searchMetadata}=require('../electron/reader-web-search');
  assert.deepEqual(searchMetadata({content:'搜索了'}),{status:'unknown',sources:[]});
  assert.deepEqual(searchMetadata({server_tool_calls:[]}),{status:'not-used',sources:[]});
  assert.deepEqual(searchMetadata({server_tool_calls:[{calls:[{type:'deepseek_web_search',status:'failed'}]}]}),{status:'failed',sources:[]});
});
