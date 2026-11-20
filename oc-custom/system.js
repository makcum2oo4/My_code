const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

const HOME = process.env.HOME || '/home/vscode';
const AUTH_PATH = path.join(HOME, '.local/share/opencode/auth.json');
const OPENCODE_CONFIG_PATH = path.join(HOME, '.config/opencode/opencode.json');
const PREVIEW_PID = '/tmp/oc-preview.pid';
const PREVIEW_LOG = '/tmp/oc-preview.log';
const SERVER_LOG = '/tmp/oc-web.log';
const PORT_4096 = 4096;
const PORT_8080 = 8080;

function readJson(p, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(p, obj) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function maskKey(k) {
  if (!k || typeof k !== 'string') return '';
  if (k.length <= 8) return '***';
  return k.slice(0, 4) + '...' + k.slice(-4);
}

function detectProvider(key) {
  if (!key) return null;
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('xai-')) return 'xai';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'google';
  return null;
}

function normalizeAuth(data) {
  const out = {};
  for (const [prov, val] of Object.entries(data || {})) {
    if (typeof val === 'string') {
      out[prov] = { type: 'api', key: val.trim() };
    } else if (val && typeof val === 'object') {
      out[prov] = { type: val.type || 'api', key: (val.key || val.apiKey || '').trim() };
      if (val.metadata) out[prov].metadata = val.metadata;
    }
  }
  return out;
}

function getKeys() {
  const raw = readJson(AUTH_PATH, {});
  const auth = normalizeAuth(raw);
  const list = Object.entries(auth).map(([provider, info]) => ({ provider, keyMasked: maskKey(info.key), hasKey: !!info.key }));
  return { keys: list, auth };
}

function setKey(provider, key) {
  if (!provider) provider = detectProvider(key);
  if (!provider) throw new Error('Cannot detect provider');
  const raw = readJson(AUTH_PATH, {});
  const auth = normalizeAuth(raw);
  auth[provider] = { type: 'api', key: key.trim() };
  writeJson(AUTH_PATH, auth);
  try { fs.chmodSync(AUTH_PATH, 0o600); } catch (e) {}
  unlockProviders();
  return { provider, keyMasked: maskKey(key) };
}

function deleteKey(provider) {
  const raw = readJson(AUTH_PATH, {});
  const auth = normalizeAuth(raw);
  delete auth[provider];
  writeJson(AUTH_PATH, auth);
  try { fs.chmodSync(AUTH_PATH, 0o600); } catch (e) {}
  return true;
}

function unlockProviders() {
  const cfg = readJson(OPENCODE_CONFIG_PATH, {});
  delete cfg.enabled_providers;
  cfg.disabled_providers = ['github-copilot'];
  writeJson(OPENCODE_CONFIG_PATH, cfg);
  try { fs.chmodSync(OPENCODE_CONFIG_PATH, 0o644); } catch (e) {}
}

function pingProvider(provider, key) {
  return new Promise((resolve) => {
    const done = (ok, detail) => resolve({ provider, ok, detail });
    let url = null;
    const headers = {};
    if (provider === 'groq') { url = 'https://api.groq.com/openai/v1/models'; headers.Authorization = 'Bearer ' + key; }
    else if (provider === 'xai') { url = 'https://api.x.ai/v1/models'; headers.Authorization = 'Bearer ' + key; }
    else if (provider === 'openrouter') { url = 'https://openrouter.ai/api/v1/models'; headers.Authorization = 'Bearer ' + key; }
    else if (provider === 'google') { url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key); }
    else return done(false, 'unknown provider');
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 2000) body += c; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode < 400) done(true, 'HTTP ' + res.statusCode);
        else done(false, 'HTTP ' + res.statusCode + ' ' + body.slice(0, 200));
      });
    });
    req.on('timeout', () => { req.destroy(); done(false, 'timeout'); });
    req.on('error', (e) => done(false, e.message));
    req.end();
  });
}

function findPidByPort(port) {
  try {
    const out = execSync(`fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
    const m = out.match(/\d+/);
    if (m) return parseInt(m[0], 10);
  } catch (e) {}
  try {
    const tcp = fs.readFileSync('/proc/net/tcp', 'utf8');
    const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
    for (const line of tcp.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const local = parts[1];
      if (!local || !local.endsWith(':' + hexPort)) continue;
      const inode = parts[9];
      const dirs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
      for (const pid of dirs) {
        try {
          const fds = fs.readdirSync('/proc/' + pid + '/fd');
          for (const fd of fds) {
            try {
              const link = fs.readlinkSync('/proc/' + pid + '/fd/' + fd);
              if (link.includes('socket:[' + inode + ']')) return parseInt(pid, 10);
            } catch (e) {}
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return null;
}

function processUptime(pid) {
  if (!pid) return null;
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const parts = stat.split(' ');
    const starttime = parseInt(parts[13], 10);
    const clk = 100;
    const uptime = os.uptime();
    const procStart = starttime / clk;
    const bootTime = Date.now() / 1000 - uptime;
    const startedAt = bootTime + procStart;
    return Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
  } catch (e) { return null; }
}

function status4096() {
  return new Promise((resolve) => {
    const pid = findPidByPort(PORT_4096);
    const req = http.get('http://127.0.0.1:4096/global/health', { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        let health = null;
        try { health = JSON.parse(body); } catch (e) {}
        resolve({ port: PORT_4096, up: res.statusCode === 200, version: health && health.version, healthy: health && health.healthy, pid, uptime: processUptime(pid) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ port: PORT_4096, up: false, pid, uptime: processUptime(pid) }); });
    req.on('error', () => resolve({ port: PORT_4096, up: false, pid, uptime: processUptime(pid) }));
  });
}

function restart4096() {
  return new Promise((resolve) => {
    const pid = findPidByPort(PORT_4096);
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch (e) {} }
    setTimeout(() => {
      try { execSync('fuser -k 4096/tcp 2>/dev/null', { timeout: 3000 }); } catch (e) {}
      const logFd = fs.openSync(SERVER_LOG, 'a');
      const child = spawn('bash', ['-c', 'cd /workspaces/My_code && export PATH="$HOME/.bun/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH" && setsid nohup env -u GITHUB_TOKEN -u GH_TOKEN OPENCODE_SERVER_PASSWORD="" opencode web --port 4096 --hostname 0.0.0.0 --print-logs --log-level WARN >/tmp/oc-web.log 2>&1 </dev/null &'], { detached: true, stdio: ['ignore', logFd, logFd] });
      child.unref();
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        http.get('http://127.0.0.1:4096/global/health', { timeout: 2000 }, (res) => {
          if (res.statusCode === 200) { clearInterval(iv); resolve({ ok: true, message: 'restarted' }); }
        }).on('error', () => {});
        if (tries > 40) { clearInterval(iv); resolve({ ok: false, message: 'timeout waiting for health' }); }
      }, 500);
    }, 1500);
  });
}

function tailLog(file, n = 50) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    return lines.slice(-n).join('\n');
  } catch (e) { return ''; }
}

function previewStatus() {
  return new Promise((resolve) => {
    let pid = null;
    if (fs.existsSync(PREVIEW_PID)) { try { pid = parseInt(fs.readFileSync(PREVIEW_PID, 'utf8').trim(), 10); } catch (e) {} }
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = false; } }
    const req = http.get('http://127.0.0.1:8080/', { timeout: 2000 }, (res) => {
      resolve({ port: 8080, up: res.statusCode < 500, statusCode: res.statusCode, pid, alive, log: tailLog(PREVIEW_LOG) });
    });
    req.on('timeout', () => { req.destroy(); resolve({ port: 8080, up: false, pid, alive, log: tailLog(PREVIEW_LOG) }); });
    req.on('error', () => resolve({ port: 8080, up: false, pid, alive, log: tailLog(PREVIEW_LOG) }));
  });
}

function previewStart() {
  return new Promise((resolve) => {
    previewStatus().then((s) => {
      if (s.up) return resolve({ ok: true, message: 'already up', pid: s.pid });
      const logFd = fs.openSync(PREVIEW_LOG, 'a');
      const child = spawn('python3', ['-m', 'http.server', '8080', '--directory', '/workspaces/My_code'], { detached: true, stdio: ['ignore', logFd, logFd], cwd: '/workspaces/My_code' });
      child.unref();
      fs.writeFileSync(PREVIEW_PID, String(child.pid));
      setTimeout(() => resolve({ ok: true, pid: child.pid }), 500);
    });
  });
}

function previewStop() {
  return new Promise((resolve) => {
    let pid = null;
    if (fs.existsSync(PREVIEW_PID)) { try { pid = parseInt(fs.readFileSync(PREVIEW_PID, 'utf8').trim(), 10); } catch (e) {} }
    if (!pid) pid = findPidByPort(PORT_8080);
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch (e) {} try { execSync('fuser -k 8080/tcp 2>/dev/null', { timeout: 3000 }); } catch (e) {} }
    try { fs.unlinkSync(PREVIEW_PID); } catch (e) {}
    resolve({ ok: true, message: 'stopped' });
  });
}

function previewRestart() {
  return previewStop().then(() => new Promise((res) => setTimeout(() => previewStart().then(res), 800)));
}

function telemetry() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  let disk = null;
  try {
    const out = execSync("df -k /workspaces/My_code | tail -1", { encoding: 'utf8', timeout: 3000 });
    const parts = out.trim().split(/\s+/);
    disk = { totalKB: parseInt(parts[1], 10), usedKB: parseInt(parts[2], 10), freeKB: parseInt(parts[3], 10) };
  } catch (e) {}
  return { ram: { total, free, used, usedPercent: Math.round((used / total) * 100) }, cpu: { loadavg: os.loadavg(), cores: os.cpus().length }, disk, uptime: os.uptime() };
}

module.exports = {
  AUTH_PATH, OPENCODE_CONFIG_PATH, PREVIEW_PID, PREVIEW_LOG, SERVER_LOG,
  PORT_4096, PORT_8080, HOME,
  readJson, writeJson, maskKey, detectProvider, normalizeAuth, getKeys, setKey, deleteKey, unlockProviders, pingProvider,
  findPidByPort, processUptime, status4096, restart4096, tailLog,
  previewStatus, previewStart, previewStop, previewRestart, telemetry
};
