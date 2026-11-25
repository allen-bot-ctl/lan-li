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
  const countEl = $('reader-count');
  const nollm = $('reader-nollm');
  const qaView = $('reader-qa-view');
  const qaInput = $('reader-qa-input');
  const qaHistory = $('reader-qa-history');
  const qaScroll = $('reader-qa-scroll');
  const qaError = $('reader-qa-error');
  const qaSend = $('reader-qa-send');
  const qaStop = $('reader-qa-stop');
  const qaDrafts = new Map();
  let qa = null;
  const PH = '粘贴网址，回车开始读';
  const PH_OFF = '先配置大模型才能用帮阅';
  const md = window.MdRender.createMd(window.markdownit);
  let llmReady = false;
  let modelCheck = null;
  let configRevision = 0;
  let items = [];
  let detailId = null;

  const STATUS = { queued: '排队中', reading: '读取网页…', summarizing: '整理中…' };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const two = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`; };

  const hasMd = (m) => typeof m.markdown === 'string' && m.markdown.trim() !== '';
  function statusText(m) {
    if (m.status === 'done') return hasMd(m) ? '已整理' : `${(m.points || []).length} 条要点`;
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
  const toKeySettings = () => openSettingsView('llm');
  const configId = c => c && c.ready ? JSON.stringify([c.baseURL, c.model]) : null;
  function applyModelConfig(c) {
    const failed = !!configId(c) && modelCheck?.config === configId(c) && !modelCheck.ok;
    llmReady = !!(c && c.ready) && !failed;
    for (const banner of [nollm, $('reader-prompt-lock')]) {
      banner.querySelector('.reader-nollm-title').textContent = failed ? '大模型连接测试未通过' : PH_OFF;
      banner.querySelector('.reader-nollm-desc').textContent = failed ? '请在设置中检查接口地址、模型和 API Key，再测试连接。' : '在 设置 › 大模型 填好接口地址、模型和 API Key 就能用。';
    }
    applyLlm();
  }
  // 没配置大模型：输入框和「帮我读」disabled，显示提示卡；配置好后立刻恢复
  function applyLlm() {
    input.disabled = !llmReady;
    go.disabled = !llmReady;
    $('reader-d-resum').disabled = !llmReady;
    for (const retryBtn of list.querySelectorAll('.reader-act-retry')) retryBtn.disabled = !llmReady;
    $('reader-prompt-ai').disabled = !llmReady;
    $('reader-prompt-lock').hidden = llmReady;
    input.placeholder = llmReady ? PH : PH_OFF;
    nollm.hidden = llmReady;
    nollm.classList.toggle('is-center', !llmReady && items.length === 0);
    empty.hidden = !llmReady ? true : items.length > 0;
    if (!llmReady) list.before(nollm);
    if (qa) updateQaControls();
  }
  function showNoLlm() { llmReady = false; applyLlm(); }
  function syncLlmHint() {
    const id = ++configRevision;
    return api.getReaderConfig().then((c) => {
      if (id === configRevision) applyModelConfig(c);
      return c;
    }).catch(() => { if (id === configRevision) applyModelConfig(null); return null; });
  }

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
      const retryBtn = rowAction('重试', 'reader-act-retry', () => retry(m.id));
      retryBtn.disabled = !llmReady;
      acts.appendChild(retryBtn);
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
    countEl.textContent = items.length ? `${items.length} 篇` : '';
    applyLlm();
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
    if (!llmReady) return;
    api.retryReader(id).then((r) => {
      if (r && r.code === 'no-key') showNoLlm();
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
    if (!llmReady) return;
    const url = input.value.trim();
    api.submitReader(url).then((r) => {
      if (!r) return;
      if (!r.ok && r.code === 'invalid-url') { setMsg('请输入以 http:// 或 https:// 开头的网址', 'error'); return; }
      if (!r.ok && r.code === 'no-key') { showNoLlm(); return; }
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
    const box = $('reader-d-md');
    const legacy = $('reader-d-legacy');
    box.textContent = '';
    if (hasMd(m)) {
      legacy.hidden = true; box.hidden = false;
      window.MdRender.renderInto(box, md, m.markdown, document, (href) => api.openReaderLink(href));
    } else {
      // 0.1.60/0.1.61 的旧记录：原样用「一句话 / 要点」版式显示，不转换
      box.hidden = true; legacy.hidden = false;
      $('reader-d-summary').textContent = m.summary || '';
      const ol = $('reader-d-points');
      ol.textContent = '';
      for (const p of m.points || []) { const li = document.createElement('li'); li.textContent = p; ol.appendChild(li); }
    }
  }

  function openDetail(id) {
    api.getReader(id).then((m) => {
      if (!m || m.status !== 'done') return;
      detailId = id;
      fillDetail(m);
      mainEl.hidden = true;
      detail.hidden = false;
      countEl.hidden = true;
      back.textContent = '‹ 帮阅';
    }).catch(() => {});
  }

  function rememberQaDraft(id, value) {
    qaDrafts.delete(id);
    if (!value.trim()) return;
    qaDrafts.set(id, value);
    if (qaDrafts.size > 20) qaDrafts.delete(qaDrafts.keys().next().value);
  }

  function showQaError(text) {
    qaError.textContent = text || '';
    qaError.hidden = !text;
  }

  function updateQaControls() {
    if (!qa) return;
    const pending = !!qa.requestId;
    const canSend = llmReady && qa.available && !qa.loading && !pending;
    qaInput.disabled = !canSend;
    qaSend.disabled = !canSend || !qaInput.value.trim();
    qaStop.hidden = !pending;
    $('reader-qa-hint').textContent = pending ? '正在生成回答…' : (/Mac/i.test(navigator.platform) ? '⌘ Enter 发送' : 'Ctrl+Enter 发送');
    $('reader-qa-model').hidden = qa.loading || llmReady;
    $('reader-qa-state').textContent = qa.loading ? '正在打开问答…' :
      pending || !qa.loaded ? '' :
      !qa.available && llmReady ? '这篇文章没有可用于问答的正文。仍可返回查看原摘要。' :
      qa.turns.length === 0 && llmReady ? '还没有追问。可以先问「文中最关键的结论是什么？」' : '';
  }

  function renderQaHistory() {
    qaHistory.replaceChildren();
    for (const turn of qa.turns) {
      const row = document.createElement('div');
      row.className = 'reader-qa-turn';
      row.setAttribute('role', 'listitem');
      const question = document.createElement('div');
      question.className = 'reader-qa-question';
      question.setAttribute('aria-label', '你的问题');
      question.textContent = turn.question;
      const answer = document.createElement('div');
      answer.className = 'reader-qa-answer reader-d-md';
      answer.setAttribute('aria-label', '模型回答');
      window.MdRender.renderInto(answer, md, turn.answer, document, (href) => api.openReaderLink(href));
      row.append(question, answer);
      qaHistory.append(row);
    }
    qaScroll.scrollTop = qaScroll.scrollHeight;
  }

  function closeQa(restoreArticle = true) {
    if (!qa) return;
    const current = qa;
    rememberQaDraft(current.id, qaInput.value);
    qa = null;
    if (current.requestId) api.cancelReaderQa({ id: current.id, requestId: current.requestId });
    qaView.hidden = true;
    if (restoreArticle && detailId === current.id && !view.hidden) {
      detail.hidden = false;
      back.textContent = '‹ 帮阅';
      $('reader-d-qa').focus({ preventScroll: true });
    }
  }

  async function openQa() {
    if (!detailId || detail.hidden || qa) return;
    const current = qa = { id: detailId, loading: true, loaded: false, available: false, turns: [], requestId: null };
    qaInput.value = qaDrafts.get(current.id) || '';
    showQaError('');
    renderQaHistory();
    detail.hidden = true;
    qaView.hidden = false;
    back.textContent = '‹ 文章摘要';
    updateQaControls();
    try {
      const [r] = await Promise.all([api.getReaderQa(current.id), syncLlmHint()]);
      if (qa !== current) return;
      if (!r?.ok) { showQaError(r?.error || '未能读取问答记录，请返回后重试。'); return; }
      current.turns = Array.isArray(r.turns) ? r.turns : [];
      current.available = r.available === true;
      current.loaded = true;
      renderQaHistory();
    } catch {
      if (qa === current) showQaError('未能读取问答记录，请返回后重试。');
    } finally {
      if (qa === current) {
        current.loading = false;
        updateQaControls();
        if (!qaInput.disabled) qaInput.focus({ preventScroll: true });
      }
    }
  }

  async function submitQa() {
    if (!qa || qaSend.disabled) return;
    const question = qaInput.value.trim();
    if (!question) return;
    const current = qa;
    const requestId = current.requestId = crypto.randomUUID();
    showQaError('');
    updateQaControls();
    try {
      const r = await api.sendReaderQa({ id: current.id, question, requestId });
      if (qa !== current || current.requestId !== requestId) return;
      if (!r?.ok) {
        if (r?.code === 'no-key') showNoLlm();
        showQaError(r?.error || '未能生成回答。问题已保留，可重试。');
        return;
      }
      current.turns = Array.isArray(r.turns) ? r.turns : [];
      qaInput.value = '';
      rememberQaDraft(current.id, '');
      renderQaHistory();
    } catch {
      if (qa === current && current.requestId === requestId) showQaError('未能生成回答。问题已保留，可重试。');
    } finally {
      if (qa === current && current.requestId === requestId) {
        current.requestId = null;
        updateQaControls();
        if (!qaInput.disabled) qaInput.focus({ preventScroll: true });
      }
    }
  }

  $('reader-d-qa').addEventListener('click', openQa);
  $('reader-qa-settings').addEventListener('click', toKeySettings);
  $('reader-qa-form').addEventListener('submit', (event) => { event.preventDefault(); submitQa(); });
  qaInput.addEventListener('input', () => {
    if (qa) rememberQaDraft(qa.id, qaInput.value);
    showQaError('');
    updateQaControls();
  });
  qaInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      submitQa();
    }
  });
  qaStop.addEventListener('click', () => {
    if (!qa?.requestId) return;
    const requestId = qa.requestId;
    qa.requestId = null;
    api.cancelReaderQa({ id: qa.id, requestId });
    showQaError('已停止回答。问题已保留，可重试。');
    updateQaControls();
    qaInput.focus({ preventScroll: true });
  });

  function showList() {
    closeQa(false);
    detailId = null;
    detail.hidden = true;
    mainEl.hidden = false;
    countEl.hidden = false;
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
    syncLlmHint();
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
  back.addEventListener('click', () => { if (qa) { closeQa(); return; } if (!detail.hidden) { showList(); refresh(); return; } closeReaderView(); });
  go.addEventListener('click', submit);
  $('reader-nollm-go').addEventListener('click', toKeySettings);
  $('reader-settings-llm-go').addEventListener('click', toKeySettings);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { if (msg.classList.contains('is-error')) setMsg(''); });
  $('reader-d-open').addEventListener('click', () => { if (detailId) api.openReaderOriginal(detailId); });
  $('reader-d-copy').addEventListener('click', () => { if (detailId) copy(detailId); });
  $('reader-d-resum').addEventListener('click', () => {
    const id = detailId;
    if (!id || !llmReady) return;
    api.resummarizeReader(id).then((r) => {
      if (r && r.code === 'no-key') { showList(); showNoLlm(); return; }
      showList(); refresh();
    }).catch(() => {});
  });
  api.onReaderChanged(() => { refresh(); });
  api.onReaderDone((p) => {
    const t = String((p && p.title) || '');
    showToast({ type: 'success', title: `已读完 · ${[...t].slice(0, 12).join('')}` });
  });
  function onEscape() {
    if (qa) { closeQa(); return; }
    if (!detail.hidden) { showList(); refresh(); return; }
    closeReaderView();
  }
  // 真机上 Esc 由主进程拦下后发 reader:escape；按键直接到页面时（如自动化测试）在这里兜底
  api.onReaderEscape(onEscape);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || view.hidden) return;
    e.preventDefault();
    onEscape();
  });

  // 设置页「大模型」：继续使用现有全局配置与密钥存储。
  const keyInput = $('reader-key');
  const baseInput = $('reader-base');
  const modelInput = $('reader-model');
  const statusEl = $('reader-key-status');
  const baseErr = $('reader-base-err');
  const modelErr = $('reader-model-err');
  const testBtn = $('reader-test');
  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'reader-key-status' + (kind ? ' is-' + kind : '');
  }
  function statusFrom(c) {
    if (configId(c) && modelCheck?.config === configId(c)) {
      setStatus(modelCheck.ok ? '测试通过' : '已配置 · 连接测试未通过', modelCheck.ok ? 'ok' : 'error');
    } else setStatus(c && c.hasKey ? `已配置 · ${c.model}` : '未配置');
  }
  function formValues() { return { baseURL: baseInput.value, model: modelInput.value, apiKey: keyInput.value }; }
  // 前端先校验一遍（主进程还会再校验）
  function checkForm() {
    const b = baseInput.value.trim();
    const badBase = !/^https:\/\/[^/\s]+/i.test(b);
    const badModel = !modelInput.value.trim();
    baseErr.hidden = !badBase;
    modelErr.hidden = !badModel;
    return !badBase && !badModel;
  }
  function showSaveError(r) {
    if (r && r.code === 'bad-url') baseErr.hidden = false;
    if (r && r.code === 'no-model') modelErr.hidden = false;
  }
  function renderReaderSettings() {
    if (!promptDirty) loadPrompt();
    return syncLlmHint();
  }
  let loadedModel = null;
  let modelMutation = 0;
  function renderModelSettings() {
    baseErr.hidden = true; modelErr.hidden = true;
    return syncLlmHint().then((c) => {
      loadedModel = c;
      keyInput.value = '';
      keyInput.placeholder = c && c.hasKey ? '已保存，留空不修改' : 'sk-…';
      baseInput.value = (c && c.baseURL) || 'https://api.deepseek.com';
      modelInput.value = (c && c.model) || 'deepseek-chat';
      $('reader-key-del').disabled = !(c && c.hasKey);
      statusFrom(c);
    });
  }
  function saveForm() {
    if (!checkForm()) return;
    modelMutation += 1;
    api.saveReaderConfig(formValues()).then((r) => {
      if (r && r.ok) { modelCheck = null; showToast({ type: 'success', title: '已保存' }); renderModelSettings(); } else showSaveError(r);
    }).catch(() => {});
  }
  $('reader-key-save').addEventListener('click', saveForm);
  for (const el of [keyInput, baseInput, modelInput]) {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveForm(); } });
  }
  baseInput.addEventListener('input', () => { if (!baseErr.hidden) checkForm(); });
  modelInput.addEventListener('input', () => { if (!modelErr.hidden) checkForm(); });
  testBtn.addEventListener('click', () => {
    if (!checkForm()) return;
    testBtn.disabled = true;
    testBtn.textContent = '测试中…';
    const values = formValues();
    const checkedModel = loadedModel;
    const revision = modelMutation;
    const saved = configId(checkedModel);
    const sameAsSaved = saved && !values.apiKey.trim() &&
      values.baseURL.trim() === checkedModel.baseURL && values.model.trim() === checkedModel.model;
    const applyTest = (ok) => {
      if (sameAsSaved && loadedModel === checkedModel && revision === modelMutation) {
        modelCheck = { config: saved, ok };
        applyModelConfig(checkedModel);
      }
    };
    api.testReaderConfig(values).then((r) => {
      applyTest(!!r?.ok);
      if (r && r.ok) setStatus('测试通过', 'ok');
      else if (r && (r.code === 'bad-url' || r.code === 'no-model')) showSaveError(r);
      else setStatus((r && r.error) || '测试失败：连不上接口', 'error');
    }).catch(() => { applyTest(false); setStatus('测试失败：连不上接口', 'error'); }).finally(() => {
      testBtn.disabled = false;
      testBtn.textContent = '测试连接';
    });
  });
  $('reader-key-del').addEventListener('click', () => {
    modelMutation += 1;
    api.removeReaderKey().then(() => { modelCheck = null; showToast({ type: 'success', title: '已删除 Key' }); renderModelSettings(); }).catch(() => {});
  });

  // 设置页「整理提示词」
  const promptEl = $('reader-prompt');
  const promptErr = $('reader-prompt-err');
  let promptDirty = false;
  function promptMsg(text) { promptErr.textContent = text || ''; promptErr.hidden = !text; }
  function loadPrompt() {
    promptMsg('');
    return api.getReaderPrompt().then((r) => { if (r && !promptDirty) { promptEl.value = r.prompt; } }).catch(() => {});
  }
  $('reader-prompt-save').addEventListener('click', () => {
    api.saveReaderPrompt(promptEl.value).then((r) => {
      if (r && r.ok) { promptMsg(''); promptEl.value = r.prompt; promptDirty = false; showToast({ type: 'success', title: '提示词已保存' }); }
      else promptMsg((r && r.error) || '保存失败');
    }).catch(() => {});
  });
  $('reader-prompt-reset').addEventListener('click', () => {
    api.resetReaderPrompt().then((r) => {
      if (r && r.ok) { promptMsg(''); promptEl.value = r.prompt; promptDirty = false; showToast({ type: 'success', title: '已恢复默认' }); }
    }).catch(() => {});
  });
  promptEl.addEventListener('input', () => { promptDirty = true; promptMsg(''); });

  // 0.1.64「AI 改提示词」弹框（契约 docs/changes/0.1.64.md §2）
  const aiOv = $('prompt-ai-overlay');
  const aiInput = $('prompt-ai-input');
  const aiResult = $('prompt-ai-result');
  const aiResultText = $('prompt-ai-result-text');
  const aiErr = $('prompt-ai-err');
  const aiKeep = $('prompt-ai-keep');
  const aiRetry = $('prompt-ai-retry');
  const aiGo = $('prompt-ai-go');
  const aiUse = $('prompt-ai-use');
  let aiBase = '';
  let aiNew = null;
  let aiBusy = false;
  let aiRid = 0;
  function aiRender() {
    const has = aiNew != null;
    aiResult.hidden = !has;
    aiResultText.textContent = has ? aiNew : '';
    aiKeep.textContent = has ? '保持原版' : '取消';
    aiGo.hidden = has;
    aiRetry.hidden = !has;
    aiUse.hidden = !has;
    aiInput.readOnly = aiBusy;
    const empty = !aiInput.value.trim();
    aiGo.textContent = aiBusy ? '生成中…' : '生成新版';
    aiGo.disabled = aiBusy || empty;
    aiRetry.textContent = aiBusy ? '生成中…' : '再试一版';
    aiRetry.disabled = aiBusy || empty;
    aiUse.disabled = aiBusy;
  }
  function aiError(text) { aiErr.textContent = text || ''; aiErr.hidden = !text; }
  function openPromptAi() {
    if (!llmReady) return;
    aiBase = promptEl.value;
    aiNew = null; aiBusy = false;
    aiInput.value = '';
    aiError('');
    aiOv.hidden = false;
    api.setPromptAiOpen(true);
    aiRender();
    aiInput.focus();
  }
  function closePromptAi() {
    if (aiOv.hidden) return;
    if (aiBusy) api.cancelRewriteReaderPrompt(aiRid);
    aiRid += 1; aiBusy = false; aiNew = null;
    aiOv.hidden = true;
    api.setPromptAiOpen(false);
  }
  function aiGenerate() {
    if (!llmReady || aiBusy || !aiInput.value.trim()) return;
    aiRid += 1;
    const rid = aiRid;
    aiBusy = true;
    aiError('');
    aiRender();
    api.rewriteReaderPrompt({ rid, prompt: aiBase, request: aiInput.value }).then((r) => {
      if (rid !== aiRid || aiOv.hidden) return;
      aiBusy = false;
      if (r && r.ok) { aiNew = r.prompt; aiError(''); }
      else aiError((r && r.error) || '生成失败：连不上接口');
      aiRender();
    }).catch(() => {
      if (rid !== aiRid || aiOv.hidden) return;
      aiBusy = false; aiError('生成失败：连不上接口'); aiRender();
    });
  }
  function aiUseNew() {
    if (aiBusy || aiNew == null) return;
    api.saveReaderPrompt(aiNew).then((r) => {
      if (r && r.ok) {
        promptMsg(''); promptEl.value = r.prompt; promptDirty = false;
        closePromptAi();
        showToast({ type: 'success', title: '提示词已更新' });
      } else aiError((r && r.error) || '保存失败');
    }).catch(() => aiError('保存失败'));
  }
  $('reader-prompt-ai').addEventListener('click', openPromptAi);
  aiKeep.addEventListener('click', closePromptAi);
  aiGo.addEventListener('click', aiGenerate);
  aiRetry.addEventListener('click', aiGenerate);
  aiUse.addEventListener('click', aiUseNew);
  aiInput.addEventListener('input', aiRender);
  aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); aiGenerate(); }
  });
  // 点遮罩空白处不关（契约 §2.3，防止误点丢掉结果）；要改成「点遮罩 = 保持原版」只需把下面这行改成 closePromptAi()
  aiOv.addEventListener('pointerdown', (e) => { if (e.target === aiOv) { /* 不关 */ } });
  api.onPromptAiEscape(closePromptAi);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aiOv.hidden) { e.preventDefault(); e.stopPropagation(); closePromptAi(); }
  }, true);
  window.closePromptAi = closePromptAi;

  window.openReaderView = openReaderView;
  window.closeReaderView = closeReaderView;
  window.renderReaderSettings = renderReaderSettings;
  window.renderModelSettings = renderModelSettings;
})();
