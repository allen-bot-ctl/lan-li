'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
function actualHandlers() {
  const calls = [];
  const window = {
    visible: false, focused: false, isDestroyed: () => false,
    isVisible() { return this.visible; },
    show() { calls.push('show'); this.visible = true; this.focused = true; },
    showInactive() { calls.push('showInactive'); this.visible = true; },
    focus() { calls.push('focus'); this.focused = true; }
  };
  const inbox = { visible: false, isVisible() { return this.visible; }, attachTray() {} };
  const ctx = vm.createContext({ calendarWindow: window, tray: null, trayMenuOpen: false, trayMenuHold: false,
    settingsViewOpen: false, openSeq: 0, inbox, E2E: true,
    Tray: class extends EventEmitter {}, nativeImage: { createEmpty: () => ({}) },
    cancelClose: () => calls.push('cancelClose'), scheduleClose: () => calls.push('scheduleClose'),
    resetViewToToday: () => calls.push('reset'), positionCalendar: () => calls.push('position'),
    updateClock() {}, sendUpdateNotice() {}, refreshWeather() {},
    weatherRefresher: { onWindowShow: () => true }, openTrayMenu() {},
    sendPanel: (name) => calls.push('panel:' + name), logger: { warn() {} }
  });
  vm.runInContext(source.slice(source.indexOf('function onTrayMouseEnter()'), source.indexOf('function buildTrayMenu()')), ctx);
  vm.runInContext(source.slice(source.indexOf('function openCalendar('), source.indexOf('function hideCalendar()')), ctx);
  vm.runInContext(source.slice(source.indexOf('function openSettingsFromTray()'), source.indexOf('// 0.1.42 A-C10')), ctx);
  vm.runInContext(source.slice(source.indexOf('function openInboxPanel()'), source.indexOf('async function bootstrap()')), ctx);
  ctx.createTray();
  return { ctx, window, inbox, calls };
}

test('actual tray hover shows inactive and repeated hover never activates; click activates an expanded preview', () => {
  const { ctx, window, calls } = actualHandlers();
  ctx.tray.emit('mouse-enter');
  assert.equal(window.visible, true);
  assert.equal(window.focused, false);
  assert.equal(calls.filter((c) => c === 'showInactive').length, 1);
  assert.equal(calls.includes('show'), false);
  assert.equal(calls.includes('focus'), false);
  ctx.tray.emit('mouse-enter');
  assert.equal(window.focused, false);
  assert.equal(ctx.openSeq, 1);
  ctx.tray.emit('click');
  assert.equal(window.focused, true);
  assert.equal(ctx.openSeq, 1, 'activating a visible panel must not reset its calendar view');
  window.visible = false; window.focused = false;
  ctx.tray.emit('click');
  assert.equal(window.focused, true);
  assert.equal(calls.includes('show'), true);
  ctx.tray.emit('mouse-leave');
  assert.equal(calls.at(-1), 'scheduleClose');
});

test('actual explicit settings/inbox entry focuses an existing preview while hover guards stay effective', () => {
  const { ctx, window, inbox, calls } = actualHandlers();
  ctx.trayMenuOpen = true;
  ctx.tray.emit('mouse-enter');
  assert.deepEqual(calls, []);
  ctx.trayMenuOpen = false; inbox.visible = true;
  ctx.tray.emit('mouse-enter');
  assert.deepEqual(calls, []);
  inbox.visible = false;
  ctx.tray.emit('mouse-enter');
  ctx.openSettingsFromTray();
  assert.equal(window.focused, true);
  assert.equal(ctx.settingsViewOpen, true);
  assert.equal(calls.at(-1), 'panel:settings');
  window.focused = false;
  ctx.openInboxPanel();
  assert.equal(window.focused, true);
  assert.equal(calls.at(-1), 'panel:inbox');
});

test('calendar accepts the first mouse click and stays focusable; E2E hooks use the actual tray event path', () => {
  const create = source.slice(source.indexOf('function createCalendarWindow()'), source.indexOf('function onTrayMouseEnter()'));
  assert.match(create, /acceptFirstMouse:\s*true/);
  assert.match(create, /focusable:\s*true/);
  assert.equal(/setFocusable\(false\)/.test(source), false);
  assert.match(source, /trayEnter\(\)\s*\{\s*if \(tray\) tray\.emit\('mouse-enter'\)/);
  assert.match(source, /trayClick\(\)\s*\{\s*if \(tray\) tray\.emit\('click'\)/);
});
