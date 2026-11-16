# 栏历文档索引

本目录是栏历（macOS 菜单栏公历/农历月历）的产品文档，随仓库分发，供任何协作者使用，记录当前实现、约定与历史决策。所有内容以**当前仓库代码**为准；仓库外的旧交接文档只作历史对照（见 [product.md](product.md)）。

## 建议阅读顺序

1. 初次接触项目：[../AGENT.md](../AGENT.md) → [product.md](product.md) → [architecture.md](architecture.md)
2. 要改代码：[coding-discipline.md](coding-discipline.md) → [implementation.md](implementation.md) → [testing.md](testing.md)
3. 要改更新逻辑：[updater.md](updater.md) → [lessons-learned.md](lessons-learned.md) 中更新相关条目 → [decisions/0003](decisions/0003-unsigned-probe-and-self-update.md)
4. 要发版：[release.md](release.md)
5. 要排查线上问题：[development.md](development.md) 的日志一节 → [lessons-learned.md](lessons-learned.md)

## 文档清单

| 文档 | 何时读 | 内容 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 想了解全局 | 进程/目录、数据流、分层职责与边界 |
| [implementation.md](implementation.md) | 要定位实现 | 按模块走读日历、托盘窗口、更新、日志、IPC |
| [coding-discipline.md](coding-discipline.md) | 动手前 | 技术栈、可测试性、命令调用、发布红线 |
| [lessons-learned.md](lessons-learned.md) | 改更新/排查问题 | 往期现象、根因、处理、教训 |
| [development.md](development.md) | 搭环境/调试 | Node 版本、启动、日志、Gatekeeper |
| [release.md](release.md) | 发版/改版本号 | 版本同步点、CI 资产、Pages |
| [updater.md](updater.md) | 改更新子系统 | 当前自动更新与未签名包自更新行为 |
| [product.md](product.md) | 确认范围 | 当前功能、不做清单、与旧规格差异 |
| [testing.md](testing.md) | 写测试/验收 | 测试分布、写法约束、真机项 |
| [contributing.md](contributing.md) | 领任务/提 PR | 分支、提交、文档同步、完成标准 |
| [decisions/README.md](decisions/README.md) | 追溯决策 | ADR 索引 |

## 维护约定

- 改代码必须同步更新对应文档；发现文档与代码冲突时，以代码为事实并修正文档。
- 同一段故事只讲一处：决策背景放 [decisions/](decisions/README.md)，过程与教训放 [lessons-learned.md](lessons-learned.md)，当前设计放架构/实现/更新文档，其他位置只链接。
- 文档用中文；代码标识符、命令、路径、IPC 名、文件名、URL、日志关键字保持英文原文。
