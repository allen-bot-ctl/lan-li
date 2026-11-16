# 编码纪律

本文是可执行的约定，不是风格建议。违反其中红线时，先停下来改设计，而不是在代码里绕。

## 技术栈与依赖

- JavaScript **CommonJS**（`require` / `module.exports`）。不用 TypeScript、ESM 构建链、Vue/React、Webpack/Vite。
- Node `>=20`（`package.json` 的 `engines.node`）。
- Electron `^31.7.7`；electron-builder `^26.0.12`。
- 唯一生产依赖：`lunar-javascript` **精确 `1.7.8`**。没有其他运行时依赖，不要新增 npm 依赖。
- 渲染层是静态 `calendar.html` / `calendar.css` / `calendar.js`，不要引入前端框架或组件库。
- 应用只能在 macOS 上运行；`npm test` 可在其他平台跑，但运行应用不行。

参考：`package.json`、[architecture.md](architecture.md)。

## 可测试性与副作用注入

- 纯逻辑模块（`calendar.js`、`world-clocks.js`、`weather.js`、`update-feed.js`、`update-status.js`、`app-version.js`、`logger.js`、`mac-self-update.js`）必须能在没有 Electron 的情况下被 `node --test` require。
- 所有外部副作用必须可注入：
  - 网络：`fetch` / `net.fetch`
  - 进程：`execFile`、`spawn`
  - 文件：`fs`、`path`、日志目录
  - 时间：`setTimeout` / `setInterval` / `pid` / `quit`
- 测试禁止真实网络、禁止访问真实 `/Applications`、禁止修改用户真实偏好文件。用临时目录与假实现。
- `createMacSelfUpdater` 的 `fetch`、`execFile`、`spawn`、`fs`、`path`、`logger`、`logsDir`、`getLogsPath`、`pid`、`quit` 都可注入；新增能力沿用这一模式。
- 参考：`electron/mac-self-update.js` 顶部注释与 `tests/mac-self-update.test.js` 的 `makeFetch` / `makeExecFile`。

## 外部命令与路径

- 调外部命令只用 `execFile` / `spawn` 的**参数数组**：`execFile('/usr/bin/ditto', ['-x', '-k', zipPath, staging])`。
- **禁止**把 URL、路径或版本号拼进 shell 字符串，也禁止 `shell: true`。
- 安装脚本正文必须保持静态；所有路径都是位置参数。当前脚本只从 `$1`…`$5` 取 PID、旧包、新包、备份、暂存目录。参考 `INSTALL_SCRIPT`。
- 对 `.app` 包及其父目录的 `rm/mv/access` 等操作使用 `original-fs`，不要用被 Electron asar 补丁过的 `fs`。`electron/main.js` 的 `originalFs` 注入与文件头注释是范例。
- 不要用私有 API 或零宽字符去压缩菜单栏内边距。

## 进程边界与 IPC

- preload 只暴露已有 IPC，不 `require` 业务模块，不暴露原始 `ipcRenderer`，不新增通用透传。
- 渲染进程**不算农历**；不要 `require('lunar-javascript')`，不要自己推导节气/节日/更新状态。
- 主进程负责 42 格、菜单栏标题、「黄历」、更新编排与日志。
- 不要扩大 IPC 清单而不更新 [implementation.md](implementation.md#6-ipc-完整清单) 与测试。
- 不要新增第二个窗口、设置页、右键菜单、Dock 图标或 Windows/Linux 主窗口。

## 日历与展示

- 次要文字顺序不可变：`getJieQi()` → `solar.getFestivals()` 拼 `lunar.getFestivals()` 的第一个非空 → 初一显示 `getMonthInChinese()+'月'` → 否则 `getDayInChinese()`。
- **禁止** `getOtherFestivals`（2026-11-11 不显示「光棍节」），也不要自建节日表来补。
- 永远 6×7=42 格，周一起始；不要改成「有几周算几周」。
- 菜单栏标题格式固定：月日不补零，时分秒补零；不要去掉秒或改成 `11/15`。
- 不要为「更像参考图」引入第二套主题、外部字体或参考应用资源；不要拷贝 `/Applications/万年历.app` 的任何文件。
- 窗口尺寸 `580×400`（左 420 / 右 160）改动必须同时改 `main.js` 与 CSS，并做真机确认。

## 提交与发布

- 提交主题用**朴素中文**，不加 `feat:` / `fix:` 等前缀。示例：`未签名包支持应用内下载校验并替换更新`。
- 提交前跑相关测试，通常直接 `npm test`。
- `electron-builder` 始终 `--publish never`；发布由 workflow 上传资产。
- 目前只正式发布 macOS Intel（x64）。
- **不要重写已经有下载的发布标签**；需要修正时发新版本。
- 只改本仓库，不要夹带或修改其他仓库的文件。
- 未签名包的登录项只允许回退到 `electron/login-item.js` 管理的本应用 LaunchAgent（`app.lanli.LanLi.plist`）；不要用 login hook、crontab，也不要改动其它 LaunchAgent。

## 文档与完成标准

- 改代码必须同步改相关文档：架构/实现/更新/发布/测试中至少一处，并检查交叉链接。入口见 [contributing.md](contributing.md)。
- UI 或更新类改动的完成标准包含**用户在 Intel Mac 真机确认**；自动化测试通过不等于完成。
- 不确定的平台事实先写进 [lessons-learned.md](lessons-learned.md) 或 [testing.md](testing.md) 的真机项，不要把它描述成已实现的检测逻辑。
