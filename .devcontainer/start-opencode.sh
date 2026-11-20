#!/usr/bin/env bash
export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

LOCK=/tmp/opencode-web-start.lock
exec 9>"$LOCK"
flock -n 9 || exit 0

if ! command -v opencode >/dev/null 2>&1; then
    curl -fsSL https://opencode.ai/install | bash -s -- --version 1.18.5
    export PATH="$HOME/.opencode/bin:$PATH"
fi

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    mkdir -p "$HOME/.local/share/opencode"
    AUTH="$HOME/.local/share/opencode/auth.json"
    python3 - "$AUTH" "$OPENROUTER_API_KEY" <<'PY'
import json, os, sys
path, key = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        data = {}
data["openrouter"] = key
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
fi

mkdir -p "$HOME/.config/opencode"
CFG="$HOME/.config/opencode/opencode.json"
python3 - "$CFG" <<'PY'
import json, os, sys
path = sys.argv[1]
data = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        data = {}
data.pop("enabled_providers", None)
data["disabled_providers"] = ["github-copilot"]
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

if ! curl -sf http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
    cd /workspaces/My_code
    setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN >/tmp/oc-web.log 2>&1 </dev/null &
fi

for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
        # start custom proxy on 3000
if [ -x /workspaces/My_code/oc-custom/start.sh ]; then
  bash /workspaces/My_code/oc-custom/start.sh >/tmp/oc-custom-start.log 2>&1 || true
fi

exit 0
    fi
    sleep 0.5
done
exit 1
