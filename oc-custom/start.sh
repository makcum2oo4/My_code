#!/usr/bin/env bash
export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  echo "port 3000 already in use"
  exit 0
fi

mkdir -p /workspaces/My_code/oc-custom/public
setsid nohup node /workspaces/My_code/oc-custom/proxy.js >/tmp/oc-custom.log 2>&1 </dev/null &
echo "started oc-custom on 0.0.0.0:3000"
