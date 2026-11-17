# 决策记录（ADR）

每则只记录背景、决策、后果与相关提交。过程与教训在 [../lessons-learned.md](../lessons-learned.md)，当前实现见 [../architecture.md](../architecture.md) 与 [../updater.md](../updater.md)。

| 编号 | 决策 | 相关提交 |
| --- | --- | --- |
| [0001](0001-empty-tray-and-compact-window.md) | 去掉菜单栏图标，窗口收紧为 580×400 | `acdfd06` |
| [0002](0002-macos-15-intel-runner.md) | Release 使用 `macos-15-intel` | `f5b63c9` |
| [0003](0003-unsigned-probe-and-self-update.md) | 未签名包走 probe-only + 应用内自更新，而不是打开 Release 页 | `ba31737`、`8ec7534` |
| [0004](0004-almanac-styles.md) | 黄历风格用固定逐词映射，而非随机抽取；文案原创，不借用「程序员老黄历」 | 0.1.20 |
| [0005](0005-almanac-focus.md) | 黄历聚焦用百年稀有度静态表选 1 宜 1 忌，建除签语，不过滤词条；完整宜忌进面板 | 0.1.21 |

## 新增 ADR

- 文件名：`NNNN-short-kebab-title.md`，四位数递增。
- 结构：背景 / 决策 / 后果 / 相关提交。
- 不要复述 lessons 全文；链接过去即可。
