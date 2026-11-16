# 0003 未签名包走 probe-only + 应用内自更新

## 背景

未签名 macOS 包无法使用 Squirrel.Mac：`autoUpdater.setFeedURL` 会直接抛 `Could not get code signature for running application`，错误处理回调进不去。0.1.2 / 0.1.3 的更新检查因此可能误报「检查失败」。0.1.4 改为直接探测同一 feed；但 0.1.4 / 0.1.5 在探测到新版本后只是打开 GitHub Release 页面，用户仍需手动下载安装。

## 决策

- `setFeedURL` 失败时进入 **probe-only**：直接 `net.fetch` 同一个 update.electronjs.org feed。`204` 表示已是最新；`200` 且含 `name`/`url` 表示有新版本。
- 未签名包不再把 Release 页当更新方案。0.1.6 起，满足条件的 x64 包在应用内：
  1. 校验 feed URL 只能是本仓库的 `v<ver>` / `LanLi-<ver>-mac-x64.zip`；
  2. 下载 zip 与同名 `.zip.sha256`，流式比对 sha256；
  3. 用 `ditto` 解压，用 `plutil` 校验版本与可执行文件；
  4. 暂存并写 `verified.json`；
  5. 用户点「重启更新」后，由静态 `/bin/sh` 脚本等待进程退出、备份、替换、失败回滚并重新打开。
- 任一校验或安装失败回退到同版本 `.dmg`；只有版本无法推导时才打开 latest Release 页。
- 保留 Squirrel 路径：将来有 Developer ID 签名时，`setFeedURL` 成功后仍走 `autoUpdater.quitAndInstall()`。

## 后果

- 官方发布必须同时提供 `.zip` 与 `.zip.sha256`；不能只发 dmg。
- 安装脚本必须保持静态、路径全部位置参数；包文件操作使用 `original-fs`。
- AppTranslocation、不可写目录、arm64、开发态不尝试自更新。
- 0.1.5 及更早需手动安装一次带自更新逻辑的版本。
- 真机上仍可能被系统隐私限制挡住替换，以 `update-install.log` 为准；当前没有检测该权限。

## 相关提交

- `ba31737`：未签名包改为直接查询更新接口，并写入本地日志（probe-only + `logger.js`）。
- `8ec7534`：未签名包支持应用内下载校验并替换更新。
- `8dc3ada`：版本号升至 0.1.7，用于验证应用内更新。

## 相关文档

- [../updater.md](../updater.md)：当前完整行为。
- [../lessons-learned.md](../lessons-learned.md)：踩坑经过。
- [../release.md](../release.md)：发布资产。
