'use strict';

// 通用提示组件：全应用只有一个 #toast，新的替换旧的。
// info/success 3 秒自动消失（悬停暂停）；带按钮、sticky、warning、error 需点 × 关；
// progress 不自动消失，只被下一个状态替换，30 秒无结果走 setToastProgressFallback。
const toast = document.getElementById('toast');
const toastIconPath = document.getElementById('toast-icon-path');
const toastTitle = document.getElementById('toast-title');
const toastDetail = document.getElementById('toast-detail');
const toastAction = document.getElementById('toast-action');
const toastClose = document.getElementById('toast-close');

const TOAST_ICONS = {
  info: 'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14zM9 8.25v4M9 5.75v.01',
  success: 'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14zM5.75 9.25l2.25 2.25 4.25-4.5',
  warning: 'M9 2.5 16 15H2zM9 7.5v3.5M9 13v.01',
  error: 'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14zM6.75 6.75l4.5 4.5M11.25 6.75l-4.5 4.5',
  progress: 'M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14zM9 5.5v6.5M6.25 9.25 9 12l2.75-2.75'
};
const TOAST_AUTO_MS = 3000;
const TOAST_PROGRESS_LIMIT_MS = 30000;

let toastState = null;
let toastDismissTimer = null;
let toastProgressTimer = null;
let toastExitTimer = null;

// 组件不依赖更新逻辑：显示与隐藏时通知订阅者（kind 为提示类型，隐藏时为 null）。
const toastListeners = [];
function onToastChange(fn) {
  toastListeners.push(fn);
}

// progress 超时的兜底提示由使用方注入（更新流程传「检查失败」）。
let toastProgressFallback = null;
function setToastProgressFallback(factory) {
  toastProgressFallback = factory;
}

function clearToastTimers() {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  if (toastProgressTimer) {
    clearTimeout(toastProgressTimer);
    toastProgressTimer = null;
  }
}

function toastAutoDismisses() {
  return Boolean(toastState) && !toastState.sticky && !toastState.action
    && (toastState.type === 'info' || toastState.type === 'success');
}

function scheduleToastDismiss() {
  if (!toastAutoDismisses()) return;
  toastDismissTimer = setTimeout(() => {
    toastDismissTimer = null;
    hideToast();
  }, TOAST_AUTO_MS);
}

function showToast({ type = 'info', title = '', detail = '', action = null, sticky = false } = {}) {
  clearToastTimers();
  if (toastExitTimer) {
    clearTimeout(toastExitTimer);
    toastExitTimer = null;
  }
  const kind = TOAST_ICONS[type] ? type : 'info';
  toastState = {
    type: kind,
    action: action && typeof action.onClick === 'function' ? action : null,
    sticky: sticky === true
  };
  toast.dataset.type = kind;
  toastIconPath.setAttribute('d', TOAST_ICONS[kind]);
  toastTitle.textContent = title;
  toastDetail.textContent = detail || '';
  toastDetail.hidden = !detail;
  toastAction.textContent = toastState.action ? toastState.action.label : '';
  toastAction.hidden = !toastState.action;
  toastClose.hidden = kind === 'progress';
  toast.hidden = false;
  // The enter transition needs a frame with the element laid out first.
  // 这一帧到来前若已被 hideToast 取消（toastState 为空），不要再补 is-visible。
  requestAnimationFrame(() => {
    if (toastState) toast.classList.add('is-visible');
  });
  if (kind === 'progress') {
    toastProgressTimer = setTimeout(() => {
      toastProgressTimer = null;
      if (toastProgressFallback) {
        showToast(toastProgressFallback());
      } else {
        hideToast();
      }
    }, TOAST_PROGRESS_LIMIT_MS);
  } else {
    scheduleToastDismiss();
  }
  for (const fn of toastListeners) fn(kind);
}

// Exit runs the 150ms reverse transition before the element leaves the DOM.
function hideToast() {
  clearToastTimers();
  toastState = null;
  toast.classList.remove('is-visible');
  if (toastExitTimer) clearTimeout(toastExitTimer);
  toastExitTimer = setTimeout(() => {
    toastExitTimer = null;
    if (!toast.classList.contains('is-visible')) toast.hidden = true;
  }, 150);
  for (const fn of toastListeners) fn(null);
}

toast.addEventListener('mouseenter', () => {
  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
});

toast.addEventListener('mouseleave', () => {
  if (!toastDismissTimer) scheduleToastDismiss();
});

toastAction.addEventListener('click', () => {
  if (toastState && toastState.action) toastState.action.onClick();
});

toastClose.addEventListener('click', () => hideToast());
