#!/usr/bin/env bash
# Cairn web QA server — 常驻 dev server 供 Playwright 用
# 用法:
#   bash scripts/web_qa_up.sh       # 检测 + 拉起 (幂等, 已在跑就不动)
#   bash scripts/web_qa_up.sh --down # 停掉
#   bash scripts/web_qa_up.sh --status # 只看状态
#
# 加速原理: Metro cold bundle 45s → hot reload 1-2s。
# 只要 dev server 常驻, 每次改代码后 Playwright 直接连 localhost:8081
# 看新代码效果, 无需重启。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$PROJECT_ROOT/app"
PORT=8081
PID_FILE="$PROJECT_ROOT/.web_qa.pid"
LOG_FILE="$PROJECT_ROOT/.web_qa.log"

is_running() {
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" 2>/dev/null | grep -q "200"; then
    return 0
  fi
  return 1
}

status() {
  if is_running; then
    echo "✓ web QA server 正在跑 http://localhost:$PORT"
    if [ -f "$PID_FILE" ]; then echo "  pid=$(cat "$PID_FILE")"; fi
    return 0
  else
    echo "✗ web QA server 未跑"
    return 1
  fi
}

up() {
  if is_running; then
    echo "✓ 已经在跑 http://localhost:$PORT (skip)"
    return 0
  fi
  echo "→ 启动 expo web dev server on port $PORT..."
  cd "$APP_DIR"
  # 后台跑, 输出到 log
  nohup npx expo start --web --port "$PORT" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "  pid=$(cat "$PID_FILE"), log=$LOG_FILE"
  echo "→ 等待 up (max 90s)..."
  for i in $(seq 1 90); do
    if is_running; then
      echo "✓ up http://localhost:$PORT (took ${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "✗ 90s 超时, 看 $LOG_FILE 排查"
  return 1
}

down() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "→ 停 pid=$pid + 端口 $PORT 相关进程..."
    # Windows/Git Bash: taskkill 更可靠
    if command -v taskkill.exe >/dev/null 2>&1; then
      taskkill.exe //F //T //PID "$pid" 2>/dev/null || true
    else
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  # 兜底: 杀端口占用
  if command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | grep "LISTENING.*:$PORT " | awk '{print $NF}' | while read -r p; do
      taskkill.exe //F //PID "$p" 2>/dev/null || true
    done
  fi
  echo "✓ down"
}

case "${1:-up}" in
  --down|down|stop) down ;;
  --status|status) status ;;
  --up|up|"") up ;;
  *) echo "usage: $0 [up|down|status]"; exit 1 ;;
esac
