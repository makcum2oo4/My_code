#!/usr/bin/env bash
# Надёжный автозапуск OpenCode web на порту 4096 (не перезапускает живой процесс).

export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

LOCK=/tmp/opencode-web-start.lock
exec 9>"$LOCK"
flock -n 9 || exit 0

# Если сервер уже здоров — ничего не запускаем.
if curl -sf http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
    exit 0
fi

# Установить бинарник, если отсутствует (после пересборки контейнера).
if ! command -v opencode >/dev/null 2>&1; then
    curl -fsSL https://opencode.ai/install | bash -s -- --version 2.3.2
    export PATH="$HOME/.opencode/bin:$PATH"
fi

# Ключ OpenRouter (без записи в репозиторий).
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

# Конфиг провайдеров.
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
    data["disabled_providers"] = ["github-copilot"]
data["model"] = "openrouter/baidu/ernie-5.5-flash-preview:free"
data["small_model"] = "openrouter/baidu/ernie-5.5-flash-preview:free"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

# CORS для Codespaces.
CORS_ARGS=""
if [ -n "${CODESPACE_NAME:-}" ]; then
    DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
    CORS_ARGS="--cors https://${CODESPACE_NAME}-4096.${DOMAIN}"
fi

# Запуск в фоне из /workspaces/My_code без GITHUB_TOKEN и GH_TOKEN.
cd /workspaces/My_code
env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" nohup opencode web --port 4096 --hostname 0.0.0.0 $CORS_ARGS --print-logs --log-level WARN >/tmp/oc-web.log 2>&1 &

# Ожидание здоровья до 15 секунд.
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:4096/global/health >/dev/null 2>&1; then
        exit 0
    fi
    sleep 0.5
done
exit 1
