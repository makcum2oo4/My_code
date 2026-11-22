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
# Ensure autorouter provider with Auto Free and role aliases
providers = data.get("provider", {})
if "autorouter" not in providers:
    providers["autorouter"] = {}
autorouter = providers["autorouter"]
autorouter["name"] = "Auto Router"
autorouter["env"] = []
autorouter["npm"] = "@ai-sdk/openai-compatible"
autorouter["options"] = {"baseURL": "http://127.0.0.1:4098/v1"}
models = autorouter.get("models", {})
for mid, mcfg in [
    ("auto-free", {"name": "Auto Free", "family": "auto-free", "tool_call": True, "reasoning": False, "temperature": True, "attachment": False, "limit": {"context": 200000, "output": 32000}}),
    ("auto-heavy", {"name": "Auto Heavy", "family": "auto-heavy", "tool_call": True, "reasoning": True, "temperature": True, "attachment": False, "limit": {"context": 200000, "output": 32000}}),
    ("auto-coder", {"name": "Auto Coder", "family": "auto-coder", "tool_call": True, "reasoning": True, "temperature": True, "attachment": False, "limit": {"context": 200000, "output": 32000}}),
    ("auto-fast", {"name": "Auto Fast", "family": "auto-fast", "tool_call": True, "reasoning": False, "temperature": True, "attachment": False, "limit": {"context": 200000, "output": 32000}}),
]:
    if mid not in models:
        models[mid] = mcfg
autorouter["models"] = models
whitelist = autorouter.get("whitelist", [])
for mid in ["auto-free", "auto-heavy", "auto-coder", "auto-fast"]:
    if mid not in whitelist:
        whitelist.append(mid)
autorouter["whitelist"] = whitelist
data["provider"] = providers
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
