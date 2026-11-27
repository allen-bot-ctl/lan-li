'use strict';

// Short, non-blocking feedback shown next to the always-visible 「检查更新」
// entry. Automatic startup/6-hour checks never emit these to the renderer;
// only a user-triggered check does.
const LABELS = {
  checking: '正在检查…',
  downloading: '正在下载…',
  'up-to-date': '已是最新',
  ready: '',
  disabled: '开发态不检查更新',
  error: '检查失败',
  'download-error': '下载失败',
  'prepare-error': '更新未完成'
};

const BUSY_STATES = new Set(['checking', 'downloading']);
const TIMED_STATES = new Set(['up-to-date', 'disabled', 'error', 'download-error', 'prepare-error']);

function describeStatus(status) {
  const state = status && typeof status.state === 'string'
    ? status.state
    : 'error';

  return {
    state,
    label: LABELS[state] || '',
    busy: BUSY_STATES.has(state),
    timed: TIMED_STATES.has(state)
  };
}

module.exports = {
  LABELS,
  BUSY_STATES,
  TIMED_STATES,
  describeStatus
};
