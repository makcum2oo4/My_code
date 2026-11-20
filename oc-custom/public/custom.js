(function () {
  'use strict';

  const CFG_URL = '/__custom/config';
  const PING_URL = '/__custom/ping';
  let config = { autoFallback: true, modelChain: [], maxTokensGroq: 900, autoCompactThreshold: 20 };

  fetch(CFG_URL).then(r => r.json()).then(c => { config = Object.assign(config, c || {}); }).catch(() => {});

  // visual viewport
  function updateVVH() {
    const h = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', h + 'px');
  }
  updateVVH();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateVVH);
    window.visualViewport.addEventListener('scroll', updateVVH);
  }
  window.addEventListener('resize', updateVVH);

  // HUD
  const hud = document.createElement('div');
  hud.className = 'oc-hud';
  hud.innerHTML = `
    <div class="oc-pill" data-id="s4096">4096 …</div>
    <div class="oc-pill" data-id="p8080">8080 …</div>
    <div class="oc-pill" data-id="model">Модель/Ключи</div>
    <div class="oc-pill" data-id="tokens">Токены/Контекст</div>
    <div class="oc-pill" data-id="server">Сервер</div>
    <div class="oc-pill" data-id="auto">Auto: ON</div>
    <div class="oc-pill" data-id="ping">Ping OFF</div>
    <div class="oc-pill" data-id="wake">Wake OFF</div>
  `;
  document.body.appendChild(hud);

  const sheets = {};
  function makeSheet(id, html) {
    const el = document.createElement('div');
    el.className = 'oc-sheet';
    el.id = 'sheet-' + id;
    el.innerHTML = html;
    document.body.appendChild(el);
    sheets[id] = el;
    return el;
  }
  function openSheet(id) { Object.values(sheets).forEach(s => s.classList.remove('open')); if (sheets[id]) sheets[id].classList.add('open'); }
  function closeSheets() { Object.values(sheets).forEach(s => s.classList.remove('open')); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.oc-sheet') && !e.target.closest('.oc-pill') && !e.target.closest('.oc-chip')) closeSheets(); });

  makeSheet('s4096', '<h3>Сервер 4096</h3><div id="s4096-body">загрузка…</div><div class="row"><button data-act="restart4096">Рестарт 4096</button></div>');
  makeSheet('p8080', '<h3>Превью 8080</h3><div id="p8080-body">загрузка…</div><div class="row"><button data-act="start8080">Старт</button><button data-act="stop8080">Стоп</button><button data-act="restart8080">Рестарт</button><button data-act="open8080">Открыть</button></div><pre id="p8080-log" style="font-size:11px;max-height:120px;overflow:auto;"></pre>');
  makeSheet('model', '<h3>Модель / Ключи</h3><div class="row"><label>Auto-Fallback <input type="checkbox" id="af-toggle"></label></div><div><textarea id="model-chain" rows="4" style="width:100%" placeholder="provider/model по одному"></textarea></div><div class="row"><button data-act="save-chain">Сохранить цепочку</button><button data-act="save-max">max_tokens Groq: <span id="mt-val">900</span></button></div><div id="keys-body"></div><div class="row"><input id="new-key" placeholder="Вставь API ключ"><button data-act="add-key">Добавить ключ</button></div><pre id="key-test"></pre>');
  makeSheet('tokens', '<h3>Токены / Контекст</h3><div id="tokens-body">сообщений: 0</div><div class="row"><button data-act="compact">Compact сейчас</button></div><div class="row">Порог Auto-Compact: <input id="ac-threshold" type="number" value="20" style="width:60px"></div>');
  makeSheet('server', '<h3>Сервер (телеметрия)</h3><div id="telemetry-body">…</div>');

  // HUD click handlers
  hud.addEventListener('click', (e) => {
    const pill = e.target.closest('.oc-pill');
    if (!pill) return;
    const id = pill.getAttribute('data-id');
    if (id === 's4096') { refresh4096(); openSheet('s4096'); }
    else if (id === 'p8080') { refreshPreview(); openSheet('p8080'); }
    else if (id === 'model') { refreshKeys(); openSheet('model'); }
    else if (id === 'tokens') { openSheet('tokens'); }
    else if (id === 'server') { refreshTelemetry(); openSheet('server'); }
    else if (id === 'auto') { toggleAuto(); }
    else if (id === 'ping') { togglePing(); }
    else if (id === 'wake') { toggleWake(); }
  });

  // sheet actions
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'restart4096') { fetch('/__custom/server4096', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) }).then(() => refresh4096()); }
    if (act === 'start8080') { fetch('/__custom/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) }).then(() => refreshPreview()); }
    if (act === 'stop8080') { fetch('/__custom/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).then(() => refreshPreview()); }
    if (act === 'restart8080') { fetch('/__custom/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) }).then(() => refreshPreview()); }
    if (act === 'open8080') { window.open('http://localhost:8080/', '_blank'); }
    if (act === 'save-chain') {
      const chain = document.getElementById('model-chain').value.split('\n').map(s => s.trim()).filter(Boolean);
      fetch(CFG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelChain: chain }) });
    }
    if (act === 'add-key') {
      const key = document.getElementById('new-key').value.trim();
      if (!key) return;
      fetch('/__custom/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
        .then(r => r.json()).then(j => { document.getElementById('key-test').textContent = JSON.stringify(j); refreshKeys(); });
    }
    if (act === 'compact') {
      const sid = getCurrentSessionId();
      if (sid) fetch('/__custom/compact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionID: sid }) });
    }
  });

  function refresh4096() {
    fetch('/__custom/server4096').then(r => r.json()).then(d => {
      const pill = hud.querySelector('[data-id="s4096"]');
      pill.textContent = '4096 ' + (d.up ? 'UP' : 'DOWN');
      pill.className = 'oc-pill ' + (d.up ? 'ok' : 'down');
      const body = document.getElementById('s4096-body');
      if (body) body.innerHTML = 'up: ' + d.up + '<br>version: ' + (d.version || '?') + '<br>uptime: ' + (d.uptime || 0) + 's<br><pre style="font-size:11px;max-height:120px;overflow:auto;">' + (d.log || '').slice(-1500) + '</pre>';
    }).catch(() => {});
  }
  function refreshPreview() {
    fetch('/__custom/preview').then(r => r.json()).then(d => {
      const pill = hud.querySelector('[data-id="p8080"]');
      pill.textContent = '8080 ' + (d.up ? 'UP' : 'DOWN');
      pill.className = 'oc-pill ' + (d.up ? 'ok' : 'down');
      const body = document.getElementById('p8080-body');
      if (body) body.textContent = 'up: ' + d.up + ' status: ' + (d.statusCode || '') + ' pid: ' + (d.pid || '');
      const log = document.getElementById('p8080-log');
      if (log) log.textContent = (d.log || '').slice(-2000);
    }).catch(() => {});
  }
  function refreshKeys() {
    fetch('/__custom/keys').then(r => r.json()).then(d => {
      const body = document.getElementById('keys-body');
      if (!body) return;
      body.innerHTML = (d.keys || []).map(k => '<div>' + k.provider + ': ' + k.keyMasked + '</div>').join('');
    }).catch(() => {});
  }
  function refreshTelemetry() {
    fetch('/__custom/telemetry').then(r => r.json()).then(d => {
      const el = document.getElementById('telemetry-body');
      if (el) el.innerHTML = 'RAM: ' + (d.ram.usedPercent || 0) + '%<br>CPU: ' + (d.cpu.loadavg[0] || 0).toFixed(2) + '<br>Disk free: ' + ((d.disk && d.disk.freeKB) || 0) + ' KB';
      const pill = hud.querySelector('[data-id="server"]');
      pill.textContent = 'RAM ' + (d.ram.usedPercent || 0) + '%';
    }).catch(() => {});
  }

  let autoOn = true;
  function toggleAuto() {
    autoOn = !autoOn;
    config.autoFallback = autoOn;
    fetch(CFG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoFallback: autoOn }) });
    const pill = hud.querySelector('[data-id="auto"]');
    pill.textContent = 'Auto: ' + (autoOn ? 'ON' : 'OFF');
  }

  // Ping
  let pingOn = false;
  let pingTimer = null;
  let lastPing = null;
  let pingAutoOffTimer = null;
  function togglePing() {
    pingOn = !pingOn;
    const pill = hud.querySelector('[data-id="ping"]');
    if (pingOn) {
      pill.textContent = 'Ping ON';
      startPing();
    } else {
      pill.textContent = 'Ping OFF';
      stopPing();
    }
  }
  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      fetch(PING_URL).then(r => r.json()).then(() => { lastPing = Date.now(); updatePingLabel(); }).catch(() => {});
    }, 25000);
    fetch(PING_URL).then(() => { lastPing = Date.now(); updatePingLabel(); }).catch(() => {});
  }
  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }
  function updatePingLabel() {
    const pill = hud.querySelector('[data-id="ping"]');
    if (!pingOn) return;
    const ago = lastPing ? Math.round((Date.now() - lastPing) / 1000) : 0;
    pill.textContent = 'Ping ' + ago + 's';
  }
  setInterval(updatePingLabel, 1000);

  // Wake Lock
  let wakeLock = null;
  let wakeOn = false;
  async function toggleWake() {
    wakeOn = !wakeOn;
    const pill = hud.querySelector('[data-id="wake"]');
    if (wakeOn) {
      try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        pill.textContent = 'Wake ON';
      } catch (e) { pill.textContent = 'Wake ERR'; wakeOn = false; }
    } else {
      try { if (wakeLock) await wakeLock.release(); } catch (e) {}
      wakeLock = null;
      pill.textContent = 'Wake OFF';
    }
  }

  // context message counter
  let msgCount = 0;
  function getCurrentSessionId() {
    const m = location.pathname.match(/ses_[A-Za-z0-9]+/);
    return m ? m[0] : null;
  }

  // Image compression: intercept file inputs and paste/drop
  function compressImage(file, cb) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        let w = img.width, h = img.height;
        const scale = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { cb(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })); }, 'image/jpeg', 0.8);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.type === 'file' && t.files && t.files.length) {
      const files = Array.from(t.files);
      const imgs = files.filter(f => f.type.startsWith('image/'));
      if (!imgs.length) return;
      // compress and replace via DataTransfer
      const dt = new DataTransfer();
      let pending = imgs.length;
      const compressedMap = new Map();
      imgs.forEach((f, i) => {
        compressImage(f, (cf) => {
          compressedMap.set(f, cf);
          pending--;
          if (pending === 0) {
            files.forEach(f => {
              if (compressedMap.has(f)) dt.items.add(compressedMap.get(f)); else dt.items.add(f);
            });
            t.files = dt.files;
          }
        });
      });
    }
  }, true);

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          compressImage(file, (cf) => {
            // attach to nearest file input if exists
            const input = document.querySelector('input[type="file"]');
            if (input) {
              const dt = new DataTransfer();
              dt.items.add(cf);
              input.files = dt.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        }
      }
    }
  }, true);

  // MutationObserver for chat: tool blocks + copy buttons + undo
  const observer = new MutationObserver(() => {
    document.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        const text = code ? code.innerText : pre.innerText;
        navigator.clipboard.writeText(text).catch(() => {});
        btn.textContent = 'Copied';
        setTimeout(() => btn.textContent = 'Copy', 1200);
      });
      pre.appendChild(btn);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Clean/All mode toggle via chip
  let cleanMode = true;
  function applyCleanMode() {
    document.body.classList.toggle('oc-clean', cleanMode);
  }
  applyCleanMode();

  // Chips bar
  const chips = document.createElement('div');
  chips.className = 'oc-chips';
  chips.innerHTML = `
    <div class="oc-chip" data-chip="build">Build</div>
    <div class="oc-chip" data-chip="plan">Plan</div>
    <div class="oc-chip" data-chip="clean">${cleanMode ? 'Чисто' : 'Всё'}</div>
    <div class="oc-chip" data-chip="cont">продолжай</div>
    <div class="oc-chip" data-chip="fix">исправь ошибки</div>
    <div class="oc-chip" data-chip="git">git status</div>
    <div class="oc-chip" data-chip="preview">проверь 8080</div>
  `;
  document.body.appendChild(chips);

  chips.addEventListener('click', (e) => {
    const c = e.target.closest('.oc-chip');
    if (!c) return;
    const kind = c.getAttribute('data-chip');
    if (kind === 'clean') {
      cleanMode = !cleanMode;
      c.textContent = cleanMode ? 'Чисто' : 'Всё';
      applyCleanMode();
      return;
    }
    if (kind === 'build' || kind === 'plan') {
      const mode = kind === 'build' ? 'Build' : 'Plan';
      const input = document.querySelector('textarea, [contenteditable="true"]');
      if (input) {
        // dispatch a custom event; native handling not guaranteed
      }
      return;
    }
    // quick commands: insert into input
    const textMap = { cont: 'продолжай', fix: 'исправь ошибки', git: 'git status', preview: 'проверь 8080' };
    const txt = textMap[kind];
    if (!txt) return;
    const input = document.querySelector('textarea, [contenteditable="true"]');
    if (input) {
      if (input.tagName === 'TEXTAREA') { input.value = (input.value ? input.value + '\n' : '') + txt; input.dispatchEvent(new Event('input', { bubbles: true })); }
      else { input.textContent = (input.textContent ? input.textContent + '\n' : '') + txt; }
    }
  });

  // Queue panel (simple)
  const queuePanel = document.createElement('div');
  queuePanel.id = 'oc-queue';
  queuePanel.style.cssText = 'position:fixed;bottom:110px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:4px;';
  document.body.appendChild(queuePanel);

  // visibilitychange resync
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh4096();
      // trigger native event reconnection is handled by browser; here just refresh
    }
  });

  // initial refresh
  setTimeout(() => { refresh4096(); refreshPreview(); refreshTelemetry(); }, 1000);
})();
