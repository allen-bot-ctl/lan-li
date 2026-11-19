const { app, Tray, nativeImage } = require('electron');
const os = require('os');
let trays = [];
let prev = null;
function cpuSnap() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; } return { idle, total }; }
function tick() {
  const used = (os.totalmem() - os.freemem()) / 1024 ** 3;
  const s = cpuSnap(); let pct = 0;
  if (prev) { const dt = s.total - prev.total; pct = dt > 0 ? 100 * (1 - (s.idle - prev.idle) / dt) : 0; }
  prev = s;
  trays[0] && trays[0].setTitle(Math.round(used) + 'G');
  trays[1] && trays[1].setTitle(Math.round(pct) + '%');
  trays[2] && trays[2].setTitle('100%');
}
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  const img = nativeImage.createEmpty();
  for (const n of ['mem', 'cpu', 'bat']) {
    try { const t = new Tray(img); t.setTitle(n); trays.push(t); console.log('TRAY_OK ' + n); }
    catch (e) { console.log('TRAY_FAIL ' + n + ' ' + e.message); }
  }
  console.log('ELECTRON_TRAYS ' + trays.length + '/3');
  tick(); setInterval(tick, 2000);
  setTimeout(() => console.log('ELECTRON_TITLES ' + trays.map(t => JSON.stringify(t.getTitle())).join(' ')), 6000);
});
app.on('window-all-closed', () => {});
