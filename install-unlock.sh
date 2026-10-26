#!/usr/bin/env bash
# ============================================================
#  install-unlock.sh  —— Typora 本地解锁（Linux / macOS）
#
#  用法：
#    ./install-unlock.sh              # 自动探测安装路径
#    ./install-unlock.sh /opt/Typora  # 手动指定 resources 目录
#
#  依赖：node（用于解包/重打包 asar）
# ============================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 探测安装路径 ----------
detect_resources() {
  local candidates=(
    "/usr/share/typora/resources"
    "/usr/lib/typora/resources"
    "/opt/Typora/resources"
    "/opt/typora/resources"
    "/Applications/Typora.app/Contents/Resources"
    "$HOME/Applications/Typora.app/Contents/Resources"
    "/usr/local/share/typora/resources"
  )
  for p in "${candidates[@]}"; do
    if [ -f "$p/app.asar" ]; then echo "$p"; return 0; fi
  done
  # Linux tar.gz 解包版
  local tgz
  tgz=$(find "$HOME" /opt /usr/local -maxdepth 4 -type d -name resources \
        -path '*Typora*' 2>/dev/null | head -n1 || true)
  if [ -n "$tgz" ] && [ -f "$tgz/app.asar" ]; then echo "$tgz"; return 0; fi
  return 1
}

RES="${1:-}"
if [ -z "$RES" ]; then
  RES=$(detect_resources) || {
    echo "[ERROR] 未找到 Typora 安装目录，请手动指定："
    echo "        $0 /path/to/Typora/resources"
    exit 1
  }
fi
RES="${RES%/resources}"
RES="$RES/resources"

echo "[*] Typora resources: $RES"
[ -f "$RES/app.asar" ] || { echo "[ERROR] 缺少 $RES/app.asar"; exit 1; }

# ---------- 检查 node ----------
command -v node >/dev/null 2>&1 || { echo "[ERROR] 需要 node"; exit 1; }

# ---------- 权限 ----------
if [ ! -w "$RES" ]; then
  echo "[*] 需要写权限，尝试 sudo..."
  SUDO="sudo"
else
  SUDO=""
fi

# ---------- 1. 备份 ----------
if [ ! -f "$RES/app.asar.orig" ]; then
  echo "[1/5] 备份 app.asar"
  $SUDO cp "$RES/app.asar" "$RES/app.asar.orig"
else
  echo "[1/5] 备份已存在，跳过"
fi

# ---------- 2. 解包 ----------
echo "[2/5] 解包 app.asar"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
$SUDO node "$SRC_DIR/asar.js" "$RES/app.asar.orig" "$TMP/app"

# ---------- 3. 安装 unlock.js ----------
echo "[3/5] 安装 unlock.js"
$SUDO cp "$SRC_DIR/unlock.js" "$TMP/app/unlock.js"

# ---------- 4. 改 main ----------
echo "[4/5] 重定向入口 -> unlock.js"
$SUDO node -e '
const fs=require("fs");
const p=process.argv[1];
const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.main="unlock.js";
fs.writeFileSync(p, JSON.stringify(j,null,4));
' "$TMP/app/package.json"

# ---------- 5. 重打包 ----------
echo "[5/5] 重打包 app.asar"
$SUDO rm -f "$RES/app.asar"
$SUDO node "$SRC_DIR/asar_pack_noint.js" "$TMP/app" "$RES/app.asar"

echo ""
echo "[OK] 完成。启动 Typora 验证：应无激活弹窗、无'未激活'角标。"
echo "     诊断日志：~/.config/Typora/unlock.log"
echo "     还原：./uninstall-unlock.sh \"$RES\""
