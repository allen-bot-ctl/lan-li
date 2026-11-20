'use strict';
// 0.1.42 收纳接纳框：4 个状态（idle/over/success/error），取数后交主进程落盘。
const api = window.lanliDrop;
const box = document.getElementById('dz');
const text = document.getElementById('dz-text');
const sub = document.getElementById('dz-sub');
let depth = 0;

function setState(s) {
  box.dataset.state = s.state;
  text.textContent = s.text;
  sub.hidden = s.state !== 'success';
}

// 拖拽进行中只能看到类型和件数，看不到内容。
function describe(dt) {
  const items = Array.from((dt && dt.items) || []);
  const files = items.filter((i) => i.kind === 'file');
  if (files.length) {
    const imgs = files.filter((f) => /^image\//.test(f.type)).length;
    if (imgs === files.length) return `${files.length} 张图片`;
    if (imgs === 0) return `${files.length} 个文件`;
    return `${files.length} 项`;
  }
  const types = Array.from((dt && dt.types) || []);
  if (types.includes('text/uri-list') && !types.includes('text/html')) return '链接';
  if (types.includes('text/html')) return '图文';
  if (types.includes('text/plain')) return '文字';
  return '';
}

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  depth += 1;
  if (depth === 1) api.enter();
  const d = describe(e.dataTransfer);
  setState({ state: 'over', text: d ? `松开即保存 · ${d}` : '松开即保存' });
});
window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  depth = Math.max(0, depth - 1);
  if (depth === 0) { setState({ state: 'idle', text: '拖到这里，放进收纳' }); api.leave(); }
});
// 取数在 preload 里做（0.1.48），这里只负责界面。
window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; });

box.addEventListener('click', () => { if (box.dataset.state === 'success') api.openInbox(); });
api.onState(setState);
