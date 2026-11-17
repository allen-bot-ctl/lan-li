# 往期经验与教训

只记录 git log 与当前代码能支撑的事实。决策背景见 [decisions/](decisions/README.md)；当前更新行为见 [updater.md](updater.md)。

## 1. 未签名包不能直接用 Squirrel.Mac

**现象**：0.1.1–0.1.2（`acdfd06` 接入 GitHub 自动更新，`549e04c` 增加检查入口）与 0.1.3（`0cea1c7`，尝试修正「已是最新时误报检查失败」）在未签名包上仍可能显示「检查失败」。

**根因**：`autoUpdater.setFeedURL` 在未签名 macOS 应用上直接抛 `Could not get code signature for running application`。异常发生在建立 updater 的阶段，后续的 `'error'` 事件与错误处理根本进不去，所以只补事件处理并不会好。

**处理**：0.1.4（`ba31737`）改为在 `setFeedURL` 失败时进入 probe-only，直接对同一 feed 发 GET；同时新增 `electron/logger.js`，把检查过程写入 `~/Library/Logs/栏历/main.log`。手动检查会留下 `manual check start` 与 `manual check result: ...`。

**教训**：用真机日志复现，不要凭「大概是某个回调没接」做浅层猜测。现在的排查入口就是 [development.md](development.md#日志) 里的两个日志文件。

## 2. feed 的 204 表示「已是最新」，不是失败

**现象**：已是最新时误报「检查失败」。

**根因**：update feed 用 HTTP `204` 表示没有更新；把它当成非 200 的异常状态就会误报。

**处理**：0.1.3 起由 `interpretFeedProbe`（`electron/update-feed.js`）明确语义：`204` → `up-to-date`；`200` 且 JSON 含 `name` 和/或 `url` → 有更新；其余 → `error`。测试在 `tests/update-feed.test.js`。

**教训**：先把协议语义写进纯函数并单测，再谈 UI 文案。

## 3. CI runner：`macos-latest` 的 arm64 队列曾长期等不到

**现象**：Release 工作流曾两次等不到 runner 被取消。

**根因**：`macos-latest` 指向的 arm64 队列不足，而本项目当时只需要 x64 产物。

**处理**：`f5b63c9` 把 `release.yml` 改为 `runs-on: macos-15-intel`。

**教训**：构建目标与 runner 架构要匹配；只发 x64 就不要排 arm64 队列。见 [decisions/0002](decisions/0002-macos-15-intel-runner.md)。

## 4. 不要把用户送到 Release 页当成「更新方案」

**现象**：0.1.4 / 0.1.5 探测到新版本后只是打开 GitHub Release 页面，用户仍要手动下载安装，体验差。

**处理**：0.1.6（`8ec7534`）实现应用内下载 zip、校验 sha256、校验包版本、退出后替换并重新打开；0.1.7（`8dc3ada`）只升版本号以便验证。应用内从 0.1.6 更新到 0.1.7 已在用户的 Intel Mac 上验证通过。

**教训**：更新提示必须给出可执行的下一步；「打开网页」只应作为最后回退。见 [decisions/0003](decisions/0003-unsigned-probe-and-self-update.md)。

## 5. Electron 的 asar 补丁会改写 `fs` 的行为

**现象**：对包路径做递归删除/移动时，普通 `fs` 可能把 `app.asar` 内的路径当成虚拟目录处理。

**根因**：Electron 会补丁 Node 的 `fs`。

**处理**：对 `.app` 及其父目录的文件操作使用 `original-fs`。`electron/main.js` 把 `originalFs` 注入 `createMacSelfUpdater`，文件头有注释说明。

**教训**：凡涉及真实包路径的 `rm/mv/access`，先确认用的是 `original-fs`。见 [coding-discipline.md](coding-discipline.md#外部命令与路径)。

## 6. 分离的安装脚本必须带等待与回滚

**现象**：应用进程尚未退出时直接替换 `.app` 会失败；替换中途失败还可能把用户的应用弄丢。

**处理**：`INSTALL_SCRIPT` 先用 `kill -0` 等待旧 pid（最多 60 秒），再 `mv` 旧包到 `.栏历-backup-<ver>.app`、`mv` 新包到位；任一步失败就恢复备份并用 `open -n` 打开旧包。成功则清 `xattr`、删除备份与暂存、`open -n` 新包。所有步骤写入 `update-install.log`。

**教训**：安装脚本正文保持静态，路径只做位置参数；脚本要能独立于应用进程自证每一步。真机上还可能被系统隐私限制挡住替换，以 `update-install.log` 为准；当前代码没有针对该权限做检测。

## 7. 版本号要显示在界面上

**现象**：升级测试时无法确认当前运行的到底是哪个版本，只能靠关于对话框或猜。

**处理**：0.1.5（`9c15e84`）在底栏「检查更新」旁显示 `v0.1.x`；`app:version` + `formatVersionLabel` 提供真实版本。测试在 `tests/app-version.test.js`。

**教训**：任何涉及升级的验收，界面上必须有可直接读出的版本号。

## 8. 空托盘图标与紧凑窗口

**现象**：用图片做菜单栏图标会额外占宽；`680×470` 的面板对菜单栏弹层偏大。

**处理**：`acdfd06` 改为 `new Tray(nativeImage.createEmpty())` + 纯文字标题，窗口收紧为 `580×400`（左 420 / 右 160）。`trayTemplate.png` 仍在仓库但未引用。

**边界**：macOS/Electron 对纯文字状态项仍有系统级内边距，没有公开 API 可以继续压缩。**不要**为此使用私有 API 或零宽字符。

**教训**：平台限制写进真机验收项，不要用旁路硬压。见 [decisions/0001](decisions/0001-empty-tray-and-compact-window.md)。

## 9. 升版本号时不要全局替换历史版本描述

**事实**：应用内自更新从 0.1.6 起可用；0.1.6 → 0.1.7 的应用内升级已在 Intel Mac 真机验证通过。

**现象**：升版本号时用全局替换把文档里的 `0.1.6` 一并改成 `0.1.7`，连「0.1.5 及更早版本需手动安装一次 0.1.6」这类历史事实也被改错。

**教训**：升版本号只能改指向当前版本的下载链接、示例与 `data-app-version` 等；历史版本描述必须逐处确认。替换后专门检查「手动安装一次」「从 … 升级」等句子。

## 10. 未签名包的登录项需要 LaunchAgent 兜底

**现象**：macOS 15.7（Intel）未签名包中勾选「登录时打开」后，开关立即被读回为未勾选，表现成无法勾选；`app.setLoginItemSettings({ openAtLogin: true })` 本身不抛异常。

**根因**：系统登录项依赖应用签名/身份校验。未签名 bundle 的请求会被系统忽略，`app.getLoginItemSettings().openAtLogin` 一直读回 `false`，所以只看「API 没报错」会误判成功。

**处理**：0.1.11 新增 `electron/login-item.js`，在系统读回仍为 false 时写入本应用自己的 `~/Library/LaunchAgents/app.lanli.LanLi.plist`（`/usr/bin/open -a <当前 .app>`，`RunAtLoad`）；关闭时同时清除系统登录项与该 plist。`getOpenAtLogin()` 返回「系统登录项 || plist 存在」，复选框显示最终真实状态。匹配只在 plist 写/删失败时写入 `logger`。

**教训**：对「设置后还能读回」的平台 API，必须以读回值作为成功判据；兜底方案要限定在本应用自己的文件，且删除路径与写入路径同等重要。

## 11. Electron 不会申请 macOS 定位授权，天气最终改为 IP + 手动城市

**现象**：`navigator.geolocation` 在 macOS 上从不弹授权框，10 秒后超时并静默回退 IP。改用 ad-hoc 签名后，系统只在 locationd 里登记客户端，仍不弹授权；再用 `node-mac-permissions` 原生申请，授权也无法稳定保留。

**根因**：Electron 不会调用 `CLLocationManager` 的 `requestWhenInUseAuthorization`（electron/electron#29314、#45290）。第三方库虽然能触发一次原生申请，但会释放 `CLLocationManager`，授权状态无法按预期保持，继续依赖它只会增加原生依赖和不确定性。

**处理**：放弃系统定位，删除 `node-mac-permissions`、原生授权模块、`NSLocation*` 用途说明和渲染层定位调用。天气默认用 ipwho.is 按 IP 取坐标与城市；点击天气行可搜索并保存手动城市（Open-Meteo 地理编码，`preferences.weatherCity`），有手动城市时直接用其名称与坐标。日志明确写 `天气位置=手动：<城市>` 或 `天气位置=IP：<城市>`。

**教训**：系统授权能力要在真机、目标签名方式下先验证再投入；如果平台 API 不能可靠工作，优先选可预测、可降级的方案，而不是叠加原生补丁。定位来源要写进日志，避免只靠天气请求失败反推。

## 12. Open-Meteo forecast 在部分网络下不可达，选城市交互不能等网络

**现象**：0.1.14（`5944d0c`）用户真机日志显示 `api.open-meteo.com` 连续 10–20 秒无响应（`net::ERR_TIMED_OUT` / aborted），天气一直显示「天气暂不可用」；同一网络下 `t.weather.itboy.net` 0.06–0.46s 返回 200、`wttr.in` 约 1.2s 返回 200，Open-Meteo 地理编码（`geocoding-api.open-meteo.com`）却可用。另外点击城市后浮层要等 `weather:setCity` 的天气刷新结束才关闭，超时表现为「点了没反应」。

**根因**：Open-Meteo forecast 域名在部分用户网络下不可达，而地理编码域名可达——同一个服务不同子域可达性不同，不能假设整个厂商一致；UI 交互链路上把保存城市和网络刷新串成了同一次 invoke。

**处理**：0.1.15 把天气数据源改为国内 itboy 接口（中国城市，用打包的城市码表 `electron/data/china-city-codes.json` 换算城市代码）+ wttr.in（非中国城市与 itboy 失败时回退），去掉 Open-Meteo forecast 与 BigDataCloud 反查，城市搜索仍用 Open-Meteo 地理编码；单源超时 8 秒，主源失败自动回退另一源。`weather:setCity` 保存后立即返回，刷新改为后台执行并经 `weather:update` 推送；渲染层点击列表项立即关闭浮层并显示「城市名 · 加载中…」。日志新增 `天气来源=itboy（上海 101020100）` / `天气来源=wttr.in`。

**教训**：选第三方数据源前先确认目标用户网络下各域名的可达性，只选一条通路时要有可达的回退；任何 UI 点击的反馈都不能排在网络请求之后——先给本地反馈，网络结果异步推送。

## 相关文档

- 当前更新实现：[updater.md](updater.md)
- 真机验收项：[testing.md](testing.md#需要-macos-真机确认的事项)
- 编码红线：[coding-discipline.md](coding-discipline.md)
