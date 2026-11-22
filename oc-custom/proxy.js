'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const PORT = 3000;
const LISTEN_HOST = '0.0.0.0';
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 4096;

const BASE_DIR = '/workspaces/My_code/oc-custom';
const HUD_DIR = path.join(BASE_DIR, 'hud');
const QUEUE_PATH = '/tmp/oc-queue.json';
const USAGE_STATS_PATH = path.join(BASE_DIR, 'usage-stats.json');
const PREVIEW_SERVER = path.join(BASE_DIR, 'preview-server.js');
const PREVIEW_LOG = '/tmp/oc-preview.log';
const PREVIEW_URL_PATH = '/tmp/oc-preview-url';
const PREVIEW_PORT = 8080;
const OC_BIN = '/home/vscode/.opencode/bin/opencode';

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function errLog(...args) {
  console.error(new Date().toISOString(), ...args);
}

function readTextFile(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

function readUsageStats() {
  try { return JSON.parse(fs.readFileSync(USAGE_STATS_PATH, 'utf8')); } catch { return {}; }
}

function saveUsageStats(stats) {
  try {
    const tmp = USAGE_STATS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats, null, 2));
    fs.renameSync(tmp, USAGE_STATS_PATH);
  } catch {}
}

// ---------------------------------------------------------------- http helpers

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function upstreamRequest(method, reqPath, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
    if (data) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = data.length;
    }
    const req = http.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: reqPath,
      method,
      headers,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('upstream timeout')));
    if (data) req.write(data);
    req.end();
  });
}

function httpsJson(url, headers = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { ...headers, connection: 'close' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isPortOpen(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

function waitForPort(port, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await isPortOpen(port)) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

// ------------------------------------------------------------------- telemetry

function getUptime() {
  try {
    const sec = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').trim().split(' ')[0]);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return { sec, human: `${d}д ${h}ч ${m}м` };
  } catch { return { sec: 0, human: 'н/д' }; }
}

function getDisk() {
  try {
    const out = execSync('df -k / 2>/dev/null | tail -1', { encoding: 'utf8', timeout: 2500 }).trim();
    const parts = out.split(/\s+/);
    const total = parseInt(parts[1], 10) * 1024;
    const free = parseInt(parts[3], 10) * 1024;
    if (!total) return { total: 0, free: 0, percent: 0 };
    return { total, free, used: total - free, percent: Math.round((1 - free / total) * 100) };
  } catch { return { total: 0, free: 0, percent: 0 }; }
}

function getResetCountdown(targetHour = 0) {
  const now = new Date();
  const nextReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + (now.getUTCHours() >= targetHour ? 1 : 0),
    targetHour, 0, 0,
  ));
  const diffMs = Math.max(0, nextReset - now);
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `${hrs}ч ${mins}м`;
}

function getOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const authPath = path.join(os.homedir(), '.local/share/opencode/auth.json');
    const obj = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (obj.openrouter && obj.openrouter.key) return obj.openrouter.key.trim();
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.startsWith('sk-or-')) return v.trim();
      if (v && typeof v.key === 'string' && v.key.startsWith('sk-or-')) return v.key.trim();
    }
  } catch {}
  return '';
}

function getConfiguredModel() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/opencode/opencode.json'), 'utf8'));
    return typeof cfg.model === 'string' ? cfg.model : '';
  } catch { return ''; }
}

function getCodespaceStats() {
  const stats = readUsageStats();
  const cs = stats.codespace || {};
  const used = typeof cs.coreMinutesUsed === 'number' ? cs.coreMinutesUsed : 0;
  const limit = typeof cs.limitCoreHours === 'number' ? cs.limitCoreHours : 120;
  const hoursUsed = used / 60;
  return {
    month: cs.monthKey || new Date().toISOString().slice(0, 7),
    hoursUsed: Number(hoursUsed.toFixed(2)),
    limitHours: limit,
    remainingHours: Number(Math.max(0, limit - hoursUsed).toFixed(2)),
  };
}

function getPreviewUrl() {
  const name = process.env.CODESPACE_NAME || '';
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || '';
  if (name && domain) return `https://${name}-${PREVIEW_PORT}.${domain}`;
  return readTextFile(PREVIEW_URL_PATH);
}

async function getSessions() {
  try {
    const res = await upstreamRequest('GET', '/session?limit=10', null, 3000);
    if (res.status === 200 && Array.isArray(res.body)) return res.body;
  } catch {}
  return [];
}

function modelOfSession(session) {
  const model = session && session.model ? session.model : {};
  const modelID = model.id || model.modelID || '';
  const providerID = model.providerID || '';
  return { modelID, providerID };
}

async function getLimits(session) {
  let modelID = '';
  let providerID = '';
  if (session) {
    const m = modelOfSession(session);
    modelID = m.modelID;
    providerID = m.providerID;
  }
  if (!modelID) {
    const configured = getConfiguredModel();
    const idx = configured.indexOf('/');
    if (idx > 0) {
      providerID = providerID || configured.slice(0, idx);
      modelID = configured.slice(idx + 1);
    } else {
      modelID = configured || 'default-model';
    }
  }

  if (providerID === 'openrouter' || (!providerID && modelID)) {
    const key = getOpenRouterApiKey();
    if (key) {
      try {
        const res = await httpsJson('https://openrouter.ai/api/v1/auth/key', { authorization: `Bearer ${key}` }, 2500);
         if (res.status === 200 && res.body && typeof res.body === 'object') {
           const d = (res.body && res.body.data && typeof res.body.data === 'object') ? res.body.data : res.body;
           const usage = d.usage_daily !== undefined ? d.usage_daily : (d.usage || 0);
          const limit = d.free_model_daily_requests && d.free_model_daily_requests.limit !== undefined
            ? d.free_model_daily_requests.limit
            : (d.limit !== undefined ? d.limit : null);
          const remaining = d.free_model_daily_requests && d.free_model_daily_requests.remaining !== undefined
            ? d.free_model_daily_requests.remaining
            : (d.limit_remaining !== undefined ? d.limit_remaining : null);
          const reset = getResetCountdown(0);
          const short = remaining !== null && limit !== null
            ? `OR ${remaining}/${limit}`
            : `OR $${Number(usage || 0).toFixed(2)}`;
          return {
            source: 'openrouter',
            model: modelID,
            short,
            text: `OpenRouter: потрачено $${Number(usage || 0).toFixed(4)} | лимит: ${limit === null ? 'н/д' : limit} | осталось: ${remaining === null ? 'н/д' : remaining} | сброс через ${reset}`,
            remaining,
            limit,
            reset,
          };
        }
      } catch {}
    }
  }

  const stats = readUsageStats();
  const isGemini = String(modelID).toLowerCase().includes('gemini');
  const targetHour = isGemini ? 8 : 0;
  const shifted = new Date(Date.now() - targetHour * 3600 * 1000);
  const dateKey = shifted.toISOString().slice(0, 10);
  const rec = stats[modelID] && stats[modelID].daily && stats[modelID].daily[dateKey]
    ? stats[modelID].daily[dateKey]
    : { requests: 0, tokens: 0 };
  const calibrated = stats[modelID] && stats[modelID].calibrated ? stats[modelID].calibrated : null;
  const reset = getResetCountdown(targetHour);
  const short = calibrated
    ? `lim ${rec.requests}/${calibrated.requests}`
    : `lim ${rec.requests} req`;
  const text = calibrated
    ? `~${rec.requests} / ~${calibrated.requests} запр. | ~${rec.tokens} / ~${calibrated.tokens} ток. | сброс через ${reset}`
    : `${rec.requests} запр. / ${rec.tokens} ток. (лимит запомнится при 429) | сброс через ${reset}`;
  return { source: 'local', model: modelID, short, text, remaining: null, limit: null, reset };
}

// ---------------------------------------------------------------- queue state

let queue = [];
try {
  const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  if (Array.isArray(raw)) queue = raw.filter((it) => it && it.id && it.sessionId && it.text);
  else if (raw && Array.isArray(raw.items)) queue = raw.items;
} catch {}

function saveQueue() {
  try {
    const tmp = QUEUE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items: queue }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, QUEUE_PATH);
  } catch (e) {
    errLog('[queue] save failed:', e.message);
  }
}

const sessionBusy = new Map();
const processing = new Set();

// ---------------------------------------------------------------- event stream

function normalizeEvent(evt) {
  if (!evt) return null;
  let out = evt;
  if (out.payload && out.payload.type) out = out.payload;
  if (out.type === 'sync' && out.syncEvent && out.syncEvent.data) {
    const sync = out.syncEvent;
    out = {
      type: String(sync.type || '').replace(/\.\d+$/, ''),
      properties: sync.data || {},
    };
  }
  return out && out.type ? out : null;
}

function handleEvent(rawEvt) {
  const evt = normalizeEvent(rawEvt);
  if (!evt) return;
  const p = evt.properties || evt.data || {};
  const sid = p.sessionID || p.sessionId || (p.info && p.info.id) || (p.part && p.part.sessionID) || '';
  if (!sid) return;
  const type = evt.type;

  if (type === 'session.status' && p.status) {
    if (p.status.type === 'busy') {
      sessionBusy.set(sid, 'busy');
      return;
    }
    if (p.status.type === 'idle') {
      sessionBusy.set(sid, 'idle');
      processQueue(sid, true).catch(() => {});
      return;
    }
    return;
  }
  if (type === 'session.idle') {
    sessionBusy.set(sid, 'idle');
    processQueue(sid, true).catch(() => {});
    return;
  }
  if (type === 'session.error') {
    sessionBusy.set(sid, 'idle');
    processQueue(sid, true).catch(() => {});
  }
}

let sseBackoff = 1000;
let sseStarted = false;

function startEventStream() {
  if (sseStarted) return;
  sseStarted = true;

  const connect = () => {
    let closed = false;
    const retry = () => {
      if (closed) return;
      closed = true;
      const delay = sseBackoff;
      sseBackoff = Math.min(15000, sseBackoff * 2);
      setTimeout(connect, delay);
    };
    const req = http.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/event',
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'accept-encoding': 'identity',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        retry();
        return;
      }
      sseBackoff = 1000;
      log('[queue] event stream connected');
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, ''));
          if (!dataLines.length) continue;
          try {
            const evt = JSON.parse(dataLines.join('\n'));
            handleEvent(evt);
          } catch {}
        }
      });
      res.on('end', retry);
      res.on('error', retry);
    });
    req.on('error', retry);
    req.setTimeout(0);
    req.end();
  };

  connect();
}

async function getSessionStatusMap() {
  try {
    const res = await upstreamRequest('GET', '/session/status', null, 3000);
    if (res.status === 200 && res.body && typeof res.body === 'object') return res.body;
  } catch {}
  return {};
}

// --------------------------------------------------------------------- queue

function normalizeModel(item) {
  const raw = item.model;
  if (raw && typeof raw === 'object') {
    const providerID = raw.providerID || raw.provider;
    const modelID = raw.modelID || raw.id || raw.model;
    if (providerID && modelID) return { providerID, modelID };
  }
  let text = '';
  if (typeof raw === 'string') text = raw;
  else if (item.providerID && item.modelID) text = `${item.providerID}/${item.modelID}`;
  if (!text) return null;
  const idx = text.indexOf('/');
  if (idx <= 0 || idx === text.length - 1) return null;
  return { providerID: text.slice(0, idx), modelID: text.slice(idx + 1) };
}

function sendPrompt(item) {
  return new Promise((resolve, reject) => {
    const payload = { parts: [{ type: 'text', text: item.text }] };
    const model = normalizeModel(item);
    if (model) payload.model = model;
    if (item.variant) payload.variant = item.variant;
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: `/session/${encodeURIComponent(item.sessionId)}/prompt_async`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': data.length,
        accept: 'application/json',
        'accept-encoding': 'identity',
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`prompt HTTP ${res.statusCode} ${body.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('prompt timeout')));
    req.write(data);
    req.end();
  });
}

async function processQueue(sessionId, force = false) {
  if (!sessionId || processing.has(sessionId)) return;
  if (!queue.some((it) => it.sessionId === sessionId)) return;
  processing.add(sessionId);
  try {
    if (!force) {
      const statuses = await getSessionStatusMap();
      if (statuses[sessionId] && statuses[sessionId].type === 'busy') {
        sessionBusy.set(sessionId, 'busy');
        return;
      }
    }
    const idx = queue.findIndex((it) => it.sessionId === sessionId);
    if (idx < 0) return;
    const item = queue[idx];
    queue.splice(idx, 1);
    saveQueue();
    try {
      await sendPrompt(item);
      sessionBusy.set(sessionId, 'busy');
      log(`[queue] sent ${item.id} to ${sessionId.slice(-8)}`);
    } catch (e) {
      queue.unshift(item);
      saveQueue();
      errLog('[queue] send failed, retry in 30s:', e.message);
      setTimeout(() => processQueue(sessionId, false).catch(() => {}), 30000);
    }
  } finally {
    processing.delete(sessionId);
  }
}

async function reconcileQueue() {
  if (!queue.length) return;
  const statuses = await getSessionStatusMap();
  const sessions = new Set(queue.map((it) => it.sessionId));
  for (const sid of sessions) {
    const st = statuses[sid];
    if (!st || st.type === 'idle') processQueue(sid, false).catch(() => {});
    else if (st.type === 'busy') sessionBusy.set(sid, 'busy');
  }
}

// ---------------------------------------------------------------- status data

async function fetchRouter(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (data) { headers['content-type']='application/json'; headers['content-length']=data.length; }
    const req = http.request({ hostname: '127.0.0.1', port: 4098, path, method, headers }, (res) => {
      let raw='';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('router timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function fetchAutopilot(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (data) { headers['content-type']='application/json'; headers['content-length']=data.length; }
    const req = http.request({ hostname: '127.0.0.1', port: 4099, path, method, headers }, (res) => {
      let raw='';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('autopilot timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function buildStatus() {
  const health = { up: false, version: '', port: UPSTREAM_PORT };
  try {
    const res = await upstreamRequest('GET', '/global/health', null, 2500);
    if (res.status === 200) {
      health.up = true;
      health.version = (res.body && res.body.version) || '';
    }
  } catch {}

  const sessions = await getSessions();
  const active = sessions[0] || null;
  const limits = await getLimits(active);
  const previewRunning = await isPortOpen(PREVIEW_PORT);
  const load = os.loadavg();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const disk = getDisk();
  const uptime = getUptime();
  const codespace = getCodespaceStats();

  return {
    ts: Date.now(),
    oc: health,
    preview: { running: previewRunning, port: PREVIEW_PORT, url: getPreviewUrl() },
    system: {
      cpu: Number(Math.min(100, (load[0] / Math.max(1, os.cpus().length)) * 100).toFixed(1)),
      load,
      ram: {
        total: totalRam,
        used: totalRam - freeRam,
        percent: Math.round((1 - freeRam / totalRam) * 100),
      },
      disk,
      uptime: uptime.sec,
      uptimeHuman: uptime.human,
    },
    codespace,
    limits,
    queue: { total: queue.length, items: queue.slice() },
    session: active ? {
      id: active.id,
      title: active.title || active.slug || '',
      model: modelOfSession(active).modelID,
      provider: modelOfSession(active).providerID,
    } : null,
    sessions: { total: sessions.length },
    router: await (async () => {
      try {
        const r = await fetchRouter('GET', '/__router/status');
        if (r.status === 200 && r.body) {
          return {
            activeModel: r.body.activeModel,
            fallbackActive: r.body.fallbackActive,
            readyCount: r.body.readyCount,
            totalFreeCount: r.body.totalFreeCount,
          };
        }
      } catch {}
      return null;
    })(),
  };
}

// ---------------------------------------------------------------- preview ops

function killPort(port) {
  try {
    const out = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf8', timeout: 3000 }).trim();
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGTERM'); } catch {}
    }
  } catch {}
}

async function startPreview() {
  let startedServer = false;
  if (!(await isPortOpen(PREVIEW_PORT))) {
    if (!fs.existsSync(PREVIEW_SERVER)) throw new Error('preview-server.js not found');
    const fd = fs.openSync(PREVIEW_LOG, 'a');
    const child = spawn('node', [PREVIEW_SERVER], { detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    fs.closeSync(fd);
    startedServer = true;
    const ok = await waitForPort(PREVIEW_PORT, 5000);
    if (!ok) throw new Error('preview server did not start');
  }
  return { startedServer, running: await isPortOpen(PREVIEW_PORT), url: getPreviewUrl() };
}

async function stopPreview() {
  killPort(PREVIEW_PORT);
  const started = Date.now();
  while (Date.now() - started < 4000) {
    if (!(await isPortOpen(PREVIEW_PORT))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { running: await isPortOpen(PREVIEW_PORT) };
}

async function restartOpenCode() {
  let pids = [];
  try {
    const out = execSync('pgrep -f "opencode web --port 4096" || true', { encoding: 'utf8', timeout: 3000 }).trim();
    pids = out.split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0 && n !== process.pid);
  } catch {}
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));

  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  env.OPENCODE_SERVER_PASSWORD = '';
  const fd = fs.openSync('/tmp/oc-web.log', 'a');
  const child = spawn(OC_BIN, ['web', '--port', '4096', '--hostname', '0.0.0.0', '--print-logs', '--log-level', 'WARN'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env,
  });
  child.unref();
  fs.closeSync(fd);

  let version = '';
  for (let i = 0; i < 30; i++) {
    try {
      const res = await upstreamRequest('GET', '/global/health', null, 2000);
      if (res.status === 200) { version = (res.body && res.body.version) || ''; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: !!version || (await isPortOpen(UPSTREAM_PORT)), version };
}

function resetLimits() {
  const stats = readUsageStats();
  for (const key of Object.keys(stats)) {
    if (stats[key] && typeof stats[key] === 'object' && 'calibrated' in stats[key]) stats[key].calibrated = null;
  }
  saveUsageStats(stats);
}

function getGhToken() {
  if (process.env.GH_CS_TOKEN) return process.env.GH_CS_TOKEN;
  try {
    const content = fs.readFileSync(path.join(BASE_DIR, '.env'), 'utf8');
    const m = content.match(/^GH_CS_TOKEN=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  return '';
}

function stopCodespace() {
  return new Promise((resolve, reject) => {
    const token = getGhToken();
    const name = process.env.CODESPACE_NAME || '';
    if (!token || !name) return reject(new Error('GH token or CODESPACE_NAME missing'));
    const body = Buffer.from('{}');
    const req = https.request({
      hostname: 'api.github.com',
      path: `/user/codespaces/${encodeURIComponent(name)}/stop`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'oc-custom-proxy',
        'content-type': 'application/json',
        'content-length': body.length,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('github timeout')));
    req.write(body);
    req.end();
  });
}

// ------------------------------------------------------------------ HUD assets

const HUD_CSS_TAG = '<link rel="stylesheet" href="/__custom/hud.css">';
const HUD_JS_TAG = '<script src="/__custom/hud.js" defer></script>';

function injectHud(html) {
  let out = html;
  if (!out.includes('/__custom/hud.css')) {
    const idx = out.search(/<\/head>/i);
    if (idx >= 0) {
      out = out.slice(0, idx) + HUD_CSS_TAG + out.slice(idx);
    } else {
      const headOpen = out.search(/<head[^>]*>/i);
      if (headOpen >= 0) {
        const end = out.indexOf('>', headOpen) + 1;
        out = out.slice(0, end) + HUD_CSS_TAG + out.slice(end);
      } else {
        out = HUD_CSS_TAG + out;
      }
    }
  }
  if (!out.includes('/__custom/hud.js')) {
    const idx = out.search(/<\/body>/i);
    if (idx >= 0) out = out.slice(0, idx) + HUD_JS_TAG + out.slice(idx);
    else out += HUD_JS_TAG;
  }
  return out;
}

function serveHudAsset(req, res, fileName) {
  const safe = fileName === 'hud.css' || fileName === 'hud.js' ? fileName : '';
  if (!safe) return sendText(res, 404, 'Not found');
  const filePath = path.join(HUD_DIR, safe);
  let content;
  try { content = fs.readFileSync(filePath); } catch { return sendText(res, 404, 'Not found'); }
  res.writeHead(200, {
    'content-type': safe.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
    'content-length': content.length,
    'cache-control': 'no-store',
  });
  res.end(content);
}

// -------------------------------------------------------------- transparent proxy

function proxyHttp(req, res) {
  const reqUrl = String(req.url || '');
  const accept = String(req.headers.accept || '');
  const isSse = /text\/event-stream/i.test(accept)
    || reqUrl === '/event' || reqUrl.startsWith('/event?')
    || reqUrl === '/global/event' || reqUrl.startsWith('/global/event?');
  const wantsHtml = req.method === 'GET' && /text\/html/i.test(accept);

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[key] = value;
  }
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  if (req.headers.origin !== undefined) headers.origin = `http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  if (isSse || wantsHtml || req.method === 'GET') headers['accept-encoding'] = 'identity';

  if (isSse) {
    if (req.socket) {
      try { req.socket.setTimeout(0); req.socket.setNoDelay(true); req.socket.setKeepAlive(true, 15000); } catch {}
    }
    if (res.socket) {
      try { res.socket.setTimeout(0); res.socket.setNoDelay(true); res.socket.setKeepAlive(true, 15000); } catch {}
    }
    try { req.setTimeout(0); } catch {}
    try { res.setTimeout(0); } catch {}
  }

  const upstreamReq = http.request({
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: req.url,
    method: req.method,
    headers,
  }, (upstreamRes) => {
    const status = upstreamRes.statusCode || 502;
    const contentType = String(upstreamRes.headers['content-type'] || '');
    const upstreamSse = /text\/event-stream/i.test(contentType);

    if (upstreamSse) {
      const outHeaders = { ...upstreamRes.headers };
      delete outHeaders['content-length'];
      delete outHeaders['content-encoding'];
      delete outHeaders['transfer-encoding'];
      outHeaders['cache-control'] = 'no-cache, no-transform';
      outHeaders['x-accel-buffering'] = 'no';
      outHeaders['pragma'] = 'no-cache';
      res.writeHead(status, outHeaders);
      try { res.flushHeaders(); } catch {}
      if (res.socket) {
        try { res.socket.setNoDelay(true); res.socket.setKeepAlive(true, 15000); } catch {}
      }
      if (upstreamRes.socket) {
        try { upstreamRes.socket.setNoDelay(true); upstreamRes.socket.setKeepAlive(true, 15000); } catch {}
      }

      let lastChunkAt = Date.now();
      let atBoundary = true;
      let keepAliveTimer = null;
      let ended = false;

      const cleanup = () => {
        if (ended) return;
        ended = true;
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        try { upstreamRes.destroy(); } catch {}
        try { upstreamReq.destroy(); } catch {}
      };

      const markBoundary = (buf) => {
        const s = typeof buf === 'string' ? buf : (buf ? buf.toString('utf8') : '');
        if (!s) return;
        atBoundary = s.endsWith('\n\n') || s.endsWith('\r\n\r\n');
      };

      upstreamRes.on('data', (chunk) => {
        lastChunkAt = Date.now();
        try { res.write(chunk); } catch {}
        markBoundary(chunk);
      });

      keepAliveTimer = setInterval(() => {
        if (ended) return;
        const since = Date.now() - lastChunkAt;
        if (since >= 15000 && atBoundary === true) {
          try { res.write(': keepalive\n\n'); } catch {}
          lastChunkAt = Date.now();
          atBoundary = true;
        }
      }, 5000);

      upstreamRes.on('end', () => { cleanup(); try { res.end(); } catch {} });
      upstreamRes.on('close', () => { cleanup(); try { res.end(); } catch {} });
      upstreamRes.on('error', () => { cleanup(); try { res.destroy(); } catch {} });
      req.on('close', cleanup);
      req.on('aborted', cleanup);
      res.on('close', cleanup);
      return;
    }

    const encoding = String(upstreamRes.headers['content-encoding'] || '').toLowerCase();
    const injectable = req.method === 'GET'
      && status === 200
      && /^text\/html/i.test(contentType)
      && (!encoding || encoding === 'identity');

    if (!injectable) {
      const outHeaders = { ...upstreamRes.headers };
      if (status === 204 || status === 304) delete outHeaders['content-length'];
      res.writeHead(status, outHeaders);
      if (res.socket) res.socket.setNoDelay(true);
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => { try { res.destroy(); } catch {} });
      return;
    }

    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const html = injectHud(raw);
      const outHeaders = { ...upstreamRes.headers };
      delete outHeaders['content-encoding'];
      delete outHeaders['transfer-encoding'];
      outHeaders['content-length'] = Buffer.byteLength(html);
      res.writeHead(status, outHeaders);
      res.end(html);
    });
    upstreamRes.on('error', () => { try { res.destroy(); } catch {} });
  });

  upstreamReq.on('error', (e) => {
    if (!res.headersSent) sendJson(res, 502, { error: { message: `Proxy error: ${e.message}`, code: 502 } });
    else try { res.destroy(); } catch {}
  });

  req.on('aborted', () => { try { upstreamReq.destroy(); } catch {} });
  req.pipe(upstreamReq);
}

// --------------------------------------------------------------- custom routes

async function handleCustom(req, res, url) {
  const p = url.pathname;

  if (p === '/__custom/hud.css' || p === '/__custom/hud.js') {
    if (req.method !== 'GET') return sendText(res, 405, 'Method not allowed');
    return serveHudAsset(req, res, p.slice('/__custom/'.length));
  }

  if (p === '/__custom/status' && req.method === 'GET') {
    try {
      return sendJson(res, 200, await buildStatus());
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // router proxy
  if (p === '/__custom/router/status' && req.method === 'GET') {
    try {
      const r = await fetchRouter('GET', '/__router/status');
      return sendJson(res, r.status, r.body);
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }
  if (p === '/__custom/router/reset' && req.method === 'POST') {
    try {
      const r = await fetchRouter('POST', '/__router/reset');
      return sendJson(res, r.status, r.body);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
  }
  if (p === '/__custom/router/refresh' && req.method === 'POST') {
    try {
      const r = await fetchRouter('POST', '/__router/refresh');
      return sendJson(res, r.status, r.body);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
  }
  if (p === '/__custom/router/pin' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    try {
      const r = await fetchRouter('POST', '/__router/pin', payload);
      return sendJson(res, r.status, r.body);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
  }
  if (p === '/__custom/router/ban' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    try {
      const r = await fetchRouter('POST', '/__router/ban', payload);
      return sendJson(res, r.status, r.body);
    } catch (e) { return sendJson(res, 502, { error: e.message }); }
  }

  // autopilot proxy
  if (p === '/__custom/autopilot/status' && req.method === 'GET') {
    try {
      const r = await fetchAutopilot('GET', '/status');
      return sendJson(res, r.status, r.body);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        return sendJson(res, 503, { status: 'offline', error: 'Orchestrator not running' });
      }
      return sendJson(res, 502, { error: e.message });
    }
  }
  if (p === '/__custom/autopilot/start' && req.method === 'POST') {
    try {
      let payload = {};
      try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      const r = await fetchAutopilot('POST', '/start', payload);
      return sendJson(res, r.status, r.body);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        return sendJson(res, 503, { status: 'offline', error: 'Orchestrator not running' });
      }
      return sendJson(res, 502, { error: e.message });
    }
  }
  if (p === '/__custom/autopilot/stop' && req.method === 'POST') {
    try {
      const r = await fetchAutopilot('POST', '/stop');
      return sendJson(res, r.status, r.body);
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        return sendJson(res, 503, { status: 'offline', error: 'Orchestrator not running' });
      }
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (p === '/__custom/action' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    const action = payload.action;
    try {
      if (action === 'preview_start') {
        const result = await startPreview();
        return sendJson(res, 200, { ok: true, action, ...result });
      }
      if (action === 'preview_stop') {
        const result = await stopPreview();
        return sendJson(res, 200, { ok: true, action, ...result });
      }
      if (action === 'preview_restart') {
        await stopPreview();
        const result = await startPreview();
        return sendJson(res, 200, { ok: true, action, ...result });
      }
      if (action === 'restart_opencode') {
        setTimeout(() => { restartOpenCode().catch((e) => errLog('[oc] restart failed:', e.message)); }, 500);
        return sendJson(res, 200, { ok: true, action, scheduled: true });
      }
      if (action === 'reset_limits') {
        resetLimits();
        return sendJson(res, 200, { ok: true, action });
      }
      if (action === 'shutdown') {
        const result = await stopCodespace();
        return sendJson(res, 200, { ok: true, action, status: result.status });
      }
      return sendJson(res, 400, { error: 'unknown action' });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (p === '/__custom/queue' && req.method === 'GET') {
    const sid = url.searchParams.get('sessionId') || '';
    const items = sid ? queue.filter((it) => it.sessionId === sid) : queue.slice();
    return sendJson(res, 200, { sessionId: sid || null, total: items.length, items });
  }

  if (p === '/__custom/queue' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    const text = payload.text === undefined || payload.text === null ? '' : String(payload.text);
    if (!text.trim()) return sendJson(res, 400, { error: 'text required' });
    let sid = payload.sessionId ? String(payload.sessionId) : '';
    if (!sid) {
      const sessions = await getSessions();
      sid = sessions[0] ? sessions[0].id : '';
    }
    if (!sid) return sendJson(res, 400, { error: 'sessionId required' });
    const item = {
      id: 'q_' + crypto.randomBytes(6).toString('hex'),
      sessionId: sid,
      text: text.slice(0, 50000),
      createdAt: Date.now(),
    };
    if (payload.model) item.model = payload.model;
    if (payload.variant) item.variant = payload.variant;
    queue.push(item);
    saveQueue();
    setTimeout(() => processQueue(sid, false).catch(() => {}), 250);
    return sendJson(res, 201, { item, total: queue.length });
  }

  const delMatch = p.match(/^\/__custom\/queue\/([^/]+)$/);
  if (delMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(delMatch[1]);
    const idx = queue.findIndex((it) => it.id === id);
    if (idx < 0) return sendJson(res, 404, { error: 'not found' });
    queue.splice(idx, 1);
    saveQueue();
    return sendJson(res, 200, { ok: true, id, total: queue.length });
  }

  return sendJson(res, 404, { error: 'not found' });
}

// --------------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
  catch { return sendText(res, 400, 'Bad request'); }

  if (url.pathname.startsWith('/__custom/')) {
    handleCustom(req, res, url).catch((e) => {
      errLog('[custom] api error:', e.message);
      if (!res.headersSent) sendJson(res, 500, { error: e.message });
      else try { res.destroy(); } catch {}
    });
    return;
  }

  proxyHttp(req, res);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

server.on('upgrade', (req, socket, head) => {
  try { socket.setTimeout(0); socket.setNoDelay(true); socket.setKeepAlive(true, 15000); } catch {}
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    try { upstream.setTimeout(0); upstream.setNoDelay(true); upstream.setKeepAlive(true, 15000); } catch {}
    const raw = req.rawHeaders;
    const lines = [];
    for (let i = 0; i < raw.length; i += 2) {
      const key = raw[i];
      const value = raw[i + 1];
      const lk = String(key).toLowerCase();
      if (lk === 'host') lines.push(`${key}: ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
      else if (lk === 'origin') lines.push(`${key}: http://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
      else lines.push(`${key}: ${value}`);
    }
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => { try { socket.destroy(); } catch {} });
  socket.on('error', () => { try { upstream.destroy(); } catch {} });
  socket.on('close', () => { try { upstream.destroy(); } catch {} });
});

server.listen(PORT, LISTEN_HOST, () => {
  log(`[proxy] listening on ${LISTEN_HOST}:${PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  startEventStream();
  setTimeout(() => reconcileQueue().catch(() => {}), 2000);
  setInterval(() => reconcileQueue().catch(() => {}), 15000);
});

setInterval(() => {
  const stats = readUsageStats();
  stats.codespace = stats.codespace || { monthKey: new Date().toISOString().slice(0, 7), coreMinutesUsed: 0, limitCoreHours: 120 };
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (stats.codespace.monthKey !== currentMonth) {
    stats.codespace.monthKey = currentMonth;
    stats.codespace.coreMinutesUsed = 0;
  }
  stats.codespace.coreMinutesUsed += os.cpus().length;
  saveUsageStats(stats);
}, 60000);

process.on('uncaughtException', (e) => errLog('[proxy] uncaught:', e.stack || e.message));
process.on('unhandledRejection', (e) => errLog('[proxy] unhandled:', e && e.message ? e.message : e));
