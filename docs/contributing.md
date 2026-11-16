# 参与开发

## 领任务

- 先读 [product.md](product.md) 确认是否在范围内；范围外的需求（多日天气预报、天气设置、设置页、第二套主题等）先和产品确认，不要直接实现。
- 再读 [architecture.md](architecture.md) 与 [implementation.md](implementation.md) 定位模块；更新相关必须读 [updater.md](updater.md) 与 [lessons-learned.md](lessons-learned.md)。
- 动手前按 [coding-discipline.md](coding-discipline.md) 检查红线：依赖、IPC、农历计算、外部命令、`original-fs`。

## 在本仓库工作

- 仓库：`/workspace/projects/lan-li`，主分支 **`master`**。
- 当前没有书面规定的复杂分支模型；不要发明 GitFlow。修一个小问题可以直接在 `master` 上工作，较大改动建议单独分支，提交前与维护者确认。
- 只改本仓库。不要改 EasyLens、mian-xi 等其他项目。
- 不要新增 npm 依赖；如确有必要，先讨论，并同步 `package.json` 与 `package-lock.json`。

## 提交

- 主题用**朴素中文**，不加 `feat:` / `fix:` / `chore:` 等前缀。
- 可参考现有 log：
  - `未签名包支持应用内下载校验并替换更新`
  - `在日历窗口底栏显示当前版本号`
  - `将发布构建改用 macos-15-intel 以避开 arm64 队列不足`
- 一次提交尽量只做一件事；更新逻辑、UI、文档可以分开提交。
- 提交前至少跑 `npm test`（当前 71 个测试应全过）。

## PR / 合并

- 说明改了什么、为什么改、怎么验证；涉及 UI 或更新时写明真机验证情况。
- 仓库目前没有为 PR 配置独立的 CI 检查。能确认的自动化只有：
  - `.github/workflows/release.yml`：推送 `v*` 标签时跑 `npm test` 并构建/发布；
  - `.github/workflows/pages.yml`：`master` 推送或手动触发时发布 `site/`。
- 不要虚构 CODEOWNERS、必过检查或审核流程；以仓库实际配置为准。
- 合并前确认没有把未完成的调试代码、临时文件或 `dist/` 产物带进来。

## 改代码必改文档

- 改实现：至少更新 [implementation.md](implementation.md)，必要时更新 [architecture.md](architecture.md)。
- 改更新：更新 [updater.md](updater.md)，并在 [lessons-learned.md](lessons-learned.md) 记录新的真机事实（如果有）。
- 改版本/发布流程：更新 [release.md](release.md)。
- 改测试或验收项：更新 [testing.md](testing.md)。
- 改产品范围：更新 [product.md](product.md)。
- 新增关键决策：在 [decisions/](decisions/README.md) 加一篇短 ADR，并更新索引。
- 检查相对链接能解析到真实文件。

## 完成标准

- `npm test` 通过。
- 相关文档已同步。
- 涉及 UI / 更新的改动，已由用户在 **Intel Mac 真机**上确认；自动化测试不能替代菜单栏悬停、窗口缝隙、登录项、Gatekeeper 与自更新替换的验收。
- 发布相关改动遵守 [release.md](release.md)：`--publish never`、只发 x64、不重写已有下载的标签。

## 相关文档

- 文档索引：[README.md](README.md)
- 编码红线：[coding-discipline.md](coding-discipline.md)
- 测试与真机项：[testing.md](testing.md)
- 发布：[release.md](release.md)
