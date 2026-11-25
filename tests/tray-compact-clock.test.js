'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readTrayClockStyle: read, initialTrayClockStyle: initial, nextTrayClockStyle: change} = require('../electron/tray-clock-style');
const {formatCompactTrayClock: face} = require('../electron/world-clocks');
const {composeCompactBitmap: bitmap} = require('../electron/tray-clock-image');

test('旧设置升级保持；三态互斥，关闭任一种不隐式开启另一种', () => {
  const regular = read({});
  assert.deepEqual(regular, {menuBarShowDate:true,menuBarCompactClock:false});
  const plain = read({menuBarShowDate:false});
  assert.deepEqual(plain, {menuBarShowDate:false,menuBarCompactClock:false});
  const compact = change(regular, 'menuBarCompactClock', true);
  assert.deepEqual(compact,{menuBarShowDate:false,menuBarCompactClock:true});
  assert.deepEqual(read(compact),compact);
  assert.deepEqual(change(compact,'menuBarShowDate',true),regular);
  assert.deepEqual(change(compact,'menuBarCompactClock',false),plain);
  assert.deepEqual(change(regular,'menuBarShowDate',false),plain);
  assert.equal(change(regular,'menuBarShowDate','false'),regular);
  assert.deepEqual(initial({},false),compact);
  assert.deepEqual(initial({},true),regular);
  assert.deepEqual(initial({loginItemInitialized:true},true),regular);
  for (const mode of [regular,plain,compact]) assert.deepEqual(initial(mode,true),mode);
});

test('秒、两位日号、周几和 HH:mm 来自同一选择时区，跨周午夜秒数归零', () => {
  const then = new Date('2026-11-01T03:59:59Z'), next = new Date('2026-11-01T04:00:00Z');
  assert.deepEqual(face(then,'America/New_York','UTC'), {seconds:'59',day:'31',weekday:'周六',time:'23:59'});
  assert.deepEqual(face(next,'America/New_York','UTC'), {seconds:'00',day:'01',weekday:'周日',time:'00:00'});
  assert.deepEqual(face(next,'invalid/zone','UTC'), {seconds:'00',day:'01',weekday:'周日',time:'04:00'});
});

test('紧凑位图绿环推进且主题反色，1×/2×保留固定尺寸', () => {
  const mk = (scale,H) => ({H:H*scale,out:Object.fromEntries([...new Set('0123456789:周日一')].map(ch=>[ch,{w:scale,adv:2,a:Array(H*scale*scale).fill(255)}]))});
  const atlas = {1:mk(1,22),2:mk(2,22),compact:{1:mk(1,10),2:mk(2,10)},seconds:{1:mk(1,12),2:mk(2,12)}};
  const data=face(new Date('2026-11-01T03:59:59Z'),'UTC','UTC');
  const a=bitmap(atlas,data,1,false), b=bitmap(atlas,{...data,seconds:'00'},2,true);
  assert.deepEqual([a.W,a.H,b.W,b.H],[82,22,164,44]);
  const green = b => {let n=0;for(let i=0;i<b.buf.length;i+=4) if(b.buf[i+1]>b.buf[i+2] && b.buf[i+1]>b.buf[i] && b.buf[i+3])n++;return n;};
  assert.ok(green(a)>30);
  assert.equal(green(b),0);
  assert.ok(b.buf.includes(244));
});
