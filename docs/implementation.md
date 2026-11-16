# 核心实现走读

本文按模块说明「代码在哪、关键行为、相关测试」。架构分层见 [architecture.md](architecture.md)，更新细节见 [updater.md](updater.md)。

## 1. 日历 / 农历（`electron/calendar.js`）

**入口与范围**

- 构造某一天一律 `Solar.fromYmd(y, m, d)`，再 `solar.getLunar()`；不用带时分秒的构造去对准节气。
- `MIN_YEAR = 1900`、`MAX_YEAR = 2100`。主进程与渲染层都按此范围校验年份。
- `daysInMonth(year, month)` 用 `new Date(year, month, 0).getDate()`。

**42 格网格（`buildCells`）**

- 永远是 6 行 × 7 列 = 42 格，不按「有几周算几周」。
- 周一起始：`weekday = first.getWeek()`（0 = 周日），`lead = weekday === 0 ? 6 : weekday - 1`，起点 `first.next(-lead)`，之后连续 `start.next(i)`。
- `buildCell` 输出：`year/month/day/week/inMonth/isToday/isWeekend/secondaryText/secondaryKind/isJieQi/isFestival`。
- `isToday` 要求该格属于当前浏览月且等于系统本地今天；补齐格不会标今日。
- 周末：`week === 0 || week === 6`。

**次要文字顺序（`secondaryTextFor`）**

1. `lunar.getJieQi()` 非空 → 显示节气。
2. 否则 `solar.getFestivals().concat(lunar.getFestivals())` 取第一个非空字符串（库返回什么就显示什么）。
3. 否则 `lunar.getDay() === 1` → `lunar.getMonthInChinese() + '月'`。
4. 否则 `lunar.getDayInChinese()`。

**禁止**调用 `getOtherFestivals`。因此 2026-11-11 显示农历日（如「初三」），不显示「光棍节」；`tests/calendar.test.js` 还用源码正则确保 `calendar.js` 不出现该调用。

**菜单栏标题（`formatMenuTitle` / `formatMenuTitleInZone`）**

```text
${M}月${D}日 ${HH}:${mm}:${ss}
```

- 月、日不补零：`1月5日` 合法，`01月05日` 不合法。
- 时、分、秒补零：`09:03:07`。
- `electron/calendar.js` 的 `formatMenuTitle(date)` 保持「当前进程本地时区」语义（现有测试不变）。
- 菜单栏实际显示用的时区由世界时钟的「设为当前」决定（见下文）。主进程每秒以及「设为当前」/删除回退后立即用 `electron/world-clocks.js` 的 `formatMenuTitleInZone(now, resolvedMenuBarTimeZone, localTimeZone)` 计算标题并 `tray.setTitle(..., { fontType: 'monospacedDigit' })`；结果仍只含日期时间，不含时区名。默认/未设置/无效时等同本地时区，因此 0.1.8 行为不变。
- `isValidMenuTitle` 与 `MENU_TITLE_PATTERN`（`calendar.js` / `world-clocks.js`）供测试约束格式。

**右侧「此刻」（`buildNow`）**

- `hourMinute`：`HH:mm`（不带秒）。0.1.8 起右栏不再渲染本地 `HH:mm`（菜单栏已有本地时间），但主进程仍返回该字段，`tests/calendar.test.js` 继续约束格式。
- `weekday`：`WEEKDAY_NAMES[solar.getWeek()]`，即 `星期日`…`星期六`。
- `day`：公历日数字，用于右侧黄色日期块。
- `ganzhiYear`：`` `${lunar.getYearInGanZhi()}年【${lunar.getYearShengXiao()}年】` ``。
- `lunarMonthDay`：`` `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}` ``。
- 只由「现在」决定，不随翻月或焦点日变化。

**测试**：`tests/calendar.test.js`（节气、初七/此刻、42 格与 lead、今日/周末/节日标记、菜单栏标题、禁用 `getOtherFestivals`）。

## 2. 世界时钟（`electron/world-clocks.js`）

纯逻辑模块，**不 require Electron**，也不读写文件/网络；`Intl` 的 supported zones、当前时刻、本地时区都由调用方注入，`node --test` 直接 require。它还负责菜单栏显示时区的解析/回退与按指定时区格式化菜单栏标题（同一格式、无时区标识）。

**城市目录与搜索**

- `CITY_CATALOG` 是离线静态表，覆盖北京/上海、东京、首尔、新加坡、香港、台北、曼谷、新德里、迪拜、莫斯科、伦敦、巴黎、柏林、纽约、洛杉矶/旧金山、芝加哥、温哥华、多伦多、悉尼、奥克兰、圣保罗、UTC。
- 一个 IANA id 可以对应多行标签：北京与上海都是 `Asia/Shanghai`，洛杉矶与旧金山都是 `America/Los_Angeles`。**去重按 IANA id**，但添加时保存用户点选那一行的 `label`。
- `searchCatalog(query, { catalog, supportedValuesOf, addedIds })`：先匹配目录的中文标签、别名与 IANA id（下划线按空格处理）。目录无匹配且查询非空时，才用注入的 `Intl.supportedValuesOf('timeZone')` 按 id 或最后一段回退。结果带 `{ id, label, source, added }`；已添加的 id 仍显示但 `added: true`，渲染层禁用。
- `isValidTimeZone(id, supportedValuesOf)` 以 `Intl.DateTimeFormat` 为准；这样 `Asia/Kolkata` 这类被 ICU 规范化为 `Asia/Calcutta` 的别名也能通过，输入列表不会放行未知 id。

**格式化（`formatClock(now, timeZone, localTimeZone)`）**

- 用 `Intl.DateTimeFormat(..., { timeZone, hourCycle: 'h23' })` 取该时区的年月日时分秒与星期，不依赖运行进程的本地时区。
- `time`：`HH:mm:ss`，全部补零；`date`：`M月D日`，月日不补零；`weekday`：`星期一`…`星期日`。
- `dayRelation`：该时区日历日相对**本地日历日**：前一天 `昨天`、后一天 `明天`、同一天为空串（不显示「今天」）。
- `offsetMinutes`：把该时区的墙上时间当作 UTC 与真实时刻相减，再减去本地时区的同一值。因此夏令时按**当前时刻**计算，而不是标准时差。
- `offsetText`：`同本地` / `比本地快 13 小时` / `比本地慢 5 小时 30 分` / `比本地快 45 分`；单位用中文，不出现 `+13`、`UTC+8` 或 `快 0 小时`。

**列表操作**

- 状态形状：`{ items: [{ id, label }], index }`。
- `addClock` 拒绝无效 id 与重复 IANA id；成功时追加并把 `index` 指向新时钟。
- `removeClock` 可按当前项、`{ id }` 或 `{ index }` 删除；删当前项时索引夹到 `length - 1`，删空时 `{ items: [], index: 0 }`，不会偷偷补回默认城市。
- `nextClock` / `prevClock` 首尾绕回；少于两个时钟时什么都不做。`selectClock` 接受 `{ index }` 或 `{ direction: 'prev' | 'next' }`。
- `normalizeWorldClocks(stored, supportedValuesOf)` 丢弃无效/重复 id、清洗 label、夹紧 index。**只有 `stored === undefined`（偏好文件里没有该键）才种入 `北京 / Asia/Shanghai`**；`items: []` 保持空。首次运行默认北京，因为这是中文日历应用，本地时区已由菜单栏显示，默认再显示「同本地」或纽约意义不大。

**菜单栏显示时区（「设为当前」）**

- 偏好键：`preferences.json` 顶层 `menuBarTimeZone`（IANA id 字符串）。省略或 `null` 表示跟随系统本地时区；不要把系统本地时区写死成字符串。
- `resolveMenuBarTimeZone(storedZone, items, localTimeZone)`：`storedZone` 未设置/`null`/非法/未知，或对应时钟已不在 `items` 中时，解析为注入的 `localTimeZone`。`storedZone` 仍在列表中且有效时解析为该 id。
- `normalizeMenuBarTimeZone(...)`：用于持久化——当解析结果等同系统本地（按 `sameTimeZone`，`Intl` 解析别名如 `Asia/Kolkata` / `Asia/Calcutta`）时返回 `null`（跟随系统），否则返回要保存的 id。若偏好是未设置且系统本地恰为某时钟（如 `Asia/Shanghai` 的北京），该时钟已被视为「当前」。
- `nextMenuBarTimeZoneAfterRemove(storedZone, removedId, itemsAfterRemove, localTimeZone)`：删除的时钟是当前菜单栏显示时区（或别名等同）时清除选择并回退到本地；删除其它时钟且选择仍存在时保持不变；选择已不存在时清除。主进程在同一轮 `clocks:remove` 中持久化并刷新托盘标题。
- `formatMenuTitleInZone(date, timeZone, localTimeZone)`：按给定时区输出与 `calendar.formatMenuTitle` 相同的 `M月D日 HH:mm:ss`；`timeZone` 无效时回退本地。可跨日历日（如上海已是次日、纽约仍是前一日），这是预期行为。
- **不改变系统时区，不调用任何系统 API。**「此刻」（`buildNow`）与月历今日高亮（`buildCells` / `isToday`）始终按系统本地日期/时间计算，主进程不会把菜单栏显示时区传给它们。

**持久化**

- 保存在既有 `app.getPath('userData')/preferences.json`（`userData` 在 `.app` 之外，重启与自更新都不会丢）：
  ```json
  {
    "worldClocks": {
      "items": [{ "id": "Asia/Shanghai", "label": "北京" }, { "id": "America/New_York", "label": "纽约" }],
      "index": 1
    },
    "menuBarTimeZone": "America/New_York"
  }
  ```
  跟随系统本地时区时省略 `menuBarTimeZone`（或为 `null`，读取时清理为省略）。
- 启动时 `loadWorldClocks()` 读取并 normalize；只有 `worldClocks` 键缺失时才种入默认北京。`menuBarTimeZone` 若未设置/非法/对应时钟已不在列表中则清除并不再持久化。每次成功 add / remove / select / setMenuBar 后都用既有 `writePreferences` 整体写回；写失败只 warn，不崩溃。
- 渲染层不碰文件、不用 `localStorage`。

**IPC 与渲染层**

- `calendar:getState` / `calendar:setView` / `calendar:goToday` 返回的 state 增加 `clocks: { items, index, menuBarTimeZone, current }`；`menuBarTimeZone` 为解析后的菜单栏显示时区（未设置时为系统本地）；`current` 是已格式化的当前时钟并包含 `isMenuBar`，空列表为 `null`。不下发完整 IANA 列表。
- `calendar:onTick` 每秒发送 `{ now, clocks }`（窗口可见时），`clocks` 与菜单栏标题都按当前时刻重新计算。
- 右栏「世界时钟」卡片只显示一个时区：城市、`HH:mm:ss`、`M月D日 星期X`、昨天/明天徽标、时差文案，以及「设为当前 / 当前」按钮；`‹`/`›` 只切换浏览中的时钟并绕回（不自动改变菜单栏显示时区），少于两个时隐藏箭头。编辑键可增删；`+` 在右栏内部打开搜索浮层，不新建窗口、不调用系统对话框。
- 「设为当前」点击后经 `clocks:setMenuBar` 持久化并立即刷新托盘标题；当前显示时区对应的卡片显示禁用态「当前」。比较按 IANA id 并用 `Intl` 视别名为等同。
- 搜索浮层覆盖 `.now-pane`，列表在浮层内部滚动；已添加项禁用；点选后关闭浮层并显示新时钟。无网络、无定位。
- 键盘 `←` / `→` 在焦点不在 `input` / `select` / `textarea` / contenteditable 时切换（点过箭头按钮后仍可继续用方向键）；卡片上的水平滚轮/触控板 `deltaX` 也切换，并有 350ms 节流。
- 空列表显示「点击 + 添加时区」，隐藏箭头、圆点、`×` 与「设为当前」。`buildNow` / `buildCells` / `isToday` 仍按系统本地时间，不受菜单栏显示时区影响。

**测试**：`tests/world-clocks.test.js`（城市/别名/IANA 回退搜索、重复 id、共享时区标签、DST 冬夏偏移、半小时时区、UTC、同本地、昨天/明天、列表增删/绕回/清洗、首次默认 vs 显式空列表）。

## 3. 托盘与窗口（`electron/main.js`）

**托盘**

- `tray = new Tray(nativeImage.createEmpty())`：纯文字状态项，0×0 空图。`electron/assets/trayTemplate.png` 仍在仓库，但代码未引用。
- 没有 `setContextMenu`，没有 tooltip。
- 事件：
  - `mouse-enter` → `openCalendar()`
  - `mouse-leave` → `scheduleClose()`（200ms 后 `hideCalendar`）
  - `click` → 仅当窗口不可见时打开；已打开不关闭。

**窗口**

- `BrowserWindow`：`width 580`、`height 400`、`frame: false`、`resizable/minimizable/maximizable: false`、`skipTaskbar: true`、`alwaysOnTop: true`、`show: false`、`fullscreenable: false`。
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`；加载 `renderer/calendar.html`。
- `before-input-event` 拦截 Esc → `hideCalendar()`；Esc 只关窗口，不退出应用。
- 每次从隐藏变可见时 `resetViewToToday()`，即浏览年月与焦点日回到系统今天。

**指针与关闭计时**

- 托盘 `mouse-enter` 打开；`mouse-leave` 安排 200ms 关闭。
- 渲染层 `document.documentElement` 的 `mouseenter` → `pointer:enter`，主进程 `cancelClose()`；`mouseleave` → `pointer:leave`，主进程再次 `scheduleClose()`。
- 200ms 是托盘与窗口之间短暂「两边都不在」的缓冲。

**定位（`positionCalendar`）**

- 垂直：`y = trayBounds.y + trayBounds.height`，默认不重叠。若真机出现指针可穿过的缝隙，最多改成 `- 1`（1px 重叠）；不要更多。
- 水平：先让窗口右缘与托盘右缘对齐（`x = bounds.x + bounds.width - WINDOW_WIDTH`）；再钳到当前显示器 `workArea`：左不越界、右不越界。
- `screen` 的 `display-metrics-changed` / `display-added` / `display-removed` 时，如果窗口可见则重新定位。

**退出**

- 唯一入口是底栏「退出栏历」→ preload `quit()` → `app:quit` → `app.quit()`。
- 单实例锁：拿不到锁直接退出；第二实例不弹窗（`second-instance` 为空处理）。

**测试**：托盘/窗口行为目前靠 README 的 macOS 真机项验收，没有自动化 UI 测试。

## 4. 更新（`electron/updater.js` + `electron/mac-self-update.js` + `electron/update-feed.js`）

调用关系：

```text
main.setupUpdates()
  ├─ createMacSelfUpdater(...)       仅在 darwin && isPackaged && arch==='x64' && fetch 时 available
  └─ setupAutoUpdate({ app, autoUpdater, net, selfUpdate, callbacks })
       ├─ 非 darwin 或未打包 → disabled（「开发态不检查更新」）
       ├─ autoUpdater.setFeedURL(...) 成功 → Squirrel 模式
       └─ 抛错（未签名）→ probe-only：net.fetch 同一 feed
            ├─ 204 → up-to-date
            ├─ 200 + name/url → 有更新
            │    ├─ selfUpdate.available → 下载/校验/暂存 → onReady(mode:'ready-self')
            │    └─ 否则 → 手动 DMG 链接 → onManual
            └─ 其他/失败 → error
```

- feed：`https://update.electronjs.org/allen-bot-ctl/lan-li/${platform}-${arch}/${version}`。
- 首次检查在启动约 10 秒后，之后每 6 小时；探测超时 15 秒。
- 自动检查无更新时静默；只有 `manual === true` 的状态才会经 `update:status` 发给渲染进程。
- 手动检查日志：`manual check start`；结束状态为 `up-to-date` / `manual` / `error` 时写 `manual check result: <state>`（`ready` 不在此列）。
- 下载成功：渲染层横幅「新版本已就绪 / 重启更新」。自更新路径的「重启更新」调 `selfUpdater.installReady()`；Squirrel 路径调 `autoUpdater.quitAndInstall()`。
- 失败回退：`fallbackManualUrl` 能从版本号推导时直接给同版本 `.dmg` 直链，否则 `RELEASES_LATEST_URL`。同一版本的手动下载提醒只出现一次（偏好文件 `updateNotifications` 去重）。
- 完整行为与边界见 [updater.md](updater.md)。

**测试**：`tests/updater.test.js`、`tests/mac-self-update.test.js`、`tests/update-feed.test.js`、`tests/update-status.test.js`。

## 5. 日志（`electron/logger.js`）

- 位置：`app.getPath('logs')/main.log`，macOS 上是 `~/Library/Logs/栏历/main.log`。
- 行格式：`${new Date().toISOString()} [level] message`；`level` 为 `info` / `warn` / `error`。
- 同时输出到终端（`console.log/warn/error`）。
- 文件超过 1MB（`DEFAULT_MAX_BYTES = 1024 * 1024`）时，在下次写入前轮转为同目录 `main.old.log`；重命名失败会先删旧文件再试一次。
- 任何文件系统失败都被吞掉：日志不得让应用崩溃；`app.getPath('logs')` 未就绪时下次写入继续重试。
- 安装脚本把步骤写入 `~/Library/Logs/栏历/update-install.log`，与 `main.log` 分开。

**测试**：`tests/updater.test.js` 中的日志测试（ISO 格式、轮转、路径解析失败不抛）。

## 6. IPC 完整清单

以 `electron/preload.js` 与 `electron/main.js` 的 `registerIpc()` 为准：

**invoke（渲染 → 主，返回 Promise）**

| 频道 | preload API | 作用 |
| --- | --- | --- |
| `app:version` | `getVersion` | 返回 `formatVersionLabel(app.getVersion())`，如 `v0.1.9` |
| `calendar:getState` | `getState` | 当前 `view`、`focus`、42 格、`now`、`clocks`（含 `menuBarTimeZone` 与 `current.isMenuBar`）、`openAtLogin` |
| `calendar:setView` | `setView` | 校验并切换浏览年月/焦点日，返回新状态 |
| `calendar:goToday` | `goToday` | 浏览年月与焦点日回到今天，返回新状态 |
| `clocks:add` | `addClock` | `{ id, label? }`；校验/去重后持久化，返回 `clocks` 快照 |
| `clocks:remove` | `removeClock` | 删除当前时钟或 `{ id }`；若删掉菜单栏显示时区则回退本地并刷新托盘；持久化并返回快照 |
| `clocks:select` | `selectClock` | `{ index }` 或 `{ direction: 'prev' \| 'next' }`；持久化并返回快照（不改变菜单栏显示时区） |
| `clocks:setMenuBar` | `setMenuBarClock` | `{ id }`（省略时取当前显示时钟）；校验后将其设为菜单栏显示时区，持久化并刷新托盘标题，返回快照；无效/不在列表中为无操作 |
| `clocks:search` | `searchClocks` | `{ query }`；返回目录 + IANA 回退结果，已添加项带 `added` |
| `login:set` | `setLogin` | 设置登录项并返回读回的真实值 |
| `update:check` | `checkForUpdate` | 立即检查；返回短状态对象 |

**send（渲染 → 主）**

| 频道 | preload API | 作用 |
| --- | --- | --- |
| `pointer:enter` | `pointerEnter` | 取消关闭计时 |
| `pointer:leave` | `pointerLeave` | 安排 200ms 关闭 |
| `app:quit` | `quit` | 退出应用 |
| `update:restart` | `restartToUpdate` | 就绪后重启更新（自更新或 Squirrel） |
| `update:openLatest` | `openLatestRelease` | 打开手动下载地址 |

**send（主 → 渲染）**

| 频道 | preload API | 说明 |
| --- | --- | --- |
| `calendar:onTick` | `onTick` | 每秒发送 `{ now, clocks }`；仅窗口可见时发送，`clocks.current` 按当前时刻重新格式化 |
| `update:notice` | `onUpdateNotice` | `ready` / `manual` 横幅；打开窗口与加载完成时重发 |
| `update:status` | `onUpdateStatus` | 短状态；**仅手动检查**时发送 |

**preload API 全量（19 个）**：`getVersion`、`getState`、`setView`、`goToday`、`addClock`、`removeClock`、`selectClock`、`setMenuBarClock`、`searchClocks`、`onTick`、`pointerEnter`、`pointerLeave`、`setLogin`、`quit`、`onUpdateNotice`、`checkForUpdate`、`onUpdateStatus`、`restartToUpdate`、`openLatestRelease`。

**状态文案（`electron/update-status.js`）**

| state | label | busy | timed |
| --- | --- | --- | --- |
| `checking` | 正在检查… | true | false |
| `downloading` | 正在下载… | true | false |
| `up-to-date` | 已是最新 | false | true |
| `ready` | （空） | false | false |
| `manual` | 需手动下载 | false | true |
| `disabled` | 开发态不检查更新 | false | true |
| `error` | 检查失败 | false | true |

未知或空状态按 `error` 处理（fail closed）。`ready` 的横幅文案在渲染层：「新版本已就绪」「重启更新」；手动失败横幅：「无法自动更新，请手动下载」「下载新版」。`timed` 状态由渲染层约 2600ms 后恢复为「检查更新」。

## 7. 登录项与平台限制

- 首次运行：`initializeLoginItem()` 读 `preferences.json`；若没有 `loginItemInitialized === true`，调用 `app.setLoginItemSettings({ openAtLogin: true })`，然后无论读回什么，都写 `loginItemInitialized: true`。之后启动不再强制打开。
- 开关：`login:set` 调设置后总是 `getLoginItemSettings().openAtLogin` 读回真实值返回，渲染层用返回值覆盖勾选状态。
- 若设置 true 后读回 false：写 `console.warn`（也进日志），不改用 LaunchAgent、login hook、crontab。
- 非 macOS：`dialog.showErrorBox('栏历', '栏历首发只支持 macOS。')` 后 `app.quit()`，不绘制仿菜单栏、不检查更新。

## 8. 底栏版本号（`electron/app-version.js`）

- `formatVersionLabel`：去首尾空白；已有 `v`/`V` 前缀去重；必须以数字开头且只含 `0-9A-Za-z.+-`；否则返回 `''`。
- 渲染层 `loadVersion()` → `app:version`，显示在「检查更新」与「退出栏历」之间，不会被检查状态文案覆盖。

**测试**：`tests/app-version.test.js`。

## 相关文档

- 架构与分层：[architecture.md](architecture.md)
- 更新当前行为：[updater.md](updater.md)
- 测试与真机项：[testing.md](testing.md)
- 踩坑经过：[lessons-learned.md](lessons-learned.md)
