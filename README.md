# 栏历 0.1.0

栏历是一个 macOS 菜单栏应用：菜单栏常驻显示系统本地日期与时间；指针指向菜单栏项时，在正下方弹出只含公历月历、农历、库内节气与节日、右侧「此刻」信息的面板。完全离线，不发起网络请求。

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

启动后不会出现 Dock 图标或主窗口，只在菜单栏出现栏历图标和 `11月15日 22:47:13` 形式的标题。点击「退出栏历」才会退出进程。

## 测试

```bash
npm test
```

使用 Node 内置 test runner，覆盖格子次要文字、42 格网格、今日/周末/节日标记与菜单栏标题格式。

## 打包

在 macOS 上执行：

```bash
npm run dist
```

`electron-builder` 会生成未签名的 dmg 与 zip，包含 x64 和 arm64：

- `dist/LanLi-0.1.0-mac-x64.dmg`
- `dist/LanLi-0.1.0-mac-x64.zip`
- `dist/LanLi-0.1.0-mac-arm64.dmg`
- `dist/LanLi-0.1.0-mac-arm64.zip`

本轮 `build.mac.identity` 为 `null`，不做代码签名与公证，也不包含自动更新。GitHub Actions 的 Release 工作流只构建并发布 macOS Intel（x64）的 dmg 与 zip；本地执行 `npm run dist` 仍可能同时打出 x64 和 arm64。

## 未签名包的 Gatekeeper 处理

首次打开未签名包时，macOS 可能提示无法验证开发者。可以：

1. 在 Finder 中右键「栏历」→「打开」，再在弹窗中确认「打开」。
2. 若已被拦截，打开「系统设置 → 隐私与安全性」，在安全区域点击「仍要打开」。
3. 必要时清除隔离属性后再打开：

   ```bash
   xattr -cr "/Applications/栏历.app"
   open "/Applications/栏历.app"
   ```

这些操作只用于本轮未签名体验包，不代表正式分发方式。

## 首次运行与「登录时打开」

首次运行会在 `app.getPath('userData')/preferences.json` 写入 `{ "loginItemInitialized": true }`，并调用 macOS 官方登录项 API 尝试打开登录项。之后启动不会再次强制打开。

窗口底部「登录时打开」开关始终显示 `app.getLoginItemSettings().openAtLogin` 的真实值。若未签名包被系统拒绝，开关会保持关闭，运行日志会写明设置后读回仍为 false；不会改用 LaunchAgent、login hook 或 crontab。

## 非 macOS

在 Windows / Linux 上启动时，会弹出「栏历首发只支持 macOS」的提示并退出，不会绘制仿菜单栏。

## 需要 macOS 真机确认

| 事项 | 说明 |
| --- | --- |
| `mouse-enter` / `mouse-leave` 是否始终触发 | 已按悬停打开、离开 200ms 关闭实现；若系统完全不触发悬停事件，点击菜单栏项仍可打开，并需报告平台与系统版本。 |
| 窗口与菜单栏缝隙 | 当前按 `y = 托盘.y + 托盘高` 无重叠对齐；若真机出现指针可穿过的缝，应将 y 改为 `托盘.y + 托盘高 - 1`，最多重叠 1px。 |
| 未签名包的 `openAtLogin` | 需确认首次运行后开关是否真的变为打开；若系统拒绝，开关应显示真实值并在运行日志中报告。 |
| 标题长度是否挤占菜单栏 | 标题固定包含秒；需观察在窄菜单栏或刘海里是否拥挤，不要自行去掉秒或改成 `11/15`。 |
| Gatekeeper 拦截未签名包 | 需按上文右键打开 /「仍要打开」/`xattr -cr` 流程实测。 |
