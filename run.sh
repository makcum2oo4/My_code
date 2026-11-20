echo "=== 1. ЛОГ ОТКАТА ==="
cat /tmp/downgrade-oc.log 2>/dev/null || echo "Лога отката нет"

echo "=== 2. ЛОГ СЕРВЕРА ==="
tail -n 20 /tmp/oc-web.log 2>/dev/null || echo "Лога сервера нет"

echo "=== 3. ПРОВЕРКА ВЕРСИИ И ПЕРЕЗАПУСК ==="
export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
which opencode && opencode --version || echo "Бинарник opencode не найден!"
setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN >/tmp/oc-web.log 2>&1 </dev/null &
sleep 2
curl -s http://127.0.0.1:4096/global/health; echo ""
