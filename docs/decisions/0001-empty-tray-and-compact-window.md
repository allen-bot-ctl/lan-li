# 0001 去掉菜单栏图标，窗口收紧为 580×400

## 背景

早期实现按交接文档使用 `electron/assets/trayTemplate.png` 作为菜单栏图标，窗口为 `680×470`，左侧 500px、右侧 180px。图标会额外占用菜单栏宽度，而产品真正需要常驻的是日期时间文字；面板尺寸也偏大。

## 决策

- 用 `new Tray(nativeImage.createEmpty())` 创建纯文字状态项，不再设置托盘图片；标题仍每秒 `setTitle(..., { fontType: 'monospacedDigit' })`。
- 窗口改为 `580×400`：左侧月历 `420px`，右侧橙栏 `160px`。
- 不设置右键菜单与 tooltip。

## 后果

- `trayTemplate.png` / `trayTemplate@2x.png` 仍在仓库，但代码不再引用。
- macOS/Electron 对纯文字状态项仍有系统级内边距，没有公开 API 可继续压缩；不要为此使用私有 API 或零宽字符。
- 紧凑尺寸下需真机确认格子、副文案、右侧「此刻」与底栏不被裁切，见 [../testing.md](../testing.md#需要-macos-真机确认的事项)。

## 相关提交

- `acdfd06`：去掉菜单栏图标并收紧日历窗口，接入 GitHub 自动更新。

## 相关文档

- [../lessons-learned.md](../lessons-learned.md#8-空托盘图标与紧凑窗口)
- [../implementation.md](../implementation.md#2-托盘与窗口electronmainjs)
