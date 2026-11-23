'use strict';
// 0.1.60 帮阅：页面（列表、输入、详情、设置 tab）。契约 docs/changes/0.1.60-reader.md。
// 依赖 calendar.js 的全局：api、appBody、showToast、closeAllPickers、closeSettingsView、closeInboxView、openSettingsView、rowAction、formatInboxTime、IQ。
(function () {
  const $ = (id) => document.getElementById(id);
  const view = $('reader-view');
  const btn = $('reader-button');
  const back = $('reader-back');
  const titleEl = $('reader-title');
  const mainEl = $('reader-main');
  const input = $('reader-input');
  const go = $('reader-go');
  const msg = $('reader-msg');
  const list = $('reader-list');
  const empty = $('reader-empty');
  const detail = $('reader-detail');
  let items = [];
  let detailId = null;

  const STATUS = { queued: '排队中', reading: '读取网页…', summarizing: '整理中…' };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const two = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`; };

  function statusText(m) {
    if (m.status === 'done') return `${(m.points || []).length} 条要点`;
    if (m.status === 'error') return m.error || '读取失败';
    return STATUS[m.status] || '';
  }

  function setMsg(text, kind, onClick) {
    msg.textContent = '';
    msg.className = 'reader-msg' + (kind ? ' is-' + kind : '');
    if (!text) { msg.hidden = true; return; }
    if (onClick) {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'reader-link'; a.textContent = text;
      a.addEventListener('click', onClick);
      msg.appendChild(a);
    } else {
      msg.textContent = text;
    }
    msg.hidden = false;
  }
  const toKeySettings = () => openSettingsView('reader');

  function buildRow(m) {
    const row = document.createElement('div');
    row.className = 'inbox-row reader-row is-' + m.status;
    row.setAttribute('role', 'listitem');
    row.dataset.id = m.id;
    row.dataset.status = m.status;
    const icon = document.createElement('span');
    icon.className = 'inbox-row-icon';
    icon.textContent = m.status === 'done' ? '📰' : (m.status === 'error' ? '⚠️' : '⏳');
    const body = document.createElement('span');
    body.className = 'inbox-row-body';
    const t = document.createElement('span');
    t.className = 'inbox-row-title';
    t.textContent = m.title || hostOf(m.url) || m.url;
    const sub = document.createElement('span');
    sub.className = 'inbox-row-sub';
    const host = document.createElement('span');
    host.textContent = `${m.site && m.site !== m.title ? m.site : hostOf(m.finalUrl || m.url)} · `;
    const st = document.createElement('span');
    st.className = 'reader-status' + (m.status === 'error' ? ' is-error' : '');
    st.textContent = statusText(m);
    sub.append(host, st);
    body.append(t, sub);
    const time = document.createElement('span');
    time.className = 'inbox-row-time';
    time.textContent = formatInboxTime(m.createdMs);
    const acts = document.createElement('span');
    acts.className = 'inbox-row-actions';
    if (m.status === 'done') {
      acts.appendChild(rowAction('打开原文', 'reader-act-open', () => api.openReaderOriginal(m.id)));
      acts.appendChild(rowAction('复制', 'reader-act-copy', () => copy(m.id)));
    } else if (m.status === 'error') {
      acts.appendChild(rowAction('重试', 'reader-act-retry', () => retry(m.id)));
    }
    acts.appendChild(rowAction('×', 'reader-act-delete', () => remove(m.id)));
    row.append(icon, body, time, acts);
    const measure = () => row.style.setProperty('--acts-w', acts.offsetWidth + 'px');
    row.addEventListener('mouseenter', measure);
    row.addEventListener('focusin', measure);
    row.addEventListener('click', () => {
      if (m.status === 'done') openDetail(m.id);
      else if (m.status === 'error' && /API Key/.test(m.error || '')) toKeySettings();
    });
    return row;
  }

  function render() {
    list.textContent = '';
    empty.hidden = items.length > 0;
    for (const g of IQ.groupByDate(items, new Date())) {
      const head = document.createElement('div');
      head.className = 'inbox-group';
      head.textContent = g.label;
      list.appendChild(head);
      for (const m of g.entries) list.appendChild(buildRow(m));
    }
  }

  function refresh() {
    if (view.hidden) return Promise.resolve();
    return api.listReader().then((r) => {
      items = r || [];
      render();
      if (detailId) {
        const m = items.find((x) => x.id === detailId);
        if (!m) showList();
        else if (m.status === 'done') fillDetail(m);
        else showList();
      }
    }).catch(() => {});
  }

  function copy(id) {
    api.copyReader(id).then((ok) => { if (ok) showToast({ type: 'success', title: '已复制' }); }).catch(() => {});
  }
  function retry(id) {
    api.retryReader(id).then((r) => {
      if (r && r.code === 'no-key') setMsg('还没设置大模型 API Key，去设置 ›', 'muted', toKeySettings);
      refresh();
    }).catch(() => {});
  }
  function remove(id) {
    api.removeReader(id).then(() => {
      items = items.filter((x) => x.id !== id);
      if (detailId === id) showList();
      render();
      showToast({ type: 'success', title: '已删除' });
    }).catch(() => {});
  }

  function submit() {
    const url = input.value.trim();
    api.submitReader(url).then((r) => {
      if (!r) return;
      if (!r.ok && r.code === 'invalid-url') { setMsg('请输入以 http:// 或 https:// 开头的网址', 'error'); return; }
      if (!r.ok && r.code === 'no-key') { setMsg('还没设置大模型 API Key，去设置 ›', 'muted', toKeySettings); return; }
      setMsg('');
      input.value = '';
      if (r.dup) {
        openDetail(r.id);
        showToast({ type: 'info', title: '读过了 · 打开上次的结果' });
        return;
      }
      refresh();
    }).catch(() => {});
  }

  function fillDetail(m) {
    titleEl.textContent = m.title || hostOf(m.url);
    $('reader-d-title').textContent = m.title || hostOf(m.url);
    const bits = [m.site || hostOf(m.finalUrl || m.url)];
    if (m.author) bits.push(m.author);
    bits.push(m.published || stamp(m.createdMs));
    if (m.chars) bits.push(`${m.chars} 字`);
    $('reader-d-meta').textContent = bits.join(' · ');
    $('reader-d-summary').textContent = m.summary || '';
    const ol = $('reader-d-points');
    ol.textContent = '';
    for (const p of m.points || []) { const li = document.createElement('li'); li.textContent = p; ol.appendChild(li); }
  }

  function openDetail(id) {
    api.getReader(id).then((m) => {
      if (!m || m.status !== 'done') return;
      detailId = id;
      fillDetail(m);
      mainEl.hidden = true;
      detail.hidden = false;
      back.textContent = '‹ 帮阅';
    }).catch(() => {});
  }

  function showList() {
    detailId = null;
    detail.hidden = true;
    mainEl.hidden = false;
    titleEl.textContent = '帮阅';
    back.textContent = '‹ 返回';
  }

  function openReaderView() {
    closeAllPickers();
    closeSettingsView();
    closeInboxView();
    appBody.hidden = true;
    view.hidden = false;
    api.setSettingsView(true);
    api.setReaderView(true);
    showList();
    setMsg('');
    refresh();
    api.readerClipboardUrl().then((u) => { if (u && !input.value) input.value = u; }).catch(() => {});
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function closeReaderView() {
    if (view.hidden) return;
    view.hidden = true;
    showList();
    appBody.hidden = false;
    api.setSettingsView(false);
    api.setReaderView(false);
  }

  btn.addEventListener('click', () => { if (view.hidden) openReaderView(); else closeReaderView(); });
  back.addEventListener('click', () => { if (!detail.hidden) { showList(); refresh(); return; } closeReaderView(); });
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { if (msg.classList.contains('is-error')) setMsg(''); });
  $('reader-d-open').addEventListener('click', () => { if (detailId) api.openReaderOriginal(detailId); });
  $('reader-d-copy').addEventListener('click', () => { if (detailId) copy(detailId); });
  $('reader-d-resum').addEventListener('click', () => {
    const id = detailId;
    if (!id) return;
    api.resummarizeReader(id).then((r) => {
      if (r && r.code === 'no-key') { showList(); setMsg('还没设置大模型 API Key，去设置 ›', 'muted', toKeySettings); return; }
      showList(); refresh();
    }).catch(() => {});
  });
  api.onReaderChanged(() => { refresh(); });
  api.onReaderDone((p) => {
    const t = String((p && p.title) || '');
    showToast({ type: 'success', title: `已读完 · ${[...t].slice(0, 12).join('')}` });
  });
  api.onReaderEscape(() => {
    if (!detail.hidden) { showList(); refresh(); return; }
    closeReaderView();
  });

  // 设置页「帮阅」tab：只放 Key
  const keyInput = $('reader-key');
  const keyNote = $('reader-key-note');
  function renderReaderSettings() {
    api.getReaderConfig().then((c) => {
      keyInput.value = '';
      keyInput.placeholder = c && c.hasKey ? '已保存，留空不修改' : 'sk-…';
      keyNote.hidden = !(c && c.usingEasyLens);
      $('reader-key-del').disabled = !(c && c.hasKey);
    }).catch(() => {});
  }
  $('reader-key-save').addEventListener('click', () => {
    api.saveReaderConfig({ apiKey: keyInput.value }).then((r) => {
      if (r && r.ok) { showToast({ type: 'success', title: '已保存' }); renderReaderSettings(); }
    }).catch(() => {});
  });
  keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('reader-key-save').click(); } });
  $('reader-key-del').addEventListener('click', () => {
    api.removeReaderKey().then(() => { showToast({ type: 'success', title: '已删除 Key' }); renderReaderSettings(); }).catch(() => {});
  });

  window.openReaderView = openReaderView;
  window.closeReaderView = closeReaderView;
  window.renderReaderSettings = renderReaderSettings;
})();
