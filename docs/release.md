# 版本与发布

## 版本号同步点

改版本号时至少同步以下位置：

| 文件 | 改什么 |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | 顶层 `version` 与 `packages[""].version` |
| `README.md` | 标题 `# 栏历 X.Y.Z`、打包产物示例、`vX.Y.Z` 相关文案 |
| `site/index.html` | `data-app-version` 的版本文本；如首页文案有「当前版本」也要同步 |

当前版本：`0.1.7`。现有标签 `v0.1.0` … `v0.1.7`。

## 本地打包

```bash
npm run dist
```

等价于 `electron-builder --mac`。`package.json` 的 `build.mac.target` 仍同时包含 dmg 与 zip 的 `x64`、`arm64`，`build.mac.identity` 为 `null`（不签名、不公证）。因此本地可能产出：

```text
dist/LanLi-0.1.7-mac-x64.dmg
dist/LanLi-0.1.7-mac-x64.zip
dist/LanLi-0.1.7-mac-arm64.dmg
dist/LanLi-0.1.7-mac-arm64.zip
```

本地不会自动生成 `.zip.sha256`；正式发布由 workflow 生成。**本地 `npm run dist` 不是正式发布**，也不能替代真机验收。

## GitHub Release

触发：推送 `v*` 标签，例如：

```bash
git tag v0.1.8
git push origin v0.1.8
```

> 本仓库禁止重写**已经有下载**的发布标签。发现问题时发新版本，不要删标签重推。

`.github/workflows/release.yml` 的流程：

1. `macos` job，`runs-on: macos-15-intel`。
2. `actions/checkout@v4`；`actions/setup-node@v4`，Node 20，npm cache。
3. `npm ci`。
4. `npm test`。
5. 构建：

   ```bash
   npx electron-builder --mac dmg zip --x64 --publish never
   ```

   环境变量：`CSC_IDENTITY_AUTO_DISCOVERY: "false"`。

6. 生成 zip 校验和：

   ```bash
   cd dist
   for f in LanLi-*-mac-x64.zip; do
     shasum -a 256 "$f" > "$f.sha256"
   done
   ```

7. 上传 artifact：`dist/LanLi-*-mac-x64.dmg`、`dist/LanLi-*-mac-x64.zip`、`dist/LanLi-*-mac-x64.zip.sha256`。
8. `publish` job（`ubuntu-latest`）用 `softprops/action-gh-release@v2` 创建 Release，名称 `栏历 <tag>`，上传上述三类资产。

正式资产只有：

- `LanLi-<ver>-mac-x64.dmg`
- `LanLi-<ver>-mac-x64.zip`
- `LanLi-<ver>-mac-x64.zip.sha256`

**不需要** `latest-mac.yml`；update.electronjs.org 直接读 Release 资产。Release body 与 README/主页统一写明「0.1.5 及更早版本需手动安装一次 0.1.6」，见 [updater.md](updater.md#升级路径与文档口径)。

## GitHub Pages

`.github/workflows/pages.yml`：

- 触发：推送到 `master`，或 `workflow_dispatch`。
- 用 `actions/configure-pages@v5`、`actions/upload-pages-artifact@v3`（`path: site`）、`actions/deploy-pages@v4`。
- 发布地址：https://allen-bot-ctl.github.io/lan-li/ 。

`site/` 只是静态主页，不是应用运行时的一部分；`site/main.js` 会通过 GitHub API 读取 latest release，只挑选 macOS Intel（x64）的 `.dmg` 作为下载按钮目标。改版本号时同步 `site/index.html` 的 `data-app-version`。

## 发布红线

- `electron-builder` 始终 `--publish never`，发布交给 workflow。
- 目前只正式发布 macOS Intel x64；不要在没有真机验收时扩展平台。
- 不要重写已有下载的标签。
- 不要修改 `.github/workflows/release.yml` 来掩盖文档口径差异；需要时单独发版修正。
- 发布前确认 `npm test` 通过；涉及 UI / 更新的改动需要 Intel Mac 真机确认。

## 相关文档

- 更新资产如何被消费：[updater.md](updater.md)
- 测试：[testing.md](testing.md)
- 提交与分支：[contributing.md](contributing.md)
- runner 选择背景：[decisions/0002](decisions/0002-macos-15-intel-runner.md)
