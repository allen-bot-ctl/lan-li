'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

// Execute the actual toast and update renderer against a DOM with a fake clock.
// Only browser timing and the main-process boundary are replaced.
function makeUI() {
  const renderer = path.join(__dirname, '../electron/renderer');
  const { document } = parseHTML(fs.readFileSync(path.join(renderer, 'calendar.html'), 'utf8'));
  let now = 0;
  let next = 0;
  let checks = 0;
  const timers = new Map();
  const context = vm.createContext({
    document, pendingNotice: null,
    checkUpdate: document.getElementById('check-update'),
    appVersion: document.getElementById('app-version'),
    clearSettingsHighlight() {},
    api: { checkUpdate: () => { checks += 1; }, restartToUpdate() {} },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { fn(); }
  });
  vm.runInContext(fs.readFileSync(path.join(renderer, 'toast.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(renderer, 'calendar.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function checkFailedToast('), source.indexOf('// 进行中的提示目前')), context);
  vm.runInContext('setToastProgressFallback(checkFailedToast)', context);
  return {
    context, document,
    checks: () => checks,
    title: () => document.getElementById('toast-title').textContent,
    advance(ms) {
      const end = now + ms;
      while (true) {
        const first = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        now = first[1].at;
        timers.delete(first[0]);
        first[1].fn();
      }
      now = end;
    }
  };
}

test('actual update renderer stays downloading after 35s then ready; ordinary progress retains 30s fallback', () => {
  const ui = makeUI();
  ui.context.applyCheckStatus({ state: 'downloading' });
  ui.advance(35000);
  assert.equal(ui.title(), '正在下载新版本');
  assert.equal(ui.document.getElementById('toast').dataset.type, 'progress');
  ui.context.showUpdateNotice({ mode: 'ready', selfUpdate: true });
  ui.context.applyCheckStatus({ state: 'ready' });
  assert.equal(ui.title(), '新版本已就绪');
  ui.context.applyCheckStatus({ state: 'prepare-error', resetReady: true });
  assert.equal(ui.title(), '更新未完成');
  vm.runInContext("showToast({ type: 'progress', title: '普通进度' })", ui.context);
  ui.advance(30001);
  assert.equal(ui.title(), '检查失败');
});

test('actual retry UI ignores stale download notices, preserves verified ready, and clears ready after install failure', () => {
  const ui = makeUI();
  ui.context.applyCheckStatus({ state: 'download-error' });
  assert.equal(ui.title(), '下载失败');
  ui.context.showUpdateNotice({ mode: 'manual' });
  assert.equal(ui.context.pendingNotice, null);
  ui.document.getElementById('toast-action').click();
  assert.equal(ui.checks(), 1);
  ui.context.showUpdateNotice({ mode: 'ready', selfUpdate: true });
  ui.context.applyCheckStatus({ state: 'ready' });
  ui.context.applyCheckStatus({ state: 'error', label: '检查失败' });
  assert.equal(ui.title(), '新版本已就绪');
  assert.match(ui.document.getElementById('settings-update-result').textContent, /新版本已就绪/);
  ui.context.applyCheckStatus({ state: 'prepare-error', resetReady: true });
  assert.equal(ui.context.pendingNotice, null);
  assert.equal(ui.document.getElementById('check-update').classList.contains('has-update'), false);
  assert.equal(ui.title(), '更新未完成');
  ui.document.getElementById('toast-action').click();
  assert.equal(ui.checks(), 2);
});
