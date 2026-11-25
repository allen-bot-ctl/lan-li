'use strict';
// 0.1.60 帮阅：大模型调用（OpenAI 兼容 /chat/completions，非流式）。
// 0.1.62：输出 Markdown，不再要求 JSON；max_tokens 4096，超时 90 秒。
class LlmError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'LlmError'; this.code = code; this.status = status; }
}

function endpointFor(baseURL) {
  return new URL(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`);
}

const { parseUsage } = require('./llm-usage');

async function request({ configuration, body, fetchImpl, timeoutMs, signal, pingOnly, reportUsage, kind }) {
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${configuration.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new LlmError(signal?.aborted ? 'canceled' : 'timeout', signal?.aborted ? '请求已取消' : '请求超时');
      throw new LlmError('network', `无法连接：${error?.message}`);
    }
    if (!response.ok) throw new LlmError('http', `HTTP ${response.status}`, response.status);
    if (!pingOnly || reportUsage) {
      try {
        // A missing or malformed Test Connection payload does not change its HTTP-success contract.
        payload = await response.json();
      } catch {
        if (!pingOnly) throw new LlmError('bad-response', '无法读取的响应');
      }
    }
    if (!pingOnly) {
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('bad-response', '无法读取的响应');
      const trimmed = content.trim();
      if (!trimmed) throw new LlmError('empty', '空返回');
      status = 'success';
      return trimmed;
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

function complete({ system, user, messages, configuration, fetchImpl = globalThis.fetch, timeoutMs = 90_000, signal = null, reportUsage, kind = 'summarize' }) {
  return request({ configuration, fetchImpl, timeoutMs, signal, reportUsage, kind, body:{
    model: configuration.model, messages: messages || [{ role:'system', content:system }, { role:'user', content:user }],
    max_tokens:4096, thinking:{type:'disabled'}, stream:false
  }});
}

// HTTP success is sufficient; usage, when available, is read from the same response.
function ping({ configuration, fetchImpl = globalThis.fetch, timeoutMs = 15_000, reportUsage }) {
  return request({configuration,fetchImpl,timeoutMs,reportUsage,kind:'test',pingOnly:true,body:{
    model:configuration.model,messages:[{role:'user',content:'ping'}],max_tokens:1,stream:false
  }});
}

module.exports = { LlmError, endpointFor, complete, ping };
