#!/bin/bash
#
# Navi 一键安装脚本（跳过「不明开发者」Gatekeeper 拦截）
#
# 用法：
#   1. 先打包：cd apps/desktop && pnpm dist
#   2. 双击本文件（或在终端里执行 ./scripts/install.command）
#
# 作用：
#   - 在 dist/ 下找到打包好的 Navi.app（或已安装的 /Applications/Navi.app）
#   - 去掉 com.apple.quarantine 隔离属性（xattr），绕过 Gatekeeper 弹窗
#   - 若尚未安装到 /Applications，则拷贝过去
#   - 打开 Navi
#
# 注意：sudo 需要输入一次密码（用于写入 /Applications 和 xattr）

set -euo pipefail

# 定位脚本所在目录（双击运行时 cwd 是 ~，必须用绝对路径）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Navi.app"

# 候选 .app 路径
APP=""
for candidate in \
  "$SCRIPT_DIR/../apps/desktop/dist/mac-arm64/$APP_NAME" \
  "$SCRIPT_DIR/../dist/mac-arm64/$APP_NAME" \
  "/Applications/$APP_NAME" \
  "$HOME/Applications/$APP_NAME"; do
  if [ -d "$candidate" ]; then
    APP="$candidate"
    break
  fi
done

if [ -z "$APP" ]; then
  echo "❌ 找不到 $APP_NAME"
  echo "   请先在 apps/desktop 下执行：pnpm dist"
  echo "   打包产物位于 apps/desktop/dist/mac-arm64/$APP_NAME"
  read -r -p "按回车键退出..." _
  exit 1
fi

echo "✅ 找到应用：$APP"

# 目标安装位置
INSTALL_DIR="/Applications"
TARGET="$INSTALL_DIR/$APP_NAME"

# 1) 若不在 /Applications，先拷贝过去（需要 sudo）
if [ "$APP" != "$TARGET" ]; then
  echo "📦 正在复制到 $TARGET ..."
  sudo rm -rf "$TARGET"
  sudo cp -R "$APP" "$TARGET"
  APP="$TARGET"
fi

# 2) 去掉隔离属性，跳过「无法验证开发者」/「不明开发者」弹窗
echo "🔓 去除 Gatekeeper 隔离属性（com.apple.quarantine）..."
sudo xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# 3) 打开
echo "🚀 正在打开 Navi ..."
open "$APP"

echo ""
echo "🎉 安装完成，Navi 已启动。"
read -r -p "按回车键退出..." _
