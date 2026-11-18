# 项目架构

栏历是一个 macOS 菜单栏应用：菜单栏只显示文字日期时间，悬停弹出固定尺寸的月历面板。运行时是 Electron 主进程 + 一个隐藏/按需显示的渲染窗口；没有服务器、没有数据库，日历计算完全离线。

## 目录与进程

```
electron/
  main.js           主进程：生命周期、托盘、窗口、时钟、登录项、更新编排、IPC 注册
  preload.js        contextBridge 暴露 window.lanli，只转发既有 IPC
  calendar.js       农历/公历/42 格/菜单栏标题/「黄历」纯逻辑与风格映射
  almanac-styles.js 5 种黄历风格的常量元数据、启动时同步读取的映射 JSON 与逐词映射/去重
  almanac-focus.js  启动时同步读取的百年稀有度表与签语、焦点词挑选与降级
  world-clocks.js   多时区城市目录、校验、列表操作、时钟格式化与相对时差纯逻辑
  settings-menu.js  「设置」原生菜单模板构建纯逻辑
  weather.js        天气纯逻辑（WMO 映射、emoji 映射、城市名、地理编码、坐标/URL/格式化、手动城市偏好）与主进程请求服务
  quick-cities.js   天气面板离线常用城市：清单读取、国家代码/中英文国家名匹配与已选城市判定纯逻辑
  data/             打包数据：中国城市码表、常用城市清单、百年黄历稀有度与 4 份黄历风格映射 JSON
  login-item.js     未签名包登录项回退：生成/删除本应用的 LaunchAgent plist
  updater.js        自动更新编排（probe-only）
  mac-self-update.js ad-hoc 签名包的应用内下载、校验、暂存、安装
  update-feed.js    feed URL 拼接与 204/200 语义
  update-status.js  手动检查状态的短文案映射
  app-version.js    右栏版本号标签格式化
  logger.js         文件日志与轮转
  renderer/         calendar.html / calendar.css / calendar.js，只负责展示与交互
  assets/           icon.png 与未再引用的 trayTemplate*.png
tests/              node:test 单测
site/               GitHub Pages 静态主页（不是应用运行时的一部分）
.github/workflows/  release.yml 发版；pages.yml 发布主页
```

- `electron/main.js`：唯一主进程入口（`package.json` 的 `main`）。持有 `Tray`、`BrowserWindow`、每秒定时器与更新器。
- `electron/preload.js`：窗口 `webPreferences` 中 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；通过 `contextBridge.exposeInMainWorld('lanli', ...)` 暴露有限 API。
- `electron/renderer/`：静态 HTML/CSS/JS。只做渲染、翻月、年份选择、世界时钟列表与编辑面板、天气卡片与选城面板、黄历风格面板、「今日黄历」面板、设置按钮、指针进出、Esc；不 `require('lunar-javascript')`，也不计算时区、天气代码或风格映射。
- `electron/calendar.js`、`almanac-styles.js`、`almanac-focus.js`、`world-clocks.js`、`settings-menu.js`、`window-layout.js`、`weather.js`、`quick-cities.js`、`login-item.js`、`update-feed.js`、`update-status.js`、`app-version.js`、`logger.js`、`mac-self-update.js`：可在没有 Electron 的情况下被 `node --test` require 的模块（`logger.js` 仅在默认取日志路径时惰性 require Electron；`weather.js` 的网络请求通过注入的 `fetch` 完成；`login-item.js` 的 `fs` 与路径可注入）。
- `site/`：纯静态主页，由 `.github/workflows/pages.yml` 部署，不参与打包。

窗口尺寸常量在 `electron/main.js`：`WINDOW_WIDTH = 580`、`WINDOW_HEIGHT = 432`；`electron/renderer/calendar.css` 中 `html, body` 也是 `580px × 432px`。最上方 32px 是通栏顶栏，`.app-body` 内的左侧月历 `.calendar-pane` 弹性占满剩余宽度（约 `404px`），右侧卡片栏 `.now-pane` 为 `176px`；两栏内部尺寸与间距仍与 0.1.24 一致。改窗口尺寸必须两处一起改，并重新做真机验收。

## 数据流

```text
系统本地时间 (new Date())
  ├─ 每秒 → world-clocks.formatMenuTitleInZone(now, resolvedMenuBarTimeZone(), defaultLocalTimeZone())
  │        （失败时才回退 calendar.formatMenuTitle(now)）→ tray.setTitle(..., { fontType: 'monospacedDigit' })
  └─ 面板可见时 → calendar.buildAlmanac() + world-clocks.formatClockTime()/describeClockRelative()
       → IPC calendar:onTick { almanac, clocks } → 渲染右侧「黄历」与世界时钟列表

用户操作（翻月/选年/返回今天/点击格子）
  → preload API → invoke calendar:setView / calendar:goToday
  → 主进程校验年月与焦点日 → calendar.buildCells(year, month, now)
  → 返回 { view, focus, cells[42], almanac, clocks } → 渲染整月

世界时钟操作（编辑面板内添加/删除/搜索/设为菜单栏）
  → preload addClock/removeClock/searchClocks/setMenuBarClock
  → 主进程 world-clocks 校验与列表操作 → 写 preferences.json
  → 「设为菜单栏」经 clocks:setMenuBar 写入 preferences.menuBarTimeZone 并立即刷新托盘标题
  → 返回 clocks 快照（每个城市的 HH:mm、相对文案、isMenuBar）→ 渲染层只展示

设置菜单
  → 右上角「⚙︎ 设置」→ preload openSettings({ x, y }) → menu:openSettings
  → 主进程 settings-menu.buildSettingsMenuTemplate() → Menu.buildFromTemplate + menu.popup
  → 「黄历风格…」/「编辑世界时钟…」/「更换天气城市…」→ webContents.send('ui:openPanel', 'almanac' | 'clocks' | 'weather')
  → 渲染层面板打开；检查更新直接在主进程走现有更新器，状态仍经 update:status 推送

黄历风格与焦点（卡片「去定制 ›」或设置菜单）
  → 主进程启动时同步读取 electron/data/almanac-styles/*.json 与 electron/data/almanac-focus.json 并缓存；lunar 为常量与恒等映射
  → buildAlmanac：lunar-javascript 原词 → almanac-focus.pickFocus 按百年稀有度选出焦点宜/忌（只对原词计算）→ 按风格映射成焦点文案 → 按值星取签语
  → almanac:getStyles 返回 5 项固定顺序的风格元数据与当前选中项
  → 用户点击 almanac:setStyle(id) → 合法则写入 preferences.almanacStyle（与当前相同则不写盘）
  → 返回 { ok, almanac } → 渲染层立即重绘标题、主题色、焦点宜忌、签语与底注；之后每秒 tick 用新风格重算
  → 渲染层点击黄历卡（「去定制 ›」除外）→ 用最近一次 almanac.detail 渲染「今日黄历」面板，不新增 IPC；面板打开期间收到新 tick 立即重绘

天气（打开窗口/后台刷新）
  → 有 preferences.weatherCity 时直接用保存的城市名与坐标（含可选 country/admin1）；否则主进程请求 ipwho.is 按 IP 取坐标、城市与 country_code
  → 主进程 weather 服务按数据源取数：中国城市（手动城市 country === 'CN' 或码表精确匹配，IP 定位 country_code === 'CN' 且城市名在码表中）优先 itboy（打包的城市码表换算城市代码），失败回退 wttr.in；非中国城市直接走 wttr.in
  → 写 `天气位置=手动：<城市>` / `天气位置=IP：<城市>` 与 `天气来源=itboy（<城市> <代码>）` / `天气来源=wttr.in` 日志
  → 30 分钟缓存 → 返回/推送 weather:update → 渲染层在 40px 单行里显示 emoji、温度、城市名与「更换 ›」（title 为「城市 · 天气」）
  → 点击天气单行（含「更换 ›」）→ 搜索框为空时经 weather:quickCities 按当前国家（手动城市 country 或 IP country_code）列出内置「常用城市」，输入后经 weather:searchCity 调 Open-Meteo 地理编码；weather:setCity 保存/清除 weatherCity 后立即返回；渲染层立即关闭面板并显示「城市 · 加载中…」，新结果经 weather:update 异步推送
```

- 农历计算只发生在主进程的 `electron/calendar.js`，底层是 `lunar-javascript@1.7.8` 的 `Solar.fromYmd`。完全离线。
- 时区格式化只发生在主进程的 `electron/world-clocks.js`，使用 `Intl.DateTimeFormat` 与注入的本地时区；渲染层不推导时差。
- 偏好文件：`app.getPath('userData')/preferences.json`，保存 `loginItemInitialized`、`updateNotifications`（每个版本的一次性手动下载提醒）、`worldClocks`（`{ items: [{ id, label }], index }`）、顶层 `menuBarTimeZone`（IANA id；省略或 `null` 表示跟随系统本地时区，不把系统本地时区写死成字符串；非法或对应时钟不在时钟列表中则清除）、可选的 `weatherCity`（`{ name, latitude, longitude, country?, admin1? }`；省略表示按 IP 定位）与可选的 `almanacStyle`（5 个风格 id 之一；缺失/非法按 `lunar`，且不回写）。天气结果只缓存在主进程内存，不写偏好文件；城市码表打包在 `electron/data/china-city-codes.json`，常用城市清单打包在 `electron/data/quick-cities.json`，黄历风格映射打包在 `electron/data/almanac-styles/{coder,worker,student,fitness}.json`，百年稀有度与签语打包在 `electron/data/almanac-focus.json`（只读，启动时同步加载一次）。
- 网络只在主进程发生：天气（`ipwho.is`、`t.weather.itboy.net`、`wttr.in`、Open-Meteo 地理编码）与打包后的 `update.electronjs.org` feed 探测、GitHub Release 资产下载。渲染层 CSP 不放开网络，开发态不检查更新。
- 详细实现见 [implementation.md](implementation.md)；更新细节见 [updater.md](updater.md)。

## 分层职责与边界

### 主进程（`electron/main.js`）

**职责**

- 应用生命周期：`requestSingleInstanceLock()`、`app.whenReady()`、`window-all-closed` 不退出、`before-quit` 清理定时器与更新器。
- 菜单栏形态：`app.dock.hide()`、`Menu.setApplicationMenu(null)`、`new Tray(nativeImage.createEmpty())`、每秒写文字标题。
- 窗口：无边框、不可缩放、`alwaysOnTop`、默认隐藏；按托盘 bounds 与 `workArea` 定位；`mouse-enter` / `mouse-leave` / `click` / Esc 的开关逻辑。
- 状态与偏好：当前浏览年月、焦点日、首次登录项初始化、更新提醒去重、世界时钟列表与当前索引。
- 天气编排：创建带注入 `net.fetch` 的天气服务（启动时读入 `weatherCity`），打开窗口/后台定时刷新并推送 `weather:update`；IP 与手动城市的取位、地理编码搜索、`weatherCity` 读写都在主进程完成，并写 `天气位置=手动：<城市>` / `天气位置=IP：<城市>` 日志（不写坐标）。
- 更新编排：创建 `mac-self-update` 实例、调用 `setupAutoUpdate`、把 `onReady` / `onManual` / `onStatus` 转成 IPC；设置菜单的「检查更新」与顶栏右上角的检查更新图标（`update:check`）复用同一 `requestUpdateCheck()` → `checkNow({ manual: true })`。
- 原生设置菜单：`menu:openSettings` → `settings-menu.buildSettingsMenuTemplate()` → `Menu.buildFromTemplate` + `menu.popup({ window, x, y })`，面板动作经 `ui:openPanel` 通知渲染层。
- 日志：`createLogger()` 写文件并在控制台输出。

**边界**

- 月历内容的计算不在这里：交给 `calendar.js`；世界时钟的校验、列表与格式化交给 `world-clocks.js`；天气映射、城市名选择与请求细节交给 `weather.js`。
- 更新下载/校验/替换不在这里：交给 `updater.js` 与 `mac-self-update.js`，主进程只做依赖注入与回调。
- 注意：`main.js` 里仍有少量展示相关字符串（如窗口/托盘文案、更新日志前缀），但不要继续把整块 UI 拼装搬进来。

**不要做**

- 不要新增第二个窗口、设置页、Dock 图标或右键菜单；设置项只放在已有托盘面板的原生菜单里。
- 未签名包的系统登录项会失败；只允许回退到本应用自己的 `~/Library/LaunchAgents/app.lanli.LanLi.plist`（见 `login-item.js`），不要使用 login hook、crontab，也不要操作其它 LaunchAgent。
- 不要把路径或 URL 拼进 shell 字符串。

### preload（`electron/preload.js`）

**职责**

- 仅通过 `contextBridge` 暴露当前已有的 25 个 API（清单见 [implementation.md](implementation.md#6-ipc-完整清单)）。
- 把 `invoke` / `send` / `on` 一一对应到固定频道。

**边界**

- 不 `require` 业务模块，不读文件、不发网络请求、不算日期。
- 不暴露原始 `ipcRenderer`，不扩大 bridge。

**不要做**

- 不要为图省事加 `send(channel, ...)` 这类通用透传。
- 不要改 `contextIsolation` / `sandbox` / `nodeIntegration` 的安全组合。

### 渲染进程（`electron/renderer/`）

**职责**

- 渲染主进程给的 `cells`、`almanac`、`clocks`、`weather`、版本号与通用提示（`electron/renderer/toast.js` 的 `showToast`）；不渲染登录项状态（由原生菜单直接读取）。
- 交互：上一月/下一月、年份下拉、今天、点击格子、世界时钟编辑面板（添加/搜索/设为菜单栏/移除）、天气单行与选城面板、黄历风格面板（5 选 1，即点即生效）、「今日黄历」面板（点黄历卡打开，仅「完成」关闭）、通栏顶栏的图钉与设置胶囊、重启更新/下载新版。
- 顶栏左侧只放图钉与「栏历」，右侧「⚙︎ 设置」只发送按钮坐标；菜单内容、登录项与退出都由主进程处理。`ui:openPanel` 到达时打开对应面板。
- 天气卡片只请求主进程的当前结果；单行显示 emoji、温度、城市名与「更换 ›」，点击整行打开城市选择面板，搜索框为空时经 `weather:quickCities` 显示当前国家的离线常用城市，输入后经 `weather:searchCity` 搜索，`weather:setCity` 保存或清除手动城市。定位、网络与偏好读写都不在渲染层。
- 黄历卡片只渲染主进程给的 `almanac`（焦点宜/忌、签语、底注）；「去定制 ›」经 `almanac:getStyles` 打开风格面板，选中后经 `almanac:setStyle` 立即重绘卡片。点击卡片用 `almanac.detail` 打开「今日黄历」面板，不新增 IPC；面板与另外三个面板互斥。主题色只通过 CSSOM 自定义属性注入，不写内联样式。
- 指针进入/离开窗口根节点时通知主进程；Esc 由主进程的 `before-input-event` 处理。
- 手动检查的短状态完全来自主进程 `update:status`；检查结果与更新通知都经 `showToast` 显示在顶栏下 8px 的通用提示卡片里，不再使用 `update-banner`。info/success 约 3 秒后隐藏（悬停暂停）；进行中的提示只被下一状态替换，30 秒无结果转为「检查失败」；就绪和失败类不自动消失。

**边界**

- **不算农历**，不算时区，不映射 WMO 天气代码，不读 `lunar-javascript`，不直接访问文件系统或天气 API。CSP 不放开网络。
- 更新提示的文案（「新版本已就绪」「立即重启」「发现新版本」「无法自动更新，请手动下载」「下载新版」等）在渲染层经 `showToast` 展示；短状态文案在 `update-status.js`。

**不要做**

- 不要引入手工主题切换、第二套配色、外部字体或参考应用资源；只跟随系统 `prefers-color-scheme`。
- 不要自己推断更新状态或版本。

### 可单测的纯逻辑模块

**职责**

- `calendar.js`：42 格、次要文字、菜单栏标题、「黄历」焦点/签语/底注/明细与按风格映射后的结果。
- `almanac-styles.js`：5 种风格的固定元数据、映射 JSON 的同步读取与容错、114 词条的逐词映射/兜底/去重、`almanacStyle` 偏好清洗。
- `almanac-focus.js`：百年稀有度与签语 JSON 的同步读取、可用性判定、按稀有度挑选焦点词、稀有度提示与签语回退。
- `world-clocks.js`：城市目录与搜索、IANA 校验、世界时钟格式化（`HH:mm` 与菜单栏标题）、相对时差文案、列表增删、偏好清洗。
- `settings-menu.js`：设置菜单模板构建（顺序、版本 sublabel、登录项 checkbox、`Cmd+Q`）。
- `weather.js`：WMO 代码中文映射、天气文字到 emoji 的映射、城市名选择、坐标校验、地理编码结果解析、`weatherCity` 读写/清除、手动城市与 IP 的取位逻辑、当前国家来源、请求 URL、结果格式化，以及可注入 `fetch` 的主进程请求服务与 30 分钟缓存。
- `quick-cities.js`：离线常用城市清单读取、ISO 国家代码与中英文国家名匹配、城市记录校验与已选城市判定。
- `update-feed.js`：feed URL 与 204/200 解释。
- `update-status.js`：状态到短文案/计时标志的映射。
- `app-version.js`：`v` 前缀规范化。
- `logger.js`：ISO 行、1MB 轮转、失败不抛。
- `mac-self-update.js`：URL/版本校验、sha256、dmg 直链、包路径检查、暂存、安装脚本。

**边界**

- 无 Electron 依赖也能被 `node --test` require（`logger.js` 的 Electron 依赖是惰性、可注入的）。
- 副作用必须可注入：`fetch`、`execFile`、`spawn`、`fs`、`path`、`logger`、时钟/定时器、`pid`、`quit`。

**不要做**

- 不要在模块顶层做网络请求、读真实用户目录或启动进程。
- 不要让测试接触真实 `/Applications` 或真实网络。

### CI / 发布（`.github/workflows/`）

**职责**

- `release.yml`：标签 `v*` 触发；Node 20；`npm ci`；`npm test`；`npx electron-builder --mac dmg zip --x64 --publish never`（ad-hoc 签名）；`codesign -dv` 校验 `Signature=adhoc`；生成 zip 的 sha256；上传并在 `ubuntu-latest` 创建 Release。
- `pages.yml`：`master` 推送或手动触发，把 `site/` 发布到 GitHub Pages。

**边界**

- `electron-builder` 必须带 `--publish never`，发布由 workflow 的上传步骤完成。
- 目前只正式构建/发布 macOS Intel x64。

**不要做**

- 不要重写已有下载的标签。
- 不要在没有真机验收的情况下扩大平台矩阵。
- 不要在 workflow 中夹带与发布无关的产品行为改动。

## 相关文档

- 核心实现走读：[implementation.md](implementation.md)
- 更新子系统：[updater.md](updater.md)
- 编码红线：[coding-discipline.md](coding-discipline.md)
- 决策记录：[decisions/README.md](decisions/README.md)
