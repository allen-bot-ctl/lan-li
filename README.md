# 栏历 0.1.4

栏历是一个 macOS 菜单栏应用：菜单栏常驻显示系统本地日期与时间（不再显示图标，只显示 `M月D日 HH:mm:ss`）；指针指向菜单栏项时，在正下方弹出只含公历月历、农历、库内节气与节日、右侧「此刻」信息的面板。日期计算完全在本机完成；打包版只会在启动后向 GitHub Release 检查更新，不上传任何数据。日历窗口左栏底栏始终有「检查更新」入口。

## 下载与主页

- 项目主页：https://allen-bot-ctl.github.io/lan-li/
- 最新安装包：https://github.com/allen-bot-ctl/lan-li/releases/latest
- 源码仓库：https://github.com/allen-bot-ctl/lan-li

当前 GitHub Release 与主页只提供 macOS Intel（x64）的 `.dmg`；其他平台等验收通过后再扩展。GitHub Actions 打出的正式下载目前只有 Intel x64。安装包未签名，首次打开可能被 Gatekeeper 拦截，处理方式见下文。

## 开发运行

需要 Node.js 20 或更高版本，并且只能在 macOS 上运行。

```bash
npm install
npm start
```

启动后不会出现 Dock 图标或主窗口，只在菜单栏出现 `11月15日 22:47:13` 形式的纯文字标题（没有托盘图标）。开发态 `electron .` 不会真正检查更新；点击底栏「检查更新」只会提示「开发态不检查更新」。点击「退出栏历」才会退出进程。

## 测试

```bash
npm test
```

使用 Node 内置 test runner，覆盖格子次要文字、42 格网格、今日/周末/节日标记、菜单栏标题格式、自动更新 feed URL 的拼接、「检查更新」状态文案的映射，以及更新器在 `setFeedURL` 抛异常时进入仅探测模式、204/200/网络失败三种探测结果、并发手动检查共享一次请求、Squirrel 报错后的 probe 回落，还有文件日志的 ISO 时间戳与 `main.old.log` 轮转。

## 打包

在 macOS 上执行：

```bash
npm run dist
```

`electron-builder` 会生成未签名的 dmg 与 zip，包含 x64 和 arm64：

- `dist/LanLi-0.1.4-mac-x64.dmg`
- `dist/LanLi-0.1.4-mac-x64.zip`
- `dist/LanLi-0.1.4-mac-arm64.dmg`
- `dist/LanLi-0.1.4-mac-arm64.zip`

本轮 `build.mac.identity` 为 `null`，不做代码签名与公证。GitHub Actions 的 Release 工作流只构建并发布 macOS Intel（x64）的 dmg 与 zip；本地执行 `npm run dist` 仍可能同时打出 x64 和 arm64。自动更新服务读取 Release 里的 `LanLi-<version>-mac-x64.zip`，不需要额外上传 `latest-mac.yml`。

## 自动更新

打包版使用 Electron 官方 `autoUpdater`，feed 指向官方静态服务：

```text
https://update.electronjs.org/allen-bot-ctl/lan-li/${process.platform}-${process.arch}/${app.getVersion()}
```

Intel Mac 上的 0.1.4 对应：

```text
https://update.electronjs.org/allen-bot-ctl/lan-li/darwin-x64/0.1.4
```

只有 macOS 且 `app.isPackaged === true` 时才设置 feed 并检查更新。启动约 10 秒后检查一次，之后每 6 小时检查一次；这些**自动检查**没有更新时完全静默。日历窗口左栏底栏始终显示「检查更新」入口：点击后立即检查，检查中显示「正在检查…」，无更新时短暂显示「已是最新」再恢复；开发态或非 macOS 显示「开发态不检查更新」。更新下载完成后，日历窗口底栏上方会出现「新版本已就绪」提示，用户点击「重启更新」后才调用 `autoUpdater.quitAndInstall()`，不会在未同意时强制退出。已下载但尚未重启的提示会在安装完成前每次打开窗口时再次出现。

未签名包无法使用 Squirrel.Mac：`autoUpdater.setFeedURL` 会因缺少代码签名直接抛出 `Could not get code signature for running application`，Squirrel 也不会替换应用。0.1.4 起，初始化遇到该错误不会再让更新器失效，而是进入仅探测 feed 模式：应用直接请求同一个 update.electronjs.org 地址，`204` 表示已是最新并显示「已是最新」，`200` JSON 表示有新版本并显示「需手动下载」，网络异常或超时则显示「检查失败」。手动点击「检查更新」会先显示「正在检查…」，重复点击共享同一次请求。

新版本仍需手动下载安装，不会自动替换当前应用。有新版本时请从 [最新 Release](https://github.com/allen-bot-ctl/lan-li/releases/latest) 或[主页](https://allen-bot-ctl.github.io/lan-li/)下载。Squirrel 能下载但无法安装的旧路径仍会显示一次「无法自动更新，请手动下载」；同一版本不会反复提醒。

### 运行日志

更新检查与错误会写入 `~/Library/Logs/栏历/main.log`（即 `app.getPath('logs')/main.log`），每行带 ISO 时间戳和级别，同时打印到终端。日志超过 1MB 时会在下次写入前轮转为同目录的 `main.old.log`。手动检查的开始和最终状态也会各写一行，例如 `manual check start`、`manual check result: up-to-date`。

排查「检查更新」问题时，请把 `~/Library/Logs/栏历/main.log` 发给开发者；其中不会包含日历内容或个人数据。

## 未签名包的 Gatekeeper 处理

首次打开未签名包时，macOS 可能提示无法验证开发者。可以：

1. 在 Finder 中右键「栏历」→「打开」，再在弹窗中确认「打开」。
2. 若已被拦截，打开「系统设置 → 隐私与安全性」，在安全区域点击「仍要打开」。
3. 必要时清除隔离属性后再打开：

   ```bash
   xattr -cr "/Applications/栏历.app"
   open "/Applications/栏历.app"
   ```

这些操作只用于本轮未签名体验包，不代表正式分发方式。未签名包也可能无法静默替换自动更新，此时请从主页或 Release 手动下载。

## 首次运行与「登录时打开」

首次运行会在 `app.getPath('userData')/preferences.json` 写入 `{ "loginItemInitialized": true }`，并调用 macOS 官方登录项 API 尝试打开登录项。之后启动不会再次强制打开。

窗口底部「登录时打开」开关始终显示 `app.getLoginItemSettings().openAtLogin` 的真实值。若未签名包被系统拒绝，开关会保持关闭，运行日志会写明设置后读回仍为 false；不会改用 LaunchAgent、login hook 或 crontab。

## 非 macOS

在 Windows / Linux 上启动时，会弹出「栏历首发只支持 macOS」的提示并退出，不会绘制仿菜单栏，也不会检查更新。

## 需要 macOS 真机确认

| 事项 | 说明 |
| --- | --- |
| 菜单栏是否只剩文字 | 0.1.1 起用空 `NativeImage` 创建 `Tray`，不再设置 `trayTemplate.png`；需确认菜单栏项只显示日期时间，图标位置不再占宽。 |
| 标题左右边距 | Electron / macOS 对纯文字状态项仍有系统级内边距，且没有公开 API 可继续压缩；需在真机确认剩余边距是否可以接受。 |
| 紧凑窗口是否仍好用 | 窗口已缩为 580×400；需确认 6×7 格子仍容易点击，农历副文案、星期行、右侧「此刻」、底栏都不被裁切或出现滚动条。 |
| 打包后的更新检查 | 需用 0.1.1 安装包升级到 0.1.2 实测：无更新时自动检查静默；有新版本时会下载并提示重启。由于包未签名，Squirrel.Mac 可能无法静默替换，此时应出现一次手动下载提示。 |
| 「检查更新」入口 | 底栏左侧「登录时打开」与右侧「检查更新 / 退出栏历」应始终可见且不被裁切；点击后需确认「正在检查…」「已是最新」「新版本已就绪 / 重启更新」「无法自动更新，请手动下载」以及开发态「开发态不检查更新」各状态正确，且自动检查不会长期占着横幅。在未签名包上，点击「检查更新」且已是最新时应显示「已是最新」，不应显示「检查失败」。 |
| `mouse-enter` / `mouse-leave` 是否始终触发 | 已按悬停打开、离开 200ms 关闭实现；若系统完全不触发悬停事件，点击菜单栏项仍可打开，并需报告平台与系统版本。 |
| 窗口与菜单栏缝隙 | 当前按 `y = 托盘.y + 托盘高` 无重叠对齐；若真机出现指针可穿过的缝，应将 y 改为 `托盘.y + 托盘高 - 1`，最多重叠 1px。 |
| 未签名包的 `openAtLogin` | 需确认首次运行后开关是否真的变为打开；若系统拒绝，开关应显示真实值并在运行日志中报告。 |
| 标题长度是否挤占菜单栏 | 标题固定包含秒；需观察在窄菜单栏或刘海里是否拥挤，不要自行去掉秒或改成 `11/15`。 |
| Gatekeeper 拦截未签名包 | 需按上文右键打开 /「仍要打开」/`xattr -cr` 流程实测。 |
