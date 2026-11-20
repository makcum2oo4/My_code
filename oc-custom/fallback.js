const fs = require('fs');
const path = require('path');

const BASE = '/workspaces/My_code/oc-custom';
const CONFIG_PATH = path.join(BASE, 'custom-config.json');

const DEFAULT_CONFIG = {
  autoFallback: true,
  modelChain: [],
  maxTokensGroq: 900,
  autoCompactThreshold: 20,
  pingAutoOff: 'inf'
};

const cooldowns = new Map(); // modelKey -> { until, reason }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Object.assign({}, DEFAULT_CONFIG, raw || {});
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig(cfg) {
  const merged = Object.assign({}, loadConfig(), cfg || {});
  // never store keys
  delete merged.keys; delete merged.auth;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

function getConfig() { return loadConfig(); }

function updateConfig(patch) { return saveConfig(Object.assign({}, loadConfig(), patch || {})); }

function modelKey(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return (m.providerID || m.provider || '') + '/' + (m.modelID || m.id || m.model || '');
}

function parseModel(m) {
  if (!m) return { providerID: '', modelID: '' };
  if (typeof m === 'string') {
    const idx = m.indexOf('/');
    if (idx > 0) return { providerID: m.slice(0, idx), modelID: m.slice(idx + 1) };
    return { providerID: '', modelID: m };
  }
  return { providerID: m.providerID || m.provider || '', modelID: m.modelID || m.id || m.model || '' };
}

function isCooldown(key) {
  const c = cooldowns.get(key);
  if (!c) return { cooldown: false };
  if (Date.now() >= c.until) { cooldowns.delete(key); return { cooldown: false }; }
  return { cooldown: true, until: c.until, reason: c.reason, remainingMs: c.until - Date.now() };
}

function setCooldown(key, reason, durationMs) {
  if (!key) return;
  const dur = durationMs || ( /day|quota|daily/i.test(reason || '') ? 3600000 : 60000 );
  cooldowns.set(key, { until: Date.now() + dur, reason: reason || 'rate limit' });
}

function clearCooldown(key) { cooldowns.delete(key); }

function getCooldowns() {
  const out = {};
  for (const [k, v] of cooldowns.entries()) {
    if (Date.now() < v.until) out[k] = { until: v.until, reason: v.reason, remainingMs: v.until - Date.now() };
    else cooldowns.delete(k);
  }
  return out;
}

function detectLimitError(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  const patterns = [
    { re: /429/, reason: 'HTTP 429' },
    { re: /rate limit/, reason: 'Rate limit' },
    { re: /exceeded/, reason: 'Exceeded' },
    { re: /otpm/, reason: 'OTPM' },
    { re: /quota/, reason: 'Quota' },
    { re: /free-models-per-day/, reason: 'free-models-per-day' },
    { re: /timeout/, reason: 'Timeout' }
  ];
  for (const p of patterns) if (p.re.test(s)) return p.reason;
  return null;
}

function getNextModel(currentKey) {
  const cfg = loadConfig();
  if (!cfg.autoFallback) return null;
  const chain = cfg.modelChain || [];
  const cur = currentKey || '';
  let start = chain.indexOf(cur);
  if (start < 0) start = -1;
  for (let i = start + 1; i < chain.length; i++) {
    const k = chain[i];
    if (!isCooldown(k).cooldown) return parseModel(k);
  }
  // wrap? no, only forward
  return null;
}

function coerceMaxTokens(provider, body) {
  // returns possibly modified body (as object) for groq
  const cfg = loadConfig();
  if (provider === 'groq') {
    // store desired max_tokens in config but cannot inject into OpenCode prompt schema
    return { maxTokens: cfg.maxTokensGroq || 900 };
  }
  return {};
}

module.exports = {
  CONFIG_PATH, DEFAULT_CONFIG, loadConfig, saveConfig, getConfig, updateConfig,
  modelKey, parseModel, isCooldown, setCooldown, clearCooldown, getCooldowns,
  detectLimitError, getNextModel, coerceMaxTokens, cooldowns
};
