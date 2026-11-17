# 栏历 0.1.11

> 开发与协作文档：入口见 [AGENT.md](AGENT.md)，完整索引见 [docs/README.md](docs/README.md)。

栏历是一个 macOS 菜单栏应用：菜单栏常驻显示日期与时间（不再显示图标，只显示 `M月D日 HH:mm:ss`）；指针指向菜单栏项时，在正下方弹出只含公历月历、农历、库内节气与节日、右侧当日黄历、多时区世界时钟与一行天气的面板。农历与月历计算完全在本机完成；网络只用于当前天气（IP 定位、城市搜索与天气数据）与打包后的 GitHub Release 更新检查，不上传日历内容；手动城市搜索只发送输入的城市名。日历窗口左栏底栏始终有「检查更新」入口（与「退出栏历」同为图标 + 文字按钮），当前版本号（如 `v0.1.11`）显示在右栏（橙色区域）最底部、一条细分割线下方。世界时钟卡片可将当前时区「设为当前」，仅改变菜单栏显示用的时区（不修改系统时区，菜单栏也不显示时区标识）。0.1.6 起，未签名包也能在应用内下载新版本，重启后替换旧应用；0.1.11 起右栏新增天气，默认按 IP 定位，也可点击天气行手动选择城市。

## 下载与主页

- 项目主页：https://allen-bot-ctl.github.io/lan-li/
- 最新安装包：https://github.com/allen-bot-ctl/lan-li/releases/latest
- 源码仓库：https://github.com/allen-bot-ctl/lan-li

当前 GitHub Release 与主页只提供 macOS Intel（x64）的 `.dmg`；其他平台等验收通过后再扩展。GitHub Actions 打出的正式下载目前只有 Intel x64。安装包未签名，首次打开可能被 Gatekeeper 拦截，处理方式见下文。Release 中的 `.zip` 与同名 `.zip.sha256` 用于应用内自更新。

## 开发运行

需要 Node.js 20 或更高版本，并且只能在 macOS 上运行。

```bash
npm install
npm start
```

启动后不会出现 Dock 图标或主窗口，只在菜单栏出现 `11月15日 22:47:13` 形式的纯文字标题（没有托盘图标）。开发态 `electron .` 不会真正检查更新；点击底栏「检查更新」只会提示「开发态不检查更新」。点击「退出栏历」才会退出进程。

## 天气

右栏世界时钟下方显示一行 `城市 · 天气 · 温度°C`（如「上海 · 多云 · 8°C」）。默认用 ipwho.is 按 IP 定位，城市名直接取 IP 返回结果；天气来自国内 itboy 接口（`t.weather.itboy.net`，用打包的城市码表 `electron/data/china-city-codes.json` 把城市名换算成城市代码）与海外 wttr.in：中国城市（手动城市按保存的 `country`，IP 定位按 `country_code === 'CN'`）优先 itboy，失败自动回退 wttr.in，非中国城市直接用 wttr.in（均为主进程请求，无需 API key，单源超时 8 秒）。点击天气行会在右栏内打开城市搜索浮层：首项是「自动（按 IP）」，其余为 Open-Meteo 地理编码返回的「城市名 · 省/州 · 国家」；选中后面板立即关闭并显示「城市名 · 加载中…」，城市（含 `country` / `admin1`）保存到 `preferences.json` 的 `weatherCity`，新结果通过 `weather:update` 异步推送，选「自动」则删除并回到 IP。结果缓存 30 分钟，打开窗口时过期即刷新，应用运行期间每 30 分钟后台刷新一次。全部数据源失败才显示「天气暂不可用」，不弹窗。天气请求、数据来源、定位来源（手动/IP）与失败原因写入运行日志；不提供独立天气设置页。

## 测试

```bash
npm test
```

使用 Node 内置 test runner，覆盖格子次要文字、42 格网格、今日/周末/节日标记、菜单栏标题格式、黄历干支生肖年与农历月、世界时钟的城市搜索与 IANA 回退、时区格式化（含 DST 与半小时时区的墙上时间）、时区列表增删与绕回、偏好数据清洗、天气的城市码表匹配（精确/加后缀/去后缀/admin1 回退）/itboy 与 wttr.in 解析/itboy 失败回退 wttr.in/坐标校验/地理编码结果解析/`weatherCity`（含 `country` 与 `admin1`）读写与清除/手动城市优先的取位逻辑/结果格式化与 30 分钟缓存、自动更新 feed URL 的拼接、「检查更新」状态文案的映射、版本号标签 `formatVersionLabel` 的格式化（`v` 前缀、首尾空白与非法输入降级），以及更新器在 `setFeedURL` 抛异常时进入仅探测模式、204/200/网络失败三种探测结果、并发手动检查共享一次请求、Squirrel 报错后的 probe 回落。未签名包自更新另有独立测试：更新 URL 校验、semver 比较、DMG 直链推导、sha256 文件解析与校验失败、plist 版本不匹配、AppTranslocation / 不可写目录拒绝、已验证暂存复用、同一时间只跑一个任务，以及安装脚本的等待与回滚内容。文件日志的 ISO 时间戳与 `main.old.log` 轮转也在此覆盖。

## 打包

在 macOS 上执行：

```bash
npm run dist
```

`electron-builder` 会生成未签名的 dmg 与 zip，包含 x64 和 arm64：

- `dist/LanLi-0.1.11-mac-x64.dmg`
- `dist/LanLi-0.1.11-mac-x64.zip`
- `dist/LanLi-0.1.11-mac-x64.zip.sha256`（由发布工作流生成）
- `dist/LanLi-0.1.11-mac-arm64.dmg`
- `dist/LanLi-0.1.11-mac-arm64.zip`

本轮 `build.mac.identity` 为 `null`，不做代码签名与公证。GitHub Actions 的 Release 工作流只构建并发布 macOS Intel（x64）的 dmg、zip 与 zip 的 sha256 校验文件；本地执行 `npm run dist` 仍可能同时打出 x64 和 arm64。自动更新服务读取 Release 里的 `LanLi-<version>-mac-x64.zip`，不需要额外上传 `latest-mac.yml`。

## 自动更新

打包版使用 Electron 官方 `autoUpdater`，feed 指向官方静态服务：

```text
https://update.electronjs.org/allen-bot-ctl/lan-li/${process.platform}-${process.arch}/${app.getVersion()}
```

Intel Mac 上的 0.1.9 对应：

```text
https://update.electronjs.org/allen-bot-ctl/lan-li/darwin-x64/0.1.9
```

只有 macOS 且 `app.isPackaged === true` 时才设置 feed 并检查更新。启动约 10 秒后检查一次，之后每 6 小时检查一次；这些**自动检查**没有更新时完全静默。日历窗口左栏底栏始终显示「检查更新」入口；当前版本号显示在右栏底部（如 `v0.1.11`）。点击后立即检查，检查中显示「正在检查…」，无更新时短暂显示「已是最新」再恢复；开发态或非 macOS 显示「开发态不检查更新」。有更新时手动检查会显示「正在下载…」，自动检查则保持静默。

### 未签名包的应用内自更新

未签名包无法使用 Squirrel.Mac：`autoUpdater.setFeedURL` 会因缺少代码签名直接抛出 `Could not get code signature for running application`。0.1.6 起，初始化遇到该错误会进入仅探测 feed 模式：应用直接请求同一个 update.electronjs.org 地址，`204` 表示已是最新，`200` JSON 既表示有新版本，也给出发布包的 zip 地址。

0.1.6 起，未签名包会尝试真正的应用内更新，而不是把用户送到 Release 页面：

- 校验 feed 里的 URL：必须是 `https://github.com/allen-bot-ctl/lan-li/releases/download/v<version>/LanLi-<version>-mac-x64.zip`，标签与文件名版本一致，且严格大于当前版本。arm64、其他仓库、其他域名或版本不匹配都会直接回退。
- 从同一 Release 下载 zip 与 `LanLi-<version>-mac-x64.zip.sha256`（发布工作流自动生成），流式计算并比对 sha256。缺失校验文件、文件名不符或摘要不一致都会回退。超过 500 MB 的下载会中止。
- 用 `/usr/bin/ditto` 解压，确认解压目录顶层只有一个 `.app`，再用 `/usr/bin/plutil` 校验 `CFBundleShortVersionString` 等于目标版本、`CFBundleExecutable` 指向的可执行文件存在。
- 暂存目录是当前 `.app` 同级的 `.栏历-update-<version>`；验证通过后写入 `verified.json`。同一版本再次检查会复用已验证的暂存包，不会重复下载。同时只会有一个更新任务在跑。
- 准备完成后，底栏上方显示「新版本已就绪」和「重启更新」，与 Squirrel 下载完成后的提示一致。已就绪提示会在安装完成前每次打开窗口时再次出现。
- 点击「重启更新」后，应用把静态 `/bin/sh` 安装脚本写入暂存目录，所有路径都作为位置参数传入。脚本最多等待当前进程 60 秒，把旧 `.app` 移到同级 `.栏历-backup-<version>.app`，再把新 `.app` 移到原位置；移动失败会把备份移回。成功后再清除隔离属性、删除备份和暂存目录，并用 `open -n` 重新打开新版本。
- 任一环节失败都会记录原因并回退到「无法自动更新，请手动下载」，此时「下载新版」直接打开同版本的 `.dmg` 资产；只有版本号完全无法推导时才打开 Release 页面。同一版本的失败提醒仍然只出现一次。
- AppTranslocation、不可写的 `.app` 或其父目录、arm64、开发态等情况下不会尝试自更新，而是按上面的手动下载路径处理。

如果将来使用 Developer ID 签名，Squirrel.Mac 路径仍保留：下载完成后点击「重启更新」会调用 `autoUpdater.quitAndInstall()`。

**从 0.1.5 及更早版本升级：** 这些版本没有应用内自更新逻辑，必须手动下载并安装一次 0.1.6。安装 0.1.6 之后，后续版本就可以通过「检查更新 → 重启更新」在应用内完成替换。

### 运行日志

更新检查与错误会写入 `~/Library/Logs/栏历/main.log`（即 `app.getPath('logs')/main.log`），每行带 ISO 时间戳和级别，同时打印到终端。日志超过 1MB 时会在下次写入前轮转为同目录的 `main.old.log`。手动检查的开始和最终状态也会各写一行，例如 `manual check start`、`manual check result: up-to-date`。自更新的校验、暂存、失败原因也会写入这里。

安装脚本在应用退出后运行，步骤（等待旧进程、备份、替换、回滚、清理、重新打开）会带时间戳写入 `~/Library/Logs/栏历/update-install.log`。

排查更新问题时，请把这两个日志文件发给开发者；天气刷新也会写入 `main.log`（记录定位来源（手动/IP）、城市/天气结果与失败原因，不记录坐标）；日志中不会包含日历内容或个人数据。

## 未签名包的 Gatekeeper 处理

首次打开未签名包时，macOS 可能提示无法验证开发者。可以：

1. 在 Finder 中右键「栏历」→「打开」，再在弹窗中确认「打开」。
2. 若已被拦截，打开「系统设置 → 隐私与安全性」，在安全区域点击「仍要打开」。
3. 必要时清除隔离属性后再打开：

   ```bash
   xattr -cr "/Applications/栏历.app"
   open "/Applications/栏历.app"
   ```

这些操作只用于本轮未签名体验包，不代表正式分发方式。0.1.6 起的应用内自更新会先校验 sha256，再在重启时替换 `.app`；如果当前 `.app` 所在目录不可写或被 AppTranslocation 隔离，会自动回退到直接下载 `.dmg`。

## 首次运行与「登录时打开」

首次运行会在 `app.getPath('userData')/preferences.json` 写入 `{ "loginItemInitialized": true }`，并尝试打开登录项（系统 API 失败时回退到本应用自己的 LaunchAgent）。之后启动不会再次强制打开。

窗口底部「登录时打开」开关始终显示最终真实状态：优先使用 `app.getLoginItemSettings().openAtLogin`；若未签名包被系统拒绝（设置后读回仍为 false），主进程会写入用户级 LaunchAgent `~/Library/LaunchAgents/app.lanli.LanLi.plist`（`/usr/bin/open -a <当前 .app>`，`RunAtLoad`），开关随该文件显示为打开。关闭时同时清除系统登录项与该 plist。运行日志会记录系统拒绝与回退结果。

## 非 macOS

在 Windows / Linux 上启动时，会弹出「栏历首发只支持 macOS」的提示并退出，不会绘制仿菜单栏，也不会检查更新。

## 需要 macOS 真机确认

| 事项 | 说明 |
| --- | --- |
| 菜单栏是否只剩文字 | 0.1.1 起用空 `NativeImage` 创建 `Tray`，不再设置 `trayTemplate.png`；需确认菜单栏项只显示日期时间，图标位置不再占宽。 |
| 标题左右边距 | Electron / macOS 对纯文字状态项仍有系统级内边距，且没有公开 API 可继续压缩；需在真机确认剩余边距是否可以接受。 |
| 紧凑窗口是否仍好用 | 窗口已缩为 580×400；需确认 6×7 格子仍容易点击，农历副文案、星期行、右侧「黄历」、世界时钟、天气栏与底栏都不被裁切或出现滚动条。 |
| 右侧世界时钟 | 确认「黄历」压缩后仍完整显示干支生肖年与农历月（如「丙午马年·十月」）以及「宜」「忌」两行；世界时钟卡片内城市、`HH:mm:ss`、日期/星期都不溢出，且不再显示昨天/明天与时差；`+` / `×` / `‹` / `›` 在 160px 栏内可点。添加、左右切换（含绕回）、移除、移除到空列表后显示「点击 + 添加时区」，重启后时钟列表与当前索引保持不变。纽约/伦敦在夏令时前后墙上时间应按当前时刻变化；新德里显示半小时时间。 |
| 天气与城市 | 首次打开窗口时天气行应按 IP 显示城市、天气与温度（国内 IP 走 itboy，日志有「天气来源=itboy（城市 代码）」；海外 IP 走 wttr.in），且不应出现 macOS 定位授权提示；点击天气行应打开城市搜索浮层，首项为「自动（按 IP）」，搜索「东京」等应显示「城市名 · 省/州 · 国家」；选中后面板立即关闭并显示「城市名 · 加载中…」，不应等待网络，结果到达后天气行更新并写入 `preferences.json` 的 `weatherCity`；重启后仍使用该城市；选「自动」应删除 `weatherCity` 并回到 IP；断网或全部数据源失败只显示「天气暂不可用」且不弹窗；超过 30 分钟后重新打开应刷新，后台刷新不应出现重复请求风暴。 |
| 打包后的更新检查 | 需用 0.1.8 安装包升级到后续版本实测：无更新时自动检查静默；有新版本时手动检查显示「正在下载…」，下载校验成功后出现「新版本已就绪 / 重启更新」。点击重启后确认旧 `.app` 被备份、新 `.app` 替换成功并自动重新打开。 |
| 「检查更新」入口 | 底栏左侧「登录时打开」与右侧「检查更新 / 退出栏历」应始终可见且不被裁切；版本号显示在右栏底部，应显示当前安装包的真实版本（如 `v0.1.11`），且不会被检查状态文案覆盖。点击后需确认「正在检查…」「正在下载…」「已是最新」「新版本已就绪 / 重启更新」「无法自动更新，请手动下载」以及开发态「开发态不检查更新」各状态正确，且自动检查不会长期占着横幅。在未签名包上，点击「检查更新」且已是最新时应显示「已是最新」，不应显示「检查失败」。 |
| 未签名包自更新 | 确认 zip 与 `.zip.sha256` 同时存在；下载失败、摘要不符、plist 版本不符、当前 `.app` 不可写或被 AppTranslocation 隔离时应回退到直接打开同版本 `.dmg`。安装脚本执行详情见 `~/Library/Logs/栏历/update-install.log`。 |
| `mouse-enter` / `mouse-leave` 是否始终触发 | 已按悬停打开、离开 200ms 关闭实现；若系统完全不触发悬停事件，点击菜单栏项仍可打开，并需报告平台与系统版本。 |
| 窗口与菜单栏缝隙 | 当前按 `y = 托盘.y + 托盘高` 无重叠对齐；若真机出现指针可穿过的缝，应将 y 改为 `托盘.y + 托盘高 - 1`，最多重叠 1px。 |
| 未签名包的 `openAtLogin` | 在 macOS 15.7 Intel 未签名包上勾选「登录时打开」后，开关应保持开启；确认 `~/Library/LaunchAgents/app.lanli.LanLi.plist` 已写入、`Label` 为 `app.lanli.LanLi`、`ProgramArguments` 指向当前 `.app`、`RunAtLoad` 为 true，且注销/重启后应用确实自动打开。取消勾选后 plist 应被删除，重启不再自动打开。运行日志应记录系统 API 被拒绝与 LaunchAgent 回退。 |
| 标题长度是否挤占菜单栏 | 标题固定包含秒；需观察在窄菜单栏或刘海里是否拥挤，不要自行去掉秒或改成 `11/15`。 |
| Gatekeeper 拦截未签名包 | 需按上文右键打开 /「仍要打开」/`xattr -cr` 流程实测。 |
