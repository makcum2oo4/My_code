#!/usr/bin/env bash
cd /workspaces/My_code/oc-custom
export HOME="/home/vscode"
export PATH="/home/vscode/.local/bin:/home/vscode/.opencode/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ ! -x "$HOME/.opencode/bin/opencode" ] || [ ! -f "$HOME/.local/share/opencode/opencode.db" ]; then
    bash /workspaces/My_code/oc-custom/restore-home.sh 2>/dev/null || true
fi

echo "$(date) start-sh started src=manual whoami=$(whoami) PATH=$PATH" >> /workspaces/My_code/oc-custom/boot.log
exec 9>/tmp/oc-start-v2.lock
flock -n 9 || { echo "lock_held"; echo "$(date) start-sh skipped reason=lock_held" >> /workspaces/My_code/oc-custom/boot.log; exit 0; }

PROJECT_DIR="/workspaces/My_code/oc-custom"
LOG_FILE="/tmp/oc-custom.log"
WATCHDOG_PID="/tmp/oc-watchdog.pid"
STOP_PROXY="/tmp/proxy.stopped"

ROUTER_LOG="/tmp/oc-router.log"
if ! pgrep -f "oc-custom/llm-router.js" > /dev/null; then
    setsid nohup node "$PROJECT_DIR/llm-router.js" </dev/null >>"$ROUTER_LOG" 2>&1 9>&- &
fi

if [ ! -f "$STOP_PROXY" ] && ! pgrep -f "oc-custom/proxy.js" > /dev/null; then
    setsid nohup node "$PROJECT_DIR/proxy.js" </dev/null >>"$LOG_FILE" 2>&1 9>&- &
fi

ORCH_LOG="/tmp/oc-orchestrator.log"
if ! pgrep -f "oc-custom/orchestrator.js" > /dev/null; then
    setsid nohup node "$PROJECT_DIR/orchestrator.js" </dev/null >>"$ORCH_LOG" 2>&1 9>&- &
fi

if ! pgrep -f "opencode web" > /dev/null; then
    setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN </dev/null >>/tmp/oc-web.log 2>&1 9>&- &
fi

cat > /tmp/oc-watchdog.sh <<'WATCHEOF'
#!/bin/bash
while true; do
    sleep 3
    if ! pgrep -f "oc-custom/llm-router.js" > /dev/null; then
        setsid nohup node /workspaces/My_code/oc-custom/llm-router.js </dev/null >>/tmp/oc-router.log 2>&1 9>&- &
    fi
    if [ ! -f /tmp/proxy.stopped ]; then
        if ! pgrep -f "oc-custom/proxy.js" > /dev/null; then
            setsid nohup node /workspaces/My_code/oc-custom/proxy.js </dev/null >>/tmp/oc-custom.log 2>&1 9>&- &
        fi
    fi
    if ! pgrep -f "oc-custom/orchestrator.js" > /dev/null; then
        setsid nohup node /workspaces/My_code/oc-custom/orchestrator.js </dev/null >>/tmp/oc-orchestrator.log 2>&1 9>&- &
    fi
    if ! pgrep -f "opencode web" > /dev/null; then
        setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN </dev/null >>/tmp/oc-web.log 2>&1 9>&- &
    fi
done
WATCHEOF
chmod +x /tmp/oc-watchdog.sh
if ! pgrep -f "oc-watchdog.sh" > /dev/null; then
    setsid nohup bash /tmp/oc-watchdog.sh </dev/null >>/tmp/watchdog.log 2>&1 9>&- &
    echo $! > "$WATCHDOG_PID"
else
    pgrep -f "oc-watchdog.sh" | head -n1 > "$WATCHDOG_PID"
fi

echo "Started opencode/proxy/watchdog (alive ones skipped)"
flock -u 9
exec 9>&-
