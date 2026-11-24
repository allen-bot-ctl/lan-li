'use strict';
// 0.1.60 帮阅：大模型调用（OpenAI 兼容 /chat/completions，非流式）。
// 0.1.62：输出 Markdown，不再要求 JSON；max_tokens 4096，超时 90 秒。
class LlmError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'LlmError'; this.code = code; this.status = status; }
}

function endpointFor(baseURL) {
  return new URL(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`);
}

async function complete({ system, user, configuration, fetchImpl = globalThis.fetch, timeoutMs = 90_000, signal = null }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let response;
  try {
    response = await fetchImpl(endpointFor(configuration.baseURL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${configuration.apiKey}` },
      body: JSON.stringify({
        model: configuration.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new LlmError('timeout', '请求超时');
    throw new LlmError('network', `无法连接：${error && error.message}`);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!response.ok) throw new LlmError('http', `HTTP ${response.status}`, response.status);
  let payload;
  try { payload = await response.json(); } catch { throw new LlmError('bad-response', '无法读取的响应'); }
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  if (typeof content !== 'string') throw new LlmError('bad-response', '无法读取的响应');
  const trimmed = content.trim();
  if (!trimmed) throw new LlmError('empty', '空返回');
  return trimmed;
}

// 0.1.61「测试连接」：最小请求（user「ping」，max_tokens 1，15 秒超时），HTTP 成功就算通过
async function ping({ configuration, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpointFor(configuration.baseURL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${configuration.apiKey}` },
      body: JSON.stringify({ model: configuration.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new LlmError('timeout', '请求超时');
    throw new LlmError('network', `无法连接：${error && error.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new LlmError('http', `HTTP ${response.status}`, response.status);
  return true;
}

module.exports = { LlmError, endpointFor, complete, ping };
