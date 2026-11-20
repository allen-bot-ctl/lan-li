'use strict';
// 0.1.50 框选层：画框、尺寸、询问条。
(function () {
  const H = window.LanliRegionHelpers;
  const api = window.lanliRegion;
  const rectEl = document.getElementById('rect');
  const sizeEl = document.getElementById('size');
  const bar = document.getElementById('bar');
  let start = null; let rect = null; let phase = 'idle';   // idle | drawing | confirm | done

  function report() { api.state({ phase, rect, bar: phase === 'confirm' ? barPos : null }); }
  let barPos = null;

  function reset() {
    start = null; rect = null; phase = 'idle'; barPos = null;
    document.body.classList.remove('has-rect');
    rectEl.style.display = 'none'; sizeEl.style.display = 'none'; bar.style.display = 'none';
    report();
  }

  function draw(r) {
    document.body.classList.add('has-rect');
    Object.assign(rectEl.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
    sizeEl.textContent = `${r.width} × ${r.height}`;
    sizeEl.style.display = 'block';
    const sh = sizeEl.offsetHeight || 20;
    sizeEl.style.left = r.x + 'px';
    sizeEl.style.top = Math.max(0, r.y - sh - 4) + 'px';
  }

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || phase === 'confirm' || phase === 'done') return;
    start = { x: e.clientX, y: e.clientY }; phase = 'drawing'; rect = null;
  });
  window.addEventListener('mousemove', (e) => {
    if (phase !== 'drawing' || !start) return;
    rect = H.normalizeRect(start.x, start.y, e.clientX, e.clientY);
    draw(rect);
  });
  window.addEventListener('mouseup', (e) => {
    if (phase !== 'drawing' || !start) return;
    rect = H.normalizeRect(start.x, start.y, e.clientX, e.clientY);
    if (H.isTooSmall(rect)) { reset(); return; }   // R-C4 误触
    draw(rect);
    phase = 'confirm';
    bar.style.display = 'flex';
    barPos = H.barPlacement(rect, { width: window.innerWidth, height: window.innerHeight }, { width: bar.offsetWidth, height: bar.offsetHeight });
    bar.style.left = barPos.left + 'px'; bar.style.top = barPos.top + 'px';
    report();
  });
  bar.addEventListener('mousedown', (e) => e.stopPropagation());
  function commit() { if (phase !== 'confirm') return; phase = 'done'; report(); api.commit(rect); }
  function cancel() { phase = 'done'; api.cancel(); }
  document.getElementById('bar-ok').addEventListener('click', commit);
  document.getElementById('bar-redo').addEventListener('click', reset);
  document.getElementById('bar-cancel').addEventListener('click', cancel);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
  api.onReset(() => reset());
  reset();
})();
