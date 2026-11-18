'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const HTML = read('electron/renderer/calendar.html');
const TOAST_CSS = read('electron/renderer/toast.css');
const TOAST_JS = read('electron/renderer/toast.js');
const CALENDAR_CSS = read('electron/renderer/calendar.css');

function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

test('C5 calendar.html 只有一个 #toast，toast.js 先于 calendar.js 加载', () => {
  assert.equal((HTML.match(/class="toast"/g) || []).length, 1, 'class="toast" 只出现一次');
  assert.match(HTML, /<div class="toast" id="toast"/);
  for (const id of ['toast-title', 'toast-detail', 'toast-action', 'toast-close']) {
    assert.ok(HTML.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(!HTML.includes('id="update-toast"'), 'old #update-toast is gone');
  assert.ok(HTML.indexOf('src="toast.js"') < HTML.indexOf('src="calendar.js"'), 'toast.js loads first');
  assert.ok(HTML.includes('href="toast.css"'), 'toast.css is linked');
});

test('C5 toast.css 几何与动效符合契约', () => {
  const toast = ruleBody(TOAST_CSS, '.toast');
  assert.match(toast, /position:\s*absolute/);
  assert.match(toast, /top:\s*40px/);
  assert.match(toast, /left:\s*50%/);
  assert.match(toast, /width:\s*320px/);
  assert.match(toast, /min-height:\s*44px/);
  assert.match(toast, /border-radius:\s*12px/);
  assert.match(toast, /box-shadow:\s*0 8px 24px rgba\(0, 0, 0, 0\.22\)/);
  assert.ok(!/backdrop-filter/.test(toast), 'no backdrop-filter');
  assert.match(toast, /transition:\s*opacity 150ms ease-in/);
  assert.match(ruleBody(TOAST_CSS, '.toast.is-visible'), /200ms ease-out/);
  assert.match(ruleBody(TOAST_CSS, '.toast::before'), /width:\s*3px/);
});

test('C5 toast.js 常量与入口存在', () => {
  assert.match(TOAST_JS, /TOAST_AUTO_MS = 3000/);
  assert.match(TOAST_JS, /TOAST_PROGRESS_LIMIT_MS = 30000/);
  assert.match(TOAST_JS, /function showToast\(/);
});

test('C5 calendar.css 不再包含旧 .toast 浮层规则', () => {
  assert.ok(!CALENDAR_CSS.includes('.toast {'), 'old .toast rule removed');
});
