# AGENT.md

栏历是 macOS 菜单栏公历/农历月历（Electron，当前 `0.1.11`）。仓库：https://github.com/allen-bot-ctl/lan-li ；主页：https://allen-bot-ctl.github.io/lan-li/ 。

## 文档地图

| 先读 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 文档索引与阅读顺序 |
| [docs/product.md](docs/product.md) | 产品功能、范围、与旧交接文档的差异 |
| [docs/architecture.md](docs/architecture.md) | 进程边界、目录、数据流、分层职责 |
| [docs/implementation.md](docs/implementation.md) | 日历、托盘窗口、更新、日志、IPC 的代码走读 |
| [docs/coding-discipline.md](docs/coding-discipline.md) | 编码约定与红线（动手前必读） |
| [docs/development.md](docs/development.md) | 环境、运行、调试、日志位置 |
| [docs/testing.md](docs/testing.md) | 测试怎么写/怎么跑、真机验收项 |
| [docs/updater.md](docs/updater.md) | 更新子系统当前行为（改更新前必读） |
| [docs/release.md](docs/release.md) | 版本号同步、打标签、CI 发布、Pages |
| [docs/lessons-learned.md](docs/lessons-learned.md) | 往期踩坑与教训 |
| [docs/contributing.md](docs/contributing.md) | 领任务、分支/PR、文档同步 |
| [docs/decisions/README.md](docs/decisions/README.md) | ADR 索引（关键决策背景） |

## 黄金规则（精简版，详见 [docs/coding-discipline.md](docs/coding-discipline.md)）

1. JavaScript CommonJS，唯一生产依赖 `lunar-javascript@1.7.8`；不引入 TypeScript、前端框架或第二个日历库。
2. 渲染进程只展示与转发操作，**不算农历**；农历/节气/节日全部由主进程 `electron/calendar.js` 计算。
3. 次要文字顺序固定；**禁止** `getOtherFestivals`（例如 2026-11-11 不显示「光棍节」）。
4. 纯逻辑模块必须可注入、可被 `node --test` 直接 require；测试不联网、不碰真实 `/Applications`。
5. 调外部命令只用 `execFile` / `spawn` 的参数数组；安装脚本正文静态，路径全部作为位置参数。
6. 对 `.app` 包的文件操作使用 `original-fs`，不要用被 Electron 打补丁的 `fs`。
7. 不要随意扩大 preload/IPC；不要为「更像参考图」引入第二套主题或参考应用资源。
8. 提交主题用朴素中文，不加 `feat:` / `fix:` 前缀。
9. 改代码必须同步改相关文档；发布标签一旦有下载就不要重写。
10. 涉及 UI 或更新的改动，完成标准包含用户的 Intel Mac 真机确认。

## 常用命令

需要 Node.js 20+。应用只能在 macOS 上运行；`npm test` 本身可在任意平台跑。

```bash
npm install     # 安装依赖
npm test        # node --test tests/*.test.js
npm start       # 开发态运行 electron .（不真正检查更新）
npm run dist    # electron-builder --mac，会尝试打 x64 + arm64
```

正式发布流程见 [docs/release.md](docs/release.md)。本地 `npm run dist` 不是正式发布，产物在 `dist/`。

## 提交说明

- 主题用**朴素中文**，不要 `feat:` / `fix:` 等前缀。
- 现有示例：
  - `未签名包支持应用内下载校验并替换更新`
  - `在日历窗口底栏显示当前版本号`
  - `将发布构建改用 macos-15-intel 以避开 arm64 队列不足`
- 提交前至少跑 `npm test`；细节见 [docs/contributing.md](docs/contributing.md)。

## 发布流程

1. 推送标签 `vX.Y.Z`。
2. [`.github/workflows/release.yml`](.github/workflows/release.yml) 在 `macos-15-intel` 上构建。
3. 构建命令：`npx electron-builder --mac dmg zip --x64 --publish never`，环境变量 `CSC_IDENTITY_AUTO_DISCOVERY=false`。
4. 目前只发布 macOS Intel（x64）的 `LanLi-<ver>-mac-x64.dmg`、`.zip`、`.zip.sha256`。
5. **不要重写已经有下载的标签。**

## 「完成」的定义

- `npm test` 通过。
- 涉及 UI / 更新的改动，已由用户在 Intel Mac 真机上确认。
- 自动化测试或文档不能替代真机验证；本文档不声称已完成真机验收。
