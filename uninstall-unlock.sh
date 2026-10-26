#!/usr/bin/env bash
# ============================================================
#  uninstall-unlock.sh  —— 还原 Typora 原始 app.asar
#  用法：./uninstall-unlock.sh [/path/to/Typora/resources]
# ============================================================
set -euo pipefail

detect_resources() {
  for p in \
    "/usr/share/typora/resources" \
    "/usr/lib/typora/resources" \
    "/opt/Typora/resources" \
    "/opt/typora/resources" \
    "/Applications/Typora.app/Contents/Resources" \
    "$HOME/Applications/Typora.app/Contents/Resources" \
    "/usr/local/share/typora/resources"; do
    if [ -f "$p/app.asar.orig" ]; then echo "$p"; return 0; fi
  done
  return 1
}

RES="${1:-}"
if [ -z "$RES" ]; then
  RES=$(detect_resources) || { echo "[ERROR] 未找到备份，请手动指定"; exit 1; }
fi
RES="${RES%/resources}"; RES="$RES/resources"

[ -f "$RES/app.asar.orig" ] || { echo "[ERROR] 缺少 $RES/app.asar.orig"; exit 1; }

SUDO=""
[ -w "$RES" ] || SUDO="sudo"

echo "[*] 还原 $RES/app.asar"
$SUDO cp "$RES/app.asar.orig" "$RES/app.asar"
echo "[OK] 已还原。"
