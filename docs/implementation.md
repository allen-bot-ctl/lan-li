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
- 菜单栏实际显示用的时区由世界时钟编辑面板的「设为菜单栏」决定（见下文）。主进程每秒以及「设为菜单栏」/删除回退后立即用 `electron/world-clocks.js` 的 `formatMenuTitleInZone(now, resolvedMenuBarTimeZone, localTimeZone)` 计算标题并 `tray.setTitle(..., { fontType: 'monospacedDigit' })`；结果仍只含日期时间，不含时区名。默认/未设置/无效时等同本地时区，因此 0.1.8 行为不变。
- `isValidMenuTitle` 与 `MENU_TITLE_PATTERN`（`calendar.js` / `world-clocks.js`）供测试约束格式。

**右侧「黄历」（`buildAlmanac`）**

- 右栏顶部为黄历卡片，高度 118px（内容四行）；卡内不再重复大字干支年。标题行右侧为固定 57px 的叠放槽（标题可用宽度 66px、间距 4px）：平时显示下一个节气倒计时，悬停/聚焦时与「去定制 ›」120ms 交叉淡入淡出。
- `ganZhiText`：`` `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年` ``，如 `丙午马年`；`lunarMonthText` 为 `getMonthInChinese() + '月'`，闰月自然带出 `闰六月`。两者用于左侧顶栏的灰色小字「丙午马年 · 十月」。
- `lunarDayText`：`` `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}` ``，如 `十月初九`，作为卡片标题行风格名的悬停 title（前缀「农历」）与「今日黄历」面板标题。
- `rawYi` / `rawJi` 保存 `lunar.getDayYi()` / `getDayJi()` 的完整原词数组（`.map(String)`，不传 `sect`）。`yi` / `ji` 是逐词映射并按映射后文案去重后的完整列表，规则与 0.1.20 相同。
- 焦点词 `focusYi` / `focusJi`：各为 `{ term, text, title, hint }`。`term` 是按百年稀有度选出的原词（只对原词计算，与风格无关，算法见下文「焦点数据」）；`text` 为风格文案（`lunar` 即原词）；`title` 为 `lunar` 的原词，其它风格为「文案（原词）」；`hint` 为面板用稀有度提示（特殊词或数据不可用时为空串）。
- `quote`：按 `getZhiXing()` 从随包签语表取当前风格的一句；`metaText`：`` `${getDayInGanZhi()}日 ${节气或值星} 冲${getDayChongShengXiao()}煞${getDaySha()}` ``，所有风格相同。
- `termCountdown`：`{ name, days, text }`，与风格无关。今天交节时 `{ name: getJieQi(), days: 0, text: '今日X' }`；否则取 `getNextJieQi(true)`（24 节气全算），按库给出的节气公历日与 `Solar.fromYmd(本地年, 本地月, 本地日)` 相减：1 天写「X 明天」，否则写「X N天后」（半角空格、阿拉伯数字不补零）。只在 `solar` 本地日历日上计算，交节时刻与本机时区不影响结果；随每秒 tick 下发，跨午夜自动换日。
- `detail`：`{ yiItems, jiItems, zhiXing, tianShen, tianShenLuck, chongText, pengZu }`。「今日黄历」面板用：`yiItems` / `jiItems` 在 `lunar` 下为原词列表，其它风格为映射去重后的「文案（原词）」数组；`chongText` 为 `` `冲${生肖}（${干支}）煞${sha}` ``；`pengZu` 为 `[getPengZuGan(), getPengZuZhi()]`。
- 已删除：`yiText`、`jiText`、`yiTitle`、`jiTitle` 与常量 `ALMANAC_MAX_ITEMS`（0.1.20 的「前 6 项 + 悬停全文」规则撤除）。
- `styleId` / `styleName` / `accentLight` / `accentDark` 随结果下发，供卡片标题、主题色与风格面板使用。只由「现在」与 `styleId` 决定，不随翻月或焦点日变化；`calendar:onTick` 每秒重算，跨天（午夜）自动刷新。数据全部来自 lunar-javascript 离线计算，不接网络。
- 风格表由 `electron/almanac-styles.js` 在主进程启动时同步读取 `electron/data/almanac-styles/{coder,worker,student,fitness}.json` 并缓存；`lunar` 是主进程常量与恒等映射。文件读取失败、`schemaVersion !== 1` 或 `id` 与文件名不符时，该风格仍使用常量表中的名称、徽标与颜色，但映射退化为原词，并写一条 logger 警告。
- 焦点数据 `electron/data/almanac-focus.json` 由 `electron/almanac-focus.js` 在同一处启动流程同步读取一次并缓存，结构见第 5 节。任何读取/结构问题都只写一条 logger 警告，全部词按 `36525` 计分、签语与提示为空，不影响卡片其它内容。
- 偏好键 `preferences.json` 顶层 `almanacStyle`：只接受 5 个风格 id；缺失、类型不对或未知值一律按 `lunar` 处理，且不回写。仅在用户选中非当前风格时写入，保留其它键。
- 渲染层「黄历」卡片显示四行：宜行 / 忌行（`#almanac-focus-yi`、`#almanac-focus-ji`，14px 加粗、单行、不设 `text-overflow`）、签语行 `#almanac-quote`、底注行 `#almanac-meta`。标题行 `#almanac-term-countdown` 与 `#almanac-customize` 同放在 `.card-swap.almanac-head-swap` 的同一网格格子里：倒计时 `opacity: 1`，悬停/聚焦黄历卡时变 0；「去定制 ›」沿用 0.1.22 的默认 `opacity: 0` + `pointer-events: none` 与悬停/聚焦显示规则；两者都带 120ms opacity 过渡，槽宽 `flex: 0 0 57px`、`justify-items: end`，标题行 `gap: 4px`（标题可用宽度 66px）。点击整张卡片（`#almanac-customize` 除外，倒计时不拦截点击）打开「今日黄历」面板；「去定制 ›」仍打开黄历风格面板。

**测试**：`tests/calendar.test.js`（节气、初七、2026-11-16 黄历「丙午马年 / 十月 / 十月初八 / 纳采 / 上梁」、42 格与 lead、今日/周末/节日标记、菜单栏标题、禁用 `getOtherFestivals`）；`tests/almanac-styles.test.js`（114 词表与四份映射完全相等、文件 schema、兜底、去重、确定性、默认兼容、偏好清洗、4 个日期 × 5 种风格选词一致）；`tests/almanac-focus.test.js`（数据 sha256/结构、36525 天稀有度复算、60 条签语、7 个固定日期、确定性、2026 相邻不重复、特殊词与平局、降级、不联网、不截断）；`tests/term-countdown.test.js`（18 行期望表、同日首尾时刻/重复/5 风格一致、1900–2100 全量扫描、节与气、CSS 槽宽与交叉淡入、DOM 叠放、preload/IPC 基线不变、不联网）。

**焦点数据（`electron/data/almanac-focus.json`，`electron/almanac-focus.js`）**

```json
{
  "schemaVersion": 1,
  "source": { "library": "lunar-javascript", "version": "1.7.8", "range": "2000-01-01..2099-12-31", "days": 36525 },
  "rarity": { "yi": { "雇佣": 49, "祭祀": 23312, "…": "共 110 键" }, "ji": { "取渔": 48, "安葬": 13792, "…": "共 86 键" } },
  "zhiXingOrder": ["建","除","满","平","定","执","破","危","成","收","开","闭"],
  "quotes": { "lunar": { "建": "万物始生 宜开新局", "…": "共 12 键" }, "coder": { "…": "共 12 键" }, "worker": { "…": "共 12 键" }, "student": { "…": "共 12 键" }, "fitness": { "…": "共 12 键" } }
}
```

- `rarity.yi[term]` / `rarity.ji[term]`：2000-01-01 至 2099-12-31（含两端，本地日历日，36525 天）中该词出现在当日宜/忌列表里的天数；宜 110 键、忌 86 键。数据由策划离线产出，实现仓库逐字节复制，不修改任何字节。
- `zhiXingOrder`：`建除满平定执破危成收开闭`。`quotes[styleId][值星]`：5 个风格 × 12 条原创签语，宽度 ≤20。
- 加载：`loadAlmanacFocus({ file, logger })` 在启动时用 `fs.readFileSync` + `JSON.parse` 同步读取一次并缓存在主进程内存，之后不读盘、不现算。解析成功、`schemaVersion === 1` 且 `rarity.yi` / `rarity.ji` / `quotes` 都是普通对象才算可用；否则视为不可用并写一条 `logger.warn`。
- 选词（`pickFocus(raw, list, score)`）：`score(list, term)` 取稀有度表中该词的天数，键缺失或不是正整数时按 `36525`。忌列表含「诸事不宜」时直接返回它；否则在非特殊词（`无`、`诸事不宜`、`馀事勿取`）中取分数最小者，平局取库返回顺序靠前者，候选为空取 `raw[0]`。不过滤任何其它词（含丧葬类）。
- 稀有度提示：焦点原词属于特殊词时为空；否则 `n = Math.floor(score / 100 + 0.5)`，`n === 0` 时为「不到一年一次」，否则「年约n次」；数据不可用时一律为空。
- 签语：`quotes[styleId][getZhiXing()]` 不是非空字符串时回退 `quotes.lunar[值星]`，仍无效则为空串（卡片保留签语行高度）。

## 2. 世界时钟（`electron/world-clocks.js`）

纯逻辑模块，**不 require Electron**，也不读写文件/网络；`Intl` 的 supported zones、当前时刻、本地时区都由调用方注入，`node --test` 直接 require。它还负责菜单栏显示时区的解析/回退与按指定时区格式化菜单栏标题（同一格式、无时区标识）。

**城市目录与搜索**

- `CITY_CATALOG` 是离线静态表，覆盖北京（别名上海/中国）、东京、首尔、新加坡、香港、台北、曼谷、新德里、迪拜、莫斯科、伦敦、巴黎、柏林、纽约、洛杉矶/旧金山、芝加哥、温哥华、多伦多、悉尼、奥克兰、圣保罗、UTC。
- 一个 IANA id 可以对应多行标签：洛杉矶与旧金山都是 `America/Los_Angeles`。**去重按 IANA id**，但添加时保存用户点选那一行的 `label`。
- `searchCatalog(query, { catalog, supportedValuesOf, addedIds })`：先匹配目录的中文标签、别名与 IANA id（下划线按空格处理）。目录无匹配且查询非空时，才用注入的 `Intl.supportedValuesOf('timeZone')` 按 id 或最后一段回退。结果带 `{ id, label, source, added }`；已添加的 id 仍返回但 `added: true`，渲染层在候选列表中过滤掉，只在编辑面板下方「已添加城市」列出。
- `isValidTimeZone(id, supportedValuesOf)` 以 `Intl.DateTimeFormat` 为准；这样 `Asia/Kolkata` 这类被 ICU 规范化为 `Asia/Calcutta` 的别名也能通过，输入列表不会放行未知 id。

**格式化（`formatClock(now, timeZone)`）**

- 用 `Intl.DateTimeFormat(..., { timeZone, hourCycle: 'h23' })` 取该时区的年月日时分秒与星期，不依赖运行进程的本地时区。
- `time`：`HH:mm:ss`，全部补零；`date`：`M月D日`，月日不补零；`weekday`：`星期一`…`星期日`。`formatClock` 仍用于菜单栏标题等需要秒的场景；右栏列表用 `formatClockTime(now, timeZone)` 输出 `HH:mm`。
- `describeClockRelative(now, timeZone, localTimeZone)` 返回 `{ dayText, dayDelta, offsetMinutes, offsetText, text }`：按两个时区的日历年月日判断「今天/昨天/明天」，按同一时刻的 UTC 偏移差计算 `±N 小时`（整小时不带小数；`+5.5` 这类半小时时区保留一位小数；负号用 `−`）。同本地时区只显示「今天」，否则如「今天 · −13 小时」「昨天 · +9 小时」。`formatClockOffset` 单独可测。

**列表操作**

- 状态形状：`{ items: [{ id, label }], index }`。
- `addClock` 拒绝无效 id 与重复 IANA id；成功时追加并把 `index` 指向新时钟。
- `removeClock` 可按当前项、`{ id }` 或 `{ index }` 删除；删当前项时索引夹到 `length - 1`，删空时 `{ items: [], index: 0 }`，不会偷偷补回默认城市。翻页与键盘左右切换已移除，`nextClock` / `prevClock` / `selectClock` 及对应 IPC 一并删除。
- `normalizeWorldClocks(stored, supportedValuesOf)` 丢弃无效/重复 id、清洗 label、夹紧 index。**只有 `stored === undefined`（偏好文件里没有该键）才种入 `北京 / Asia/Shanghai`**；`items: []` 保持空。首次运行默认北京，因为这是中文日历应用，本地时区已由菜单栏显示，默认再显示「同本地」或纽约意义不大。

**菜单栏显示时区（「设为菜单栏」）**

- 偏好键：`preferences.json` 顶层 `menuBarTimeZone`（IANA id 字符串）。省略或 `null` 表示跟随系统本地时区；不要把系统本地时区写死成字符串。
- `resolveMenuBarTimeZone(storedZone, items, localTimeZone)`：`storedZone` 未设置/`null`/非法/未知，或对应时钟已不在 `items` 中时，解析为注入的 `localTimeZone`。`storedZone` 仍在列表中且有效时解析为该 id。
- `normalizeMenuBarTimeZone(...)`：用于持久化——当解析结果等同系统本地（按 `sameTimeZone`，`Intl` 解析别名如 `Asia/Kolkata` / `Asia/Calcutta`）时返回 `null`（跟随系统），否则返回要保存的 id。若偏好是未设置且系统本地恰为某时钟（如 `Asia/Shanghai` 的北京），该时钟已被视为「当前」。
- `nextMenuBarTimeZoneAfterRemove(storedZone, removedId, itemsAfterRemove, localTimeZone)`：删除的时钟是当前菜单栏显示时区（或别名等同）时清除选择并回退到本地；删除其它时钟且选择仍存在时保持不变；选择已不存在时清除。主进程在同一轮 `clocks:remove` 中持久化并刷新托盘标题。
- `formatMenuTitleInZone(date, timeZone, localTimeZone)`：按给定时区输出与 `calendar.formatMenuTitle` 相同的 `M月D日 HH:mm:ss`；`timeZone` 无效时回退本地。可跨日历日（如上海已是次日、纽约仍是前一日），这是预期行为。
- **不改变系统时区，不调用任何系统 API。**「黄历」（`buildAlmanac`）与月历今日高亮（`buildCells` / `isToday`）始终按系统本地日期/时间计算，主进程不会把菜单栏显示时区传给它们。

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
- 启动时 `loadWorldClocks()` 读取并 normalize；只有 `worldClocks` 键缺失时才种入默认北京。`menuBarTimeZone` 若未设置/非法/对应时钟已不在列表中则清除并不再持久化。每次成功 add / remove / setMenuBar 后都用既有 `writePreferences` 整体写回；写失败只 warn，不崩溃。
- 渲染层不碰文件、不用 `localStorage`。

**IPC 与渲染层**

- `calendar:getState` / `calendar:setView` / `calendar:goToday` 返回的 state 包含 `clocks: { items }`；每个 item 为 `{ id, label, time, relativeText, isMenuBar }`，`time` 是 `HH:mm`，`relativeText` 由主进程按本地时区算好，`isMenuBar` 按 IANA id 与别名比较。不下发完整 IANA 列表。
- `calendar:onTick` 每秒发送 `{ almanac, clocks }`（窗口可见时），`clocks` 与菜单栏标题都按当前时刻重新计算。
- 右栏「世界时钟」卡片常驻列出全部城市：城市名、相对时区小字、右侧 `HH:mm`；菜单栏显示中的城市带橙色「菜单栏」标签。`‹`/`›`、圆点、`+`/`×` 与滑动手势都已移除。
- 标题右侧「编辑」默认占位隐藏，仅在 `.world-clock-card:hover` 或 `:focus-within` 时显示；点击后打开编辑面板（覆盖整个面板的居中浮层）：上方搜索框沿用 `clocks:search`，下方列出已添加城市；每行「设为菜单栏」经 `clocks:setMenuBar` 持久化并立即刷新托盘标题，当前项禁用；「移除」经 `clocks:remove`，删除当前菜单栏时区时回退本地。
- 编辑面板的搜索结果在面板内滚动，已添加的时区直接过滤，不再显示「已添加」行；搜索框为空时不显示「没有匹配的时区」，只有输入内容且无结果时才显示。添加后不关闭面板，列表与搜索结果同步刷新。面板不新建窗口、不调用系统对话框、无网络、无定位。
- 空列表显示「尚未添加城市」。`buildAlmanac` / `buildCells` / `isToday` 仍按系统本地时间，不受菜单栏显示时区影响。

**测试**：`tests/world-clocks.test.js`（城市/别名/IANA 回退搜索、重复 id、共享时区标签、DST 冬夏墙上时间、半小时时区、UTC、`HH:mm` 格式化、相对时差「今天/昨天/明天 · ±N 小时」、列表增删/清洗、首次默认 vs 显式空列表）。

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

**设置菜单（`electron/settings-menu.js` + `menu:openSettings`）**

- 顶栏「⚙︎ 设置」把按钮左缘/下缘加 4px 的坐标经 preload `openSettings({ x, y })` → `menu:openSettings` 发给主进程；渲染层只负责高亮按钮。
- 主进程用 `buildSettingsMenuTemplate({ version, openAtLogin }, actions)` 生成模板，再 `Menu.buildFromTemplate` + `menu.popup({ window, x, y })`。菜单左上角直接放在按钮左缘、下方 4px 处；超出窗口右侧时交给 macOS 自动调整。坐标缺失时退回光标位置。
- 模板顺序固定：检查更新（`sublabel` 为 `formatVersionLabel(app.getVersion())`）、登录时打开（`type: 'checkbox'`，`checked` 来自 `getOpenAtLogin()`）、分隔线、黄历风格…、编辑世界时钟…、更换天气城市…、分隔线、退出栏历（`accelerator: 'Cmd+Q'`）。
- 检查更新（设置菜单的项与右栏底部的文字链接）都调用 `requestUpdateCheck()` → `performUpdateCheck()`（`updater.checkNow({ manual: true })`）；底部入口经 `update:check` 到达主进程，结果仍走 `update:status`，不另写更新逻辑。
- 「登录时打开」点击后用 Electron 回传的 `menuItem.checked` 调 `applyLoginItem()`，业务实现不变。
- 面板动作经 `ui:openPanel`（`almanac` / `clocks` / `weather`）通知渲染层打开对应面板。菜单打开期间 `scheduleClose()` 暂停；选择面板/检查更新后窗口保持可见，其它方式关闭菜单且指针在窗口外时按原 200ms 逻辑收起。

**退出**

- 唯一入口是「设置」菜单的「退出栏历」（`Cmd+Q`）→ 主进程 `app.quit()`；不再有底栏按钮或 `app:quit` IPC。
- 单实例锁：拿不到锁直接退出；第二实例不弹窗（`second-instance` 为空处理）。

**测试**：托盘/窗口行为目前靠 README 的 macOS 真机项验收，没有自动化 UI 测试。

## 4. 更新（`electron/updater.js` + `electron/mac-self-update.js` + `electron/update-feed.js`）

调用关系：

```text
main.setupUpdates()
  ├─ createMacSelfUpdater(...)       仅在 darwin && isPackaged && arch==='x64' && fetch 时 available
  └─ setupAutoUpdate({ app, net, selfUpdate, callbacks })
       ├─ 非 darwin 或未打包 → disabled（「开发态不检查更新」）
       └─ darwin 且已打包 → 一律 probe-only（ad-hoc 签名，不调用 setFeedURL）
            ├─ 204 → up-to-date
            ├─ 200 + name/url → 有更新
            │    ├─ selfUpdate.available → 下载/校验/暂存 → onReady(mode:'ready-self')
            │    └─ 否则 → 手动 DMG 链接 → onManual
            └─ 其他/失败 → error
```

- feed：`https://update.electronjs.org/allen-bot-ctl/lan-li/${platform}-${arch}/${version}`。
- 首次检查在启动约 10 秒后，之后每 6 小时；探测超时 15 秒。
- 自动检查无更新时静默；只有 `manual === true` 的状态才会经 `update:status` 发给渲染进程。
- 手动检查日志：`manual check start`；结束状态为 `up-to-date` / `manual` / `error` 时写 `manual check result: <state>`（`ready` 不在此列）。进入 probe-only 时写 `macOS 未正式签名，使用 probe-only`。
- 下载成功：渲染层横幅「新版本已就绪 / 重启更新」。当前 macOS 只有自更新路径，「重启更新」调 `selfUpdater.installReady()`。
- 失败回退：`fallbackManualUrl` 能从版本号推导时直接给同版本 `.dmg` 直链，否则 `RELEASES_LATEST_URL`。同一版本的手动下载提醒只出现一次（偏好文件 `updateNotifications` 去重）。
- 完整行为与边界见 [updater.md](updater.md)。

**测试**：`tests/updater.test.js`、`tests/mac-self-update.test.js`、`tests/update-feed.test.js`、`tests/update-status.test.js`。

## 5. 日志（`electron/logger.js`）

- 位置：`app.getPath('logs')/main.log`，macOS 上是 `~/Library/Logs/栏历/main.log`。
- 行格式：`${new Date().toISOString()} [level] message`；`level` 为 `info` / `warn` / `error`。
- 同时输出到终端（`console.log/warn/error`）。
- 文件超过 1MB（`DEFAULT_MAX_BYTES = 1024 * 1024`）时，在下次写入前轮转为同目录 `main.old.log`；重命名失败会先删旧文件再试一次。
- 天气刷新成功/失败与失败原因也会经同一 logger 写入（前缀 `[栏历] 天气：`）；每次取位后还写一行 `天气位置=手动：<城市>` 或 `天气位置=IP：<城市>`，只写来源与城市，不写坐标。
- 任何文件系统失败都被吞掉：日志不得让应用崩溃；`app.getPath('logs')` 未就绪时下次写入继续重试。
- 安装脚本把步骤写入 `~/Library/Logs/栏历/update-install.log`，与 `main.log` 分开。

**测试**：`tests/updater.test.js` 中的日志测试（ISO 格式、轮转、路径解析失败不抛）。

## 6. IPC 完整清单

以 `electron/preload.js` 与 `electron/main.js` 的 `registerIpc()` 为准：

**invoke（渲染 → 主，返回 Promise）**

| 频道 | preload API | 作用 |
| --- | --- | --- |
| `app:version` | `getVersion` | 返回 `formatVersionLabel(app.getVersion())`，如 `v0.1.13` |
| `weather:get` | `getWeather` | 返回当前天气结果；有 `preferences.weatherCity` 时直接用其城市名与坐标，否则按 IP 定位；30 分钟缓存 |
| `weather:searchCity` | `searchCity` | `query`；主进程请求 Open-Meteo 地理编码，返回最多 8 条 `{ name, admin1, country, latitude, longitude, label }`，`label` 为「城市名 · 省/州 · 国家」；空查询返回空数组 |
| `weather:quickCities` | `getQuickCities` | 无参数；按手动城市 `weatherCity.country` 或自动模式的 IP 国家，从内置 `electron/data/quick-cities.json` 返回 `{ country, countryCode, cities: [{ name, latitude, longitude, country?, admin1?, label, selected }] }`；无法确定国家或该国不在清单时 `cities` 为空 |
| `weather:setCity` | `setCity` | `{ name, latitude, longitude, country?, admin1? }` 或 `null`；校验后写入/删除 `preferences.weatherCity` 并立即返回（不等待网络），后台强制刷新，结果经 `weather:update` 异步推送 |
| `almanac:getStyles` | `getAlmanacStyles` | 无参数；返回固定顺序的 5 项 `{ id, name, tagline, badge, accentLight, accentDark, selected }` |
| `almanac:setStyle` | `setAlmanacStyle` | `id` 字符串；5 个合法 id 之一时，若与当前不同则写入 `preferences.almanacStyle`，返回 `{ ok: true, almanac }`；非法 id 不写盘，返回 `{ ok: false }` |
| `calendar:getState` | `getState` | 当前 `view`、`focus`、42 格、`almanac`、`clocks: { items }`（每项含 `time`、`relativeText`、`isMenuBar`） |
| `calendar:setView` | `setView` | 校验并切换浏览年月/焦点日，返回新状态 |
| `calendar:goToday` | `goToday` | 浏览年月与焦点日回到今天，返回新状态 |
| `clocks:add` | `addClock` | `{ id, label? }`；校验/去重后持久化，返回 `clocks` 快照 |
| `clocks:remove` | `removeClock` | 删除当前时钟或 `{ id }`；若删掉菜单栏显示时区则回退本地并刷新托盘；持久化并返回快照 |
| `clocks:setMenuBar` | `setMenuBarClock` | `{ id }`（省略时取当前显示时钟）；校验后将其设为菜单栏显示时区，持久化并刷新托盘标题，返回快照；无效/不在列表中为无操作 |
| `clocks:search` | `searchClocks` | `{ query }`；返回目录 + IANA 回退结果，已添加项带 `added`，由渲染层过滤 |

**send（渲染 → 主）**

| 频道 | preload API | 作用 |
| --- | --- | --- |
| `pointer:enter` | `pointerEnter` | 取消关闭计时 |
| `pointer:leave` | `pointerLeave` | 安排 200ms 关闭 |
| `menu:openSettings` | `openSettings` | `{ x, y }` 为设置按钮左缘/下缘 + 4px；主进程把原生菜单左上角放在该点 |
| `update:check` | `checkUpdate` | 右栏底部「检查更新」；主进程复用 `requestUpdateCheck()`，结果仍经 `update:status` |
| `update:restart` | `restartToUpdate` | 就绪后重启更新（自更新） |
| `update:openLatest` | `openLatestRelease` | 打开手动下载地址 |

**send（主 → 渲染）**

| 频道 | preload API | 说明 |
| --- | --- | --- |
| `calendar:onTick` | `onTick` | 每秒发送 `{ almanac, clocks }`；仅窗口可见时发送，每个城市的 `time` 与 `relativeText` 按当前时刻重新计算 |
| `weather:update` | `onWeatherUpdate` | 后台或打开窗口刷新后的天气结果；失败同样下发 `{ ok: false, text: '天气暂不可用', emoji: '🌡️' }` |
| `ui:openPanel` | `onOpenPanel` | `'almanac'`、`'clocks'` 或 `'weather'`；由设置菜单触发，渲染层打开对应面板 |
| `update:notice` | `onUpdateNotice` | `ready` / `manual` 横幅；打开窗口与加载完成时重发 |
| `update:status` | `onUpdateStatus` | 短状态；**仅手动检查**时发送 |

**preload API 全量（25 个）**：`getVersion`、`getState`、`setView`、`goToday`、`addClock`、`removeClock`、`setMenuBarClock`、`searchClocks`、`getWeather`、`searchCity`、`getQuickCities`、`setCity`、`getAlmanacStyles`、`setAlmanacStyle`、`onWeatherUpdate`、`onTick`、`pointerEnter`、`pointerLeave`、`openSettings`、`onOpenPanel`、`onUpdateNotice`、`onUpdateStatus`、`checkUpdate`、`restartToUpdate`、`openLatestRelease`。

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

未知或空状态按 `error` 处理（fail closed）。`ready` 的横幅文案在渲染层：「新版本已就绪」「重启更新」；手动失败横幅：「无法自动更新，请手动下载」「下载新版」。`timed` 状态由渲染层约 2600ms 后隐藏状态横幅；更新就绪/手动下载横幅优先，不会被短状态覆盖。

## 7. 登录项与平台限制

- 纯逻辑模块 `electron/login-item.js`：生成并管理本应用自己的 `~/Library/LaunchAgents/app.lanli.LanLi.plist`，`Label` 为 `app.lanli.LanLi`，`ProgramArguments` 为 `["/usr/bin/open", "-a", <当前 .app>]`，`RunAtLoad` 为 `true`。`.app` 从 `process.execPath` 逐级向上找到 `.app` 目录；非打包开发模式 `enable()` 返回 `{ ok: false, reason: 'not-packaged' }`，不写文件。
- `createLoginItem({ fs, path, execPath, homeDir, plistPath, isPackaged, logger })` 的 `fs`、路径与 logger 都可注入，便于单测；`enable` / `disable` / `isEnabled` 只操作上述固定 plist，不碰其它 LaunchAgent。
- 首次运行：`initializeLoginItem()` 读 `preferences.json`；若没有 `loginItemInitialized === true`，调用 `applyLoginItem(true)`，然后无论结果如何都写 `loginItemInitialized: true`。之后启动不再强制打开。
- 开关：「设置」菜单元生的「登录时打开」checkbox → `applyLoginItem(menuItem.checked)`。先调 `app.setLoginItemSettings({ openAtLogin: desired })`；打开时若系统读回 false，写 LaunchAgent plist；关闭时同时调用系统 API 设 false 并删除 plist。系统登录项正常生效时会顺手清理遗留 plist，避免登录时启动两次。不再有 `login:set` IPC。
- `getOpenAtLogin()` 返回 `系统读回 openAtLogin || plist 存在`；每次打开设置菜单时用它决定 checkbox 的 `checked`，首次运行也共用这一判断，因此勾选始终显示最终真实状态。
- 系统 API 抛错、plist 写/删失败、最终状态与期望不一致都写入 `logger`（`~/Library/Logs/栏历/main.log`），不只 `console`。
- 非 macOS：`dialog.showErrorBox('栏历', '栏历首发只支持 macOS。')` 后 `app.quit()`，不绘制仿菜单栏、不检查更新。

**测试**：`tests/login-item.test.js`。

## 8. 版本号（`electron/app-version.js`）

- `formatVersionLabel`：去首尾空白；已有 `v`/`V` 前缀去重；必须以数字开头且只含 `0-9A-Za-z.+-`；否则返回 `''`。
- 渲染层 `loadVersion()` → `app:version`，在右栏底部居中显示为「栏历 vX.Y.Z」；`app:version` 仍返回 `formatVersionLabel()` 的 `vX.Y.Z`，渲染层只在前面加产品名。右侧以「·」分隔「检查更新」文字按钮，点击经 `update:check` 复用设置菜单的更新检查；该按钮不属于三张卡片的隐藏选择器，始终可见。版本号不会被检查状态文案覆盖，也不会因设置菜单的 sublabel 重复占位。

**测试**：`tests/app-version.test.js`。

## 9. 天气（`electron/weather.js`）

- 纯函数：`matchChinaCity` / `matchChinaCityExact`（城市码表匹配：先精确，再加「市」「区」「县」后缀，再去掉这些后缀；`matchChinaCity` 匹配不到时用 `admin1` 再试；`matchChinaCityExact` 只做精确匹配，供无 `country` 的旧数据使用）、`resolveChinaCode`（手动城市按 `country === 'CN'` 走完整匹配、无 `country` 只做精确匹配，IP 定位按 `isChina`）、`pickIpCity`、`normalizeCoordinates`、`parseIpLocation`（含 `country_code === 'CN'` 得出的 `isChina`）、`normalizeWeatherCity`（`{ name, latitude, longitude, country?, admin1? }` 校验）、`readWeatherCity` / `writeWeatherCity`（从偏好读取、写入或删除 `weatherCity`）、`resolveWeatherLocation`（手动城市优先，否则用 IP 数据）、`parseGeocodingResults`（Open-Meteo 地理编码结果 → 列表行）、`parseItboyWeather`（`data.wendu` + `data.forecast[0].type`）、`parseWttrWeather`（`current_condition[0].temp_C` + `lang_zh[0].value`，缺失时 `weatherDesc[0].value`）、`formatWeatherResult`（`城市 · 天气 · X°C`）、`describeWeatherLocation`（`天气位置=手动：<城市>` / `天气位置=IP：<城市>`）以及地理编码、itboy 与 wttr.in URL 构造器。测试直接 require，不联网。
- 数据源（主进程请求，单源超时 8 秒，主源失败自动回退另一源，全部失败才「天气暂不可用」）：
  - 中国城市：`http://t.weather.itboy.net/api/weather/city/<city_code>`；`city_code` 来自打包的城市码表 `electron/data/china-city-codes.json`（`{name: code}`，由城市码全表精简而来）。
  - 非中国城市或码表匹配不到：`https://wttr.in/<lat>,<lon>?format=j1&lang=zh`。
  - 成功时写日志 `天气来源=itboy（<城市> <代码>）` 或 `天气来源=wttr.in`。
- 位置来源：
  - `preferences.weatherCity` 存在时，直接用保存的 `name`、`latitude`、`longitude`（可选 `country`、`admin1`），**不请求 `ipwho.is`**。启动时由主进程读入天气服务。
  - 否则请求 `https://ipwho.is/`，用返回的 `latitude` / `longitude` / `city` 与 `country_code`（`=== 'CN'` 判定中国）；城市名直接使用 IP 返回结果，不做反向地理编码。
  - 取数前写 `天气位置=手动：<城市>` / `天气位置=IP：<城市>` 日志。
- 快捷城市：`electron/quick-cities.js` 读取打包的 `electron/data/quick-cities.json`（按 ISO 国家代码分组，城市含 `name`/`latitude`/`longitude`/`country`，中国城市另含 `admin1`）；`findQuickCities` 同时接受 Open-Meteo 的中文国家名与 ipwho.is 的英文国家名 / `country_code`。当前国家取手动城市的 `weatherCity.country`，自动模式取最近一次 IP 定位的 `country_code`（优先）或国家名；拿不到国家时不显示快捷城市。`sameCity` 用于把当前手动城市标成「已选」。
- 手动选择城市：
  - 点击天气卡片（单行任意位置，含行尾「更换 ›」），渲染层打开复用 `.picker-*` 样式的城市面板；列表首项固定为「自动（按 IP）」。
  - 搜索框为空时，在「自动（按 IP）」下方显示小标题「常用城市」与该国快捷城市；当前手动城市标为「已选」并禁用。点击快捷城市与搜索结果走同一套 `weather:setCity` 逻辑：面板立即关闭、卡片显示「城市名 · 加载中…」，天气后台刷新。
  - 输入内容后经 `weather:searchCity` 调 `https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=8&language=zh&format=json`，显示「城市名 · 省/州 · 国家」；网络请求只在主进程。
  - 点击列表项后渲染层**立即关闭面板**并把天气卡片文字显示为「<城市名> · 加载中…」，不等网络；`weather:setCity` 写入 `preferences.weatherCity = { name, latitude, longitude, country?, admin1? }`（选「自动」则删除该键）后立即返回，主进程清理缓存并异步强制刷新，结果经 `weather:update` 推送。
- `createWeatherService({ fetch, logger, now, setTimeout, clearTimeout, weatherCity })`：所有请求带 `User-Agent` 与 8 秒超时；结果缓存 30 分钟，失败也写入缓存时间，30 分钟内不重复请求；成功/失败分别写 info/warn 日志。`setCity` 会清空旧城市缓存并让进行中的旧请求失效。
- 打开窗口时调用 `refreshWeather()`：缓存超过 30 分钟才重新请求；`setInterval` 每 30 分钟后台刷新一次，结果经 `weather:update` 推给渲染层。首次打开且无缓存时主进程会按 IP 或手动城市取一次。
- 结果带 `emoji`（`weatherEmoji()` 按「雷 → 雪 → 雨 → 雾 → 阴 → 多云 → 晴」优先匹配；未知用 `🌡️`），渲染层在 40px 单行里按「emoji → 温度 → 弹性区」排列；`#weather-city` 只写城市名（`result.city`）或状态文字，放在 `.card-swap.weather-swap` 弹性区内靠行尾右对齐，超长省略；`.weather-change` 与城市名叠在同一格右对齐，默认占位隐藏，天气卡 `.weather-card:hover` 或 `:focus-visible` 时 120ms 交叉淡入，位置与右边缘不变。悬停 title 为「城市 · 天气」（加载中/失败为状态文字）。加载中显示「天气加载中…」或「城市名 · 加载中…」，全部数据源失败统一显示「天气暂不可用」，不弹窗。CSP 仍为 `default-src 'self'`，不放开网络。
- 不再请求 macOS 定位授权：没有 `navigator.geolocation`、定位权限处理器、`NSLocation*` 用途说明或原生定位依赖。

**测试**：`tests/weather.test.js`（城市码表匹配与 admin1 回退、itboy 与 wttr.in 解析、URL 构造、IP 失败、坐标校验、地理编码结果解析、天气文字→emoji 映射、`weatherCity` 含 `country`/`admin1` 的读写/清除、有无手动城市的取位逻辑、手动/IP 国家来源、itboy 失败回退、非中国直走 wttr.in、定位与来源日志文案、注入假 fetch 的缓存/失败路径与手动/自动切换）；`tests/quick-cities.test.js`（清单结构、国家代码/中英文国家名匹配、已选城市判定）；`tests/ui-wiring.test.js`（空搜索时显示「常用城市」并走 `weather:quickCities`）。

## 相关文档

- 架构与分层：[architecture.md](architecture.md)
- 更新当前行为：[updater.md](updater.md)
- 测试与真机项：[testing.md](testing.md)
- 踩坑经过：[lessons-learned.md](lessons-learned.md)
