'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 4099;
const HOST = '127.0.0.1';
const STATE_FILE = '/workspaces/My_code/oc-custom/task-state.json';
const ROUTER_URL = 'http://127.0.0.1:4098';
const PROXY_URL = 'http://127.0.0.1:3000';

const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_TIMEOUT_MS = 120 * 1000;

let currentProcess = null;
let currentStepStart = 0;
let staleTimer = null;
let stepTimeoutTimer = null;

function log(...args) { console.log(new Date().toISOString(), '[orchestrator]', ...args); }
function errLog(...args) { console.error(new Date().toISOString(), '[orchestrator]', ...args); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, obj) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { errLog('writeJson failed:', e.message); }
}

const OUTPUT_DIR = '/tmp/autopilot-out';
const TG_API = 'https://api.telegram.org';

function prepareOutputDir() {
  try { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); } catch {}
  try {
    for (const f of fs.readdirSync(OUTPUT_DIR)) {
      const full = path.join(OUTPUT_DIR, f);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}

function sendFileToTelegram(filePath) {
  const token = (process.env.TG_BOT_TOKEN || '').trim();
  const chatId = (process.env.TG_CHAT_ID || '').trim();
  if (!token || !chatId) return Promise.resolve(false);
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { errLog('sendFile TG stat error:', e.message); return Promise.resolve(false); }
  if (!stat.isFile()) return Promise.resolve(false);
  const sizeMB = stat.size / (1024 * 1024);
  if (stat.size > 49 * 1024 * 1024) {
    const name = path.basename(filePath);
    const text = `⚠️ Файл слишком большой для отправки (${sizeMB.toFixed(1)} МБ): ${name}`;
    sendTg(text);
    return Promise.resolve(false);
  }
  const ext = path.extname(filePath).toLowerCase();
  let method = 'sendDocument', field = 'document';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) { method = 'sendPhoto'; field = 'photo'; }
  else if (['.mp4', '.mov', '.webm'].includes(ext)) { method = 'sendVideo'; field = 'video'; }
  else if (['.mp3', '.wav', '.ogg'].includes(ext)) { method = 'sendAudio'; field = 'audio'; }
  const name = path.basename(filePath);
  const boundary = '----oc' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const CRLF = '\r\n';
  const head = Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${chatId}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="caption"${CRLF}${CRLF}${name}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${field}"; filename="${name}"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const fileBuf = fs.readFileSync(filePath);
  const body = Buffer.concat([head, fileBuf, tail]);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': body.length,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let ok = false;
        try { ok = JSON.parse(raw).ok === true; } catch {}
        if (!ok) errLog('TG sendFile failed:', method, name, raw.slice(0, 300));
        resolve(ok);
      });
    });
    req.on('error', (e) => { errLog('TG sendFile error:', e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

function getState() {
  return readJson(STATE_FILE) || { status: 'idle', steps: [], currentStep: 0, lastError: null, logs: [] };
}

function setState(partial) {
  const state = getState();
  Object.assign(state, partial);
  writeJson(STATE_FILE, state);
  return state;
}

function addLog(entry) {
  const state = getState();
  state.logs = state.logs || [];
  state.logs.push({ ts: Date.now(), ...entry });
  if (state.logs.length > 500) state.logs = state.logs.slice(-500);
  writeJson(STATE_FILE, state);
}

function sendTg(text) {
  const token = (process.env.TG_BOT_TOKEN || '').trim();
  const chatId = (process.env.TG_CHAT_ID || '').trim();
  if (!token || !chatId) return;
  const data = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
  }, (res) => { res.resume(); });
  req.on('error', (e) => errLog('TG send error:', e.message));
  req.write(data);
  req.end();
}

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers: { accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function httpPostJson(url, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

function killCurrentProcess() {
  if (currentProcess) {
    try { currentProcess.kill('SIGKILL'); } catch {}
    currentProcess = null;
  }
  if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
  if (stepTimeoutTimer) { clearTimeout(stepTimeoutTimer); stepTimeoutTimer = null; }
}

async function callRouter(model, messages, stream = false) {
  const res = await httpPostJson(`${ROUTER_URL}/v1/chat/completions`, {
    model,
    messages,
    stream,
    max_tokens: stream ? undefined : 8000,
  }, 120000);
  if (res.status !== 200) throw new Error(`Router HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  if (stream) throw new Error('stream not supported here');
  return res.data;
}

async function checkPoolStatus() {
  try {
    const res = await httpGetJson(`${ROUTER_URL}/pool-status`);
    if (!res || typeof res !== 'object') return { availableCount: 0, nextAvailableAt: null };
    return {
      availableCount: (typeof res.availableCount === 'number') ? res.availableCount : 0,
      totalCount: (typeof res.totalCount === 'number') ? res.totalCount : 0,
      nextAvailableAt: (typeof res.nextAvailableAt === 'number') ? res.nextAvailableAt : null,
    };
  } catch (e) {
    errLog('pool-status error:', e.message);
    return { availableCount: 0, nextAvailableAt: null };
  }
}

async function waitForModelAvailability() {
  while (true) {
    const pool = await checkPoolStatus();
    if ((pool?.availableCount || 0) > 0) return;
    if (!pool?.nextAvailableAt) {
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    const waitMs = pool.nextAvailableAt - Date.now();
    if (waitMs <= 0) continue;
    const waitMin = Math.ceil(waitMs / 60000);
    if (waitMin < 10) {
      addLog({ level: 'info', msg: `Waiting ${waitMin} min for model availability` });
      await new Promise(r => setTimeout(r, Math.min(waitMs, 60000)));
    } else {
      const resumeAt = new Date(pool.nextAvailableAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      setState({ status: 'paused_limits', pausedAt: Date.now(), resumeAt: pool.nextAvailableAt });
      sendTg(`⏸ Автопилот на паузе: нет доступных моделей. Ожидается восстановление ~${resumeAt} (МСК). Сервер будет выключен.`);
      try {
        await httpPostJson(`${PROXY_URL}/__custom/action`, { action: 'shutdown' });
      } catch (e) { errLog('shutdown action failed:', e.message); }
      throw new Error('PAUSED_LIMITS');
    }
  }
}

function extractJsonArray(text) {
  let t = String(text || '').trim();
  // strip markdown fences
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // try direct parse
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
    if (parsed && Array.isArray(parsed.plan)) return parsed.plan;
  } catch {}
  // try to find array in text
  const m = t.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  // try object with steps/plan
  const om = t.match(/\{[\s\S]*\}/);
  if (om) {
    try {
      const parsed = JSON.parse(om[0]);
      if (parsed && Array.isArray(parsed.steps)) return parsed.steps;
      if (parsed && Array.isArray(parsed.plan)) return parsed.plan;
    } catch {}
  }
  return null;
}

async function runPlanner(task, model = 'auto-heavy', retry = false) {
  const sysPrompt = `Ты — планировщик задач. Разбей задачу на чёткие шаги. Верни ТОЛЬКО JSON-массив:
[
  { "id": 1, "title": "Краткое название", "prompt": "Полный промпт для исполнителя", "role": "auto-heavy|auto-coder|auto-fast", "verifyCmd": "опциональная shell-команда проверки" }
]
Роли: auto-heavy — планирование/архитектура, auto-coder — код/инструменты, auto-fast — быстрые правки. verifyCmd — shell-команда для проверки результата шага (можно опустить).\nЕсли задача предполагает создание итоговых файлов для пользователя (картинки, видео, аудио, документы, архивы), обязательно сохрани их в /tmp/autopilot-out/.`;
  const data = await callRouter(model, [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: task },
  ], false);
  const text = data.choices?.[0]?.message?.content || '';
  const steps = extractJsonArray(text);
  if (!steps || steps.length === 0) {
    const raw = text.slice(0, 200);
    addLog({ level: 'error', msg: 'Planner bad response', raw });
    if (!retry) {
      // one retry with stricter prompt
      const retryPrompt = sysPrompt + '\n\nВАЖНО: верни ТОЛЬКО валидный JSON-массив, без markdown и пояснений.';
      const data2 = await callRouter(model, [
        { role: 'system', content: retryPrompt },
        { role: 'user', content: task },
      ], false);
      const text2 = data2.choices?.[0]?.message?.content || '';
      const steps2 = extractJsonArray(text2);
      if (!steps2 || steps2.length === 0) {
        throw new Error('Planner returned empty plan. Raw: ' + text2.slice(0, 200));
      }
      return normalizeSteps(steps2);
    }
    throw new Error('Planner returned empty plan. Raw: ' + raw);
  }
  return normalizeSteps(steps);
}

function normalizeSteps(steps) {
  for (const s of steps) {
    s.id = Number(s.id);
    s.title = String(s.title || '');
    s.prompt = String(s.prompt || '');
    s.role = ['auto-heavy', 'auto-coder', 'auto-fast'].includes(s.role) ? s.role : 'auto-coder';
    s.verifyCmd = s.verifyCmd ? String(s.verifyCmd) : null;
  }
  return steps;
}

function extractFinalText(stdout) {
  const texts = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.type === 'text' && o.part && typeof o.part.text === 'string') {
        texts.push(o.part.text);
      } else if (o && typeof o.text === 'string' && o.type === 'text') {
        texts.push(o.text);
      }
    } catch {}
  }
  if (texts.length > 0) return texts.join('\n').trim();
  // fallback: last 2000 chars of cleaned stdout
  const cleaned = String(stdout || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  return cleaned.slice(-2000);
}

function runOpencodeStep(model, prompt, attempt, prevError) {
  return new Promise((resolve) => {
    const args = ['run', '--model', model, '--format', 'json', '--auto'];
    const promptRule = '\n\nПравило: если задача предполагает создание итоговых файлов для пользователя (картинки, видео, аудио, документы, архивы), обязательно сохрани их в /tmp/autopilot-out/.';
    if (attempt > 1 && prevError) {
      args.push(`Попытка ${attempt}. Предыдущая ошибка: ${prevError}\n\nЗадача: ${prompt}${promptRule}`);
    } else {
      args.push(prompt + promptRule);
    }
    const child = spawn('opencode', args, { cwd: '/workspaces/My_code', env: { ...process.env, OPENCODE_SERVER_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    currentProcess = child;
    currentStepStart = Date.now();

    let stdout = '', stderr = '';
    let lastOutputAt = Date.now();

    const updateStale = () => { lastOutputAt = Date.now(); };

    child.stdout.on('data', (d) => { stdout += d; updateStale(); });
    child.stderr.on('data', (d) => { stderr += d; updateStale(); });

    staleTimer = setInterval(() => {
      if (Date.now() - lastOutputAt > STALE_TIMEOUT_MS) {
        errLog('Stale timeout, killing process');
        child.kill('SIGKILL');
      }
    }, 10000);

    stepTimeoutTimer = setTimeout(() => {
      errLog('Step timeout, killing process');
      child.kill('SIGKILL');
    }, STEP_TIMEOUT_MS);

    child.on('close', (code) => {
      if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
      if (stepTimeoutTimer) { clearTimeout(stepTimeoutTimer); stepTimeoutTimer = null; }
      currentProcess = null;
      const timedOut = code === null || code === undefined;
      resolve({ code: code ?? -1, stdout, stderr, timedOut, finalText: extractFinalText(stdout) });
    });
  });
}

function runVerifyCmd(cmd) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', cmd], { cwd: '/workspaces/My_code', timeout: 60000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
  });
}

async function executeStep(step, stepIndex) {
  const role = step.role;
  const modelId = 'autorouter/' + role;
  addLog({ level: 'info', step: step.id, title: step.title, role, attempt: 1 });
  sendTg(`▶️ Шаг ${step.id}/${step.title} (${role})`);

  let lastError = null;
  let nativeFallbackUsed = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      addLog({ level: 'warn', step: step.id, attempt, retrying: true, error: lastError });
      sendTg(`🔁 Шаг ${step.id}: попытка ${attempt}/3 — ${lastError || 'неизвестная ошибка'}`);
    }

    // Fallback: if router pool is empty, try native Beam Free once before pausing/shutdown
    const pool = await checkPoolStatus();
    if ((pool.availableCount || 0) === 0 && !nativeFallbackUsed) {
      nativeFallbackUsed = true;
      addLog({ level: 'info', step: step.id, msg: 'router pool empty, trying native Beam Free' });
      sendTg(`🛟 Шаг ${step.id}: пул роутера пуст, пробую нативный Beam Free`);
      const fbResult = await runOpencodeStep('opencode/beam-free', step.prompt, 1, lastError);
      if (fbResult.finalText) { setState({ lastResult: String(fbResult.finalText).slice(0, 4000) }); }
      const fbSuccess = fbResult.code === 0 && !fbResult.timedOut;
      if (fbSuccess) {
        if (step.verifyCmd) {
          addLog({ level: 'info', step: step.id, verify: 'running' });
          const vr = await runVerifyCmd(step.verifyCmd);
          if (vr.code === 0) {
            addLog({ level: 'info', step: step.id, verify: 'ok' });
            return { success: true };
          }
          lastError = `verifyCmd failed (code ${vr.code}): ${vr.stderr.slice(0, 500)}`;
          addLog({ level: 'error', step: step.id, verify: 'failed', error: lastError });
        } else {
          return { success: true };
        }
      } else {
        lastError = fbResult.timedOut ? `timeout (no output ${STALE_TIMEOUT_MS/1000}s). stderr: ${fbResult.stderr.slice(-300).trim()}` : `exit code ${fbResult.code}: ${fbResult.stderr.slice(0, 500)}`;
        addLog({ level: 'error', step: step.id, error: lastError, fallback: 'beam-free' });
        sendTg(`❌ Шаг ${step.id}: нативный Beam Free не помог — ${lastError}`);
      }
    }

    try {
      await waitForModelAvailability();
    } catch (e) {
      if (e && e.message === 'PAUSED_LIMITS') throw e;
      throw e;
    }

    const result = await runOpencodeStep(modelId, step.prompt, attempt, lastError);
    if (result.finalText) { setState({ lastResult: String(result.finalText).slice(0, 4000) }); }
    const success = result.code === 0 && !result.timedOut;

    if (success && step.verifyCmd) {
      addLog({ level: 'info', step: step.id, verify: 'running' });
      const vr = await runVerifyCmd(step.verifyCmd);
      if (vr.code === 0) {
        addLog({ level: 'info', step: step.id, verify: 'ok' });
        return { success: true };
      }
      lastError = `verifyCmd failed (code ${vr.code}): ${vr.stderr.slice(0, 500)}`;
      addLog({ level: 'error', step: step.id, verify: 'failed', error: lastError });
    } else if (!success) {
      lastError = result.timedOut ? `timeout (no output ${STALE_TIMEOUT_MS/1000}s). stderr: ${result.stderr.slice(-300).trim()}` : `exit code ${result.code}: ${result.stderr.slice(0, 500)}`;
      addLog({ level: 'error', step: step.id, error: lastError });
    } else {
      return { success: true };
    }
  }
  return { success: false, error: lastError };
}

async function runOrchestrator() {
  const state = getState();
  if (state.status === 'running' || state.status === 'paused_limits') {
    log('Resuming task:', state.task?.slice(0, 80));
    sendTg('🔄 Автопилот возобновляет задачу...');
    await new Promise(r => setTimeout(r, 10000));
    const steps = state.steps || [];
    const startIdx = state.currentStep || 0;
    for (let i = startIdx; i < steps.length; i++) {
      const step = steps[i];
      setState({ currentStep: i });
      const res = await executeStep(step, i);
      if (!res.success) {
        setState({ status: 'failed', lastError: res.error, currentStep: i });
        sendTg(`❌ Задача провалена на шаге ${step.id}: ${res.error}`);
        return;
      }
    }
    setState({ status: 'done', currentStep: steps.length });
    const _lr = (getState().lastResult || '').slice(0, 1500);
    sendTg('✅ Задача выполнена полностью.' + (_lr ? '\n\nРезультат:\n' + _lr : ''));
    // send output files to Telegram
    try {
      const outFiles = fs.readdirSync(OUTPUT_DIR).map((f) => path.join(OUTPUT_DIR, f)).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
      for (const fp of outFiles) {
        await sendFileToTelegram(fp);
      }
      for (const fp of outFiles) { try { fs.unlinkSync(fp); } catch {} }
    } catch (e) { errLog('output files send error:', e.message); }
    return;
  }

  // This is for POST /start, actual logic is in handler
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); } catch { return sendJson(res, 400, { error: 'bad request' }); }
  const p = url.pathname;

  function sendJson(r, status, obj) {
    const body = JSON.stringify(obj);
    r.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    r.end(body);
  }

  if (p === '/status' && req.method === 'GET') {
    return sendJson(res, 200, getState());
  }

  if (p === '/start' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(raw || '{}');
        if (!task || !task.trim()) return sendJson(res, 400, { error: 'task required' });
        const state = getState();
        if (state.status === 'running' || state.status === 'planning') {
          return sendJson(res, 409, { error: 'already running' });
        }
        prepareOutputDir();
        setState({ status: 'planning', task, steps: [], currentStep: 0, lastError: null, logs: [] });
        sendJson(res, 200, { ok: true });

        // Planning
        addLog({ level: 'info', msg: 'Planning started' });
        sendTg('🧠 Планировщик анализирует задачу...');
        let steps;
        let lastPlanError = null;
        // Cascade: auto-coder -> auto-fast -> native opencode/beam-free
        for (const pm of ['auto-coder', 'auto-fast']) {
          try {
            steps = await runPlanner(task, pm);
            lastPlanError = null;
            break;
          } catch (e) {
            lastPlanError = e;
            addLog({ level: 'warn', msg: 'Planner failed', model: pm, error: e.message });
            sendTg(`⚠️ Планировщик (${pm}) не справился: ${e.message}`);
          }
        }
        if (!steps) {
          // Native fallback via opencode run
          try {
            addLog({ level: 'info', msg: 'Planner native fallback via opencode/beam-free' });
            sendTg('🛟 Планировщик: пробую нативный opencode/beam-free');
            const child = spawn('opencode', ['run', '--model', 'opencode/beam-free', '--format', 'json', '--auto', task + '\n\nВерни ТОЛЬКО валидный JSON-массив шагов.'], { cwd: '/workspaces/My_code', env: { ...process.env, OPENCODE_SERVER_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            await new Promise((resolve) => {
              child.stdout.on('data', (d) => { stdout += d; });
              child.stderr.on('data', (d) => { stderr += d; });
              child.on('close', (code) => resolve(code));
              setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(-1); }, 120000);
            });
            const text = extractFinalText(stdout) || stdout;
            const parsed = extractJsonArray(text);
            if (!parsed || parsed.length === 0) {
              throw new Error('Native planner returned empty plan. stderr: ' + stderr.slice(0, 300));
            }
            steps = normalizeSteps(parsed);
            lastPlanError = null;
          } catch (e) {
            lastPlanError = e;
            addLog({ level: 'error', msg: 'Planner native fallback failed', error: e.message });
          }
        }
        if (!steps) {
          const msg = (lastPlanError && lastPlanError.message) ? lastPlanError.message : 'Planner failed';
          const stage = (lastPlanError && lastPlanError.message && lastPlanError.message.includes('Native')) ? 'native fallback' : 'router';
          setState({ status: 'failed', lastError: `Planner failed at ${stage}: ${msg}` });
          sendTg(`❌ Ошибка планировщика (${stage}): ${msg}`);
          return;
        }
        setState({ status: 'running', steps, currentStep: 0 });
        addLog({ level: 'info', msg: 'Plan created', steps: steps.length });
        sendTg(`📋 План создан (${steps.length} шагов):\n` + steps.map(s => `${s.id}. ${s.title} [${s.role}]`).join('\n'));

        // Execute
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          setState({ currentStep: i });
          const res = await executeStep(step, i);
          if (!res.success) {
            setState({ status: 'failed', lastError: res.error, currentStep: i });
            sendTg(`❌ Задача провалена на шаге ${step.id}: ${res.error}`);
            return;
          }
        }
        setState({ status: 'done', currentStep: steps.length });
        const _lr = (getState().lastResult || '').slice(0, 1500);
    sendTg('✅ Задача выполнена полностью.' + (_lr ? '\n\nРезультат:\n' + _lr : ''));
    // send output files to Telegram
    try {
      const outFiles = fs.readdirSync(OUTPUT_DIR).map((f) => path.join(OUTPUT_DIR, f)).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
      for (const fp of outFiles) {
        await sendFileToTelegram(fp);
      }
      for (const fp of outFiles) { try { fs.unlinkSync(fp); } catch {} }
    } catch (e) { errLog('output files send error:', e.message); }
      } catch (e) {
        if (e.message === 'PAUSED_LIMITS') return;
        errLog('start error:', e.stack);
        setState({ status: 'failed', lastError: e.message });
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  if (p === '/stop' && req.method === 'POST') {
    killCurrentProcess();
    const state = getState();
    const wasRunning = state.status === 'running' || state.status === 'planning';
    setState({ status: 'idle', currentStep: 0 });
    if (wasRunning) sendTg('🛑 Автопилот остановлен вручную.');
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  log(`[orchestrator] listening on http://${HOST}:${PORT}`);
  // Auto-resume on start
  const state = getState();
  if (state.status === 'running' || state.status === 'paused_limits') {
    setTimeout(() => runOrchestrator().catch(e => errLog('auto-resume error:', e)), 10000);
  }
});

process.on('uncaughtException', (e) => errLog('uncaught:', e.stack));
process.on('unhandledRejection', (e) => errLog('unhandled:', e));