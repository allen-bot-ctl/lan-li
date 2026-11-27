# 更新子系统（当前行为）

本文描述代码**现在**怎么工作，供实现对照。历史经过与教训见 [lessons-learned.md](lessons-learned.md#1-未签名包不能直接用-squirrelmac)；决策见 [decisions/0003](decisions/0003-unsigned-probe-and-self-update.md)。

## 入口与模块

| 文件 | 职责 |
| --- | --- |
| `electron/main.js` | 创建自更新器、调用 `setupAutoUpdate`、把回调转成 IPC、处理「重启更新」 |
| `electron/updater.js` | 选择 probe-only / disabled，调度检查，解释结果，决定 ready/error/download-error/prepare-error |
| `electron/mac-self-update.js` | 校验 URL、下载、sha256、解压、plist 校验、暂存、安装脚本 |
| `electron/update-feed.js` | feed URL 拼接、`204`/`200` 语义 |
| `electron/update-status.js` | 手动检查短文案 |
| `electron/logger.js` | `main.log` 与轮转 |

## 运行模式

1. **disabled**：`platform !== 'darwin'` 或 `app.isPackaged !== true`。手动检查返回「开发态不检查更新」；不联网。
2. **probe-only**：darwin 且已打包时**一律**进入。ad-hoc 签名的包无法通过 Squirrel.Mac 的签名校验，所以不再调用 `autoUpdater.setFeedURL`，而是直接 `net.fetch` 同一个 feed。记录 `macOS 未正式签名，使用 probe-only`。

## feed 与调度

```text
https://update.electronjs.org/allen-bot-ctl/lan-li/${platform}-${arch}/${version}
```

- 例：Intel Mac 上的 `0.1.7` → `https://update.electronjs.org/allen-bot-ctl/lan-li/darwin-x64/0.1.7`。
- 请求头：`User-Agent: LanLi/<version> (<platform>: <arch>)`；`cache: 'no-store'`。
- 首次检查：启动约 **10 秒**后；之后每 **6 小时**。
- 探测超时：**15 秒**（`FEED_TIMEOUT_MS`）。
- 自动检查无更新时**完全静默**：`updater` 会产出状态，但 `main.js` 只把 `manual === true` 的状态发给渲染进程。
- 自动检查若下载到新版本，仍会通过 `update:notice` 在窗口打开时用 `showToast` 显示「新版本已就绪」提示。

## 探测结果语义

| feed 响应 | 结果 |
| --- | --- |
| `204` | 已是最新（`up-to-date`） |
| `200` + JSON 含 `name` 和/或 `url` | 有新版本（`manual` 候选） |
| `200` 但 JSON 无效 / 无 name 与 url | `error` |
| 其他状态、网络失败、JSON 解析失败 | `error` |

并发的手动点击共享同一个进行中的 probe（`probePromise`），整轮检查及下载只产生一次最终状态；自动检查中加入手动请求会转为手动反馈。

## 自更新是否可用

`createMacSelfUpdater` 的 `available` 仅在以下全部成立时为 true：

- `platform === 'darwin'`
- `isPackaged === true`
- `arch === 'x64'`
- 注入了可用的 `fetch`

否则不准备更新，手动请求显示「更新未完成 / 重试」；自动失败保持静默。

## 更新 URL 校验

feed 中的 `url` 必须严格满足：

```text
https://github.com/allen-bot-ctl/lan-li/releases/download/v<ver>/LanLi-<ver>-mac-x64.zip
```

逐项要求：

- 协议必须是 `https:`。
- host 必须恰为 `github.com`，`port` 为空，无用户名/密码，无 query/hash。
- 路径恰好 6 段：`allen-bot-ctl` / `lan-li` / `releases` / `download` / `v<ver>` / 文件名。
- tag 必须匹配 `^v(\d+\.\d+\.\d+)$`；文件名必须匹配 `^LanLi-(\d+\.\d+\.\d+)-mac-(x64|arm64)\.zip$`，且 tag 与文件名版本一致。
- 资产与运行架构都必须是 `x64`；arm64、其他仓库、其他域名、其他文件名一律拒绝。
- 版本必须是严格 `\d+\.\d+\.\d+`，且**大于**当前 `app.getVersion()`。

## 下载与校验

1. `fetch(url, { redirect: 'follow', cache: 'no-store' })` 下载 zip。
2. 同时下载 `${url}.sha256`。
3. 流式计算 zip 的 sha256（无法流式时退回整块 buffer）。
4. 超过 **500 MB**（`MAX_DOWNLOAD_BYTES`）中止：先看 `content-length`，流式过程中再累计一次。
5. `.sha256` 内容为单行 64 位十六进制，可带 `*` 与文件名（`shasum -a 256` 输出）。若带文件名，必须与 zip 完全一致。
6. 缺校验文件、文件名不符、摘要不一致、空下载、超限 → 本轮失败，提供应用内重试。

## 解压与包校验

- `/usr/bin/ditto -x -k <zip> <staging>` 解压。
- 暂存目录顶层必须**恰好有一个** `.app`。
- `/usr/bin/plutil -extract CFBundleShortVersionString raw -o - <Info.plist>` 必须等于目标版本。
- `/usr/bin/plutil -extract CFBundleExecutable raw -o - <Info.plist>`：名称不能为空、不能含 `/` 或 `\`、不能是 `.` / `..`，且 `Contents/MacOS/<name>` 必须存在。
- `/usr/bin/xattr -cr <newApp>` 清隔离属性；失败只记日志，不阻断。
- 全部通过后写 `verified.json`（含 `version`、`verifiedAt`、`app`），删除 zip。

## 暂存、复用与并发

- 暂存目录：当前 `.app` 同级的 `.栏历-update-<version>/`。
- 每次准备前清理同级的**其他**旧 `.栏历-update-*` 目录。
- 若已有同版本 `verified.json` 且其中的 `.app` 重新校验通过，直接复用，不重复下载。
- 同一时间只跑一个自更新任务：并发 `start()` 返回同一个 Promise，后到的调用者等同一结果。

## 「重启更新」与安装脚本

前提：`updateNotice.mode === 'ready'`。当前 macOS 只有自更新路径，「重启更新」调用 `selfUpdater.installReady()`。

`installReady()` 的步骤：

1. 要求内存中已有 `lastReady`，且暂存的 `newApp` 存在、日志目录可解析。
2. 把**静态** `/bin/sh` 脚本写到暂存目录的 `update-install.sh`（mode `0700`）。
3. 备份路径：`.栏历-backup-<version>.app`。先尽力删除可能残留的同名备份，避免 `mv` 把当前包移进旧备份目录。
4. 以 detached 方式 `spawn('/bin/sh', [script, pid, bundle, newApp, backup, staging])`，stdout/stderr 追加到 `~/Library/Logs/栏历/update-install.log`，父进程 `unref()`。
5. 调用注入的 `quit()`：`app.quit()`，3 秒后若仍未退出则 `app.exit(0)`。

脚本正文是常量，**所有路径都是位置参数**，不插入脚本正文：

```text
$1 pid  $2 当前 .app  $3 新 .app  $4 备份路径  $5 暂存目录
```

脚本行为：

- `kill -0 "$PID"` 等待旧进程退出，最多 60 秒；超时则不动旧包，`exit 1`。
- `mv "$BUNDLE" "$BACKUP"`；失败则 `open -n` 旧包并 `exit 1`。
- `mv "$NEW_APP" "$BUNDLE"`；失败则把备份移回、`open -n` 旧包、`exit 1`。
- 成功：`xattr -cr`、删除备份与暂存、`open -n` 新包。
- 每一步带时间戳写入 `update-install.log`，关键字前缀 `update-install:`。

真机上还可能被系统隐私限制挡住替换；当前代码没有检测该权限，以 `update-install.log` 为准。

## 失败与应用内重试

- feed 超时或失败显示「检查失败 / 重试」；zip/校验文件传输失败显示「下载失败 / 重试」；URL、摘要、包、本地权限或安装准备失败显示「更新未完成 / 重试」。只在用户主动检查或重试时反馈；自动检查失败不弹提示。
- 不生成手动下载通知、不记录失败去重偏好，也不通过浏览器打开 DMG 或 Release。移除 `update:openLatest` 和对应 preload 方法。
- 失败结束后释放整轮任务；重试按钮、顶栏、设置页及原生菜单下一次点击均重新请求 feed，按需重新下载/校验。不自动重试，不增加备用传输。
- 正在检查或下载时的重复请求共用同一任务；已确认 ready 时保留重启提示。旧的失败/进度消息不覆盖已就绪状态；旧的手动下载通知被忽略。
- 更新专用 progress 不使用通用 toast 的 30 秒界面兜底；真实网络与校验结果决定成功或失败。其他通用 progress 仍有 30 秒兜底。
- `installReady()` 若无法启动（如暂存包缺失、spawn 失败），清除 main/updater/renderer 的 ready 缓存和橙点，回到应用内重试，允许重新准备。原有 URL、架构、版本、checksum、bundle 校验与安装脚本保持。

## 将来有签名时

当前代码没有 Squirrel 路径（macOS 一律 probe-only）。若将来拿到 Developer ID 签名并公证，需要重新加回 `autoUpdater.setFeedURL`、`'update-downloaded'` 等监听与 `autoUpdater.quitAndInstall()` 的「重启更新」分支，并按签名能力切换模式。

## 升级路径与文档口径

- **0.1.5 及更早**没有应用内自更新，必须手动下载并安装一次 **0.1.6**。
- 从 0.1.6 起支持应用内自更新；0.1.6 → 0.1.7 已在 Intel Mac 真机验证通过。
- `README.md`、`site/index.html` 与 Release body 统一按上述口径说明。

## 相关测试

- `tests/update-feed.test.js`：URL 拼接与 204/200/错误。
- `tests/updater.test.js`：probe-only 模式、200 手动提醒、网络失败、并发共享、日志轮转。
- `tests/mac-self-update.test.js`：URL/版本/架构校验、sha256、包校验、暂存复用、并发、安装脚本、probe→self-update 流程。
- `tests/update-status.test.js`：状态文案与计时标志。

## 相关文档

- 实现走读：[implementation.md](implementation.md#4-更新electronupdaterjs-electronmac-self-updatejs-electronupdate-feedjs)
- 历史教训：[lessons-learned.md](lessons-learned.md)
- 发布资产：[release.md](release.md)
- 真机验收：[testing.md](testing.md#需要-macos-真机确认的事项)
