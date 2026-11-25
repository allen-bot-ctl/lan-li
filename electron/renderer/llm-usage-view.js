'use strict';

(() => {
  const id = name => document.getElementById(name);
  const settings = id('settings-view');
  const modelPage = id('settings-page-llm');
  const config = id('llm-config-panel');
  const panel = id('llm-usage-panel');
  const tabs = [id('llm-config-tab'), id('llm-usage-tab')];
  const period = id('llm-usage-period');
  const models = id('llm-usage-models');
  const tasks = id('llm-usage-tasks');
  const metrics = id('llm-usage-metrics');
  const counts = id('llm-usage-counts');
  const state = id('llm-usage-state');
  const retry = id('llm-usage-retry');
  const filter = id('llm-usage-filter');
  const clear = id('llm-usage-all-models');
  const pagination = id('llm-usage-pagination');
  const prev = id('llm-usage-prev');
  const next = id('llm-usage-next');
  const number = new Intl.NumberFormat('zh-CN');
  const date = new Intl.DateTimeFormat('zh-CN', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
  const kinds = {summarize:'帮阅整理',followup:'帮阅追问',retry:'帮阅重试',rewrite:'AI 改提示词',test:'测试连接'};
  const statuses = {success:'成功',failed:'失败',canceled:'已取消'};
  let active = 0, page = 1, generation = 0, modelFilter = null;
  const visible = () => !settings.hidden && !modelPage.hidden && active === 1;
  const fmt = value => Number.isFinite(value) ? number.format(value) : '未上报';
  const tokens = (item, key) => item?.reported === 0 || item?.[key] == null ? '未上报' : fmt(item[key]);
  const same = (item, selected) => selected && item.model === selected.model && item.provider === selected.provider;
  const modelName = item => [item.model || '未知模型', item.provider || ''].filter(Boolean).join(' · ');
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function setState(text) {
    state.textContent = text;
    state.hidden = !text;
  }
  function filterBy(selected) {
    modelFilter = selected;
    page = 1;
    load();
  }
  function render(data) {
    const {summary, storageWarning} = data;
    const showCounts = summary.requests > 0;
    metrics.hidden = counts.hidden = !showCounts;
    for (const key of ['total','input','output']) id('llm-usage-'+key).textContent = tokens(summary,key);
    id('llm-usage-count').textContent = fmt(summary.requests);
    counts.textContent = `成功 ${fmt(summary.success)} · 失败 ${fmt(summary.failed)} · 已取消 ${fmt(summary.canceled)} · Token 未上报 ${fmt(summary.unknown)}`;
    if (['inputReported','outputReported','totalReported'].every(key => Number.isFinite(summary[key])) &&
        new Set([summary.inputReported,summary.outputReported,summary.totalReported]).size > 1) {
      counts.textContent += `；输入、输出、总量分别上报 ${fmt(summary.inputReported)} / ${fmt(summary.outputReported)} / ${fmt(summary.totalReported)} 次`;
    }
    setState(storageWarning ? '部分本机记录读写失败，当前统计可能不完整。'
      : showCounts ? '' : '暂无消耗记录。');

    clear.hidden = filter.hidden = !modelFilter;
    filter.textContent = modelFilter ? '当前筛选：' + modelName(modelFilter) : '';
    const focusModel = document.activeElement?.closest('#llm-usage-models button');
    let restoreFocus = null;
    models.replaceChildren(...data.models.map(item => {
      const li = node('li', '', 'llm-usage-row');
      const button = node('button', modelName(item), 'nav-pill');
      button.type = 'button';
      const selected = same(item, modelFilter);
      button.setAttribute('aria-pressed', String(Boolean(selected)));
      if (focusModel && focusModel.textContent === button.textContent) restoreFocus = button;
      button.addEventListener('click', () => filterBy(selected ? null : {provider:item.provider, model:item.model}));
      li.append(button, node('p', `${fmt(item.requests)} 次 · 总 Token ${tokens(item, 'total')} · 未上报 ${fmt(item.unknown)} 次`, 'llm-usage-note'));
      return li;
    }));
    if (restoreFocus) restoreFocus.focus({preventScroll:true});
    tasks.replaceChildren(...data.tasks.map(item => {
      const li = node('li', '', 'llm-usage-row');
      const at = Number.isFinite(item.at) ? date.format(item.at) : '时间未知';
      const title = node('strong', `${kinds[item.kind] || '大模型请求'} · 请求状态：${statuses[item.status] || '未知'}`);
      const source = node('p', `${modelName(item)} · ${at} · ${fmt(item.durationMs)} ms`, 'llm-usage-note');
      const token = item.usage ? `总 Token ${fmt(item.usage.total)} · 输入 ${fmt(item.usage.input)} · 输出 ${fmt(item.usage.output)}` : 'Token 未上报';
      li.append(title, source, node('p', token, 'llm-usage-note'));
      return li;
    }));
    if (!data.tasks.length) tasks.append(node('li', '当前筛选没有任务。', 'llm-usage-note'));
    page = data.page;
    pagination.hidden = data.totalPages <= 1;
    prev.disabled = page <= 1;
    next.disabled = page >= data.totalPages;
    id('llm-usage-page').textContent = `第 ${page} / ${data.totalPages} 页`;
  }
  async function load() {
    if (!visible()) return;
    const rev = ++generation;
    panel.setAttribute('aria-busy','true');
    retry.hidden = true;
    setState('正在读取本机记录…');
    try {
      const data = await window.lanli.getLlmUsage({period:period.value, page, ...(modelFilter || {})});
      if (rev !== generation || !visible()) return;
      render(data);
    } catch {
      if (rev !== generation || !visible()) return;
      metrics.hidden = counts.hidden = pagination.hidden = clear.hidden = filter.hidden = true;
      models.replaceChildren();
      tasks.replaceChildren();
      setState('暂时无法读取消耗记录。');
      retry.hidden = false;
    } finally {
      if (rev === generation) panel.setAttribute('aria-busy','false');
    }
  }
  function select(index, focus = false, refresh = true) {
    active = index;
    tabs.forEach((tab,i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    config.hidden = index !== 0;
    panel.hidden = index !== 1;
    if (focus) tabs[index].focus();
    if (index === 1 && refresh) load();
    if (index === 0) { generation++; panel.setAttribute('aria-busy','false'); }
  }
  tabs.forEach((tab,index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();
        select(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
      }
    });
  });
  period.addEventListener('change', () => filterBy(null));
  clear.addEventListener('click', () => filterBy(null));
  prev.addEventListener('click', () => { page--; load(); });
  next.addEventListener('click', () => { page++; load(); });
  retry.addEventListener('click', load);
  const observer = new MutationObserver(() => {
    if (settings.hidden || modelPage.hidden) {
      if (active) select(0, false, false);
      page = 1; modelFilter = null; period.value = '7d';
    }
  });
  for (const element of [settings,modelPage]) observer.observe(element,{attributeFilter:['hidden']});
})();
