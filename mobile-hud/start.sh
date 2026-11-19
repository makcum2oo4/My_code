#!/usr/bin/env bash
set -u
PORT=3000
if curl -sf http://127.0.0.1:$PORT/api/ping >/dev/null 2>&1; then exit 0; fi
cd /workspaces/My_code/mobile-hud
setsid nohup python3 server.py >/tmp/mobile-hud.log 2>&1 </dev/null &
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:$PORT/api/ping >/dev/null 2>&1; then exit 0; fi
  sleep 0.5
done
exit 1
