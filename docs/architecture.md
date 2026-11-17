# 项目架构

栏历是一个 macOS 菜单栏应用：菜单栏只显示文字日期时间，悬停弹出固定尺寸的月历面板。运行时是 Electron 主进程 + 一个隐藏/按需显示的渲染窗口；没有服务器、没有数据库，日历计算完全离线。

## 目录与进程

```
electron/
  main.js           主进程：生命周期、托盘、窗口、时钟、登录项、更新编排、IPC 注册
  preload.js        contextBridge 暴露 window.lanli，只转发既有 IPC
  calendar.js       农历/公历/42 格/菜单栏标题/「黄历」纯逻辑
  world-clocks.js   多时区城市目录、校验、列表操作与时钟格式化纯逻辑
  weather.js        天气纯逻辑（WMO 映射、城市名、坐标/URL/格式化）与主进程请求服务
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
- `electron/renderer/`：静态 HTML/CSS/JS。只做渲染、翻月、开关、世界时钟的显示/切换/搜索浮层、天气行、检查更新按钮、指针进出、Esc；不 `require('lunar-javascript')`，也不计算时区或天气代码。
- `electron/calendar.js`、`world-clocks.js`、`weather.js`、`login-item.js`、`update-feed.js`、`update-status.js`、`app-version.js`、`logger.js`、`mac-self-update.js`：可在没有 Electron 的情况下被 `node --test` require 的模块（`logger.js` 仅在默认取日志路径时惰性 require Electron；`weather.js` 的网络请求通过注入的 `fetch` 完成；`login-item.js` 的 `fs` 与路径可注入）。
- `site/`：纯静态主页，由 `.github/workflows/pages.yml` 部署，不参与打包。

窗口尺寸常量在 `electron/main.js`：`WINDOW_WIDTH = 580`、`WINDOW_HEIGHT = 400`；`electron/renderer/calendar.css` 中 `html, body` 也是 `580px × 400px`。左侧目录区 `.calendar-pane` 为 `420px`，右侧橙栏 `.now-pane` 为 `160px`。改尺寸必须两处一起改，并重新做真机验收。

## 数据流

```text
系统本地时间 (new Date())
  ├─ 每秒 → world-clocks.formatMenuTitleInZone(now, resolvedMenuBarTimeZone(), defaultLocalTimeZone())
  │        （失败时才回退 calendar.formatMenuTitle(now)）→ tray.setTitle(..., { fontType: 'monospacedDigit' })
  └─ 面板可见时 → calendar.buildAlmanac() + world-clocks.formatClock()
       → IPC calendar:onTick { almanac, clocks } → 渲染右侧「黄历」与世界时钟

用户操作（翻月/选年/返回今天/点击格子）
  → preload API → invoke calendar:setView / calendar:goToday
  → 主进程校验年月与焦点日 → calendar.buildCells(year, month, now)
  → 返回 { view, focus, cells[42], almanac, clocks, openAtLogin } → 渲染整月

世界时钟操作（添加/删除/左右切换/搜索/设为当前）
  → preload addClock/removeClock/selectClock/searchClocks/setMenuBarClock
  → 主进程 world-clocks 校验与列表操作 → 写 preferences.json
  → 「设为当前」经 clocks:setMenuBar 写入 preferences.menuBarTimeZone 并立即刷新托盘标题
  → 返回 clocks 快照 → 渲染层只展示

天气（打开窗口/后台刷新）
  → 渲染层 navigator.geolocation（10s 超时）取坐标，并把定位来源（系统成功 / 失败 code+message / 无 geolocation）随请求传给主进程
  → preload getWeather({ latitude, longitude } | 省略, location)
  → 主进程 weather 服务：反向地理编码 + Open-Meteo（无坐标时先 ipwho.is），并按 location 写一行定位来源日志
  → 30 分钟缓存 → 返回/推送 weather:update → 渲染层显示一行天气
```

- 农历计算只发生在主进程的 `electron/calendar.js`，底层是 `lunar-javascript@1.7.8` 的 `Solar.fromYmd`。完全离线。
- 时区格式化只发生在主进程的 `electron/world-clocks.js`，使用 `Intl.DateTimeFormat` 与注入的本地时区；渲染层不推导时差。
- 偏好文件：`app.getPath('userData')/preferences.json`，保存 `loginItemInitialized`、`updateNotifications`（每个版本的一次性手动下载提醒）、`worldClocks`（`{ items: [{ id, label }], index }`）与顶层 `menuBarTimeZone`（IANA id；省略或 `null` 表示跟随系统本地时区，不把系统本地时区写死成字符串；非法或对应时钟不在时钟列表中则清除）。天气结果只缓存在主进程内存，不写偏好文件。
- 网络只在主进程发生：天气（`ipwho.is`、BigDataCloud 反向地理编码、Open-Meteo，均为 HTTPS）与打包后的 `update.electronjs.org` feed 探测、GitHub Release 资产下载。渲染层 CSP 不放开网络，开发态不检查更新。
- 详细实现见 [implementation.md](implementation.md)；更新细节见 [updater.md](updater.md)。

## 分层职责与边界

### 主进程（`electron/main.js`）

**职责**

- 应用生命周期：`requestSingleInstanceLock()`、`app.whenReady()`、`window-all-closed` 不退出、`before-quit` 清理定时器与更新器。
- 菜单栏形态：`app.dock.hide()`、`Menu.setApplicationMenu(null)`、`new Tray(nativeImage.createEmpty())`、每秒写文字标题。
- 窗口：无边框、不可缩放、`alwaysOnTop`、默认隐藏；按托盘 bounds 与 `workArea` 定位；`mouse-enter` / `mouse-leave` / `click` / Esc 的开关逻辑。
- 状态与偏好：当前浏览年月、焦点日、首次登录项初始化、更新提醒去重、世界时钟列表与当前索引。
- 天气编排：设置仅允许 `geolocation` 的权限处理器，创建带注入 `net.fetch` 的天气服务，打开窗口/后台定时刷新并推送 `weather:update`；`weather:get` 时按渲染层传来的定位来源写 `定位来源=系统` / `定位来源=IP（…）` 日志（不写坐标）。
- 更新编排：创建 `mac-self-update` 实例、调用 `setupAutoUpdate`、把 `onReady` / `onManual` / `onStatus` 转成 IPC。
- 日志：`createLogger()` 写文件并在控制台输出。

**边界**

- 月历内容的计算不在这里：交给 `calendar.js`；世界时钟的校验、列表与格式化交给 `world-clocks.js`；天气映射、城市名选择与请求细节交给 `weather.js`。
- 更新下载/校验/替换不在这里：交给 `updater.js` 与 `mac-self-update.js`，主进程只做依赖注入与回调。
- 注意：`main.js` 里仍有少量展示相关字符串（如窗口/托盘文案、更新日志前缀），但不要继续把整块 UI 拼装搬进来。

**不要做**

- 不要新增第二个窗口、设置页、Dock 图标或右键菜单。
- 未签名包的系统登录项会失败；只允许回退到本应用自己的 `~/Library/LaunchAgents/app.lanli.LanLi.plist`（见 `login-item.js`），不要使用 login hook、crontab，也不要操作其它 LaunchAgent。
- 不要把路径或 URL 拼进 shell 字符串。

### preload（`electron/preload.js`）

**职责**

- 仅通过 `contextBridge` 暴露当前已有的 21 个 API（清单见 [implementation.md](implementation.md#6-ipc-完整清单)）。
- 把 `invoke` / `send` / `on` 一一对应到固定频道。

**边界**

- 不 `require` 业务模块，不读文件、不发网络请求、不算日期。
- 不暴露原始 `ipcRenderer`，不扩大 bridge。

**不要做**

- 不要为图省事加 `send(channel, ...)` 这类通用透传。
- 不要改 `contextIsolation` / `sandbox` / `nodeIntegration` 的安全组合。

### 渲染进程（`electron/renderer/`）

**职责**

- 渲染主进程给的 `cells`、`almanac`、`clocks`、`weather`、`openAtLogin`、版本号与更新横幅。
- 交互：上一月/下一月、年份下拉、返回今天、点击格子、登录项开关、世界时钟左右切换/添加/删除/搜索、检查更新、重启更新/下载新版、退出。
- 打开窗口时先用 `navigator.geolocation.getCurrentPosition` 取坐标（10 秒超时），再把坐标与定位来源（成功 / 失败 code+message / 无 `navigator.geolocation`）一起经 `weather:get` 传给主进程；主进程后台刷新通过 `weather:update` 推回。
- 指针进入/离开窗口根节点时通知主进程；Esc 由主进程的 `before-input-event` 处理。
- 手动检查时先本地显示「正在检查…」，之后应用主进程推来的状态；定时状态约 2.6 秒后恢复。

**边界**

- **不算农历**，不算时区，不映射 WMO 天气代码，不读 `lunar-javascript`，不直接访问文件系统或天气 API。CSP 不放开网络。
- 更新横幅的文案（「新版本已就绪」「重启更新」「无法自动更新，请手动下载」「下载新版」）在渲染层；短状态文案在 `update-status.js`。

**不要做**

- 不要为「更像参考图」引入第二套主题、外部字体或参考应用资源。
- 不要自己推断更新状态或版本。

### 可单测的纯逻辑模块

**职责**

- `calendar.js`：42 格、次要文字、菜单栏标题、「黄历」。
- `world-clocks.js`：城市目录与搜索、IANA 校验、世界时钟格式化、列表增删/绕回、偏好清洗。
- `weather.js`：WMO 代码中文映射、城市名选择、坐标校验、请求 URL、结果格式化，以及可注入 `fetch` 的主进程请求服务与 30 分钟缓存。
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
