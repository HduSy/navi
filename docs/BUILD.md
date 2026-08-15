# Navi 打包流程（macOS app + dmg）

Navi 使用 [Vite](https://vitejs.dev) 构建渲染进程（React），用 [Tauri](https://tauri.app)
（Rust + tauri-bundler）打包成 macOS `.app` / `.dmg`。

## 前置条件

- Node ≥ 22，pnpm ≥ 10.7（见根 `package.json` `engines`）
- macOS（打包目标平台）
- 依赖已安装：`pnpm install`

## 打包配置

全部集中在 `apps/desktop/src-tauri/tauri.conf.json`：

| 项 | 值 | 说明 |
|----|----|----|
| `identifier` | `com.hbusy.navi` | 应用唯一标识 |
| `productName` | `Navi` | 产物名称 |
| `bundle.icon` | `icons/icon.icns`, `icons/icon.png` | 应用图标 |
| `bundle.targets` | `["app", "dmg"]` | 输出格式 |
| `bundle.macOS.minimumSystemVersion` | `10.15` | 最低系统版本 |

## 生成/更新图标

图标源文件：`apps/desktop/resources/navi-logo-b1-aperture-bite.svg`（定稿 B+ 版）。
Tauri 的图标在 `apps/desktop/src-tauri/icons/`（`tauri.conf.json` 的 `bundle.icon` 指向这里）。

从 SVG 生成 1024 PNG，再用 `tauri icon` 一键生成全套图标（含 icns）：

```bash
cd apps/desktop/resources
qlmanage -t -s 1024 -o . navi-logo-b1-aperture-bite.svg   # SVG -> 1024 PNG
mv navi-logo-b1-aperture-bite.svg.png navi-logo-b1-aperture-bite-1024.png
cd ..
pnpm tauri icon resources/navi-logo-b1-aperture-bite-1024.png   # 输出到 src-tauri/icons/
```

> 注：图标形状用 `rect rx` 圆弧圆角（上一版 B+），不是 squircle。若改回超椭圆需同时改
> `navi-logo-b1-aperture-bite.svg` 里的 clipPath。

## 打包

```bash
cd apps/desktop
pnpm dist        # = tauri build（先跑 beforeBuildCommand: pnpm build:vite，
                 #   再编译 Rust 并打 bundle）
```

产物输出到 `apps/desktop/src-tauri/target/release/bundle/`：

- **macOS**：`bundle/macos/` → `Navi.app` + `Navi_<ver>_aarch64.dmg`
- **Windows**：`bundle/nsis/` → `Navi_<ver>_x64-setup.exe`（NSIS 安装包，按用户安装免管理员）
- **Linux**：`bundle/deb/`、`bundle/appimage/`（未在 CI 构建）

> 注意 `apps/desktop/dist/` 是 Vite 前端构建输出（`tauri.conf.json` 的
> `frontendDist`），**不是**打包产物。

## CI / 发版（GitHub Actions）

仓库配了两套 workflow（`.github/workflows/`）：

| workflow | 触发 | 作用 |
|---|---|---|
| `ci.yml` | push 到 main / PR | ubuntu 上跑 `pnpm typecheck` + 前端 `vite build`，防回归 |
| `release.yml` | 推 `v*` tag（手动 Run workflow 需选 `v*` tag 作 ref） | macOS（dmg/app）+ Windows（NSIS exe）并行构建，自动建 GitHub Release |

### 发版流程

版本号以 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 为准（当前 `0.3.1`）。发版时：

```bash
git tag v0.3.1          # 版本号要和 tauri.conf.json 一致
git push origin v0.3.1
```

push 后 `release.yml` 在 macOS + Windows 两个 runner 上并行构建，并把产物附到同一个
GitHub Release：`Navi_<ver>_aarch64.dmg` + `Navi.app`（macOS）、
`Navi_<ver>_x64-setup.exe`（Windows）。产物**未签名**（见常见问题 #1），
macOS 下载后需绕过 Gatekeeper，Windows 需绕过 SmartScreen。

> ⚠️ `tauri-action` 创建的 Release 是**草稿（draft）**，不会自动公开。
> 发布到 Release 页面点一下「Publish release」，或命令行：
> `gh release edit v0.3.1 --draft=false`

### 发版 workflow 干了什么

1. 矩阵 runner：`macos-latest`（arm64，Apple Silicon）+ `windows-latest`（x64），
   各跑各的原生目标（`aarch64-apple-darwin` / `x86_64-pc-windows-msvc`），
   原生编译 `rusqlite`，无需交叉编译；`fail-fast: false` 保证一个平台失败不拖累另一个
2. `pnpm install --frozen-lockfile`（lockfile 已入库）
3. `swatinem/rust-cache` 缓存 Cargo 构建产物，加速重复构建
4. `tauri-apps/tauri-action` 执行 `npm run tauri build`（所以
   `apps/desktop/package.json` 必须有 `"tauri": "tauri"` 脚本）+ `GH_TOKEN`
   自动建 Release、把两个平台的产物附到同一个 Release
   （Tauri 没有 electron-builder 的 `--publish` 参数，建 Release 交给 tauri-action）

### 代码签名（可选）

runner 上没有签名证书，产物未签名（macOS + Windows）。若想发布签名版本：

**macOS（签名 + 公证）**
1. 申请 Apple Developer 账号 + `Developer ID Application` 证书
2. 把证书安装到 runner 的 keychain，或在 repo Secrets 配
   `APPLE_SIGNING_IDENTITY` / `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD`
3. 需要公证再配 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`

**Windows（Authenticode 签名，消 SmartScreen 警告）**
1. 申请 Authenticode 代码签名证书，导出为 `.pfx`
2. 在 repo Secrets 配 `WINDOWS_CERTIFICATE`（base64）与 `WINDOWS_CERTIFICATE_PASSWORD`

配置后 tauri-action 会自动签名。

## 常见问题

### 1. 未签名导致「无法打开，因为 Apple 无法检查其是否包含恶意软件」

打包工具在无 `Developer ID Application` 证书时会跳过签名，产物被打上
`com.apple.quarantine` 隔离属性，首次打开被 Gatekeeper 拦截。

解决办法（二选一）：
- **开发者分发**：配置代码签名证书后打包，彻底免拦截
- **本地自用**：双击项目里的 `scripts/install.command`，它会对 `.app` 执行
  `xattr -dr com.apple.quarantine` 再打开，跳过弹窗

### 2. `@esbuild/*` 等 pnpm 断符号链接导致 `ENOENT`（Electron 时代遗留）

pnpm 只安装当前平台的可选依赖，但会在 `node_modules/.pnpm/node_modules/` 留下
指向未下载平台的**断符号链接**。Electron 时代的 `@electron/rebuild` 遍历会撞上它报
`ENOENT`。迁移到 Tauri 后构建走 cargo + vite，不再遍历这些链接，此问题已不适用；
`release.yml` 里对应的清理步骤也已移除。若遇到 vite/esbuild 相关 ENOENT，可手动清理：

```bash
find node_modules/.pnpm/node_modules -maxdepth 3 -type l ! -exec test -e {} \; -delete
```

### 3. dev 模式 Dock 图标不显示自定义图标

macOS dev 模式下 Dock 图标可能与打包后不一致。要看真实图标请用打包后的 `.app`：

```bash
open apps/desktop/src-tauri/target/release/bundle/macos/Navi.app
```

### 4. 图标改了但 Dock 还显示旧图标（缓存）

清 Dock / Launchpad 图标缓存：

```bash
killall Dock            # 会重启 Dock
# 或手动删除图标服务缓存目录后重启
rm -rf ~/Library/Caches/com.apple.iconservices.store
killall Dock
```
