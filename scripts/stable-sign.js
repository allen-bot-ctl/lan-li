'use strict';
// 0.1.52：electron-builder afterSign 钩子。CI 设了 LANLI_SIGN_IDENTITY 时，
// 用固定的自签证书把 .app 整体重签一遍（在打 dmg/zip 之前），
// 这样 designated requirement 是「identifier + certificate leaf」，升级后屏幕录制授权保留。
// 本地没设这个变量时什么也不做，仍是临时签名。
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function stableSign(context) {
  const id = process.env.LANLI_SIGN_IDENTITY;
  if (!id || context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const args = ['--force', '--deep', '--sign', id, '--timestamp=none'];
  if (process.env.LANLI_SIGN_KEYCHAIN) args.push('--keychain', process.env.LANLI_SIGN_KEYCHAIN);
  execFileSync('codesign', [...args, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`[stable-sign] 已用固定证书重签 ${path.basename(app)}`);
};
