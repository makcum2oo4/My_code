const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const system = require('./system');
const fallback = require('./fallback');

const HOST = '0.0.0.0';
const PORT = 3000;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 4096;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'custom-config.json');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': b.length, 'Access-Control-Allow-Origin': '*' });
  res.end(b);
}

function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  try {
    const data = fs.readFileSync(full);
    const ext = path.extname(file).toLowerCase();
    const ct = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': ct, 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}

async function handleCustom(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  const method = req.method.toUpperCase();

  if (pathname === '/__custom/ping') {
    let healthOk = false;
    try {
      const h = await new Promise((resolve) => {
        const r = http.get('http://127.0.0.1:4096/global/health', { timeout: 3000 }, (resp) => {
          let b = ''; resp.on('data', (c) => b += c); resp.on('end', () => resolve({ status: resp.statusCode, body: b }));
        });
        r.on('error', () => resolve({ status: 0, body: '' }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: '' }); });
      });
      healthOk = h.status === 200;
    } catch (e) {}
    return sendJson(res, 200, { ok: true, ts: Date.now(), upstream: healthOk });
  }

  if (pathname === '/__custom/config') {
    if (method === 'GET') {
      return sendJson(res, 200, fallback.loadConfig());
    }
    if (method === 'POST') {
      const body = await readBody(req);
      let patch = {};
      try { patch = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { patch = {}; }
      // strip any keys
      delete patch.keys; delete patch.auth; delete patch.key;
      const cfg = fallback.saveConfig(patch);
      return sendJson(res, 200, cfg);
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (pathname === '/__custom/preview') {
    if (method === 'GET') {
      const s = await system.previewStatus();
      return sendJson(res, 200, s);
    }
    if (method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { data = {}; }
      const action = (data.action || u.searchParams.get('action') || 'status').toLowerCase();
      if (action === 'start') { const r = await system.previewStart(); return sendJson(res, 200, Object.assign({ log: system.tailLog(system.PREVIEW_LOG) }, r)); }
      if (action === 'stop') { const r = await system.previewStop(); return sendJson(res, 200, r); }
      if (action === 'restart') { const r = await system.previewRestart(); return sendJson(res, 200, r); }
      const s = await system.previewStatus();
      return sendJson(res, 200, s);
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (pathname === '/__custom/server4096') {
    if (method === 'GET') {
      const s = await system.status4096();
      s.log = system.tailLog(system.SERVER_LOG);
      return sendJson(res, 200, s);
    }
    if (method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { data = {}; }
      const action = (data.action || u.searchParams.get('action') || 'status').toLowerCase();
      if (action === 'restart') {
        const r = await system.restart4096();
        return sendJson(res, 200, r);
      }
      const s = await system.status4096();
      s.log = system.tailLog(system.SERVER_LOG);
      return sendJson(res, 200, s);
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (pathname === '/__custom/telemetry') {
    return sendJson(res, 200, system.telemetry());
  }

  if (pathname === '/__custom/keys') {
    if (method === 'GET') {
      return sendJson(res, 200, system.getKeys());
    }
    if (method === 'POST') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { data = {}; }
      const key = data.key || data.apiKey;
      if (!key) return sendJson(res, 400, { error: 'key required' });
      const provider = data.provider || system.detectProvider(key);
      if (!provider) return sendJson(res, 400, { error: 'cannot detect provider' });
      const info = system.setKey(provider, key);
      let test = null;
      if (data.test !== false) test = await system.pingProvider(provider, key);
      return sendJson(res, 200, { ok: true, provider, keyMasked: info.keyMasked, test });
    }
    if (method === 'DELETE') {
      const body = await readBody(req);
      let data = {};
      try { data = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { data = {}; }
      const provider = data.provider || u.searchParams.get('provider');
      if (!provider) return sendJson(res, 400, { error: 'provider required' });
      system.deleteKey(provider);
      return sendJson(res, 200, { ok: true, provider });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (pathname === '/__custom/compact') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    const body = await readBody(req);
    let data = {};
    try { data = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { data = {}; }
    const sessionID = data.sessionID || u.searchParams.get('sessionID');
    if (!sessionID) return sendJson(res, 400, { error: 'sessionID required' });
    const directory = data.directory || u.searchParams.get('directory') || '/workspaces/My_code';
    // get model from config or server
    let providerID = data.providerID;
    let modelID = data.modelID;
    if (!providerID || !modelID) {
      try {
        const cfg = JSON.parse(await new Promise((resolve, reject) => {
          const r = http.get('http://127.0.0.1:4096/config', { timeout: 3000 }, (resp) => { let b=''; resp.on('data',c=>b+=c); resp.on('end',()=>resolve(b)); });
          r.on('error', reject);
        }));
        const m = (cfg.model || '').split('/');
        if (m.length >= 2) { providerID = m[0]; modelID = m.slice(1).join('/'); }
      } catch (e) {}
    }
    const result = await new Promise((resolve) => {
      const q = '?directory=' + encodeURIComponent(directory);
      const payload = JSON.stringify({ providerID, modelID, auto: false });
      const r = http.request({ hostname: '127.0.0.1', port: 4096, path: '/session/' + encodeURIComponent(sessionID) + '/summarize' + q, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (resp) => {
        let b = ''; resp.on('data', (c) => b += c); resp.on('end', () => resolve({ status: resp.statusCode, body: b }));
      });
      r.on('error', (e) => resolve({ status: 0, body: e.message }));
      r.write(payload); r.end();
    });
    return sendJson(res, result.status || 200, { status: result.status, result: tryJson(result.body) });
  }

  // static custom assets
  if (pathname === '/__custom/custom.css') return serveStatic(res, 'custom.css');
  if (pathname === '/__custom/custom.js') return serveStatic(res, 'custom.js');

  return sendJson(res, 404, { error: 'not found' });
}

function tryJson(s) { try { return JSON.parse(s); } catch (e) { return s; } }

const isPromptPath = (p) => /\/session\/[^/]+\/(message|prompt_async)$/.test(p.split('?')[0]);

function doProxy(req, res, bodyBuf, retryModel, attempt) {
  attempt = attempt || 0;
  const maxAttempts = 6;
  const headers = Object.assign({}, req.headers);
  delete headers.host;
  delete headers['accept-encoding'];
  headers.host = '127.0.0.1:4096';

  let body = bodyBuf;
  const prompt = isPromptPath(req.url);
  if (retryModel && body && prompt) {
    try {
      const j = JSON.parse(body.toString('utf8'));
      j.model = { providerID: retryModel.providerID, modelID: retryModel.modelID };
      body = Buffer.from(JSON.stringify(j));
      headers['content-length'] = String(body.length);
    } catch (e) {}
  }

  // groq max_tokens note: cannot inject into schema; config only.

  return new Promise((resolve, reject) => {
    const preq = http.request({
      hostname: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers
    }, (pres) => {
      const ct = (pres.headers['content-type'] || '').toLowerCase();
      const status = pres.statusCode;

      if (ct.includes('text/html')) {
        const chunks = [];
        pres.on('data', (c) => chunks.push(c));
        pres.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          const tag = '<link rel="stylesheet" href="/__custom/custom.css"><script src="/__custom/custom.js" defer></script>';
          if (html.includes('</body>')) html = html.replace('</body>', tag + '</body>');
          else html += tag;
          const h = Object.assign({}, pres.headers);
          delete h['content-length']; delete h['content-encoding']; delete h['transfer-encoding'];
          res.writeHead(status, h);
          res.end(html);
          resolve();
        });
        return;
      }

      // For prompt endpoints, buffer full response to allow auto-fallback retry.
      if (prompt) {
        const chunks = [];
        pres.on('data', (c) => chunks.push(c));
        pres.on('end', async () => {
          const respBuf = Buffer.concat(chunks);
          const respText = respBuf.toString('utf8');
          const cfg = fallback.loadConfig();
          let reason = null;
          if (status === 429) reason = 'HTTP 429';
          if (!reason) reason = fallback.detectLimitError(respText);
          const currentModel = (() => {
            try { const j = JSON.parse((bodyBuf || Buffer.from('{}')).toString('utf8')); return j.model ? fallback.modelKey(j.model) : ''; } catch (e) { return ''; }
          })();

          if (cfg.autoFallback && reason && attempt < maxAttempts) {
            fallback.setCooldown(currentModel, reason);
            const next = fallback.getNextModel(currentModel);
            if (next) {
              // retry
              try {
                await doProxy(req, res, bodyBuf, next, attempt + 1);
                resolve();
                return;
              } catch (e) {}
            }
          }

          // send original
          const h = Object.assign({}, pres.headers);
          delete h['transfer-encoding'];
          res.writeHead(status, h);
          res.end(respBuf);
          resolve();
        });
        return;
      }

      // stream other responses
      const h = Object.assign({}, pres.headers);
      delete h['transfer-encoding'];
      res.writeHead(status, h);
      pres.on('data', (c) => res.write(c));
      pres.on('end', () => { res.end(); resolve(); });
      pres.on('error', (e) => { try { res.end(); } catch (x) {} resolve(); });
    });

    preq.on('error', (e) => {
      if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); }
      res.end('Bad gateway: ' + e.message);
      reject(e);
    });

    if (body && body.length) preq.write(body);
    preq.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
    return res.end();
  }

  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/__custom/')) {
    // handle static assets under __custom already in handleCustom; but ensure
    try { await handleCustom(req, res); } catch (e) { if (!res.headersSent) sendJson(res, 500, { error: e.message }); else res.end(); }
    return;
  }

  // buffer request body
  let body = Buffer.alloc(0);
  try { body = await readBody(req); } catch (e) {}
  try { await doProxy(req, res, body, null, 0); } catch (e) {
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); }
    res.end('Bad gateway: ' + e.message);
  }
});

server.on('upgrade', (req, socket, head) => {
  const headers = Object.assign({}, req.headers);
  delete headers.host;
  headers.host = '127.0.0.1:4096';
  const preq = http.request({
    hostname: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers
  });
  preq.on('upgrade', (pres, psocket, phead) => {
    let raw = 'HTTP/1.1 101 ' + (pres.statusMessage || 'Switching Protocols') + '\r\n';
    for (const [k, v] of Object.entries(pres.headers)) raw += k + ': ' + v + '\r\n';
    raw += '\r\n';
    socket.write(raw);
    if (head && head.length) psocket.write(head);
    if (phead && phead.length) socket.write(phead);
    psocket.pipe(socket);
    socket.pipe(psocket);
    socket.on('error', () => { try { psocket.destroy(); } catch (e) {} });
    psocket.on('error', () => { try { socket.destroy(); } catch (e) {} });
  });
  preq.on('error', () => { try { socket.destroy(); } catch (e) {} });
  preq.end();
});

server.listen(PORT, HOST, () => {
  console.log('oc-custom proxy listening on ' + HOST + ':' + PORT + ' -> ' + TARGET_HOST + ':' + TARGET_PORT);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
