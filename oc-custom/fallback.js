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

function checkIsLimitError(errorMsg) {
  if (!errorMsg) return false;
  const lowerError = errorMsg.toLowerCase();
  const limitPatterns = [
    '429', 'rate limit', 'exceeded', 'otpm', 'quota',
    'free-models-per-day', 'timeout',
  ];
  return limitPatterns.some(p => lowerError.includes(p.toLowerCase()));
}

function getProviderModel(modelName) {
  const provider = getKeyProvider(modelName || '');
  const target = fallbacks.find(m => m.provider === provider && m.enabled);
  if (!target) return null;
  return { provider, model: target.model, cooldown: target.cooldown };
}

function applyFallback(data) {
  const modelName = data.model || '';
  const errorMsg = data.error || '';
  const duration = data.duration;

  if (!checkIsLimitError(errorMsg)) {
    return { ok: false, reason: 'Not a rate limit error' };
  }

  const providerData = getProviderModel(modelName);
  if (!providerData) {
    return { ok: false, reason: 'No available provider' };
  }

  const { provider, model, cooldown } = providerData;
  if (cooldown > 0) {
    return { ok: false, reason: 'On cooldown', cooldown };
  }

  const target = fallbacks.find(m => m.provider === provider && m.enabled);
  if (!target) {
    return { ok: false, reason: 'No available provider' };
  }

  target.cooldown = duration || COOLDOWN_SECOND;

  const live = getLiveProviders();
  const next = live.find(m => m.provider !== provider && m.enabled && m.cooldown <= 0);

  if (next) {
    target.enabled = false;
  }

  return { ok: true, provider, model, cooldown };
}

module.exports = {
  checkIsLimitError,
  getProviderModel,
  getLiveProviders,
  applyFallback,
  fallbacks,
};