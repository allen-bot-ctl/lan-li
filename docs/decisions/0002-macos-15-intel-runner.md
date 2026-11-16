# 0002 Release 使用 macos-15-intel

## 背景

Release 工作流原先使用 `macos-latest`。该 runner 的 arm64 队列不足，工作流曾两次等不到 runner 被取消，而项目只需要构建并发布 macOS Intel（x64）产物。

## 决策

`release.yml` 的 macOS 构建 job 固定为：

```yaml
runs-on: macos-15-intel
```

## 后果

- runner 架构与发布目标（x64）一致，不再排 arm64 队列。
- 正式发布仍只有 x64；本地 `npm run dist` 仍可能同时打 x64 与 arm64。
- 将来若发布 arm64，需要重新评估 runner 与构建矩阵，并先完成真机验收。

## 相关提交

- `f5b63c9`：将发布构建改用 macos-15-intel 以避开 arm64 队列不足。

## 相关文档

- [../release.md](../release.md)
- [../lessons-learned.md](../lessons-learned.md#3-ci-runnermacos-latest-的-arm64-队列曾长期等不到)
