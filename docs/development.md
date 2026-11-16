# 开发环境与调试

## 前置条件

- Node.js **20 或更高版本**（`package.json` 的 `engines.node`）。
- 应用只能在 **macOS** 上运行：主进程依赖 `app.dock.hide()`、`Tray`、`autoUpdater`、`original-fs` 与 macOS 登录项 API。
- `npm test` 只跑纯逻辑测试，可在非 macOS 上执行；它不能替代真机验收。
- 不需要全局安装 Electron。不要新增依赖。

## 安装 / 运行 / 测试

```bash
npm install
npm start      # electron .
npm test       # node --test tests/*.test.js
```

开发态行为：

- 没有 Dock 图标，也没有主窗口。
- 菜单栏出现纯文字标题，形如 `11月15日 22:47:13`，每秒更新；没有托盘图标。
- 开发态 `electron .` **不真正检查更新**；点击底栏「检查更新」只会得到「开发态不检查更新」。
- 只有底栏「退出栏历」会退出进程；Esc 只关面板。

打包见 [release.md](release.md)。本地 `npm run dist` 会尝试打 x64 与 arm64，产物在 `dist/`。

## 启动后应该看到什么

1. 菜单栏只有文字，没有额外图标（系统仍保留自身内边距）。
2. 指针移到菜单栏文字上，面板在正下方展开；离开约 200ms 收起。点击也能打开，已打开时点击不关闭。
3. 面板固定 `580×400`：左侧白色月历 `420px`，右侧橙色「黄历与世界时钟」栏 `160px`。
4. 底栏有「登录时打开」、版本号、检查更新、退出；顶部有年份下拉、上/下月、返回今天。
5. 没有右键菜单、天气、设置页或广告。

## 调试

### 日志

| 文件 | 位置 | 记录内容 |
| --- | --- | --- |
| `main.log` | `~/Library/Logs/栏历/main.log`（`app.getPath('logs')`） | 更新检查、feed 探测、自更新校验/暂存、错误；每行 ISO 时间戳 + 级别 |
| `main.old.log` | 同目录 | `main.log` 超过 1MB 后轮转出来的旧文件 |
| `update-install.log` | 同目录 | 安装脚本步骤：等待 pid、备份、替换、回滚、清理、重新打开 |

- 日志同时打印到终端。
- 日志不包含日历内容或个人数据；排查更新问题时把 `main.log` 与 `update-install.log` 一起收集。
- 关键关键字：`manual check start`、`manual check result: ...`、`entering probe-only mode`、`self-update ready`、`self-update failed`、`update-install:`。

### 更新相关

- 只有打包版（`app.isPackaged === true`）且 macOS 才会设置 feed 并检查。
- 未签名包的 `setFeedURL` 会失败，进入 probe-only；看到这条不是新问题，当前设计如此。详见 [updater.md](updater.md)。
- 想验证真实下载/替换，必须用打包后的 `.app`，并确认 `.zip` 与 `.zip.sha256` 同时存在于 Release。

### 渲染层

- 窗口 `webPreferences` 为 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；渲染层只有 `window.lanli`。
- 没有开发服务器：`calendar.html` 由 `loadFile` 直接加载。改 HTML/CSS/JS 后重启 `npm start`。
- 浮层尺寸以 `main.js` 常量和 CSS 的 `html, body` 为准，两处必须一致。

## Gatekeeper 与未签名包

当前包未签名、未公证，首次打开可能被 macOS 拦截。仅用于本轮体验：

1. Finder 中右键「栏历」→「打开」，在弹窗确认。
2. 已拦截时到「系统设置 → 隐私与安全性」点击「仍要打开」。
3. 必要时清除隔离属性：

   ```bash
   xattr -cr "/Applications/栏历.app"
   open "/Applications/栏历.app"
   ```

这些**不是**正式分发方式，也不代表已经签名。应用内自更新会先校验 sha256 再替换；当前 `.app` 不可写或被 AppTranslocation 隔离时会回退到手动下载 `.dmg`。

## 相关文档

- 编码约定：[coding-discipline.md](coding-discipline.md)
- 测试与真机项：[testing.md](testing.md)
- 更新行为：[updater.md](updater.md)
- 日志系统的实现：[implementation.md](implementation.md#5-日志electronloggerjs)
