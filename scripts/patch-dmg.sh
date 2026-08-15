#!/bin/bash
#
# 将 scripts/install.command 注入 tauri 打包好的 macOS DMG。
#
# 用法：
#   bash scripts/patch-dmg.sh [dmg路径]   # 省略参数时自动找 src-tauri/target 下最新的 dmg
#
# 原理：tauri 的 DMG 打包器不支持在镜像里放额外文件（DmgConfig 只有窗口/
# 图标位置配置），所以走「UDRW 转可写 → 挂载 → 拷入脚本 → Finder 重排布局 →
# UDZO 重新压缩」的路子，保留 tauri 原有图标布局。
#
# 结果：打开 DMG 可见 Navi.app / Applications 快捷方式 / install.command，
# 双击 install.command 即完成安装 + xattr 绕过 Gatekeeper。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_CMD="$SCRIPT_DIR/install.command"
VOLUME_NAME="Navi"                  # = tauri.conf.json productName（DMG 卷名）
WIN_BOUNDS="{100, 100, 760, 620}"   # 原始 660x400，加高给第三个图标腾位
CMD_POS="{180, 340}"                # 默认布局：app {180,170} / Applications {480,170}

# --- 定位 DMG ---
if [ $# -ge 1 ]; then
  DMG="$1"
else
  DMG="$(find "$SCRIPT_DIR/../apps/desktop/src-tauri/target" \
    -name '*.dmg' -type f -exec stat -f '%m %N' {} + 2>/dev/null \
    | sort -rn | head -n 1 | cut -d' ' -f2-)"
fi

if [ -z "${DMG:-}" ] || [ ! -f "$DMG" ]; then
  echo "❌ 找不到 DMG，请先打包：cd apps/desktop && pnpm dist"
  exit 1
fi
echo "🎯 目标：$DMG"

TMP="$(mktemp -d)"
MNT="$TMP/mnt"
cleanup() {
  hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# --- 1) 转可写镜像并扩容（app 约 20MB，512m 足够）---
echo "🔄 转换为可写镜像..."
hdiutil convert "$DMG" -format UDRW -o "$TMP/rw.dmg" -quiet
hdiutil resize -size 512m "$TMP/rw.dmg"

# --- 2) 挂载并注入脚本 ---
# 挂到默认 /Volumes 位置（Finder 的 AppleScript 才能寻址卷内项目）；
# 若用户已挂载同名卷，macOS 会自动改名（如 "Navi 1"），因此必须用
# hdiutil 的实际输出反查真实卷名，不能写死。
echo "📦 注入 install.command..."
ATTACH_OUT="$(hdiutil attach "$TMP/rw.dmg" -nobrowse)"
MNT="$(printf '%s\n' "$ATTACH_OUT" | awk -F'\t' '/\/Volumes\//{mnt=$NF} END{print mnt}' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$MNT" ] || { echo "❌ 未能解析挂载点"; exit 1; }
VOL_NAME="$(basename "$MNT")"
echo "   挂载于：${MNT}（卷名：${VOL_NAME}）"
ditto "$INSTALL_CMD" "$MNT/install.command"
chmod +x "$MNT/install.command"

# --- 3) Finder 布局：窗口加高 + 脚本图标就位（写回 .DS_Store）---
# 注：首次运行可能弹「想控制 Finder」的授权框；拒绝也不影响脚本注入，
# 只是 install.command 的图标位置走 Finder 默认摆放。
echo "🎨 调整 DMG 图标布局..."
osascript >/dev/null 2>&1 <<APPLESCRIPT || echo "⚠️ 布局调整失败（不影响注入），图标将按默认位置摆放"
tell application "Finder"
  tell disk "$VOL_NAME"
    open
    delay 1
    set current view of container window to icon view
    set the bounds of container window to $WIN_BOUNDS
    set position of item "install.command" to $CMD_POS
    close
  end tell
end tell
APPLESCRIPT

# --- 4) 卸载（Finder 关窗后可能仍占用，重试几次）---
echo "💤 卸载镜像..."
ok=0
for _ in 1 2 3 4 5; do
  if hdiutil detach "$MNT" -quiet; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "❌ 无法卸载 $MNT，请手动弹出后重试"; exit 1; }

# --- 5) 重新压缩回 UDZO，覆盖原 dmg ---
echo "🗜️  重新压缩..."
hdiutil convert "$TMP/rw.dmg" -format UDZO -o "$TMP/final.dmg" -quiet
mv "$TMP/final.dmg" "$DMG"

# --- 6) 校验 ---
hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -readonly -quiet
if [ -f "$MNT/install.command" ]; then
  echo "✅ 校验通过：$(basename "$DMG") 内含 install.command"
else
  echo "❌ 校验失败：未找到 install.command"
  exit 1
fi
hdiutil detach "$MNT" -quiet

echo "🎉 完成：$DMG"
