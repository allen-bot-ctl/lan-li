'use strict';
// 0.1.50 框选收纳：纯函数（矩形、询问条位置、截取缩放、快捷键校验）。
const MIN_SIDE = 8;

function normalizeRect(x0, y0, x1, y1) {
  const x = Math.min(x0, x1); const y = Math.min(y0, y1);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.abs(x1 - x0)), height: Math.round(Math.abs(y1 - y0)) };
}

function isTooSmall(r) { return !r || r.width < MIN_SIDE || r.height < MIN_SIDE; }

// 询问条默认放框下方；放不下（贴底）时放框上方。水平与框左对齐，不出屏。
function barPlacement(rect, view, bar, gap = 8) {
  const b = bar || { width: 220, height: 36 };
  let top = rect.y + rect.height + gap;
  let side = 'below';
  if (top + b.height > view.height) { top = Math.max(0, rect.y - gap - b.height); side = 'above'; }
  const left = Math.max(0, Math.min(rect.x, view.width - b.width));
  return { left: Math.round(left), top: Math.round(top), side };
}

// 窗口内 CSS 像素 → 屏幕截图像素（Retina 按 scaleFactor），夹到图像范围内。
function cropRect(rect, scaleFactor, imageSize) {
  const s = scaleFactor || 1;
  let x = Math.round(rect.x * s); let y = Math.round(rect.y * s);
  let w = Math.round(rect.width * s); let h = Math.round(rect.height * s);
  if (imageSize) {
    x = Math.max(0, Math.min(x, imageSize.width)); y = Math.max(0, Math.min(y, imageSize.height));
    w = Math.max(0, Math.min(w, imageSize.width - x)); h = Math.max(0, Math.min(h, imageSize.height - y));
  }
  return { x, y, width: w, height: h };
}

const MODS = ['Command', 'Control', 'Alt', 'Shift'];
const MOD_ALIASES = { cmd: 'Command', command: 'Command', commandorcontrol: 'Command', cmdorctrl: 'Command', ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift' };
const KEY_RE = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Plus|Minus|=|,|\.|\/|;|'|\[|\]|\\|`)$/;

// 规范化并校验；非法返回 ''。至少一个修饰键（Shift 单独不算）+ 一个主键。
function normalizeAccelerator(s) {
  if (typeof s !== 'string' || !s.trim()) return '';
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const key = parts.pop();
  const mods = new Set();
  for (const p of parts) { const m = MOD_ALIASES[p.toLowerCase()]; if (!m) return ''; mods.add(m); }
  const k = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  if (!KEY_RE.test(k)) return '';
  if (!mods.size || (mods.size === 1 && mods.has('Shift'))) return '';
  return [...MODS.filter((m) => mods.has(m)), k].join('+');
}

function isValidAccelerator(s) { return normalizeAccelerator(s) !== ''; }

const SYM = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };
function acceleratorLabel(s) {
  const n = normalizeAccelerator(s);
  if (!n) return '';
  const parts = n.split('+'); const key = parts.pop();
  const order = ['Control', 'Alt', 'Shift', 'Command'];
  return order.filter((m) => parts.includes(m)).map((m) => SYM[m]).join('') + (key === 'Space' ? '空格' : key);
}

// 设置页录键：KeyboardEvent 字段 → accelerator；只按修饰键返回 ''。
function eventToAccelerator(e) {
  const code = String(e.code || '');
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (code === 'Space') key = 'Space';
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
  if (!key) return '';
  const mods = [];
  if (e.metaKey) mods.push('Command');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return normalizeAccelerator([...mods, key].join('+'));
}

module.exports = { MIN_SIDE, normalizeRect, isTooSmall, barPlacement, cropRect, normalizeAccelerator, isValidAccelerator, acceleratorLabel, eventToAccelerator };
