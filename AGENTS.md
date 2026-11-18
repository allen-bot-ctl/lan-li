# AGENTS.md

栏历是 macOS 菜单栏公历/农历月历（Electron，当前 0.1.24）。仓库：https://github.com/allen-bot-ctl/lan-li ；主页：https://allen-bot-ctl.github.io/lan-li/ 。本文件是 agent 的入口；详细规则先读 [docs/coding-discipline.md](docs/coding-discipline.md)。

## 验证命令（完成标准，必须当轮执行）

```bash
npm install
npm test                    # Node 单测：node --test tests/*.test.js
npm run e2e                 # Playwright _electron 端到端（macOS）
xvfb-run -a npm run e2e     # Linux 无头机
npm start                   # 真启动冒烟：menu bar 出现时间、悬停能打开 580×400 面板
```

- 每次改代码至少跑 `npm test`；涉及 UI / 托盘 / 钉住 / 窗口行为还必须跑 `npm run e2e`（Linux 用 `xvfb-run -a`）。
- **打包成功 ≠ 能运行。** 发布前必须真启动一次（`npm start` 或安装打出的 `.app`），确认菜单栏出现、面板能打开、日志无启动异常。
- **没有当轮验证输出不算完成。** 交付说明里贴出 `npm test`、`npm run e2e` 的通过条数与真启动冒烟的观察结果；只写「应该没问题」视为未完成。
- `npm run e2e` 只在 `LANLI_E2E=1` 时启用主进程测试钩子；正式运行不暴露。C6 顶栏宽度以 macOS CI 为准。

## 红线（精简版，详见 [docs/coding-discipline.md](docs/coding-discipline.md)）

1. JavaScript **CommonJS**；唯一生产依赖 `lunar-javascript@1.7.8`；不引入 TypeScript、前端框架或第二个日历库。
2. 渲染进程只展示与转发操作，**不算农历**；农历/节气/节日全部由主进程 `electron/calendar.js` 计算。
3. 次要文字顺序固定：节气 → 公历/农历节日第一个非空 → 初一「X月」→ 农历日。**禁止** `getOtherFestivals` 或自建节日表。
4. 永远 6×7=42 格，周一起始；窗口 `580×400`，菜单栏标题月日不补零、时分秒补零且保留秒。
5. 纯逻辑模块必须可注入、可被 `node --test` 直接 require；测试不联网、不碰真实 `/Applications`、不改用户真实偏好。
6. 调外部命令只用 `execFile` / `spawn` 的参数数组，禁止 shell 字符串与 `shell: true`；安装脚本正文静态，路径全部走位置参数。
7. 对 `.app` 包的文件操作使用 `original-fs`，不要用被 Electron 打补丁的 `fs`。
8. 不随意扩大 preload/IPC；新增频道必须同步 [docs/implementation.md](docs/implementation.md#6-ipc-完整清单) 与测试。不新增第二个窗口、设置页、右键菜单或 Dock 图标。
9. 钉住状态只存在内存，不写 `preferences.json`；不要为「更像参考图」引入第二套主题或参考应用资源。
10. 改代码必须同步改相关文档；提交主题用**朴素中文**，不加 `feat:` / `fix:` 前缀。
11. 发布标签一旦有下载就不要重写；修正走新补丁版本。
12. 只改本仓库，不夹带其他仓库的文件；未签名包的登录项只允许本应用 LaunchAgent。
13. UI / 更新类改动的最终完成标准包含用户在 Intel Mac 真机确认；自动化通过不能替代真机验收。

## 常用命令

```bash
npm install     # 安装依赖（Node 20+）
npm test        # node --test tests/*.test.js
npm run e2e     # Playwright 端到端；Linux 用 xvfb-run -a
npm start       # 开发态运行 electron .
npm run dist    # electron-builder --mac，产物在 dist/（非正式发布）
```

正式发布见 [docs/release.md](docs/release.md)。

## 文档地图

| 先读 | 内容 |
| --- | --- |
| [docs/product.md](docs/product.md) | 产品功能与范围 |
| [docs/architecture.md](docs/architecture.md) | 进程边界、目录、数据流 |
| [docs/implementation.md](docs/implementation.md) | 代码走读与 IPC 清单 |
| [docs/testing.md](docs/testing.md) | 单测 / e2e 怎么跑与真机项 |
| [docs/updater.md](docs/updater.md) | 更新子系统（改更新前必读） |
| [docs/release.md](docs/release.md) | 版本、标签、CI 发布 |
| [docs/lessons-learned.md](docs/lessons-learned.md) | 往期踩坑 |
| [docs/decisions/README.md](docs/decisions/README.md) | ADR 索引 |
