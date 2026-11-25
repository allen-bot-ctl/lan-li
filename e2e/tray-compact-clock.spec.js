'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('macOS 状态栏三种时钟模式、绿环与换日、深浅外观及重启', async ({}, info) => {
  test.skip(process.platform !== 'darwin', '验证 macOS 原生状态项图片');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'lanli-tray-compact-'));
  let app;
  const hook = async (name,arg) => {
    for (let i=0;;i++) {
      try { return await app.evaluate((_e, data)=>globalThis.__lanliTest[data.name](data.arg),{name,arg}); }
      catch(e) { if (i===2 || !/garbage collected/.test(String(e))) throw e; }
    }
  };
  const launch = async () => {
    app = await electron.launch({args:['.'],env:{...process.env,LANLI_E2E:'1',LANLI_E2E_TRAY_IMAGE:'1',
      LANLI_E2E_USER_DATA_DIR:path.join(dir,'prefs'),LANLI_INBOX_DIR:path.join(dir,'inbox'),LANLI_READER_DIR:path.join(dir,'reader')}});
    const page=await app.firstWindow();
    await page.waitForFunction(()=>document.readyState==='complete' && typeof window.openSettingsView==='function');
    await hook('showWindow');
    return page;
  };
  const state = () => hook('trayClockFrame');
  const read = (page,id) => page.locator('#'+id);
  const tap = (page,id) => page.locator('label.settings-row').filter({has:read(page,id)}).locator('.switch-track').click();
  const date='setting-show-date', compact='setting-compact-clock';
  const openSettings = async page => {
    await page.locator('#settings-button').click();
    await expect(read(page,date)).toBeVisible();
  };
  try {
    let page=await launch();
    await hook('setNow','2026-10-31T23:59:59');
    await openSettings(page);
    await expect(read(page,date)).toBeChecked();
    await expect(read(page,compact)).not.toBeChecked();
    await tap(page,compact);
    await expect(read(page,compact)).toBeChecked();
    await expect(read(page,date)).not.toBeChecked();
    await expect.poll(async () => (await state())?.face).toEqual({seconds:'59',day:'31',weekday:'周六',time:'23:59'});
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});
    await expect.poll(async () => (await state())?.dark).toBe(true);
    const dark=await state();
    const image=Buffer.from(dark.png,'base64');
    expect(image.readUInt32BE(16)).toBe(154);
    expect(image.readUInt32BE(20)).toBe(44);
    expect(dark.title).toBe('');
    fs.writeFileSync(info.outputPath('tray-compact-dark.png'),image);
    await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});
    await expect.poll(async () => (await state())?.dark).toBe(false);
    const light=await state();
    expect(light.png).not.toEqual(dark.png);
    fs.writeFileSync(info.outputPath('tray-compact-light.png'),Buffer.from(light.png,'base64'));
    await hook('setNow','2026-11-01T00:00:00');
    await expect.poll(async () => (await state())?.face).toEqual({seconds:'00',day:'01',weekday:'周日',time:'00:00'});

    await app.close(); app=null; page=await launch();
    await openSettings(page);
    await expect(read(page,date)).not.toBeChecked();
    await expect(read(page,compact)).toBeChecked();
    await tap(page,date);
    await expect(read(page,date)).toBeChecked();
    await expect(read(page,compact)).not.toBeChecked();
    await expect.poll(()=>hook('trayTitle')).toMatch(/月\d+日 \d{2}:\d{2}:\d{2}$/);
    await tap(page,date);
    await expect(read(page,date)).not.toBeChecked();
    await expect(read(page,compact)).not.toBeChecked();
    await expect.poll(()=>hook('trayTitle')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  } finally {
    if (app) await app.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
