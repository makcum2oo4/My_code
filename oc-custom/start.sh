#!/usr/bin/env bash
set -e

PROJECT_DIR="/workspaces/My_code/oc-custom"
LOG_FILE="/tmp/oc-custom.log"
PROXY_SCRIPT="$PROJECT_DIR/proxy.js"

if pkill -f "node.*proxy.js" 2>/dev/null; then
  echo "Stopping existing proxy..."
  sleep 1
fi

cd "$PROJECT_DIR"

setsid nohup node "$PROXY_SCRIPT" > "$LOG_FILE" 2>&1 &

PROCESS_ID=$!
echo $PROCESS_ID > /tmp/oc-custom-pid
echo "Started proxy on 0.0.0.0:3000 (PID: $PROCESS_ID)"
echo "Log: $LOG_FILE"

sleep 2

if curl -sf http://127.0.0.1:3000/__custom/ping > /dev/null 2>&1; then
  echo "Proxy is healthy"
else
  echo "Proxy health check FAILED"
  cat "$LOG_FILE"
  exit 1
fi

# Start Telegram bot
setsid nohup node "$PROJECT_DIR/tg-bot.js" > /tmp/oc-tg.log 2>&1 &
echo "Telegram bot started (PID: $!)"
echo "Log: /tmp/oc-tg.log"