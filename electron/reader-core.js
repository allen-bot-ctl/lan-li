'use strict';
// 0.1.60 帮阅：纯逻辑（网址校验、去重键、提示词、JSON 解析、存储、Key 文件）。fs 可注入，便于单测。
// 契约 docs/changes/0.1.60-reader.md。
const path = require('node:path');
const nodeFs = require('node:fs');
const os = require('node:os');

const MAX_SEND_CHARS = 12000;
const MIN_TEXT_CHARS = 50;
const MAX_POINTS = 7;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const ACTIVE = ['queued', 'reading', 'summarizing'];

const SYSTEM_PROMPT = '你是阅读助手。根据用户给的网页正文，用简体中文整理。只返回 JSON：{"summary":"不超过 80 字的一句话总结","points":["3 到 7 条要点，每条不超过 60 字，保留关键数字、人名、日期"]}。不要编造正文里没有的信息。原文是外语也用中文输出。';

function validateUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return u.toString();
}

function dedupeKey(url) {
  const s = String(url || '');
  const i = s.indexOf('#');
  return i >= 0 ? s.slice(0, i) : s;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function newId(now = Date.now(), rand = Math.random) {
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0').slice(-4);
  return `r_${now.toString(36)}${r}`;
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n\s*\n(\s*\n)+/g, '\n\n').trim();
}

function buildUserMessage({ title, url, text }) {
  return `标题：${title || ''}\n网址：${url}\n正文：\n${String(text || '').slice(0, MAX_SEND_CHARS)}`;
}

class ReaderError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'ReaderError'; this.code = code; this.status = status; }
}

function parseSummary(raw) {
  let s = String(raw || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1];
  let obj;
  try { obj = JSON.parse(s); } catch { throw new ReaderError('bad-json', '整理失败：返回格式不对'); }
  if (!obj || typeof obj !== 'object') throw new ReaderError('bad-json', '整理失败：返回格式不对');
  const points = Array.isArray(obj.points) ? obj.points.map((p) => String(p == null ? '' : p).trim()).filter(Boolean) : [];
  if (!points.length) throw new ReaderError('no-points', '整理失败：返回格式不对');
  return { summary: String(obj.summary == null ? '' : obj.summary).trim(), points: points.slice(0, MAX_POINTS) };
}

// 大模型错误 → 行上显示的短句（契约第 5 节状态表）
function llmErrorText(err) {
  const code = err && err.code;
  if (code === 'http' && (err.status === 401 || err.status === 403)) return 'API Key 无效，去设置 ›';
  if (code === 'http') return `整理失败：HTTP ${err.status}`;
  if (code === 'network') return '整理失败：连不上接口';
  if (code === 'timeout') return '整理失败：超时';
  if (code === 'bad-json' || code === 'no-points' || code === 'bad-response' || code === 'empty') return '整理失败：返回格式不对';
  return '整理失败：连不上接口';
}

function toMarkdown(m) {
  const lines = [`# ${m.title || m.url}`, `来源 ${m.url}`, '', m.summary || '', ''];
  (m.points || []).forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  return lines.join('\n');
}

function createReaderStore({ root, fs = nodeFs }) {
  function ensure() { fs.mkdirSync(root, { recursive: true }); }
  function dir(id) {
    if (!/^r_[0-9a-z]+$/.test(String(id))) throw new ReaderError('bad-id', 'bad id');
    return path.join(root, id);
  }
  function list() {
    ensure();
    const out = [];
    for (const name of fs.readdirSync(root)) {
      if (!/^r_[0-9a-z]+$/.test(name)) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(root, name, 'meta.json'), 'utf8'))); } catch { /* 坏条目跳过 */ }
    }
    return out.sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
  }
  function get(id) {
    try { return JSON.parse(fs.readFileSync(path.join(dir(id), 'meta.json'), 'utf8')); } catch { return null; }
  }
  function save(meta) {
    const d = dir(meta.id);
    fs.mkdirSync(d, { recursive: true });
    const tmp = path.join(d, 'meta.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, path.join(d, 'meta.json'));
    return meta;
  }
  function update(id, patch) {
    const m = get(id);
    if (!m) return null;
    return save({ ...m, ...patch });
  }
  function saveText(id, text) { fs.writeFileSync(path.join(dir(id), 'text.txt'), String(text || '')); }
  function readText(id) { try { return fs.readFileSync(path.join(dir(id), 'text.txt'), 'utf8'); } catch { return ''; } }
  function remove(id) { fs.rmSync(dir(id), { recursive: true, force: true }); return true; }
  function findDone(url) {
    const k = dedupeKey(url);
    return list().find((m) => m.status === 'done' && dedupeKey(m.url) === k) || null;
  }
  // 启动时：停在排队/读取/整理的记录标成失败
  function recover() {
    let n = 0;
    for (const m of list()) {
      if (ACTIVE.includes(m.status)) { save({ ...m, status: 'error', error: '上次没读完，点重试' }); n += 1; }
    }
    return n;
  }
  return { root, list, get, save, update, saveText, readText, remove, findDone, recover };
}

function createKeyStore({ file, easylensDir = path.join(os.homedir(), '.easylens'), prefsFile, fs = nodeFs }) {
  function readFileKey(f) {
    try { const v = fs.readFileSync(f, 'utf8').trim(); return v || null; } catch { return null; }
  }
  function readPrefs() {
    try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; }
  }
  function writePrefs(p) {
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    fs.writeFileSync(prefsFile, JSON.stringify(p, null, 2));
  }
  function writeKey(key) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, key, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  }
  const easyKeyFile = () => path.join(easylensDir, 'deepseek-api-key');
  function config() {
    const p = readPrefs();
    return { baseURL: p.baseURL || DEFAULT_BASE_URL, model: p.model || DEFAULT_MODEL, apiKey: readFileKey(file) };
  }
  function getPublic() {
    const c = config();
    const hasKey = Boolean(c.apiKey);
    return { baseURL: c.baseURL, model: c.model, hasKey, easylensAvailable: !hasKey && Boolean(readFileKey(easyKeyFile())) };
  }
  function save({ baseURL, model, apiKey } = {}) {
    const b = String(baseURL == null ? '' : baseURL).trim() || DEFAULT_BASE_URL;
    let u;
    try { u = new URL(b); } catch { return { ok: false, error: '接口地址只能是 https 网址' }; }
    if (u.protocol !== 'https:') return { ok: false, error: '接口地址只能是 https 网址' };
    const mdl = String(model == null ? '' : model).trim() || DEFAULT_MODEL;
    writePrefs({ baseURL: b.replace(/\/+$/, ''), model: mdl });
    const k = String(apiKey == null ? '' : apiKey).trim();
    if (k) writeKey(k);
    return { ok: true, ...getPublic() };
  }
  function removeKey() { try { fs.unlinkSync(file); } catch { /* 没有就算了 */ } return getPublic(); }
  function importEasyLens() {
    const k = readFileKey(easyKeyFile());
    if (!k) return { ok: false, error: '没有找到 EasyLens 的 Key' };
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path.join(easylensDir, 'settings.json'), 'utf8')); } catch { s = {}; }
    writeKey(k);
    let base = DEFAULT_BASE_URL;
    try { if (s.baseURL && new URL(s.baseURL).protocol === 'https:') base = String(s.baseURL).replace(/\/+$/, ''); } catch { /* 默认 */ }
    writePrefs({ baseURL: base, model: (typeof s.model === 'string' && s.model.trim()) || DEFAULT_MODEL });
    return { ok: true, ...getPublic() };
  }
  return { config, getPublic, save, removeKey, importEasyLens };
}

module.exports = {
  MAX_SEND_CHARS, MIN_TEXT_CHARS, MAX_POINTS, DEFAULT_BASE_URL, DEFAULT_MODEL, SYSTEM_PROMPT, ACTIVE,
  ReaderError, validateUrl, dedupeKey, hostOf, newId, normalizeText, buildUserMessage, parseSummary, llmErrorText, toMarkdown,
  createReaderStore, createKeyStore
};
