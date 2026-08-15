#!/bin/bash
#
# Navi 一键安装脚本（跳过「不明开发者」Gatekeeper 拦截）
#
# 两种用法：
#   1. DMG 内双击：打开 Navi_*.dmg 后，直接双击本文件（与 Navi.app 同目录）
#   2. 本地开发：cd apps/desktop && pnpm dist 后，双击本文件
#
# 若双击本文件本身被 Gatekeeper 拦截（未签名应用的宿命），任选其一放行：
#   - 右键本文件 → 打开（macOS 14 及以下）
#   - 系统设置 → 隐私与安全性 → 仍要打开（macOS 15+）
#   - 或直接在终端执行：bash /Volumes/Navi/install.command
#
# 作用：
#   - 找到 Navi.app（DMG 同目录 / 本地打包产物 / 已安装的 /Applications）
#   - 若尚未安装，拷贝过去：优先 /Applications（admin 组用户免密码直写），
#     不可写时自动落到 ~/Applications——全程无 sudo、无密码
#   - 去掉 com.apple.quarantine 隔离属性（xattr），绕过 Gatekeeper 弹窗
#   - 打开 Navi
#
# 全程不需要输入任何密码。

set -euo pipefail

# 定位脚本所在目录（双击运行时 cwd 是 ~，必须用绝对路径）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Navi.app"

# 候选 .app 路径（按优先级）
APP=""
for candidate in \
  "$SCRIPT_DIR/$APP_NAME" \
  "$SCRIPT_DIR/../apps/desktop/src-tauri/target/release/bundle/macos/$APP_NAME" \
  "$SCRIPT_DIR/../apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/$APP_NAME" \
  "/Applications/$APP_NAME" \
  "$HOME/Applications/$APP_NAME"; do
  if [ -d "$candidate" ]; then
    APP="$candidate"
    break
  fi
done

if [ -z "$APP" ]; then
  echo "❌ 找不到 $APP_NAME"
  echo "   若从 DMG 运行：请确认本文件与 Navi.app 在同一目录"
  echo "   若本地开发：请先在 apps/desktop 下执行 pnpm dist"
  read -r -p "按回车键退出..." _
  exit 1
fi

echo "✅ 找到应用：$APP"

# 目标安装位置：优先 /Applications（admin 组用户免 sudo 直写）；
# 若目标已被 root 属主的旧拷贝占据（历史上用 sudo 装过）删不掉，
# 自动降级到 ~/Applications，保证全程无密码。
TARGET="/Applications/$APP_NAME"
if [ "$APP" != "$TARGET" ]; then
  echo "📦 正在安装 ..."
  rm -rf "$TARGET" 2>/dev/null || true
  if ! ditto "$APP" "$TARGET" 2>/dev/null; then
    INSTALL_DIR="$HOME/Applications"
    TARGET="$INSTALL_DIR/$APP_NAME"
    mkdir -p "$INSTALL_DIR"
    rm -rf "$TARGET" 2>/dev/null || true
    ditto "$APP" "$TARGET"
    echo "   ℹ️ /Applications 下有 root 属主的旧拷贝删不掉，已改装到 $INSTALL_DIR"
    echo "      （想清理旧拷贝可手动执行一次：sudo rm -rf /Applications/$APP_NAME）"
  fi
  APP="$TARGET"
fi
echo "✅ 安装位置：$APP"

# 去掉隔离属性，跳过「无法验证开发者」/「不明开发者」弹窗（自家目录无需 sudo）
echo "🔓 去除 Gatekeeper 隔离属性（com.apple.quarantine）..."
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 打开
echo "🚀 正在打开 Navi ..."
open "$APP"

echo ""
echo "🎉 安装完成，Navi 已启动。"
read -r -p "按回车键退出..." _
