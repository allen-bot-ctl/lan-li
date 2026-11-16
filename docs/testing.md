# 测试

## 运行

```bash
npm test
```

实际执行 `node --test tests/*.test.js`（Node 内置 test runner）。当前共 **71** 个测试，全部通过。测试不依赖 Electron 窗口，可在非 macOS 上运行；但 UI/更新行为仍需真机验收。

## 测试文件与覆盖面

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/calendar.test.js` | 节气（立冬/小雪）、2026-11-11 不显示「光棍节」、源码不含 `getOtherFestivals`、农历初一显示「十月」、初七与右侧「此刻」、42 格与周一起始/lead、今日/周末/补齐格/节日标记、菜单栏标题格式 |
| `tests/world-clocks.test.js` | 城市/别名/IANA 回退搜索、按 IANA id 去重与共享时区标签（北京/上海、洛杉矶/旧金山）、DST 按当前时刻计算偏移（纽约冬夏）、半小时时区（新德里）、UTC 与 +8、同本地、昨天/明天、`addClock`/`removeClock`/`nextClock`/`prevClock` 增删与绕回、`normalizeWorldClocks` 偏好清洗、首次默认北京 vs 显式空列表、非法 id/时刻拒绝 |
| `tests/app-version.test.js` | `v` 前缀添加与去重、大小写、首尾空白、非法输入降级为空串、永不抛错 |
| `tests/update-feed.test.js` | feed URL 拼接、owner/repo/server 覆盖、缺参数抛错、`204` → up-to-date、`200` payload → manual、其他状态 → error |
| `tests/update-status.test.js` | 各状态文案、`busy`/`timed` 标志、`ready` 恢复入口、未知/null 按 error |
| `tests/updater.test.js` | `setFeedURL` 抛错进入 probe-only、204 与 200 结果、网络失败、并发手动检查共享 probe、Squirrel 错误回落、`checkForUpdates` 同步抛错回落、日志 ISO 格式与 `main.old.log` 轮转、日志路径失败不抛 |
| `tests/mac-self-update.test.js` | URL 校验（host/repo/scheme/文件名/版本/架构）、semver、DMG 直链、sha256 解析、bundle 路径与 AppTranslocation/不可写、完整下载校验解压复用、sha 缺失/不符/文件名不符、plist 版本与可执行文件校验、500MB 上限、并发只跑一个任务、安装脚本静态/位置参数/`sh -n`、`installReady` 参数与日志、probe-only → downloading → ready、自更新失败 → 手动 DMG |

日志轮转测试在 `tests/updater.test.js` 中，不单独建 `logger.test.js`。

## 写测试的约束

- 统一使用 `node:test` + `node:assert/strict`；不新增测试框架。
- **禁止真实网络**：注入假的 `fetch` / `net.fetch`，返回构造好的 `status` / `json` / `text` / `arrayBuffer`。
- **禁止碰真实 `/Applications`**：用 `fs.mkdtempSync` 建临时目录，`t.after` 清理；假 bundle 只需要 `Contents/MacOS/<name>` 与 `Info.plist`。
- 外部命令必须注入：`execFile` / `spawn` 用假实现记录调用，不真的运行 `ditto`、`plutil`、`xattr`。
- 时间与「今天」用固定日期（如 `new Date(2026, 10, 15)`），不要依赖运行时的真实日期。
- 纯逻辑模块应可在没有 Electron 的情况下 require；`logger.js` 的日志路径必须可注入。
- 新增行为先补纯函数测试，再改主进程/渲染层；更新相关改动同时检查 [updater.md](updater.md)。

## 需要 macOS 真机确认的事项

以下来自 `README.md` 的「需要 macOS 真机确认」，不能在云主机上替代：

| 事项 | 说明 |
| --- | --- |
| 菜单栏是否只剩文字 | 空 `NativeImage` 创建的 `Tray` 是否只显示日期时间，图标位置不再占宽 |
| 标题左右边距 | 系统级内边距是否可接受；没有公开 API 可继续压缩 |
| 紧凑窗口是否仍好用 | `580×400` 下 6×7 格是否易点，农历副文案、星期行、右侧「此刻」、底栏是否被裁切或出现滚动条 |
| 右侧世界时钟 | `580×400` / 160px 右栏无裁切、`html, body` 无滚动；「此刻」压缩后星期、干支年【生肖】、农历月日完整；世界时钟的城市、`HH:mm:ss`、`M月D日 星期X`、昨天/明天徽标、时差文案都不溢出；`+` / `×` / `‹` / `›` 在 160px 内可点。添加、绕回切换（含键盘 `←`/`→` 与卡片横向滑动）、删到空列表显示「点击 + 添加时区」且重启后不回种；重启后列表与当前索引仍在；纽约/伦敦夏令时切换前后时差按当前时刻变化，新德里显示半小时偏移 |
| 打包后的更新检查 | 用 0.1.7 安装包升级到后续版本：无更新时自动检查静默；手动检查显示「正在下载…」；下载校验成功后出现「新版本已就绪 / 重启更新」；重启后旧包备份、新包替换并自动打开 |
| 「检查更新」入口 | 底栏入口、版本号、退出是否始终可见；版本号显示真实版本且不被状态文案覆盖；「正在检查…」「正在下载…」「已是最新」「新版本已就绪 / 重启更新」「无法自动更新，请手动下载」「开发态不检查更新」各状态正确；未签名包已是最新时应显示「已是最新」而非「检查失败」 |
| 未签名包自更新 | zip 与 `.zip.sha256` 同时存在；下载失败、摘要不符、plist 版本不符、当前 `.app` 不可写或 AppTranslocation 时回退到同版本 `.dmg`；安装详情看 `update-install.log` |
| `mouse-enter` / `mouse-leave` 是否始终触发 | 若不触发，点击打开兜底应可用，并报告平台与系统版本 |
| 窗口与菜单栏缝隙 | 当前 `y = 托盘.y + 托盘高`；若出现指针可穿过的缝，最多改为 `- 1`（1px 重叠） |
| 未签名包的 `openAtLogin` | 首次运行后开关是否真的打开；若系统拒绝，开关显示真实值并在日志中报告 |
| 标题长度是否挤占菜单栏 | 固定含秒；观察窄菜单栏或刘海下是否拥挤，不要自行去掉秒 |
| Gatekeeper 拦截未签名包 | 按右键打开 /「仍要打开」/ `xattr -cr` 流程实测 |

## 相关文档

- 开发与日志：[development.md](development.md)
- 更新行为：[updater.md](updater.md)
- 编码纪律：[coding-discipline.md](coding-discipline.md)
- 完成标准：[contributing.md](contributing.md)
