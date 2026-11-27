'use strict';
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');

test('应用内重试：超时后各入口重新检查，超过30秒仍可就绪，安装启动失败可恢复', async () => {
  const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
  const app = await electron.launch({ args, env: { ...process.env, LANLI_E2E: '1' } });
  const hook = (name, arg) => app.evaluate((_e, a) => globalThis.__lanliTest[a.name](a.arg), { name, arg });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#grid');
    await hook('trayEnter');
    await page.clock.install();
    await hook('configureUpdateRetryScenario');
    const title = page.locator('#toast-title');
    const action = page.locator('#toast-action');
    const stats = () => hook('updateRetryStats');
    const downloading = async (count) => {
      await expect(title).toHaveText('正在下载新版本');
      await expect.poll(async () => (await stats()).downloads).toBe(count);
      expect((await stats()).feeds).toBe(count);
    };
    const fail = async (reason, text) => {
      expect(await hook('finishUpdateAttempt', { ok: false, reason })).toBe(true);
      await expect(title).toHaveText(text);
      await expect(action).toHaveText('重试');
      expect((await stats()).notice).toBeNull();
      await expect(page.getByRole('button', { name: '下载新版', exact: true })).toHaveCount(0);
    };
    const nativeCheck = async () => {
      await hook('trayRightClick');
      expect(await hook('clickTrayMenuItem', 'tray-check-update')).toBe(true);
    };

    // Scheduled failures stay silent; they do not leave a pending failure notice.
    await hook('checkUpdateAutomatically');
    await expect.poll(async () => (await stats()).downloads).toBe(1);
    await hook('finishUpdateAttempt', { ok: false, reason: 'zip-download-failed: timeout' });
    await expect.poll(async () => (await stats()).state).toBe('download-error');
    await expect(page.locator('#toast')).toBeHidden();
    expect((await stats()).notice).toBeNull();
    await hook('configureUpdateRetryScenario');

    // The UI must not fabricate a timeout during a slow download.
    await page.locator('#check-update').click();
    await downloading(1);
    await page.clock.fastForward(35000);
    await expect(title).toHaveText('正在下载新版本');
    await expect(page.locator('#toast')).toHaveAttribute('data-type', 'progress');
    await fail('zip-download-failed: timeout', '下载失败');
    expect(await page.evaluate(() => typeof window.lanli.openLatestRelease)).toBe('undefined');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'update-in-app-retry.png') });
    await hook('emitUpdateNotice', { mode: 'manual', url: 'https://example.invalid/old-download' });
    await expect(title).toHaveText('下载失败');
    await action.click();
    await downloading(2);
    await page.locator('#check-update').click();
    await downloading(2); // duplicate clicks join the same preparation
    await fail('sha256-mismatch', '更新未完成');
    await expect(page.locator('#toast-detail')).toHaveText('未能验证或准备更新，请重试');

    // Settings is a fresh check after failure, including a prior dismissed toast.
    await page.locator('#toast-close').click();
    await page.locator('#settings-button').click();
    await page.locator('.settings-tab[data-tab="update"]').click();
    await page.locator('#settings-check-update').click();
    await downloading(3);
    await fail('zip-download-failed: timeout', '下载失败');
    await nativeCheck();
    await downloading(4);
    await page.locator('.settings-tab[data-tab="update"]').click();
    await page.clock.fastForward(35000);
    await expect(title).toHaveText('正在下载新版本');
    await hook('finishUpdateAttempt', { ok: true });
    await expect(title).toHaveText('新版本已就绪');
    await expect(action).toHaveText('立即重启');
    await expect(page.locator('#check-update')).toHaveClass(/has-update/);
    await hook('emitUpdateStatus', { state: 'download-error', label: '下载失败' });
    await expect(title).toHaveText('新版本已就绪');
    await expect(page.locator('#settings-update-result')).toContainText('新版本已就绪');
    await page.locator('#toast-close').click();
    await page.locator('.settings-tab[data-tab="update"]').click();
    await page.locator('#settings-check-update').click();
    await expect(title).toHaveText('新版本已就绪');
    expect((await stats()).feeds).toBe(4);
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'update-in-app-ready.png') });

    // A missing staged app cannot leave all entries trapped in cached ready.
    await action.click();
    await expect(title).toHaveText('更新未完成');
    await expect(action).toHaveText('重试');
    await expect(page.locator('#check-update')).not.toHaveClass(/has-update/);
    expect((await stats()).notice).toBeNull();
    await page.locator('#check-update').click();
    await downloading(5);
    await hook('finishUpdateAttempt', { ok: true });
    await expect(title).toHaveText('新版本已就绪');
    await action.click();
    expect((await stats()).installs).toBe(2);
  } finally {
    await app.close();
  }
});
