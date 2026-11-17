# 测试

## 运行

```bash
npm test
```

实际执行 `node --test tests/*.test.js`（Node 内置 test runner）。当前共 **118** 个测试，全部通过。测试不依赖 Electron 窗口，可在非 macOS 上运行；但 UI/更新行为仍需真机验收。

## 测试文件与覆盖面

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/calendar.test.js` | 节气（立冬/小雪）、2026-11-11 不显示「光棍节」、源码不含 `getOtherFestivals`、农历初一显示「十月」、初七、2026-11-16 黄历（丙午马年 / 十月 / 十月初八、宜首项纳采、忌首项上梁、可见项数与完整 title）、42 格与周一起始/lead、今日/周末/补齐格/节日标记、菜单栏标题格式（本地语义保持不变） |
| `tests/world-clocks.test.js` | 城市/别名/IANA 回退搜索、按 IANA id 去重与共享时区标签（北京/上海、洛杉矶/旧金山）、DST 按当前时刻的墙上时间（纽约冬夏）、半小时时区（新德里）、UTC 与 +8、`HH:mm` 紧凑时间、相对本地时区的「今天/昨天/明天 · ±N 小时」文案、`addClock`/`removeClock` 增删与索引夹取、`normalizeWorldClocks` 偏好清洗、首次默认北京 vs 显式空列表、非法 id/时刻拒绝；菜单栏显示时区 `resolveMenuBarTimeZone`（未设置/`null`/非法/未知→本地，仍在列表中→保留，`Asia/Kolkata`/`Asia/Calcutta` 别名等同）、删除所选时区后回退并清除持久化值 vs 删除其它时区保持选择、`formatMenuTitleInZone` 固定时刻下的格式/跨区日期翻转（上海次日、纽约前一日）与 UTC/+8、一致通过 `isValidMenuTitle`/`MENU_TITLE_PATTERN` |
| `tests/settings-menu.test.js` | 设置菜单模板的项顺序与分隔线、检查更新右侧版本 sublabel、登录时打开 checkbox 的初始值与会话中回传值、编辑世界时钟/更换天气城市/退出动作分发、`Cmd+Q`、缺失版本与动作时不抛错 |
| `tests/weather.test.js` | 城市码表匹配（精确/加「市」「区」「县」后缀/去后缀/admin1 回退/匹配不到）、无 `country` 旧数据只做精确匹配、itboy（`data.wendu` + `forecast[0].type`）与 wttr.in（`temp_C` + `lang_zh`/`weatherDesc`）解析、itboy/wttr.in/地理编码 URL、ipwho.is 失败时忽略城市、坐标范围与空值校验、地理编码结果解析、天气文字到 emoji 的映射（晴/多云/阴/雨/雪/雷/雾与未知降级）、`weatherCity`（含 `country`/`admin1`）读写与清除、手动城市优先的取位逻辑、itboy 失败回退 wttr.in、非中国直走 wttr.in、`城市 · 天气 · X°C` 格式化与温度取整、`天气位置=手动/IP` 与 `天气来源=itboy（城市 代码）/wttr.in` 日志文案、注入假 `fetch` 的 30 分钟缓存与失败降级、手动/自动切换（不联网） |
| `tests/login-item.test.js` | LaunchAgent plist 的固定 `Label`、`/usr/bin/open -a <当前 .app>` 参数、`RunAtLoad`、XML 转义、空路径拒绝；从 `execPath` 向上定位 `.app`、默认 plist 路径；临时目录下 `enable`/`isEnabled`/`disable` 全流程；非打包模式不写文件；找不到 `.app` 与写/删失败时返回原因并走 logger |
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
| 紧凑窗口是否仍好用 | `580×400` 下 6×7 格是否易点，农历副文案、星期行、右侧「黄历」、世界时钟、天气卡片与右栏底部版本号是否被裁切或出现滚动条 |
| 右侧世界时钟 | `580×400` / 176px 右栏无裁切、`html, body` 无滚动；「黄历」卡片干支生肖年与农历月（如「丙午马年 · 十月」，闰月如「闰六月」）用于左侧顶栏，卡内「宜」「忌」两行小标签与条目完整，单行放不下时省略号截断、悬停 title 显示完整列表，午夜跨天自动刷新；世界时钟卡片一次列出全部城市，每行城市名、`HH:mm` 与「今天/昨天/明天 · ±N 小时」均不溢出，菜单栏显示中的城市带橙色「菜单栏」标签；城市较多时卡片内可滚动，不再有 `‹` / `›`、圆点、`+` / `×`、键盘 `←`/`→` 或滑动手势；「编辑」打开编辑面板后可搜索添加、设为菜单栏、移除，删到空列表显示「尚未添加城市」且重启后不回种；纽约/伦敦夏令时切换前后墙上时间按当前时刻变化，新德里显示半小时时差 |
| 天气卡与城市 | 首次打开窗口时不应出现 macOS 定位权限提示，天气卡片应按 IP 显示 emoji、温度（如 `17°`）与「城市 · 天气」；点击卡片任意位置、标题右侧「更换城市 ›」或设置菜单的「更换天气城市…」应打开城市搜索浮层，首项为「自动（按 IP）」，搜索结果显示「城市名 · 省/州 · 国家」，选中后立即关闭面板并刷新、重启后保留，选「自动」回到 IP；关闭 Wi-Fi/网络或接口超时后仅显示「天气暂不可用」且不弹窗；打开窗口后等待超过 30 分钟再打开应刷新，后台刷新不造成重复请求风暴；右栏无横向溢出，版本号仍在右栏底部 |
| 菜单栏显示时区「设为菜单栏」 | 在编辑面板点击「设为菜单栏」后菜单栏标题立即变为该时区的 `M月D日 HH:mm:ss`（不含时区名/缩写），且每秒按该时区走时；当前项按钮禁用并带「菜单栏」标签。跨日历日场景（本地与所选时区日期不同，如纽约落后一天）菜单栏日期随所选时区正确翻转。添加城市或移除其它城市不会改变菜单栏显示时区。系统时区未被修改；右侧「黄历」与月历今日高亮始终为系统本地。重启及应用内自更新后选择仍保留。删除当前被设为菜单栏显示时区的时钟后立即回退到系统本地时区且不在重启后复现；删除其它时钟不影响选择。 |
| 打包后的更新检查 | 用 0.1.7 安装包升级到后续版本：无更新时自动检查静默；手动检查显示「正在下载…」；下载校验成功后出现「新版本已就绪 / 重启更新」；重启后旧包备份、新包替换并自动打开 |
| 「⚙︎ 设置」菜单 | 点击顶栏「⚙︎ 设置」应在按钮右下方弹出原生菜单并右对齐按钮，按钮橙色高亮；检查更新、登录时打开、编辑世界时钟…、更换天气城市…、退出栏历均可见，`Cmd+Q` 可退出；选择编辑世界时钟或更换天气城市后菜单关闭、窗口保持打开并弹出对应面板；点击窗口外关闭菜单后，指针不在窗口上时仍按 200ms 逻辑收起 |
| 「检查更新」入口 | 设置菜单里的「检查更新」右侧应显示当前版本号，版本号在右栏底部显示真实版本且不被状态文案覆盖；「正在检查…」「正在下载…」「已是最新」「新版本已就绪 / 重启更新」「无法自动更新，请手动下载」「开发态不检查更新」各状态正确；未签名包已是最新时应显示「已是最新」而非「检查失败」 |
| 未签名包自更新 | zip 与 `.zip.sha256` 同时存在；下载失败、摘要不符、plist 版本不符、当前 `.app` 不可写或 AppTranslocation 时回退到同版本 `.dmg`；安装详情看 `update-install.log` |
| `mouse-enter` / `mouse-leave` 是否始终触发 | 若不触发，点击打开兜底应可用，并报告平台与系统版本 |
| 窗口与菜单栏缝隙 | 当前 `y = 托盘.y + 托盘高`；若出现指针可穿过的缝，最多改为 `- 1`（1px 重叠） |
| 未签名包的 `openAtLogin` | 在 macOS 15.7 Intel 未签名包上从「⚙︎ 设置」勾选「登录时打开」后勾选保持开启；`~/Library/LaunchAgents/app.lanli.LanLi.plist` 写入且 `Label`/`ProgramArguments`/`RunAtLoad` 正确，注销或重启后应用自动打开；取消勾选后 plist 删除、重启不再自动打开；日志记录系统 API 拒绝与 LaunchAgent 回退 |
| 标题长度是否挤占菜单栏 | 固定含秒；观察窄菜单栏或刘海下是否拥挤，不要自行去掉秒 |
| Gatekeeper 拦截未签名包 | 按右键打开 /「仍要打开」/ `xattr -cr` 流程实测 |

## 相关文档

- 开发与日志：[development.md](development.md)
- 更新行为：[updater.md](updater.md)
- 编码纪律：[coding-discipline.md](coding-discipline.md)
- 完成标准：[contributing.md](contributing.md)
