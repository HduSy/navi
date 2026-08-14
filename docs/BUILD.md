# Navi 打包流程（macOS app + dmg）

Navi 使用 [electron-vite](https://electron-vite.org) 构建渲染进程，用
[electron-builder](https://www.electron.build) 打包成 macOS `.app` / `.dmg` / `.zip`。

## 前置条件

- Node ≥ 22，pnpm ≥ 10.7（见根 `package.json` `engines`）
- macOS（打包目标平台）
- 依赖已安装：`pnpm install`

## 打包配置

全部集中在 `apps/desktop/package.json` 的 `build` 字段：

| 项 | 值 | 说明 |
|----|----|----|
| `appId` | `com.hbusy.navi` | 应用唯一标识 |
| `productName` | `Navi` | 产物名称 |
| `directories.buildResources` | `resources` | 图标等构建资源目录 |
| `mac.icon` | `resources/icon.icns` | macOS 应用图标 |
| `mac.target` | `["dmg", "zip"]` | 输出格式 |
| `mac.category` | `public.app-category.productivity` | Launchpad 分类 |
| `files` | `out/**/*`, `resources/icon.png`, `resources/icon.icns` | 打进 app 的文件 |

## 生成/更新图标

图标源文件：`apps/desktop/resources/navi-logo-b1-aperture-bite.svg`（定稿 B+ 版）。

从 SVG 重新生成 `icon.icns`（10 个 macOS 标准尺寸）与 `icon.png`：

```bash
cd apps/desktop/resources
SRC=navi-logo-b1-aperture-bite.svg
qlmanage -t -s 1024 -o . "$SRC"                 # SVG -> 1024 PNG
mv navi-logo-b1-aperture-bite.svg.png navi-logo-b1-aperture-bite-1024.png
cp navi-logo-b1-aperture-bite-1024.png icon.png  # 通用 1024 PNG（electron-builder 各平台用）

# iconset -> icns
rm -rf icon.iconset icon.icns
mkdir -p icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
cp icon.png icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
```

> 注：图标形状用 `rect rx` 圆弧圆角（上一版 B+），不是 squircle。若改回超椭圆需同时改
> `navi-logo-b1-aperture-bite.svg` 里的 clipPath。

## 打包

```bash
cd apps/desktop
pnpm dist        # = electron-vite build && electron-builder
```

产物输出到 `apps/desktop/dist/`：

```
dist/
  mac-arm64/Navi.app            # 可直接运行的 .app
  Navi-0.1.0-arm64.dmg          # 安装镜像（拖入 Applications）
  Navi-0.1.0-arm64-mac.zip      # zip 包
  *.blockmap                    # 增量更新用
```

## CI / 发版（GitHub Actions）

仓库配了两套 workflow（`.github/workflows/`）：

| workflow | 触发 | 作用 |
|---|---|---|
| `ci.yml` | push 到 main / PR | ubuntu 上跑 `pnpm typecheck` + `pnpm build`，防回归 |
| `release.yml` | 推 `v*` tag（也可手动 Run workflow） | macOS arm64 runner 打 dmg/zip，自动建 GitHub Release |

### 发版流程

版本号以 `apps/desktop/package.json` 的 `version` 为准（当前 `0.1.0`）。发版时：

```bash
git tag v0.1.0          # 版本号要和 package.json 一致
git push origin v0.1.0
```

push 后 `release.yml` 自动构建并创建 GitHub Release，附上 `Navi-<ver>-arm64.dmg`、
`Navi-<ver>-arm64-mac.zip` 及 blockmap。产物**未签名**（见常见问题 #1），
下载安装需手动绕过 Gatekeeper。

> ⚠️ electron-builder 创建的 Release 是**草稿（draft）**，不会自动公开。
> 发布到 Release 页面点一下「Publish release」，或命令行：
> `gh release edit v0.1.0 --draft=false`

### 发版 workflow 干了什么

1. `macos-latest`（arm64 runner，Apple Silicon）——与本机架构一致，原生编译
   `better-sqlite3`，无需交叉编译
2. `pnpm install --frozen-lockfile`（lockfile 已入库）
3. 清理 pnpm 跨平台断符号链接（常见问题 #2，否则 rebuild 报 ENOENT）
4. `electron-builder --publish always` + `GH_TOKEN` 自动建 Release 传产物

### 代码签名（可选）

runner 上没有 Developer ID 证书，workflow 用 `CSC_IDENTITY_AUTO_DISCOVERY=false`
强制跳过签名。若想发布签名 + 公证的版本：

1. 申请 Apple Developer 账号 + `Developer ID Application` 证书
2. 把证书导出为 `.p12`，在 repo Secrets 配 `CSC_LINK`（base64）与 `CSC_KEY_PASSWORD`
3. 去掉 `release.yml` 里 `CSC_IDENTITY_AUTO_DISCOVERY` 那行，electron-builder 会自动签名
4. 需要公证再配 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`

## 常见问题

### 1. 未签名导致「无法打开，因为 Apple 无法检查其是否包含恶意软件」

electron-builder 在无 `Developer ID Application` 证书时会跳过签名，产物被打上
`com.apple.quarantine` 隔离属性，首次打开被 Gatekeeper 拦截。

解决办法（二选一）：
- **开发者分发**：配置代码签名证书后打包，彻底免拦截
- **本地自用**：双击项目里的 `scripts/install.command`，它会对 `.app` 执行
  `xattr -dr com.apple.quarantine` 再打开，跳过弹窗

### 2. `@esbuild/*` / `@rollup/*` 等 pnpm 断符号链接导致 `ENOENT`

pnpm 只安装当前平台的可选依赖，但会在 `node_modules/.pnpm/node_modules/` 留下
指向未下载平台的**断符号链接**，electron-builder 的 `@electron/rebuild` 遍历时会报错：

```text
ENOENT: no such file or directory, stat '.../@esbuild/aix-ppc64'
```

清理所有断符号链接即可：

```bash
find node_modules/.pnpm/node_modules -maxdepth 3 -type l ! -exec test -e {} \; -delete
```

### 3. dev 模式 Dock 图标不显示自定义图标

macOS dev 模式下 Dock 显示的是 `Electron.app` 的图标（Electron 进程身份强占），
`app.dock.setIcon()` 在某些系统版本不可靠。要看真实图标请用打包后的 `.app`：

```bash
open apps/desktop/dist/mac-arm64/Navi.app
```

### 4. 图标改了但 Dock 还显示旧图标（缓存）

清 Dock / Launchpad 图标缓存：

```bash
killall Dock            # 会重启 Dock
# 或手动删除图标服务缓存目录后重启
rm -rf ~/Library/Caches/com.apple.iconservices.store
killall Dock
```
