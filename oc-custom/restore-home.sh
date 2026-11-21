#!/usr/bin/env bash
set -u
BACKUP="/workspaces/My_code/.oc-backup"
HOME_DIR="/home/vscode"
BOOT_LOG="/workspaces/My_code/oc-custom/boot.log"

if [ -x "$HOME_DIR/.opencode/bin/opencode" ] && [ -f "$HOME_DIR/.local/share/opencode/opencode.db" ]; then
    exit 0
fi

echo "$(date) restore-home started" >> "$BOOT_LOG"
mkdir -p "$HOME_DIR/.opencode" "$HOME_DIR/.config/opencode" "$HOME_DIR/.cache/opencode" "$HOME_DIR/.local/share/opencode"

for pair in \
    "dot_opencode:.opencode" \
    "config_opencode:.config/opencode" \
    "cache_opencode:.cache/opencode" \
    "local_share_opencode:.local/share/opencode"; do
    src="$BACKUP/${pair%%:*}"
    dst="$HOME_DIR/${pair#*:}"
    if [ -d "$src" ]; then
        cp -a "$src/." "$dst/" 2>/dev/null || true
    fi
done

chmod 600 "$HOME_DIR/.local/share/opencode/auth.json" 2>/dev/null || true
chmod +x "$HOME_DIR/.opencode/bin/opencode" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
    chown -R vscode:vscode "$HOME_DIR/.opencode" "$HOME_DIR/.config/opencode" "$HOME_DIR/.cache/opencode" "$HOME_DIR/.local/share/opencode" 2>/dev/null || true
fi
echo "$(date) restore-home done" >> "$BOOT_LOG"
