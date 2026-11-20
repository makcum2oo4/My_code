const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 3000;
const UPSTREAM = '127.0.0.1:4096';
const PUBLIC_DIR = '/workspaces/My_code/oc-custom/public';

function proxyRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const targetPath = url.pathname;

  if (targetPath === '/__custom/ping') {
    handlePing(req, res);
    return;
  }

  if (targetPath === '/__custom/config') {
    handleConfig(req, res);
    return;
  }

  if (targetPath === '/__custom/preview') {
    handlePreview(req, res);
    return;
  }

  if (targetPath === '/__custom/server4096') {
    handleServer4096(req, res);
    return;
  }

  if (targetPath === '/__custom/telemetry') {
    handleTelemetry(req, res);
    return;
  }

  if (targetPath === '/__custom/keys') {
    handleKeys(req, res);
    return;
  }

  if (targetPath === '/__custom/compact') {
    handleCompact(req, res);
    return;
  }

  if (targetPath === '/__custom/custom.css') {
    serveCustomCSS(req, res);
    return;
  }

  if (targetPath === '/__custom/custom.js') {
    serveCustomJS(req, res);
    return;
  }

  if (targetPath.startsWith('/__custom/')) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  forwardToUpstream(req, res);
}

function serveCustomCSS(req, res) {
  const filePath = path.join(PUBLIC_DIR, 'custom.css');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

function serveCustomJS(req, res) {
  const filePath = path.join(PUBLIC_DIR, 'custom.js');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

function injectHTML(html, cssPath, jsPath) {
  const styleLink = `<link rel="stylesheet" href="${cssPath}">`;
  const scriptTag = `<script src="${jsPath}" defer></script>`;

  const bodyEnd = html.indexOf('</body>');
  if (bodyEnd === -1) return html;

  const before = html.slice(0, bodyEnd);
  const after = html.slice(bodyEnd);

  return before + styleLink + scriptTag + after;
}

function forwardToUpstream(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: 4096,
    path: req.url,
    method: req.method,
    headers: {
      'Host': '127.0.0.1:4096',
      'Accept': req.headers.accept || '',
      'Accept-Language': req.headers['accept-language'] || '',
      'Accept-Encoding': req.headers['accept-encoding'] || '',
      'Content-Type': req.headers['content-type'] || '',
      'Cookie': req.headers.cookie || '',
      'Origin': 'http://127.0.0.1:3000',
    },
  };

  const upstreamReq = http.request(options, (upstreamRes) => {
    let data = '';
    upstreamRes.on('data', (chunk) => data += chunk);
    upstreamRes.on('end', () => {
      const upstreamHeaders = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (typeof value === 'string' && value.length > 0) {
          upstreamHeaders[key] = value;
        }
      }

      if (upstreamHeaders['content-encoding']) {
        delete upstreamHeaders['content-encoding'];
      }
      if (upstreamHeaders['transfer-encoding']) {
        delete upstreamHeaders['transfer-encoding'];
      }

      let contentType = upstreamHeaders['content-type'] || '';

      if (upstreamRes.statusCode === 101) {
        res.writeHead(101, upstreamHeaders);
        upstreamRes.on('data', (chunk) => res.write(chunk));
        upstreamRes.on('end', () => res.end());
        return;
      }

      if (upstreamRes.statusCode === 429 || upstreamRes.statusCode === 403) {
        res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limited or access denied' }));
        return;
      }

      if (contentType.includes('text/html') && upstreamRes.statusCode === 200) {
        const html = injectHTML(data, '/__custom/custom.css', '/__custom/custom.js');
        const rawHeaders = {};
        for (const [k, v] of Object.entries(upstreamHeaders)) {
          const kl = k.toLowerCase();
          if (kl === 'content-length') continue;
          if (kl === 'content-encoding') continue;
          if (kl === 'transfer-encoding') continue;
          if (typeof v === 'string') rawHeaders[k] = v;
        }
        res.writeHead(upstreamRes.statusCode, rawHeaders);
        res.end(html);
      } else {
        const rawHeaders = {};
        for (const [k, v] of Object.entries(upstreamHeaders)) {
          if (typeof v === 'string') rawHeaders[k] = v;
        }
        res.writeHead(upstreamRes.statusCode, rawHeaders);
        if (data) res.end(data);
        else res.end();
      }
    });
  });

  upstreamReq.on('error', (e) => {
    res.writeHead(502);
    res.end(`Proxy error: ${e.message}`);
  });

  req.on('data', (chunk) => upstreamReq.write(chunk));
  req.on('end', () => upstreamReq.end());
}

function handlePing(req, res) {
  const ts = Date.now();
  let globalHealth = { ok: true, ts: null };

  try {
    const healthResp = execSync('curl -sf http://127.0.0.1:4096/global/health 2>/dev/null', { encoding: 'utf8' }).trim();
    globalHealth = JSON.parse(healthResp);
  } catch {
    globalHealth = { ok: false, ts };
  }

  const response = { ok: true, ts };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

function handleConfig(req, res) {
  const configPath = '/workspaces/My_code/oc-custom/custom-config.json';
  const gitignorePath = '/workspaces/My_code/oc-custom/.gitignore';

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '__custom/custom-config.json\n');
  }

  if (req.method === 'GET') {
    let data = {};
    if (fs.existsSync(configPath)) {
      try { data = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { data = {}; }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }
      fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

function handlePreview(req, res) {
  const childPath = '/workspaces/My_code/oc-custom/preview-child.js';

  if (!fs.existsSync(childPath)) {
    fs.writeFileSync(childPath, '');
  }

  if (req.method === 'GET') {
    try {
      const result = execSync('lsof -ti:8080 2>/dev/null', { encoding: 'utf8' }).trim();
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'running', pid: result }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'stopped' }));
      }
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'stopped' }));
    }
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }
      if (data.action === 'start') {
        execSync('setsid nohup node /workspaces/My_code/oc-custom/preview-server.js > /tmp/oc-preview.log 2>&1 </dev/null &', { stdio: 'ignore' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'started' }));
      } else if (data.action === 'stop') {
        try { execSync('kill $(lsof -ti:8080) 2>/dev/null', { encoding: 'utf8' }); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'stopped' }));
      } else if (data.action === 'restart') {
        execSync('kill $(lsof -ti:8080) 2>/dev/null', { encoding: 'utf8' });
        execSync('setsid nohup node /workspaces/My_code/oc-custom/preview-server.js > /tmp/oc-preview.log 2>&1 </dev/null &', { stdio: 'ignore' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'restarted' }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Unknown action' }));
      }
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

function handleServer4096(req, res) {
  const logPath = '/tmp/oc-web.log';

  if (req.method === 'GET') {
    let uptime = 'unknown';
    let status = 'unknown';
    let logLines = [];

    try {
      uptime = execSync('cat /proc/1/uptime 2>/dev/null | awk "{print int($1)}"', { encoding: 'utf8' }).trim();
    } catch {}

    try {
      status = execSync('curl -sf http://127.0.0.1:4096/global/health 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch {}

    try {
      const logData = fs.readFileSync(logPath, 'utf8');
      const lines = logData.split('\n').filter(l => l.trim()).slice(-50);
      logLines = lines;
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ uptime, status, log: logLines }));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }
      if (data.action === 'restart') {
        try { execSync('pkill -f "opencode web" || true', { encoding: 'utf8' }); } catch {}
        setTimeout(() => {
          execSync('setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN >/tmp/oc-web.log 2>&1 </dev/null &', { stdio: 'ignore' });
        }, 1000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action: 'restarted' }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Unknown action' }));
      }
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

function handleTelemetry(req, res) {
  const total = os.totalmem();
  const free = os.freemem();
  const cpuUsage = process.cpuUsage ? process.cpuUsage() : { user: 0, system: 0 };
  const disk = execSync('df -k / 2>/dev/null | tail -1', { encoding: 'utf8' });
  const diskParts = disk.split(/\s+/);
  const diskTotal = parseInt(diskParts[1]) * 1024;
  const diskFree = parseInt(diskParts[3]) * 1024;

  const response = {
    ram: {
      total: total,
      free,
      used: total - free,
      percent: Math.round((1 - free / total) * 100),
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    disk: {
      total: diskTotal,
      free: diskFree,
      used: diskTotal - diskFree,
      percent: Math.round((1 - diskFree / diskTotal) * 100),
    },
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

function handleKeys(req, res) {
  const authPath = `${os.homedir()}/.local/share/opencode/auth.json`;
  const configPath = `${os.homedir()}/.config/opencode/opencode.json`;

  if (!fs.existsSync(`${os.homedir()}/.local/share/opencode`)) {
    fs.mkdirSync(`${os.homedir()}/.local/share/opencode`, { recursive: true });
  }

  if (!fs.existsSync(authPath)) {
    fs.writeFileSync(authPath, '{}');
    fs.chmodSync(authPath, 0o600);
  }

  if (req.method === 'GET') {
    let data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const mask = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > 4) {
        mask[key] = value.slice(0, 4) + '*****';
      } else {
        mask[key] = value;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mask));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }

      let providerMap = { gsk_: 'groq', 'xai-': 'xai', 'sk-or-': 'openrouter', AIza: 'google' };
      let resolvedProvider = 'openrouter';

      for (const [prefix, provider] of Object.entries(providerMap)) {
        for (const key of Object.keys(data)) {
          if (key.startsWith(prefix)) {
            resolvedProvider = provider;
          }
        }
      }

      data._provider = resolvedProvider;

      try {
        const testKey = Object.values(data).find(k => typeof k === 'string' && k.length > 10);
        if (testKey) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, provider: resolvedProvider, key: testKey.slice(0, 4) + '*****' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, provider: resolvedProvider }));
        }
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, provider: resolvedProvider }));
      }

      let authData = { ...data };
      delete authData._provider;
      fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
      fs.chmodSync(authPath, 0o600);

      let cfgData = {};
      if (fs.existsSync(configPath)) {
        try { cfgData = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      }
      cfgData.disabled_providers = cfgData.disabled_providers || [];
      if (!cfgData.disabled_providers.includes(resolvedProvider)) {
        cfgData.disabled_providers.push(resolvedProvider);
      }
      fs.writeFileSync(configPath, JSON.stringify(cfgData, null, 2));
    });
  } else if (req.method === 'DELETE') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }
      if (data.key) {
        let authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        delete authData[data.key];
        fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
        fs.chmodSync(authPath, 0o600);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

function handleCompact(req, res) {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { data = JSON.parse(body); } catch { data = {}; }
      const reason = data.reason || 'manual';
      try {
        execSync(`nohup opencode compact --reason "${reason}" > /tmp/oc-compact.log 2>&1 &`, { encoding: 'utf8' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reason }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

const server = http.createServer((req, res) => {
  proxyRequest(req, res);
});

server.on('upgrade', (req, res) => {
  if (req.url === '/ws' || req.url === '/events') {
    res.writeHead(101, {});
    const ws = res.socket;
    const net = require('net');
    const client = new net.Socket();
    client.connect(4096, '127.0.0.1', () => {
      client.write(req.headers['sec-websocket-key'] || '');
    });
    client.on('data', (data) => ws.emit('data', data));
    ws.on('data', (data) => client.write(data));
    ws.on('close', () => client.destroy());
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Custom proxy running on 0.0.0.0:${PORT} → 127.0.0.1:4096`);
});