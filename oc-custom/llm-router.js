'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4098;
const HOST = '127.0.0.1';
const OPENROUTER_BASE = 'https://openrouter.ai';
const MODELS_CACHE = '/tmp/oc-free-models.json';
const OVERRIDES_PATH = '/tmp/oc-router-overrides.json';
const COOLDOWN_STATE = '/tmp/oc-router-cooldowns.json';
const REFRESH_MS = 3 * 60 * 60 * 1000;
const TTFT_MS = 25000;
const MIDSTREAM_TIMEOUT_MS = 35000;
const META_ROUTERS = ['openrouter/free'];

const ROLE_ALIASES = {
  'auto-heavy': {
    priority: [
      'gh:openai/gpt-4.1',
      'or:nvidia/nemotron-3-ultra-550b-a55b:free',
      'gh:deepseek/DeepSeek-V3-0324',
    ],
    fallback: true,
  },
  'auto-coder': {
    priority: [
      'gh:openai/gpt-4.1-mini',
      'oc:deepseek-v4.1-flash-free',
      'gem:gemini-3.5-flash',
      'groq:qwen/qwen3.8-27b',
    ],
    fallback: true,
  },
  'auto-fast': {
    priority: [
      'gem:gemini-3.1-flash-lite',
      'groq:openai/gpt-oss-20b',
      'oc:beam-free',
    ],
    fallback: true,
  },
};
const GITHUB_FREE_MODELS = [
  { id: 'openai/gpt-4.1', name: 'GitHub: GPT-4.1', context_length: 1047576 },
  { id: 'openai/gpt-4.1-mini', name: 'GitHub: GPT-4.1 Mini', context_length: 1047576 },
  { id: 'openai/gpt-4o', name: 'GitHub: GPT-4o', context_length: 128000 },
  { id: 'deepseek/DeepSeek-V3-0324', name: 'GitHub: DeepSeek V3 0324', context_length: 128000 },
];
const GEMINI_FREE_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini: 3 Flash Preview', context_length: 1048576 },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini: 3.1 Flash Lite', context_length: 1048576 },
  { id: 'gemini-3.5-flash', name: 'Gemini: 3.5 Flash', context_length: 1048576 },
];
const GROQ_FREE_MODELS = [
  { id: 'qwen/qwen3.8-27b', name: 'Groq: Qwen 3.8 27B', context_length: 131072 },
  { id: 'openai/gpt-oss-20b', name: 'Groq: GPT-OSS 20B', context_length: 131072 },
  { id: 'openai/gpt-oss-120b', name: 'Groq: GPT-OSS 120B', context_length: 131072 },
];

const UPSTREAMS = {
  openrouter: {
    id: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    authHeader: () => ({ authorization: 'Bearer ' + apiKey }),
    freeFilter: (m) => m && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0
      && Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
    normalize: (m) => ({
      id: 'or:' + m.id,
      upstreamModelId: m.id,
      upstream: 'openrouter',
      name: m.name || m.id,
      context_length: m.context_length || (m.top_provider && m.top_provider.context_length) || 0,
      created: m.created || 0,
      supported_parameters: m.supported_parameters || [],
    }),
  },
  opencode: {
    id: 'opencode',
    baseURL: 'https://opencode.ai/zen/v1',
    chatPath: '/chat/completions',
    authHeader: () => ({ authorization: 'Bearer ' + getOpenCodeToken() }),
    freeFilter: (m) => {
      if (!m || m.type !== 'chat') return false;
      const tools = m.capabilities && m.capabilities.tools && m.capabilities.tools.supported;
      if (!tools) return false;
      const c = m.cost || {};
      let priceIn = 0, priceOut = 0;
      if (c.text) {
        if (typeof c.text.input === 'object') priceIn = c.text.input.price || 0;
        else if (typeof c.text.input === 'number') priceIn = c.text.input;
        if (typeof c.text.output === 'object') priceOut = c.text.output.price || 0;
        else if (typeof c.text.output === 'number') priceOut = c.text.output;
      } else if (typeof c.input === 'number') { priceIn = c.input; priceOut = c.output || 0; }
      return priceIn === 0 && priceOut === 0;
    },
    normalize: (m) => ({
      id: 'oc:' + m.id,
      upstreamModelId: m.id,
      upstream: 'opencode',
      name: m.name || m.id,
      context_length: (m.limit && m.limit.context) || 0,
      created: m.created || 0,
      supported_parameters: (m.capabilities && m.capabilities.reasoning && m.capabilities.reasoning.supported) ? ['tools', 'reasoning'] : ['tools'],
      _tools: true,
    }),
  },
  github: {
    id: 'github',
    baseURL: 'https://models.github.ai/inference',
    chatPath: '/chat/completions',
    authHeader: () => {
      const t = (process.env.MODELS_TOKEN_GITHUB || '').trim();
      return t ? { authorization: 'Bearer ' + t } : {};
    },
    freeFilter: (m) => true,
    normalize: (m) => ({
      id: 'gh:' + m.id,
      upstreamModelId: m.id,
      upstream: 'github',
      name: m.name || m.id,
      context_length: m.context_length || 0,
      created: m.created || 0,
      supported_parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : ['tools'],
      _tools: true,
    }),
  },
  gemini: {
    id: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chatPath: '/chat/completions',
    authHeader: () => {
      const t = (process.env.GEMINI_API_KEY || '').trim();
      return t ? { authorization: 'Bearer ' + t } : {};
    },
    freeFilter: (m) => true,
    normalize: (m) => ({
      id: 'gem:' + m.id,
      upstreamModelId: m.id,
      upstream: 'gemini',
      name: m.name || m.id,
      context_length: m.context_length || 0,
      created: m.created || 0,
      supported_parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : ['tools'],
      _tools: true,
    }),
  },
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    authHeader: () => {
      const t = (process.env.GROQ_API_KEY || '').trim();
      return t ? { authorization: 'Bearer ' + t } : {};
    },
    freeFilter: (m) => true,
    normalize: (m) => ({
      id: 'groq:' + m.id,
      upstreamModelId: m.id,
      upstream: 'groq',
      name: m.name || m.id,
      context_length: m.context_length || 0,
      created: m.created || 0,
      supported_parameters: Array.isArray(m.supported_parameters) ? m.supported_parameters : ['tools'],
      _tools: true,
    }),
  },
};
const COOLDOWN_STEPS = [2 * 60, 5 * 60, 15 * 60, 45 * 60];

let apiKey = '';
function loadApiKey() {
  if (process.env.OPENROUTER_API_KEY) { apiKey = process.env.OPENROUTER_API_KEY.trim(); return; }
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/opencode/auth.json'), 'utf8'));
    if (obj.openrouter && typeof obj.openrouter.key === 'string') { apiKey = obj.openrouter.key.trim(); return; }
    if (obj.openrouter && typeof obj.openrouter === 'string') { apiKey = obj.openrouter.trim(); return; }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.startsWith('sk-or-')) { apiKey = v.trim(); return; }
      if (v && typeof v.key === 'string' && v.key.startsWith('sk-or-')) { apiKey = v.key.trim(); return; }
    }
  } catch {}
  try {
    const content = fs.readFileSync(path.join('/workspaces/My_code/oc-custom', '.env'), 'utf8');
    const m = content.match(/^OPENROUTER_API_KEY=(.*)$/m) || content.match(/^OPENROUTER_KEY=(.*)$/m);
    if (m) { apiKey = m[1].trim(); return; }
  } catch {}
}
loadApiKey();

let _ocTokenCache = { token: 'public', mtime: 0 };
function getOpenCodeToken() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY.trim();
  try {
    const authPath = path.join(os.homedir(), '.local/share/opencode/auth.json');
    const st = fs.statSync(authPath);
    if (st.mtimeMs === _ocTokenCache.mtime && _ocTokenCache.token) return _ocTokenCache.token;
    const obj = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    let token = '';
    const v = obj && obj.opencode;
    if (typeof v === 'string') token = v.trim();
    else if (v && typeof v.key === 'string') token = v.key.trim();
    else if (v && typeof v.access_token === 'string') token = v.access_token.trim();
    else if (v && typeof v.token === 'string') token = v.token.trim();
    if (!token) token = 'public';
    _ocTokenCache = { token, mtime: st.mtimeMs };
    return token;
  } catch {
    return 'public';
  }
}

function log(...args) { console.log(new Date().toISOString(), ...args); }
function errLog(...args) { console.error(new Date().toISOString(), ...args); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, obj) { try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, file); } catch {} }

function getOverrides() {
  const o = readJson(OVERRIDES_PATH) || {};
  return {
    pinnedModel: (typeof o.pinnedModel === 'string' && o.pinnedModel) ? o.pinnedModel : null,
    bannedModels: Array.isArray(o.bannedModels) ? o.bannedModels : [],
  };
}
function setOverrides(o) {
  const cur = getOverrides();
  const next = { pinnedModel: cur.pinnedModel, bannedModels: cur.bannedModels };
  if (o && Object.prototype.hasOwnProperty.call(o, 'pinnedModel')) next.pinnedModel = o.pinnedModel;
  if (o && Object.prototype.hasOwnProperty.call(o, 'bannedModels')) next.bannedModels = o.bannedModels;
  writeJson(OVERRIDES_PATH, next);
  return next;
}

const cooldowns = new Map();
function loadCooldowns() {
  const raw = readJson(COOLDOWN_STATE);
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.until === 'number') cooldowns.set(k, v);
    }
  }
}
function saveCooldowns() {
  const obj = {};
  for (const [k, v] of cooldowns.entries()) obj[k] = v;
  writeJson(COOLDOWN_STATE, obj);
}
loadCooldowns();

function cooldownLeft(id) {
  const c = cooldowns.get(id);
  if (!c || !c.until) return 0;
  return Math.max(0, Math.ceil((c.until - Date.now()) / 1000));
}
function isInCooldown(id) {
  return cooldownLeft(id) > 0;
}
function setCooldown(id, sec, err, stepOverride) {
  const cur = cooldowns.get(id) || { step: 0, fails: 0 };
  const step = (typeof stepOverride === 'number') ? stepOverride : Math.min(cur.step + 1, COOLDOWN_STEPS.length - 1);
  const dur = (typeof sec === 'number' && sec > 0) ? sec : COOLDOWN_STEPS[step];
  const until = Date.now() + dur * 1000;
  cooldowns.set(id, { until, step, fails: (cur.fails || 0) + 1, lastError: err ? String(err).slice(0, 300) : (cur.lastError || '') });
  saveCooldowns();
}
function clearCooldown(id) {
  if (cooldowns.has(id)) {
    const c = cooldowns.get(id);
    cooldowns.set(id, { until: 0, step: 0, fails: 0, lastError: c ? c.lastError : '' });
    saveCooldowns();
  }
}
function markSuccess(id) {
  cooldowns.set(id, { until: 0, step: 0, fails: 0, lastError: '' });
  saveCooldowns();
}

// ---------- ranking tiers ----------
function parseParams(blob) {
  let total = 0, active = 0;
  const moe = blob.match(/(\d+(?:\.\d+)?)b-a(\d+(?:\.\d+)?)b/);
  if (moe) { total = parseFloat(moe[1]); active = parseFloat(moe[2]); }
  else {
    const m = blob.match(/(\d+(?:\.\d+)?)b/);
    if (m) { total = parseFloat(m[1]); active = total; }
  }
  return { total, active };
}
const TIER_BASE = { highest: 100000, high: 80000, medium: 50000, low: 10000 };

function classifyTier(blob, total) {
  // Low tier always wins: tiny/nano/mini/lite models must stay at the bottom
  // regardless of any nominal parameter count (e.g. nemotron-3-nano-omni-30b).
  if (/nano|mini|lite/.test(blob)) return 'low';
  if (total > 0 && total <= 8) return 'low';

  // Highest tier: flagship families regardless of the word "flash" or digits.
  if (/nemotron-3-ultra|nemotron-3\.5-ultra/.test(blob)) return 'highest';
  if (/deepseek-v4|deepseek-v3|deepseek-r1/.test(blob)) return 'highest';
  if (/nemotron-3\.5-super/.test(blob)) return 'highest';

  // High tier.
  if (/flint/.test(blob)) return 'high';
  if (/gemma-4/.test(blob)) return 'high';
  if (/coder/.test(blob)) return 'high';
  if (/llama/.test(blob) && total >= 70) return 'high';
  if (/qwen3/.test(blob) && total >= 30) return 'high';

  // Medium tier (explicit families + sensible default for everything else).
  if (/beam|tidepool|particle|longcat|iceman|nemotron-3\.5-lightning|hy4|mimo|big-pickle|ernie/.test(blob)) return 'medium';
  return 'medium';
}

function scoreModel(m) {
  const id = String(m.id || '').toLowerCase();
  const name = String(m.name || '').toLowerCase();
  const blob = id + ' ' + name;
  let { total, active } = parseParams(blob);
  // Known MoE sizes that are not encoded in the model id/name.
  if (/deepseek-v4/.test(blob)) { total = Math.max(total, 552); active = Math.max(active, 37); }
  else if (/deepseek-v3|deepseek-r1/.test(blob)) { total = Math.max(total, 671); active = Math.max(active, 37); }

  const tier = classifyTier(blob, total);
  const paramScore = (total || 0) * 10 + (active || 0) * 2;
  let familyBoost = 0;
  if (/deepseek/.test(blob)) familyBoost += 50;
  if (/qwen/.test(blob)) familyBoost += 40;
  if (/nemotron/.test(blob)) familyBoost += 40;
  if (/gemma/.test(blob)) familyBoost += 20;
  if (/claude|gpt|gemini/.test(blob)) familyBoost += 60;
  return TIER_BASE[tier] + paramScore + familyBoost;
}

function familyKey(modelId) {
  let s = String(modelId || '').replace(/^(or|oc):/, '');
  s = s.split('/').pop() || s;
  s = s.replace(/(:free|-free)$/, '');
  return s.toLowerCase();
}
function hasTools(m) {
  if (m._tools) return true;
  if (Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools')) return true;
  return false;
}
function rankModels(list) {
  const overrides = getOverrides();
  const banned = new Set(overrides.bannedModels);
  const filtered = (list || []).filter((m) => {
    if (!m || !m.id) return false;
    if (String(m.id).startsWith('gh:') && !(process.env.MODELS_TOKEN_GITHUB || '').trim()) return false;
    if (String(m.id).startsWith('gem:') && !(process.env.GEMINI_API_KEY || '').trim()) return false;
    if (String(m.id).startsWith('groq:') && !(process.env.GROQ_API_KEY || '').trim()) return false;
    if (banned.has(m.id)) return false;
    const stripped = String(m.id).replace(/^(or|oc):/, '');
    if (META_ROUTERS.includes(stripped)) return false;
    if (!hasTools(m)) return false;
    return true;
  });
  const scored = filtered.map((m) => ({
    id: m.id,
    upstreamModelId: m.upstreamModelId || m.id,
    upstream: m.upstream || 'openrouter',
    name: m.name || m.id,
    context_length: m.context_length || 0,
    created: m.created || 0,
    supported_parameters: m.supported_parameters || [],
    tier: Math.round(scoreModel(m) / 100),
    score: scoreModel(m),
    status: 'ready',
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Keep the same model from different upstreams adjacent (quota fallback pairs).
    const fa = familyKey(a.id);
    const fb = familyKey(b.id);
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (b.context_length !== a.context_length) return b.context_length - a.context_length;
    return (b.created || 0) - (a.created || 0);
  });
  return scored;
}

// ---------- model discovery ----------
let cachedModels = [];
let lastRefresh = 0;
let refreshInProgress = false;

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'oc-router/1.0' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchFreeModels(force) {
  if (refreshInProgress) return cachedModels;
  const now = Date.now();
  if (!force && cachedModels.length && (now - lastRefresh) < REFRESH_MS) return cachedModels;
  refreshInProgress = true;
  const merged = [];
  try {
    try {
      const data = await httpGetJson('https://openrouter.ai/api/v1/models', 30000);
      const list = Array.isArray(data && data.data) ? data.data : [];
      for (const m of list) {
        if (!UPSTREAMS.openrouter.freeFilter(m)) continue;
        merged.push(UPSTREAMS.openrouter.normalize(m));
      }
    } catch (e) { errLog('[router] openrouter fetch failed:', e.message); }
    try {
      const data = await httpGetJson('https://opencode.ai/inference/openai/v1/models', 30000);
      const list = Array.isArray(data && data.data) ? data.data : [];
      for (const m of list) {
        if (!UPSTREAMS.opencode.freeFilter(m)) continue;
        merged.push(UPSTREAMS.opencode.normalize(m));
      }
    } catch (e) { errLog('[router] opencode fetch failed:', e.message); }

    if ((process.env.MODELS_TOKEN_GITHUB || '').trim()) {
      for (const gm of GITHUB_FREE_MODELS) {
        merged.push({
          id: 'gh:' + gm.id,
          upstreamModelId: gm.id,
          upstream: 'github',
          name: gm.name,
          context_length: gm.context_length,
          created: 0,
          supported_parameters: ['tools'],
          _tools: true,
        });
      }
    }
    if ((process.env.GEMINI_API_KEY || '').trim()) {
      for (const gm of GEMINI_FREE_MODELS) {
        merged.push({
          id: 'gem:' + gm.id,
          upstreamModelId: gm.id,
          upstream: 'gemini',
          name: gm.name,
          context_length: gm.context_length,
          created: 0,
          supported_parameters: ['tools'],
          _tools: true,
        });
      }
    }
    if ((process.env.GROQ_API_KEY || '').trim()) {
      for (const gm of GROQ_FREE_MODELS) {
        merged.push({
          id: 'groq:' + gm.id,
          upstreamModelId: gm.id,
          upstream: 'groq',
          name: gm.name,
          context_length: gm.context_length,
          created: 0,
          supported_parameters: ['tools'],
          _tools: true,
        });
      }
    }
    for (const m of merged) m._normalized = true;
    cachedModels = merged;
    lastRefresh = Date.now();
    try { fs.writeFileSync(MODELS_CACHE, JSON.stringify({ ts: lastRefresh, data: merged })); } catch {}
    log(`[router] refreshed models: ${merged.length} free+tools (openrouter+opencode)`);
  } catch (e) {
    errLog('[router] refresh failed:', e.message);
     try {
       const c = JSON.parse(fs.readFileSync(MODELS_CACHE, 'utf8'));
       if (c && Array.isArray(c.data) && c.data.length && c.data[0]._normalized) { cachedModels = c.data; lastRefresh = c.ts || 0; }
     } catch {}
     if (!(process.env.MODELS_TOKEN_GITHUB || '').trim()) {
       cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('gh:'));
     }
     if (!(process.env.GEMINI_API_KEY || '').trim()) {
       cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('gem:'));
     }
     if (!(process.env.GROQ_API_KEY || '').trim()) {
       cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('groq:'));
     }
  } finally {
    refreshInProgress = false;
  }
  return cachedModels;
}

// load cache on start
try {
  const c = JSON.parse(fs.readFileSync(MODELS_CACHE, 'utf8'));
  if (c && Array.isArray(c.data) && c.data.length && c.data[0]._normalized) { cachedModels = c.data; lastRefresh = c.ts || 0; }
} catch {}
if (!(process.env.MODELS_TOKEN_GITHUB || '').trim()) {
  cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('gh:'));
}
if (!(process.env.GEMINI_API_KEY || '').trim()) {
  cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('gem:'));
}
if (!(process.env.GROQ_API_KEY || '').trim()) {
  cachedModels = (cachedModels || []).filter((m) => !String((m && m.id) || '').startsWith('groq:'));
}

// ---------- context estimate ----------
function estimateContext(body) {
  try {
    const s = JSON.stringify(body || {});
    return Math.ceil(s.length / 3.5);
  } catch { return 1000; }
}

// ---------- adaptation ----------
function adaptBody(modelId, body) {
  const out = JSON.parse(JSON.stringify(body || {}));
  const m = (cachedModels || []).find((x) => x.id === modelId);
  const params = (m && Array.isArray(m.supported_parameters)) ? m.supported_parameters : [];
  const supportsReasoning = m && (params.includes('reasoning') || params.includes('reasoning_effort') || params.includes('include_reasoning'));
  if (!supportsReasoning) {
    delete out.reasoning;
    delete out.reasoning_effort;
    delete out.include_reasoning;
  }
  if (String(modelId).startsWith('oc:')) {
    delete out.stream_options;
    delete out.store;
  }
  return out;
}

// ---------- failover ----------
const switchLog = [];
let lastActiveModel = null;
let lastActiveAt = 0;
function setActiveModel(id) {
  lastActiveModel = id || null;
  lastActiveAt = Date.now();
}
function recordSwitch(from, to, reason) {
  switchLog.unshift({ ts: Date.now(), from, to, reason: String(reason || '').slice(0, 200) });
  if (switchLog.length > 10) switchLog.length = 10;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseRetryAfter(headers) {
  const ra = headers['retry-after'];
  if (ra) {
    const n = parseInt(ra, 10);
    if (!isNaN(n) && n > 0) return n;
    const d = Date.parse(ra);
    if (!isNaN(d)) return Math.max(1, Math.ceil((d - Date.now()) / 1000));
  }
  const reset = headers['x-ratelimit-reset'] || headers['x-rate-limit-reset'];
  if (reset) {
    const n = parseInt(reset, 10);
    if (!isNaN(n)) {
      // could be seconds epoch or ms
      const ms = n > 1e12 ? n : n * 1000;
      return Math.max(1, Math.ceil((ms - Date.now()) / 1000));
    }
  }
  return null;
}

function isModelSpecific400(status, bodyText) {
  if (status !== 400) return false;
  const t = String(bodyText || '').toLowerCase();
  return /model|not (found|available|supported)|invalid model|does not exist|unknown model/.test(t);
}

function isErrorPacket(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.error) return true;
  if (Array.isArray(obj.choices) && obj.choices.length === 0 && obj.error) return true;
  return false;
}

function resolveUpstream(modelId) {
  const m = (cachedModels || []).find((x) => x.id === modelId);
  if (m) return { upstream: m.upstream || 'openrouter', upstreamModelId: m.upstreamModelId || modelId };
  if (modelId.startsWith('or:')) return { upstream: 'openrouter', upstreamModelId: modelId.slice(3) };
  if (modelId.startsWith('oc:')) return { upstream: 'opencode', upstreamModelId: modelId.slice(3) };
  if (modelId.startsWith('gh:')) return { upstream: 'github', upstreamModelId: modelId.slice(3) };
  if (modelId.startsWith('gem:')) return { upstream: 'gemini', upstreamModelId: modelId.slice(4) };
  if (modelId.startsWith('groq:')) return { upstream: 'groq', upstreamModelId: modelId.slice(5) };
  return { upstream: 'openrouter', upstreamModelId: modelId };
}

async function tryModel(modelId, body, isStream, res) {
  // returns {ok:true} if sent to client, or throws with {retry:true/false, ...}
  const overrides = getOverrides();
  const banned = new Set(overrides.bannedModels);
  if (banned.has(modelId)) throw { retry: true, reason: 'banned' };
  if (isInCooldown(modelId)) throw { retry: true, reason: 'cooldown' };

  const adapted = adaptBody(modelId, body);
  adapted.model = modelId;

  const { upstream, upstreamModelId } = resolveUpstream(modelId);
  const up = UPSTREAMS[upstream] || UPSTREAMS.openrouter;
  const urlObj = new URL(up.baseURL + up.chatPath);
  const authHeaders = up.authHeader();
  const headers = {
    'content-type': 'application/json',
    'accept': isStream ? 'text/event-stream' : 'application/json',
    'http-referer': 'http://127.0.0.1:4098',
    'x-title': 'oc-router',
    ...authHeaders,
  };

  adapted.model = upstreamModelId;

  const data = Buffer.from(JSON.stringify(adapted));

  return new Promise((resolve, reject) => {
    let settled = false;
    let firstSent = false;
    let lastChunkAt = Date.now();
    let midTimer = null;
    let ttftTimer = null;
    let upstreamReq = null;
    let upstreamRes = null;

    const cleanup = () => {
      if (ttftTimer) { clearTimeout(ttftTimer); ttftTimer = null; }
      if (midTimer) { clearInterval(midTimer); midTimer = null; }
    };

    const fail = (reason, retry, retrySec, status) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (upstreamRes) upstreamRes.destroy(); } catch {}
      try { if (upstreamReq) upstreamReq.destroy(); } catch {}
      reject({ retry: !!retry, reason, retrySec: (typeof retrySec === 'number' && retrySec > 0) ? retrySec : null, status: (typeof status === 'number' ? status : null) });
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: true });
    };

    const mod = urlObj.protocol === 'https:' ? https : http;
    upstreamReq = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'content-length': data.length },
    }, (r) => {
      upstreamRes = r;
      const status = r.statusCode || 0;
      // handle non-2xx immediately
      if (status === 429 || status === 402 || status === 404 || status >= 500) {
        let raw = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { raw += c; });
        r.on('end', () => {
          const sec = (status === 429) ? (parseRetryAfter(r.headers) || null) : null;
          fail(`HTTP ${status} ${raw.slice(0, 200)}`, true, sec, status);
        });
        r.on('error', () => fail('upstream error', true, null, status));
        return;
      }
      if (status !== 200) {
        let raw = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { raw += c; });
        r.on('end', () => {
          if (status === 400) {
            fail(`HTTP 400 ${raw.slice(0, 200)}`, true, null, 400);
          } else {
            fail(`HTTP ${status} ${raw.slice(0, 200)}`, false, null, status);
          }
        });
        r.on('error', () => fail('upstream error', true, null));
        return;
      }

      // status 200: need to inspect first packet
      if (!isStream) {
        let raw = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { raw += c; });
        r.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (isErrorPacket(parsed)) {
            const msg = parsed && parsed.error ? (parsed.error.message || JSON.stringify(parsed.error)) : raw.slice(0, 200);
            const code = parsed && parsed.error && parsed.error.code;
            const codeNum = Number(code);
            const retry = codeNum === 429 || codeNum === 402 || codeNum === 404 || (codeNum >= 500) || /rate|limit|overload|unavailable|timeout/i.test(msg);
            const sec = (codeNum === 429) ? (parseRetryAfter(r.headers) || null) : null;
            fail(`first-packet error: ${msg}`, retry, sec, (Number.isFinite(codeNum) ? codeNum : 200));
            return;
          }
          // validate that response is a real chat completion (not a dead endpoint returning "OK")
          if (!parsed || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
            fail(`invalid response: ${raw.slice(0, 200)}`, true, null, 200);
            return;
          }
          // success: send
          if (!res.headersSent) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          }
          setActiveModel(modelId);
          res.end(raw);
          markSuccess(modelId);
          succeed();
        });
        r.on('error', () => fail('upstream error', true, null));
        return;
      }

      // stream: buffer raw Buffer chunks until the first complete SSE frame.
      // No setEncoding(), no extra 'data' listeners: one handler owns the stream.
      let pendingChunks = [];
      let pendingLen = 0;
      let committed = false;

      const midCheck = () => {
        if (Date.now() - lastChunkAt >= MIDSTREAM_TIMEOUT_MS) {
          cooldowns.set(modelId, {
            until: Date.now() + 2 * 60 * 1000,
            step: 1,
            fails: ((cooldowns.get(modelId) || {}).fails || 0) + 1,
            lastError: 'mid-stream timeout',
          });
          saveCooldowns();
          cleanup();
          try { if (upstreamRes) upstreamRes.destroy(); } catch {}
          try { if (upstreamReq) upstreamReq.destroy(); } catch {}
          try { res.end(); } catch {}
          succeed();
        }
      };

      const commit = (buf) => {
        committed = true;
        if (ttftTimer) { clearTimeout(ttftTimer); ttftTimer = null; }
        if (!res.headersSent) {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            'connection': 'keep-alive',
            'x-accel-buffering': 'no',
          });
        }
        try { res.write(buf); } catch {}
        lastChunkAt = Date.now();
        setActiveModel(modelId);
        midTimer = setInterval(midCheck, 5000);
      };

      const dataPayloads = (block) => block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());

      const inspectFirstFrame = (allowEnd) => {
        const buf = Buffer.concat(pendingChunks, pendingLen);
        const text = buf.toString('utf8');
        let frame = null;
        let pos = 0;

        // Walk complete frames and skip comment/keep-alive blocks (no data: lines).
        while (pos < text.length) {
          let idx = text.indexOf('\n\n', pos);
          let sep = 2;
          const crlf = text.indexOf('\r\n\r\n', pos);
          if (idx < 0 || (crlf >= 0 && crlf < idx)) { idx = crlf; sep = 4; }
          if (idx < 0) break;
          const candidate = text.slice(pos, idx);
          pos = idx + sep;
          if (dataPayloads(candidate).length === 0) continue;
          frame = candidate;
          break;
        }

        if (frame === null) {
          if (!allowEnd) return false;
          if (dataPayloads(text).length === 0) return false;
          frame = text;
        }

        const joined = dataPayloads(frame).join('\n');
        if (joined === '[DONE]') {
          fail('empty stream [DONE] first', true, null);
          return false;
        }
        let parsed = null;
        try { parsed = JSON.parse(joined); } catch { parsed = null; }
        if (parsed && isErrorPacket(parsed)) {
          const msg = parsed.error ? (parsed.error.message || JSON.stringify(parsed.error)) : 'error packet';
          const code = parsed.error && parsed.error.code;
          const codeNum = Number(code);
          const retry = codeNum === 429 || codeNum === 402 || codeNum === 404 || (codeNum >= 500) || /rate|limit|overload|unavailable|timeout|capacity/i.test(String(msg));
          const sec = (codeNum === 429) ? (parseRetryAfter(r.headers) || null) : null;
          fail(`first-packet error: ${msg}`, retry, sec, (Number.isFinite(codeNum) ? codeNum : 200));
          return false;
        }
        if (!parsed) {
          fail('invalid first chunk json', true, null);
          return false;
        }
        // Valid first frame: commit once, write every buffered byte exactly once.
        pendingChunks = null;
        pendingLen = 0;
        commit(buf);
        return true;
      };

      r.on('data', (chunk) => {
        if (settled) return;
        if (committed) {
          lastChunkAt = Date.now();
          try { res.write(chunk); } catch {}
          return;
        }
        pendingChunks.push(chunk);
        pendingLen += chunk.length;
        lastChunkAt = Date.now();
        inspectFirstFrame(false);
      });

      r.on('end', () => {
        if (settled) return;
        if (!committed) {
          if (!inspectFirstFrame(true) || !committed) {
            if (!settled) fail('stream ended before first chunk', true, null);
            return;
          }
        }
        cleanup();
        try { res.end(); } catch {}
        markSuccess(modelId);
        succeed();
      });
      r.on('error', (e) => fail('upstream error: ' + e.message, true, null));
      r.on('close', () => {
        if (!settled && !committed) fail('upstream closed', true, null);
      });
    });

    upstreamReq.on('error', (e) => fail('network error: ' + e.message, true, null));
    upstreamReq.setTimeout(0);
    ttftTimer = setTimeout(() => {
      if (!firstSent && !settled) fail('TTFT timeout', true, null);
    }, TTFT_MS);
    upstreamReq.write(data);
    upstreamReq.end();
  });
}

// ---------- HTTP server ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function rankedList() {
  const ranked = rankModels(cachedModels);
  const overrides = getOverrides();
  const banned = new Set(overrides.bannedModels);
  const pinned = overrides.pinnedModel;
  // annotate status
  return ranked.map((m) => {
    let status = 'ready';
    if (banned.has(m.id)) status = 'banned';
    else if (pinned && m.id === pinned) status = 'pinned';
    else if (isInCooldown(m.id)) status = 'cooldown';
    return {
      id: m.id,
      name: m.name,
      upstream: m.upstream,
      upstreamModelId: m.upstreamModelId,
      tier: m.tier,
      score: m.score,
      context_length: m.context_length,
      status,
      cooldownLeftSec: cooldownLeft(m.id),
      lastError: (cooldowns.get(m.id) && cooldowns.get(m.id).lastError) || '',
      okCount: 0,
      failCount: (cooldowns.get(m.id) && cooldowns.get(m.id).fails) || 0,
      pinned: pinned === m.id,
      banned: banned.has(m.id),
    };
  });
}

function topModelId() {
  const list = rankedList();
  const overrides = getOverrides();
  if (overrides.pinnedModel && list.some((m) => m.id === overrides.pinnedModel && m.status !== 'banned' && m.status !== 'cooldown')) {
    return overrides.pinnedModel;
  }
  const ready = list.filter((m) => m.status === 'ready' || m.status === 'pinned');
  return ready.length ? ready[0].id : null;
}

function activeModelId() {
  // Prefer the model that actually served the last request; fall back to the
  // next candidate that would be picked now. When nothing is available, null.
  const list = rankedList();
  const ready = list.filter((m) => m.status === 'ready' || m.status === 'pinned');
  if (ready.length === 0) {
    if (lastActiveModel && list.some((m) => m.id === lastActiveModel && (m.status === 'ready' || m.status === 'pinned'))) return lastActiveModel;
    return null;
  }
  if (lastActiveModel && list.some((m) => m.id === lastActiveModel && (m.status === 'ready' || m.status === 'pinned'))) return lastActiveModel;
  return topModelId();
}

function buildStatus() {
  const list = rankedList();
  const overrides = getOverrides();
  const top = list.length ? list[0].id : null;
  const active = activeModelId();
  const fallbackActive = !!(active && top && active !== top);
  const readyCount = list.filter((m) => m.status === 'ready' || m.status === 'pinned').length;
  return {
    ts: Date.now(),
    activeModel: active,
    activeModelAt: lastActiveAt || null,
    topModel: top,
    fallbackActive,
    readyCount,
    totalFreeCount: list.length,
    pinnedModel: overrides.pinnedModel,
    bannedModels: overrides.bannedModels,
    switches: switchLog.slice(),
    models: list,
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); } catch { return sendText(res, 400, 'bad request'); }
  const p = url.pathname;

  // management API
  if (p === '/__router/status' && req.method === 'GET') {
    return sendJson(res, 200, buildStatus());
  }
  if (p === '/pool-status' && req.method === 'GET') {
    const list = rankedList();
    const ready = list.filter((m) => m.status === 'ready' || m.status === 'pinned');
    let nextAvailableAt = null;
    for (const m of list) {
      if (m.status === 'cooldown' && m.cooldownLeftSec > 0) {
        const at = Date.now() + m.cooldownLeftSec * 1000;
        if (nextAvailableAt === null || at < nextAvailableAt) nextAvailableAt = at;
      }
    }
    return sendJson(res, 200, {
      ts: Date.now(),
      availableCount: ready.length,
      totalCount: list.length,
      nextAvailableAt,
    });
  }
  if (p === '/__router/reset' && req.method === 'POST') {
    for (const k of cooldowns.keys()) cooldowns.set(k, { until: 0, step: 0, fails: 0, lastError: '' });
    saveCooldowns();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/__router/refresh' && req.method === 'POST') {
    await fetchFreeModels(true);
    return sendJson(res, 200, { ok: true, total: cachedModels.length });
  }
  if (p === '/__router/pin' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    const modelId = payload.modelId === null || payload.modelId === undefined || payload.modelId === '' ? null : String(payload.modelId);
    setOverrides({ pinnedModel: modelId });
    return sendJson(res, 200, { ok: true, pinnedModel: modelId });
  }
  if (p === '/__router/ban' && req.method === 'POST') {
    let payload = {};
    try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
    const modelId = String(payload.modelId || '');
    const banned = !!payload.banned;
    const cur = getOverrides();
    const set = new Set(cur.bannedModels);
    if (banned) set.add(modelId); else set.delete(modelId);
    setOverrides({ bannedModels: Array.from(set) });
    return sendJson(res, 200, { ok: true, modelId, banned });
  }

  // OpenAI-compatible
  if (p === '/v1/models' && req.method === 'GET') {
    return sendJson(res, 200, {
      object: 'list',
      data: [{ id: 'auto-free', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'oc-router' }],
    });
  }

  if (p === '/v1/chat/completions' && req.method === 'POST') {
    let raw = '';
    try { raw = await readBody(req); } catch { return sendText(res, 400, 'bad body'); }
    let body = {};
    try { body = JSON.parse(raw); } catch { return sendText(res, 400, 'invalid json'); }
    const isStream = !!body.stream;
    const est = estimateContext(body);
    const ranked = rankModels(cachedModels);
    const overrides = getOverrides();
    const banned = new Set(overrides.bannedModels);
    // build candidate list
    let candidates = ranked.map((m) => m.id);
    if (overrides.pinnedModel && candidates.includes(overrides.pinnedModel)) {
      candidates = [overrides.pinnedModel].concat(candidates.filter((x) => x !== overrides.pinnedModel));
    }
    // filter by context
    candidates = candidates.filter((id) => {
      const m = ranked.find((x) => x.id === id);
      if (!m) return false;
      if (banned.has(id)) return false;
      if (isInCooldown(id)) return false;
      if ((m.context_length || 0) < est + 4096) return false;
      return true;
    });

    // role aliases: if requested model is a role alias, use its priority list
    let roleAlias = null;
    const requestedModel = String(body.model || '').replace(/^[^/]+\//, '');
    if (requestedModel && ROLE_ALIASES[requestedModel]) {
      roleAlias = requestedModel;
      const alias = ROLE_ALIASES[roleAlias];
      const priorityCandidates = alias.priority.filter((id) => {
        const m = ranked.find((x) => x.id === id);
        if (!m) return false;
        if (banned.has(id)) return false;
        if (isInCooldown(id)) return false;
        if ((m.context_length || 0) < est + 4096) return false;
        return true;
      });
      // append remaining ranked models (excluding priority ones) as fallback
      const restCandidates = ranked.map((m) => m.id).filter((id) => {
        if (alias.priority.includes(id)) return false;
        const m = ranked.find((x) => x.id === id);
        if (!m) return false;
        if (banned.has(id)) return false;
        if (isInCooldown(id)) return false;
        if ((m.context_length || 0) < est + 4096) return false;
        return true;
      });
      candidates = priorityCandidates.concat(restCandidates);
      if (alias.fallback && candidates.length === 0) {
        // fall back to all non-banned ranked models ignoring cooldown
        roleAlias = null;
        candidates = ranked.map((m) => m.id).filter((id) => !banned.has(id));
      }
    }

    // meta routers as last resort
    const metaAvailable = META_ROUTERS.filter((id) => !banned.has(id) && !isInCooldown(id));
    // if no candidates, try meta routers (they are not in ranked list; check cooldown only)
    if (candidates.length === 0) {
      candidates = metaAvailable.slice();
    }
    // last resort: if still empty, try all non-banned ranked models ignoring cooldown
    if (candidates.length === 0) {
      candidates = ranked.map((m) => m.id).filter((id) => !banned.has(id));
    }
    // last resort: meta routers ignoring cooldown
    if (candidates.length === 0) {
      candidates = META_ROUTERS.filter((id) => !banned.has(id));
    }

    if (candidates.length === 0) {
      const allCooldown = ranked.length > 0 && ranked.every((m) => isInCooldown(m.id)) && metaAvailable.length === 0;
      const code = allCooldown ? 429 : 503;
      return sendJson(res, code, { error: { message: allCooldown ? 'all models in cooldown' : 'no available models', code } });
    }

    let lastErr = null;
    for (const cand of candidates) {
      const fromModel = (lastErr && lastErr.model) || null;
      try {
        const r = await tryModel(cand, body, isStream, res);
        if (r && r.ok) {
          if (fromModel && fromModel !== cand) recordSwitch(fromModel, cand, lastErr && lastErr.reason);
          return; // response already sent
        }
      } catch (e) {
        lastErr = { model: cand, reason: e.reason || 'error', retrySec: e.retrySec };
        const upstream = (resolveUpstream(cand).upstream) || 'unknown';
        const status = (typeof e.status === 'number') ? e.status : null;
        const reasonText = String(e.reason || 'error');
        const is429 = status === 429 || /^HTTP 429\b/.test(reasonText) || /free-usage-limit|rate limit exceeded/i.test(reasonText);
        let sec = (typeof e.retrySec === 'number' && e.retrySec > 0) ? e.retrySec : null;
        const cur = cooldowns.get(cand) || { step: 0, fails: 0 };
        let dur;
        if (is429) {
          // real rate limit: escalate per COOLDOWN_STEPS (cap 45 min) or use retry-after
          if (typeof sec === 'number' && sec > 45 * 60) sec = 45 * 60;
          const nextStep = Math.min((cur.step || 0) + 1, COOLDOWN_STEPS.length - 1);
          dur = (typeof sec === 'number' && sec > 0) ? sec : COOLDOWN_STEPS[nextStep];
        } else {
          // ordinary errors (5xx, timeout, parse, invalid): short cooldown, no escalation
          dur = 90;
          sec = 90;
        }
        if (is429) {
          setCooldown(cand, sec, e.reason);
        } else {
          setCooldown(cand, sec, e.reason, 0);
        }
        log(`[router] failover model=${cand} upstream=${upstream} status=${status === null ? '?' : status} error="${reasonText.slice(0, 120)}" cooldownSec=${dur}`);
        if (fromModel && fromModel !== cand) {}
        // try next
        if (candidates.indexOf(cand) < candidates.length - 1) {
          recordSwitch(cand, candidates[candidates.indexOf(cand) + 1], e.reason);
        }
        continue;
      }
    }
    // all failed
    if (!res.headersSent) {
      sendJson(res, 503, { error: { message: 'all models failed: ' + (lastErr ? lastErr.reason : 'unknown'), code: 503 } });
    } else {
      try { res.end(); } catch {}
    }
    return;
  }

  // fallback: proxy GET / etc to openrouter? not needed
  sendText(res, 404, 'not found');
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

server.listen(PORT, HOST, () => {
  log(`[router] listening on http://${HOST}:${PORT}`);
});

setInterval(() => { fetchFreeModels(false).catch(() => {}); }, REFRESH_MS);
// initial fetch (non-blocking)
fetchFreeModels(false).catch(() => {});

process.on('uncaughtException', (e) => errLog('[router] uncaught:', e.stack || e.message));
process.on('unhandledRejection', (e) => errLog('[router] unhandled:', e && e.message ? e.message : e));
