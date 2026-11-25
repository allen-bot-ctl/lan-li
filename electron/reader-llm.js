'use strict';
// 0.1.60 帮阅：大模型调用（OpenAI 兼容 /chat/completions，非流式）。
// 0.1.62：输出 Markdown，不再要求 JSON；max_tokens 4096，超时 90 秒。
class LlmError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'LlmError'; this.code = code; this.status = status; }
}

function endpointFor(baseURL) {
  return new URL(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`);
}

const {sse} = require('./reader-sse');
const { parseUsage } = require('./llm-usage');
const {TOOL,isDeepSeekWebSearchSupported,searchMetadata} = require('./reader-web-search');

async function request({ configuration, body, fetchImpl, timeoutMs, signal, pingOnly, reportUsage, kind, webSearch, onDelta }) {
  const endpoint = endpointFor(configuration.baseURL);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) throw new LlmError('canceled', '请求已取消');
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(onAbort, timeoutMs);
  const started = Date.now();
  let status = 'failed';
  let payload;
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${configuration.apiKey}`, ...(body.stream ? {Accept:'text/event-stream'} : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(webSearch ? {redirect:'error'} : {})
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new LlmError(signal?.aborted ? 'canceled' : 'timeout', signal?.aborted ? '请求已取消' : '请求超时');
      throw new LlmError('network', `无法连接：${error?.message}`);
    }
    if (!response.ok) throw new LlmError('http', `HTTP ${response.status}`, response.status);
    const contentType = response.headers?.get('content-type') || '';
    const completedJsonFallback = body.stream && /^application\/(?:json|[^;\s]+\+json)(?:[;\s]|$)/i.test(contentType);
    if (body.stream && !completedJsonFallback) {
      let answer = '', finish, done = false, codepoints = 0;
      let message = {};
      try {
        for await (const frame of sse(response.body)) {
          if (controller.signal.aborted) throw new Error('aborted');
          if (frame === '[DONE]') { done = true; break; }
          const chunk = JSON.parse(frame);
          if (!chunk || typeof chunk !== 'object' || chunk.error) throw new Error('stream error');
          payload ||= {};
          if (typeof chunk.model === 'string') payload.model = chunk.model;
          if (chunk.usage != null) payload.usage = chunk.usage;
          const choice = Array.isArray(chunk.choices) && chunk.choices.find(c => c?.index === 0 || c?.index == null);
          if (!choice) continue;
          if (choice.finish_reason != null) finish = choice.finish_reason;
          const delta = choice.delta;
          if (webSearch && delta) {
            if (Array.isArray(delta.server_tool_calls)) message.server_tool_calls = delta.server_tool_calls;
            if (Array.isArray(delta.annotations)) message.annotations = delta.annotations;
          }
          if (typeof delta?.content === 'string' && delta.content) {
            codepoints += Array.from(delta.content).length;
            if (codepoints > 16000) throw new LlmError('answer-limit','回答太长');
            answer += delta.content;
            try { onDelta?.(delta.content); } catch { /* renderer left; never log or persist a transport error */ }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) throw new LlmError(signal?.aborted?'canceled':'timeout', '请求已中止');
        if (error instanceof LlmError) throw error;
        throw new LlmError('bad-response','回答传输中断');
      }
      if (controller.signal.aborted) throw new LlmError(signal?.aborted?'canceled':'timeout','请求已中止');
      if (!done || finish !== 'stop') throw new LlmError('incomplete','回答没有完整结束');
      if (!answer.trim()) throw new LlmError('empty','空返回');
      status = 'success';
      return webSearch ? {answer:answer.trim(),webSearch:searchMetadata(message,configuration.apiKey)} : answer.trim();
    }
    if (!pingOnly || reportUsage) {
      try {
        // A missing or malformed Test Connection payload does not change its HTTP-success contract.
        payload = await response.json();
      } catch {
        if (!pingOnly) throw new LlmError('bad-response', '无法读取的响应');
      }
    }
    if (!pingOnly) {
      if (completedJsonFallback && (payload?.error || payload?.choices?.[0]?.finish_reason !== 'stop')) {
        throw new LlmError('incomplete','回答没有完整结束');
      }
      if (completedJsonFallback && controller.signal.aborted) throw new LlmError(signal?.aborted?'canceled':'timeout','请求已中止');
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('bad-response', '无法读取的响应');
      const trimmed = content.trim();
      if (!trimmed) throw new LlmError('empty', '空返回');
      if (completedJsonFallback && Array.from(trimmed).length > 16000) throw new LlmError('answer-limit','回答太长');
      status = 'success';
      return webSearch ? {answer:trimmed, webSearch:searchMetadata(payload.choices[0].message, configuration.apiKey)} : trimmed;
    }
    status = 'success';
    return true;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (reportUsage) try {
      reportUsage({at:started,durationMs:Math.max(0,Date.now()-started),kind,
        status:signal?.aborted?'canceled':status,baseURL:endpoint.origin,requestedModel:configuration.model === configuration.apiKey ? '' : configuration.model,
        responseModel:payload?.model === configuration.apiKey ? '' : payload?.model,usage:parseUsage(payload?.usage)});
    } catch { /* Ledger failures must never change the request result. */ }
  }
}

function complete({ system, user, messages, configuration, fetchImpl = globalThis.fetch, timeoutMs = 90_000, signal = null, reportUsage, kind = 'summarize', webSearch = false }) {
  if (webSearch && (kind !== 'followup' || !isDeepSeekWebSearchSupported(configuration.baseURL,configuration.model))) {
    throw new LlmError('web-search-unsupported','联网搜索仅支持 DeepSeek 官方接口与 deepseek-flash');
  }
  return request({ configuration, fetchImpl, timeoutMs, signal, reportUsage, kind, webSearch, body:{
    model: configuration.model, messages: messages || [{ role:'system', content:system }, { role:'user', content:user }],
    max_tokens:4096, thinking:{type:'disabled'}, stream:false,
    ...(webSearch ? {tools:[{type:TOOL}]} : {})
  }});
}

function completeStream({messages, configuration, fetchImpl = globalThis.fetch, timeoutMs = 90_000, signal = null, reportUsage, webSearch = false, onDelta}) {
  if (webSearch && !isDeepSeekWebSearchSupported(configuration.baseURL,configuration.model)) {
    throw new LlmError('web-search-unsupported','联网搜索仅支持 DeepSeek 官方接口与 deepseek-flash');
  }
  return request({configuration,fetchImpl,timeoutMs,signal,reportUsage,kind:'followup',webSearch,onDelta,body:{
    model:configuration.model,messages,max_tokens:4096,thinking:{type:'disabled'},stream:true,
    stream_options:{include_usage:true},...(webSearch ? {tools:[{type:TOOL}]} : {})
  }});
}

// HTTP success is sufficient; usage, when available, is read from the same response.
function ping({ configuration, fetchImpl = globalThis.fetch, timeoutMs = 15_000, reportUsage }) {
  return request({configuration,fetchImpl,timeoutMs,reportUsage,kind:'test',pingOnly:true,body:{
    model:configuration.model,messages:[{role:'user',content:'ping'}],max_tokens:1,stream:false
  }});
}

module.exports = { LlmError, endpointFor, complete, completeStream, ping };
