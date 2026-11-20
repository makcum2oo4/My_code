const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const COOLDOWN_SECOND = 60;
const COOLDOWN_DAY = 24 * 60 * 60;

const fallbacks = [
  { provider: 'groq', model: 'llama-3.1-70b-versatile', enabled: true, cooldown: 0 },
  { provider: 'openrouter', model: 'meta-llama/llama-3.1-70b-instruct', enabled: true, cooldown: 0 },
  { provider: 'xai', model: 'grok-2-latest', enabled: true, cooldown: 0 },
  { provider: 'google', model: 'gemini-1.5-flash', enabled: true, cooldown: 0 },
];

function getKeyProvider(key) {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('xai-')) return 'xai';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'google';
  return 'openrouter';
}

function getLiveProviders() {
  const live = [];
  for (const m of fallbacks) {
    if (m.enabled && m.cooldown <= 0) {
      live.push(m);
    }
  }
  return live;
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/__custom/fallback/status') {
    handleFallbackStatus(req, res);
  } else if (pathname === '/__custom/fallback/trigger') {
    handleFallbackTrigger(req, res);
  } else {
    forwardToUpstream(req, res);
  }
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
      const rawHeaders = {};
      for (const [k, v] of upstreamRes.headers) {
        if (typeof v === 'string') rawHeaders[k] = v;
        else rawHeaders[k] = JSON.stringify(v);
      }
      res.writeHead(upstreamRes.statusCode, rawHeaders);
      if (data) res.end(data);
      else res.end();
    });
  });

  upstreamReq.on('error', (e) => {
    res.writeHead(502);
    res.end(`Proxy error: ${e.message}`);
  });

  req.on('data', (chunk) => upstreamReq.write(chunk));
  req.on('end', () => upstreamReq.end());
}

function handleFallbackStatus(req, res) {
  const live = getLiveProviders();
  const response = {
    autoFallback: true,
    liveProviders: live.map(m => ({ ...m, cooldown: Math.max(0, m.cooldown) })),
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

function handleFallbackTrigger(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }

  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', () => {
    try { data = JSON.parse(body); } catch { data = {}; }
    const modelName = data.model || '';
    const errorMsg = data.error || '';

    const lowerError = (errorMsg || '').toLowerCase();

    const limitPatterns = [
      '429', 'rate limit', 'exceeded', 'otpm', 'quota',
      'free-models-per-day', 'timeout',
    ];

    const isLimitError = limitPatterns.some(p => lowerError.includes(p.toLowerCase()));

    if (!isLimitError) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'Not a rate limit error' }));
      return;
    }

    const provider = getKeyProvider(modelName || '');

    const target = fallbacks.find(m => m.provider === provider && m.enabled);
    if (!target) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'No available provider' }));
      return;
    }

    if (target.cooldown > 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'On cooldown', cooldown: target.cooldown }));
      return;
    }

    target.cooldown = data.duration || COOLDOWN_SECOND;

    const live = getLiveProviders();
    const next = live.find(m => m.provider !== provider && m.enabled && m.cooldown <= 0);

    if (next) {
      target.enabled = false;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: provider, model: target.model, cooldown: target.cooldown }));
  });
}

const server = http.createServer(handleRequest);

server.listen(8080, '0.0.0.0', () => {
  console.log(`Fallback server running on 0.0.0.0:8080`);
});