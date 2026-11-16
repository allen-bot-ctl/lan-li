# 项目架构

栏历是一个 macOS 菜单栏应用：菜单栏只显示文字日期时间，悬停弹出固定尺寸的月历面板。运行时是 Electron 主进程 + 一个隐藏/按需显示的渲染窗口；没有服务器、没有数据库，日历计算完全离线。

## 目录与进程

```
electron/
  main.js           主进程：生命周期、托盘、窗口、时钟、登录项、更新编排、IPC 注册
  preload.js        contextBridge 暴露 window.lanli，只转发既有 IPC
  calendar.js       农历/公历/42 格/菜单栏标题/「此刻」纯逻辑
  world-clocks.js   多时区城市目录、校验、列表操作与时钟格式化纯逻辑
  updater.js        自动更新编排（Squirrel 路径 + probe-only）
  mac-self-update.js 未签名包的应用内下载、校验、暂存、安装
  update-feed.js    feed URL 拼接与 204/200 语义
  update-status.js  手动检查状态的短文案映射
  app-version.js    底栏版本号格式化
  logger.js         文件日志与轮转
  renderer/         calendar.html / calendar.css / calendar.js，只负责展示与交互
  assets/           icon.png 与未再引用的 trayTemplate*.png
tests/              node:test 单测
site/               GitHub Pages 静态主页（不是应用运行时的一部分）
.github/workflows/  release.yml 发版；pages.yml 发布主页
```

- `electron/main.js`：唯一主进程入口（`package.json` 的 `main`）。持有 `Tray`、`BrowserWindow`、每秒定时器与更新器。
- `electron/preload.js`：窗口 `webPreferences` 中 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；通过 `contextBridge.exposeInMainWorld('lanli', ...)` 暴露有限 API。
- `electron/renderer/`：静态 HTML/CSS/JS。只做渲染、翻月、开关、世界时钟的显示/切换/搜索浮层、检查更新按钮、指针进出、Esc；不 `require('lunar-javascript')`，也不计算时区。
- `electron/calendar.js`、`world-clocks.js`、`update-feed.js`、`update-status.js`、`app-version.js`、`logger.js`、`mac-self-update.js`：可在没有 Electron 的情况下被 `node --test` require 的模块（`logger.js` 仅在默认取日志路径时惰性 require Electron）。
- `site/`：纯静态主页，由 `.github/workflows/pages.yml` 部署，不参与打包。

窗口尺寸常量在 `electron/main.js`：`WINDOW_WIDTH = 580`、`WINDOW_HEIGHT = 400`；`electron/renderer/calendar.css` 中 `html, body` 也是 `580px × 400px`。左侧目录区 `.calendar-pane` 为 `420px`，右侧橙栏 `.now-pane` 为 `160px`。改尺寸必须两处一起改，并重新做真机验收。

## 数据流

```text
系统本地时间 (new Date())
  ├─ 每秒 → calendar.formatMenuTitle() → tray.setTitle(..., { fontType: 'monospacedDigit' })
  └─ 面板可见时 → calendar.buildNow() + world-clocks.formatClock()
       → IPC calendar:onTick { now, clocks } → 渲染右侧「此刻」与世界时钟

用户操作（翻月/选年/返回今天/点击格子）
  → preload API → invoke calendar:setView / calendar:goToday
  → 主进程校验年月与焦点日 → calendar.buildCells(year, month, now)
  → 返回 { view, focus, cells[42], now, clocks, openAtLogin } → 渲染整月

世界时钟操作（添加/删除/左右切换/搜索）
  → preload addClock/removeClock/selectClock/searchClocks
  → 主进程 world-clocks 校验与列表操作 → 写 preferences.json
  → 返回 clocks 快照 → 渲染层只展示
```

- 农历计算只发生在主进程的 `electron/calendar.js`，底层是 `lunar-javascript@1.7.8` 的 `Solar.fromYmd`。完全离线。
- 时区格式化只发生在主进程的 `electron/world-clocks.js`，使用 `Intl.DateTimeFormat` 与注入的本地时区；渲染层不推导时差。
- 偏好文件：`app.getPath('userData')/preferences.json`，保存 `loginItemInitialized`、`updateNotifications`（每个版本的一次性手动下载提醒）与 `worldClocks`（`{ items: [{ id, label }], index }`）。
- 网络只在打包后发生：`update.electronjs.org` 的 feed 探测，以及 GitHub Release 资产下载。开发态不检查更新。
- 详细实现见 [implementation.md](implementation.md)；更新细节见 [updater.md](updater.md)。

## 分层职责与边界

### 主进程（`electron/main.js`）

**职责**

- 应用生命周期：`requestSingleInstanceLock()`、`app.whenReady()`、`window-all-closed` 不退出、`before-quit` 清理定时器与更新器。
- 菜单栏形态：`app.dock.hide()`、`Menu.setApplicationMenu(null)`、`new Tray(nativeImage.createEmpty())`、每秒写文字标题。
- 窗口：无边框、不可缩放、`alwaysOnTop`、默认隐藏；按托盘 bounds 与 `workArea` 定位；`mouse-enter` / `mouse-leave` / `click` / Esc 的开关逻辑。
- 状态与偏好：当前浏览年月、焦点日、首次登录项初始化、更新提醒去重、世界时钟列表与当前索引。
- 更新编排：创建 `mac-self-update` 实例、调用 `setupAutoUpdate`、把 `onReady` / `onManual` / `onStatus` 转成 IPC。
- 日志：`createLogger()` 写文件并在控制台输出。

**边界**

- 月历内容的计算不在这里：交给 `calendar.js`；世界时钟的校验、列表与格式化交给 `world-clocks.js`。
- 更新下载/校验/替换不在这里：交给 `updater.js` 与 `mac-self-update.js`，主进程只做依赖注入与回调。
- 注意：`main.js` 里仍有少量展示相关字符串（如窗口/托盘文案、更新日志前缀），但不要继续把整块 UI 拼装搬进来。

**不要做**

- 不要新增第二个窗口、设置页、Dock 图标或右键菜单。
- 不要在未签名包上绕过系统登录项 API（LaunchAgent / crontab / login hook）。
- 不要把路径或 URL 拼进 shell 字符串。

### preload（`electron/preload.js`）

**职责**

- 仅通过 `contextBridge` 暴露当前已有的 18 个 API（清单见 [implementation.md](implementation.md#6-ipc-完整清单)）。
- 把 `invoke` / `send` / `on` 一一对应到固定频道。

**边界**

- 不 `require` 业务模块，不读文件、不发网络请求、不算日期。
- 不暴露原始 `ipcRenderer`，不扩大 bridge。

**不要做**

- 不要为图省事加 `send(channel, ...)` 这类通用透传。
- 不要改 `contextIsolation` / `sandbox` / `nodeIntegration` 的安全组合。

### 渲染进程（`electron/renderer/`）

**职责**

- 渲染主进程给的 `cells`、`now`、`clocks`、`openAtLogin`、版本号与更新横幅。
- 交互：上一月/下一月、年份下拉、返回今天、点击格子、登录项开关、世界时钟左右切换/添加/删除/搜索、检查更新、重启更新/下载新版、退出。
- 指针进入/离开窗口根节点时通知主进程；Esc 由主进程的 `before-input-event` 处理。
- 手动检查时先本地显示「正在检查…」，之后应用主进程推来的状态；定时状态约 2.6 秒后恢复。

**边界**

- **不算农历**，不算时区，不读 `lunar-javascript`，不访问文件系统或网络。
- 更新横幅的文案（「新版本已就绪」「重启更新」「无法自动更新，请手动下载」「下载新版」）在渲染层；短状态文案在 `update-status.js`。

**不要做**

- 不要为「更像参考图」引入第二套主题、外部字体或参考应用资源。
- 不要自己推断更新状态或版本。

### 可单测的纯逻辑模块

**职责**

- `calendar.js`：42 格、次要文字、菜单栏标题、「此刻」。
- `world-clocks.js`：城市目录与搜索、IANA 校验、世界时钟格式化、列表增删/绕回、偏好清洗。
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

- `release.yml`：标签 `v*` 触发；Node 20；`npm ci`；`npm test`；`npx electron-builder --mac dmg zip --x64 --publish never`；生成 zip 的 sha256；上传并在 `ubuntu-latest` 创建 Release。
- `pages.yml`：`master` 推送或手动触发，把 `site/` 发布到 GitHub Pages。

**边界**

- `electron-builder` 必须带 `--publish never`，发布由 workflow 的上传步骤完成。
- 目前只正式构建/发布 macOS Intel x64。

**不要做**

- 不要重写已有下载的标签。
- 不要在没有真机验收的情况下扩大平台矩阵。
- 不要在 workflow 中改动产品行为（本次文档任务也不改 workflow）。

## 相关文档

- 核心实现走读：[implementation.md](implementation.md)
- 更新子系统：[updater.md](updater.md)
- 编码红线：[coding-discipline.md](coding-discipline.md)
- 决策记录：[decisions/README.md](decisions/README.md)
