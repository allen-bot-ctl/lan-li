# 决策记录（ADR）

每则只记录背景、决策、后果与相关提交。过程与教训在 [../lessons-learned.md](../lessons-learned.md)，当前实现见 [../architecture.md](../architecture.md) 与 [../updater.md](../updater.md)。

| 编号 | 决策 | 相关提交 |
| --- | --- | --- |
| [0001](0001-empty-tray-and-compact-window.md) | 去掉菜单栏图标，窗口收紧为 580×400 | `acdfd06` |
| [0002](0002-macos-15-intel-runner.md) | Release 使用 `macos-15-intel` | `f5b63c9` |
| [0003](0003-unsigned-probe-and-self-update.md) | 未签名包走 probe-only + 应用内自更新，而不是打开 Release 页 | `ba31737`、`8ec7534` |

## 新增 ADR

- 文件名：`NNNN-short-kebab-title.md`，四位数递增。
- 结构：背景 / 决策 / 后果 / 相关提交。
- 不要复述 lessons 全文；链接过去即可。
