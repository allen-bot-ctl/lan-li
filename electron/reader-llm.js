'use strict';
// 0.1.60 帮阅：大模型调用，照搬 EasyLens electron/app/deepseek.js 的 complete()（OpenAI 兼容 /chat/completions，非流式）。
// 帮阅额外加 response_format json_object，超时 60 秒。
class LlmError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'LlmError'; this.code = code; this.status = status; }
}

function endpointFor(baseURL) {
  return new URL(`${String(baseURL).replace(/\/+$/, '')}/chat/completions`);
}

async function complete({ system, user, configuration, fetchImpl = globalThis.fetch, timeoutMs = 60_000, signal = null }) {
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
        response_format: { type: 'json_object' },
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

module.exports = { LlmError, endpointFor, complete };
