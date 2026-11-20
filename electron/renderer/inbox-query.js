'use strict';
// 0.1.44 收纳 B 段：检索、筛选、日期分组、标签规则（契约 docs/changes/0.1.42-inbox.md 第七节）。
// 纯函数，渲染进程用 <script> 加载（window.LanliInboxQuery），主进程和单测用 require。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LanliInboxQuery = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const MAX_TAGS = 5;
  const MAX_TAG_LEN = 8;
  const TYPES = ['file', 'image', 'text', 'link'];

  function tagError(code, message) { const e = new Error(message); e.code = code; return e; }

  function normalizeTag(tag) { return String(tag == null ? '' : tag).trim().replace(/^#+/, '').trim(); }

  // 加一个标签：重复的忽略；单个最长 8 字；每条最多 5 个。
  function addTag(tags, tag) {
    const list = Array.isArray(tags) ? tags.slice() : [];
    const t = normalizeTag(tag);
    if (!t) throw tagError('tag-empty', '标签不能为空');
    if ([...t].length > MAX_TAG_LEN) throw tagError('tag-too-long', `标签最多 ${MAX_TAG_LEN} 个字`);
    if (list.includes(t)) return list;
    if (list.length >= MAX_TAGS) throw tagError('tag-limit', `每条最多 ${MAX_TAGS} 个标签`);
    list.push(t);
    return list;
  }

  function cleanTags(tags) {
    const out = [];
    for (const raw of tags || []) {
      const t = normalizeTag(raw);
      if (!t || out.includes(t)) continue;
      if ([...t].length > MAX_TAG_LEN) throw tagError('tag-too-long', `标签最多 ${MAX_TAG_LEN} 个字`);
      out.push(t);
    }
    if (out.length > MAX_TAGS) throw tagError('tag-limit', `每条最多 ${MAX_TAGS} 个标签`);
    return out;
  }

  function entryMs(m) {
    if (m && typeof m.createdMs === 'number') return m.createdMs;
    const t = Date.parse(m && m.createdAt);
    return Number.isNaN(t) ? 0 : t;
  }

  function dayKeyOf(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  function entryDayKey(m) { return dayKeyOf(new Date(entryMs(m))); }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function baseName(p) { return String(p || '').split('/').pop(); }

  // 检索用的文本：标题、正文纯文本、文件名、来源域名、标签。
  function haystack(m) {
    if (m.__hay !== undefined) return m.__hay;
    const parts = [m.title, m.preview, m.body, m.type === 'file' ? baseName(m.sourcePath) : '', m.sourceUrl ? hostOf(m.sourceUrl) : '', (m.tags || []).join(' ')];
    const hay = parts.filter(Boolean).join('\n').toLowerCase();
    try { Object.defineProperty(m, '__hay', { value: hay, enumerable: false }); } catch (e) { /* frozen */ }
    return hay;
  }

  function matchesQuery(m, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return haystack(m).includes(q);
  }

  // filter: { query, type: 'all'|'file'|..., tags: [], day: 'Y-M-D'|null }，四种条件叠加（与）。
  function filterEntries(entries, filter) {
    const f = filter || {};
    const type = f.type && f.type !== 'all' ? f.type : null;
    const tags = (f.tags || []).filter(Boolean);
    const q = String(f.query || '').trim().toLowerCase();
    return (entries || []).filter((m) => {
      if (type && m.type !== type) return false;
      if (tags.length && !tags.every((t) => (m.tags || []).includes(t))) return false;
      if (f.day && entryDayKey(m) !== f.day) return false;
      if (q && !haystack(m).includes(q)) return false;
      return true;
    });
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function startOfWeek(d) {
    const s = startOfDay(d);
    const dow = (s.getDay() + 6) % 7; // 周一 = 0
    return new Date(s.getFullYear(), s.getMonth(), s.getDate() - dow);
  }

  // 今天 / 昨天 / 本周（周一起）/ 本月 / 更早按月（「10月」，跨年「2025年10月」）。
  function dateGroupLabel(ms, now) {
    const n = now || new Date();
    const d = new Date(ms);
    const today = startOfDay(n).getTime();
    const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
    const t = d.getTime();
    if (t >= today) return '今天';
    if (t >= yesterday) return '昨天';
    if (t >= startOfWeek(n).getTime()) return '本周';
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return '本月';
    if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  }

  // 已按时间倒序的条目 → [{ label, entries }]
  function groupByDate(entries, now) {
    const groups = [];
    for (const m of entries || []) {
      const label = dateGroupLabel(entryMs(m), now);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.entries.push(m);
      else groups.push({ label, entries: [m] });
    }
    return groups;
  }

  // 标签按使用次数降序（同次数按名字）。
  function tagCounts(entries) {
    const counts = new Map();
    for (const m of entries || []) for (const t of m.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  }

  // 文本按命中词切段：[{ text, hit }]，大小写不敏感。
  function highlightParts(text, query) {
    const s = String(text || '');
    const q = String(query || '').trim();
    if (!q) return [{ text: s, hit: false }];
    const lower = s.toLowerCase(); const ql = q.toLowerCase();
    const out = []; let i = 0;
    for (;;) {
      const j = lower.indexOf(ql, i);
      if (j < 0) break;
      if (j > i) out.push({ text: s.slice(i, j), hit: false });
      out.push({ text: s.slice(j, j + q.length), hit: true });
      i = j + q.length;
    }
    if (i < s.length || !out.length) out.push({ text: s.slice(i), hit: false });
    return out;
  }

  function dayChipLabel(dayKey) {
    const p = String(dayKey || '').split('-');
    return p.length === 3 ? `${Number(p[1])}月${Number(p[2])}日` : '';
  }

  return {
    MAX_TAGS, MAX_TAG_LEN, TYPES, normalizeTag, addTag, cleanTags, entryMs, entryDayKey, dayKeyOf,
    matchesQuery, filterEntries, dateGroupLabel, groupByDate, startOfWeek, tagCounts, highlightParts, dayChipLabel
  };
}));
