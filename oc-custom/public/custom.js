const { WakeLock } = require('wake-lock');

const CHIP_TEXTS = ['Build / Plan', 'Clean / All', 'продолжай', 'исправь ошибки', 'git status', 'проверь 8080'];
const COOLDOWN_OPTS = [30, 60, 120, 300];

let chipIndex = 0;
let messageQueue = [];
let sendTimeout = null;
let autoCooldown = null;
let wakeLock = null;

const activeProviders = ['groq', 'openrouter', 'xai', 'google'];
let fallbackCooldowns = {};

function createChipElement(text, active = false) {
  const el = document.createElement('span');
  el.className = 'chip' + (active ? ' active' : '');
  el.textContent = text;
  el.title = text;
  el.onclick = () => {
    chipIndex = CHIP_TEXTS.indexOf(text);
    updateChips();
    applyChipAction(text);
  };
  return el;
}

function updateChips() {
  const container = document.getElementById('chip-container');
  if (!container) return;
  container.innerHTML = '';
  CHIP_TEXTS.forEach((text, i) => {
    container.appendChild(createChipElement(text, i === chipIndex));
  });
}

function applyChipAction(text) {
  switch (text) {
    case 'Build / Plan': window.dispatchEvent(new CustomEvent('buildplan')); break;
    case 'Clean / All': window.dispatchEvent(new CustomEvent('cleanall')); break;
    case 'продолжай': window.dispatchEvent(new CustomEvent('continue')); break;
    case 'исправь ошибки': window.dispatchEvent(new CustomEvent('fixerrors')); break;
    case 'git status': window.dispatchEvent(new CustomEvent('gitstatus')); break;
    case 'проверь 8080': checkPort8080(); break;
  }
}

function checkPort8080() {
  const req = new XMLHttpRequest();
  req.open('GET', 'http://127.0.0.1:3000/__custom/preview', true);
  req.onload = () => {
    const data = JSON.parse(req.responseText);
    addChatMessage('system', `Port 8080: ${data.status || 'stopped'}`);
  };
  req.onerror = () => addChatMessage('system', 'Cannot reach proxy on port 3000');
  req.send();
}

function initChipLine() {
  const statusBar = document.querySelector('.status-bar') || document.body;
  const chipContainer = document.createElement('div');
  chipContainer.id = 'chip-container';
  chipContainer.className = 'chip-container';
  CHIP_TEXTS.forEach(text => chipContainer.appendChild(createChipElement(text)));
  statusBar.insertBefore(chipContainer, document.querySelector('footer') || null);
}

function initUpperBar() {
  const bar = document.createElement('div');
  bar.className = 'upper-bar';
  bar.innerHTML = `
    <div class="tab-group">
      <div class="tab" data-tab="4096">4096</div>
      <div class="tab" data-tab="8080">8080</div>
      <div class="tab" data-tab="models">Модель / Ключи</div>
      <div class="tab" data-tab="tokens">Токены / Контекст</div>
      <div class="tab" data-tab="server">Сервер</div>
    </div>
  `;
  document.body.insertBefore(bar, document.querySelector('footer') || null);

  const tabs = bar.querySelectorAll('.tab');
  const panels = {
    4096: create4096Panel(),
    8080: create8080Panel(),
    models: createModelPanel(),
    tokens: createTokenPanel(),
    server: createServerPanel(),
  };

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach(p => p.style.display = 'none');
      panels[tab.dataset.tab].style.display = 'block';
    };
  });

  panels[tabs[0].dataset.tab].style.display = 'block';
}

function create4096Panel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-4096';
  panel.innerHTML = `
    <h3>4096 Status</h3>
    <div id="health-status">Checking...</div>
    <button onclick="restart4096()">Restart</button>
    <div id="4096-log" style="height: 150px; overflow: auto; font-size: 12px;"></div>
  `;

  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/ping', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      document.getElementById('health-status').textContent = data.ok ? 'OK' : 'ERROR';
    };
    xhr.send();
  }, 25000);

  setInterval(() => {
    const logXhr = new XMLHttpRequest();
    logXhr.open('GET', 'http://127.0.0.1:3000/__custom/server4096', true);
    logXhr.onload = () => {
      const data = JSON.parse(logXhr.responseText);
      const logDiv = document.getElementById('4096-log');
      logDiv.innerHTML = '';
      (data.log || []).slice(-50).forEach(line => {
        const p = document.createElement('p');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
        logDiv.appendChild(p);
      });
      logDiv.scrollTop = logDiv.scrollHeight;
    };
    logXhr.send();
  }, 5000);

  return panel;
}

function create8080Panel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-8080';
  panel.innerHTML = `
    <h3>Preview 8080</h3>
    <div id="preview-status">Checking...</div>
    <div style="margin: 8px 0;">
      <button onclick="startPreview()">Start</button>
      <button onclick="stopPreview()">Stop</button>
    </div>
    <div id="8080-log" style="height: 120px; overflow: auto; font-size: 12px; margin-top: 8px;"></div>
  `;

  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/preview', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      document.getElementById('preview-status').textContent = data.status || 'stopped';
    };
    xhr.send();
  }, 5000);

  setInterval(() => {
    const logXhr = new XMLHttpRequest();
    logXhr.open('GET', 'http://127.0.0.1:3000/__custom/server4096', true);
    logXhr.onload = () => {
      const data = JSON.parse(logXhr.responseText);
      const logDiv = document.getElementById('8080-log');
      logDiv.innerHTML = '';
      (data.log || []).slice(-30).forEach(line => {
        const p = document.createElement('p');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
        logDiv.appendChild(p);
      });
      logDiv.scrollTop = logDiv.scrollHeight;
    };
    logXhr.send();
  }, 5000);

  return panel;
}

function createModelPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-models';
  panel.innerHTML = `
    <h3>Model / Keys</h3>
    <div class="model-chain">
      <div class="model-item" data-provider="groq">
        <span>Groq</span>
        <input type="text" class="key-input" placeholder="API key" />
      </div>
      <div class="model-item" data-provider="openrouter">
        <span>OpenRouter</span>
        <input type="text" class="key-input" placeholder="API key" />
      </div>
      <div class="model-item" data-provider="xai">
        <span>xAI</span>
        <input type="text" class="key-input" placeholder="API key" />
      </div>
      <div class="model-item" data-provider="google">
        <span>Google AI</span>
        <input type="text" class="key-input" placeholder="API key" />
      </div>
    </div>
    <div class="fallback-controls">
      <label><input type="checkbox" id="auto-fallback"> Auto-Fallback</label>
      <label><input type="checkbox" id="ping-enabled" checked> Ping (every 25s)</label>
      <select id="ping-cooldown">
        <option value="1h">1 hour</option>
        <option value="3h">3 hours</option>
        <option value="∞" selected>∞</option>
      </select>
    </div>
  `;

  const autoFallback = document.getElementById('auto-fallback');
  const pingEnabled = document.getElementById('ping-enabled');
  const pingCooldown = document.getElementById('ping-cooldown');

  setInterval(() => {
    const pingXhr = new XMLHttpRequest();
    pingXhr.open('GET', 'http://127.0.0.1:3000/__custom/ping', true);
    pingXhr.onload = () => {
      const data = JSON.parse(pingXhr.responseText);
      document.getElementById('health-status').textContent = data.ok ? 'OK' : 'ERROR';
    };
    pingXhr.send();
  }, 25000);

  autoFallback.onchange = () => {
    const enabled = autoFallback.checked;
    fetch('http://127.0.0.1:3000/__custom/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_fallback: enabled })
    });
  };

  pingEnabled.onchange = () => {
    fetch('http://127.0.0.1:3000/__custom/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping_enabled: pingEnabled.checked })
    });
  };

  pingCooldown.onchange = () => {
    fetch('http://127.0.0.1:3000/__custom/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping_cooldown: pingCooldown.value })
    });
  };

  return panel;
}

function createTokenPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-tokens';
  panel.innerHTML = `
    <h3>Tokens / Context</h3>
    <div class="token-counter">0 / 0</div>
    <button onclick="manualCompact()">Compact</button>
    <select id="compact-threshold">
      <option value="4000">Auto-Compact at 4000</option>
      <option value="8000">Auto-Compact at 8000</option>
      <option value="16000">Auto-Compact at 16000</option>
    </select>
  `;

  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/telemetry', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      const counterDiv = document.querySelector('.token-counter');
      if (counterDiv) {
        counterDiv.textContent = `${data.tokens || 0} / ${data.ram ? Math.round(data.ram.total / 1024 / 1024) : '?'}M`;
      }
    };
    xhr.send();
  }, 3000);

  return panel;
}

function createServerPanel() {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-server';
  panel.innerHTML = `
    <h3>Server</h3>
    <div id="ram-status">Loading...</div>
    <div id="cpu-status">Loading...</div>
    <div id="disk-status">Loading...</div>
  `;

  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/telemetry', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      document.getElementById('ram-status').textContent = `${Math.round((1 - data.ram.free / data.ram.total) * 100)}% RAM`;
      document.getElementById('cpu-status').textContent = `CPU: ${Math.round((data.cpu.user + data.cpu.system) / 1000000)}%`;
      const diskPct = data.disk ? Math.round((1 - data.disk.free / data.disk.total) * 100) : '?';
      document.getElementById('disk-status').textContent = `${diskPct}% Disk`;
    };
    xhr.send();
  }, 2000);

  return panel;
}

function initWakeLock() {
  const wakeToggle = document.getElementById('wake-toggle');
  if (!wakeToggle) return;

  async function acquireWakeLock() {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeToggle.title = 'Wake Lock active';
      wakeToggle.textContent = 'Wake: Active';
      wakeLock.addEventListener('release', () => {
        wakeToggle.title = 'Wake Lock released';
        wakeToggle.textContent = 'Wake: Available';
      });
    } catch (err) {
      console.error('Wake lock not supported', err);
    }
  }

  wakeToggle.onclick = acquireWakeLock;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (wakeLock) { wakeLock.release(); wakeLock = null; }
    } else {
      acquireWakeLock().catch(() => {});
    }
  });
}

function initImageCompression() {
  const dropZone = document.getElementById('image-drop');
  if (!dropZone) return;

  dropZone.ondragover = (e) => e.preventDefault();
  dropZone.ondrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const canvas = document.createElement('canvas');
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      let width = img.width;
      let height = img.height;
      const max = 1280;

      if (width > max) {
        height = height * (max / width);
        width = max;
      }
      if (height > max) {
        width = width * (max / height);
        height = max;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const compressedData = reader.result;
            const compressedFile = new File([blob], file.name, { type: 'image/jpeg' });
            addChatMessage('user', '', compressedFile);
          };
          reader.readAsDataURL(blob);
        }
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.8);
    };

    img.src = url;
  };
}

function initMessageQueue() {
  const sendBtn = document.getElementById('send-btn');
  if (!sendBtn) return;

  let cooldown = 30;

  sendBtn.onclick = () => sendMessage();

  document.getElementById('cooldown-select').onchange = (e) => {
    cooldown = parseInt(e.target.value);
  };

  setInterval(() => {
    if (messageQueue.length > 0) {
      const { text, callback } = messageQueue[0];
      const now = Date.now();
      if (now - lastSendTime > cooldown * 1000) {
        messageQueue.shift();
        lastSendTime = now;
        sendMessageInternal(text, callback);
      }
    }
  }, 1000);
}

let lastSendTime = 0;

function sendMessage() {
  const input = document.getElementById('user-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  clearTimeout(sendTimeout);
  messageQueue.push({ text, callback: null });
  lastSendTime = Date.now();

  if (messageQueue.length === 1) {
    setTimeout(() => {
      const { text } = messageQueue.shift();
      sendMessageInternal(text);
    }, cooldown * 1000);
  }
}

function sendMessageInternal(text, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/v1/messages', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = () => {
    if (callback) callback(xhr.responseText);
  };
  xhr.send(JSON.stringify({ text, }));
}

function addChatMessage(role, text, file) {
  const chat = document.getElementById('chat-messages');
  if (!chat) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${role}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (role === 'assistant') {
    contentDiv.innerHTML = marked.parse(text || '');
  } else if (role === 'user' && file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement('img');
      img.src = reader.result;
      img.style.maxWidth = '100%';
      contentDiv.appendChild(img);
    };
    reader.readAsDataURL(file);
  } else {
    contentDiv.textContent = text || '';
  }

  msgDiv.appendChild(contentDiv);
  chat.appendChild(msgDiv);
  chat.scrollTop = chat.scrollHeight;
}

function initAutoCompact() {
  const threshold = parseInt(document.getElementById('compact-threshold').value);
  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/telemetry', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      const used = data.ram ? data.ram.total - data.ram.free : 0;
      if (used > threshold) {
        fetch('http://127.0.0.1:3000/__custom/compact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'auto' })
        });
      }
    };
    xhr.send();
  }, 30000);
}

function initEventListeners() {
  const style = document.createElement('style');
  style.textContent = `
    .upper-bar { display: flex; gap: 12px; background: var(--v2-foreground, #333); padding: 4px 8px; margin-bottom: 8px; }
    .tab { padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px; }
    .tab.active { background: var(--v2-accent, #0066ff); color: white; }
    .panel { display: none; padding: 8px; }
    .panel.active { display: block; }
    .chip-container { display: flex; gap: 4px; background: #f0f0f0; padding: 2px 4px; border-radius: 4px; margin-bottom: 8px; }
    .chip { padding: 4px 8px; background: white; border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap; }
    .chip.active { background: var(--v2-accent, #0066ff); color: white; }
    .chip-container .chip { flex: 1; }
    .status-bar { display: flex; justify-content: space-between; align-items: center; }
    .chip-container { order: 2; }
    @media (max-width: 520px) {
      .chip-container { order: 1; flex-wrap: wrap; }
      .model-selector { max-width: 140px; text-overflow: ellipsis; overflow: hidden; }
      input { padding-right: 48px !important; max-width: 100% !important; box-sizing: border-box !important; }
    }
  `;
  document.head.appendChild(style);
}

function initTelemetryPing() {
  setInterval(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:3000/__custom/telemetry', true);
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      window.dispatchEvent(new CustomEvent('telemetry-update', { detail: data }));
    };
    xhr.send();
  }, 5000);
}

initChipLine();
initUpperBar();
initWakeLock();
initImageCompression();
initMessageQueue();
initAutoCompact();
initEventListeners();
initTelemetryPing();

// Handle incoming messages from server
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'chat') {
    addChatMessage(e.data.role, e.data.text, e.data.file);
  }
});