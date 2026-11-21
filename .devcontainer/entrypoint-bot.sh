#!/bin/bash
if [ "$(id -u)" = "0" ]; then
    mkdir -p /run/sshd
    /usr/sbin/sshd 2>/dev/null || true
fi

(
    for i in $(seq 1 30); do
        [ -f /workspaces/My_code/oc-custom/start.sh ] && break
        sleep 1
    done
    if [ "$(id -u)" = "0" ]; then
        su - vscode -c 'bash /workspaces/My_code/oc-custom/restore-home.sh'
        su - vscode -c 'echo "$(date) start-sh started src=entrypoint" >> /workspaces/My_code/oc-custom/boot.log; setsid bash /workspaces/My_code/oc-custom/start.sh </dev/null >>/workspaces/My_code/oc-custom/boot.log 2>&1 &'
    else
        bash /workspaces/My_code/oc-custom/restore-home.sh 2>/dev/null || true
        echo "$(date) start-sh started src=entrypoint" >> /workspaces/My_code/oc-custom/boot.log
        setsid bash /workspaces/My_code/oc-custom/start.sh </dev/null >>/workspaces/My_code/oc-custom/boot.log 2>&1 &
    fi
) &

if [ "$#" -gt 0 ]; then
    exec "$@"
else
    exec sleep infinity
fi
