const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SECRET_PATH = '/workspaces/My_code/oc-custom/tg-secret.json';
const OC_BASE = 'http://127.0.0.1:4096';
const FALLBACK_PATH = '/workspaces/My_code/oc-custom/fallback.js';

let botToken = '';
let ownerId = null;
let lastUpdateId = 0;
let isThinking = false;
let thinkingMsgId = null;
let fallbackMod = null;

function loadSecret() {
  try {
    const data = fs.readFileSync(SECRET_PATH, 'utf8');
    const obj = JSON.parse(data);
    botToken = obj.token;
    ownerId = obj.ownerId;
    return true;
  } catch {
    return false;
  }
}

function saveSecret() {
  fs.writeFileSync(SECRET_PATH, JSON.stringify({ token: botToken, ownerId }, null, 2));
  fs.chmodSync(SECRET_PATH, 0o600);
}

function loadFallbackMod() {
  try {
    fallbackMod = require(FALLBACK_PATH);
  } catch {}
}

function isAuthorized(fromId) {
  if (ownerId === null) return true;
  return fromId == ownerId;
}

function apiCall(method, payload) {
  return new Promise((resolve) => {
    const opts = {
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/${method}`,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function sendMessage(chatId, text, parseMode = 'Markdown') {
  apiCall('sendMessage', { chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true });
}

function editMessageText(chatId, messageId, text, parseMode = 'Markdown') {
  apiCall('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode });
}

function answerCallbackQuery(callbackQueryId, text) {
  apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

function sendPhoto(chatId, photoFileId, caption) {
  apiCall('sendPhoto', { chat_id: chatId, photo: photoFileId, caption, disable_web_page_preview: true });
}

function getFile(filePath) {
  return new Promise((resolve) => {
    const opts = {
      method: 'GET',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/getFile?file_path=${encodeURIComponent(filePath)}`,
      headers: {}
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).result.file_path); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function downloadFile(filePath) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/file/${encodeURIComponent(filePath)}`,
      headers: {}
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve(data);
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function forwardToOC(text, chatId) {
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4096,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://127.0.0.1:3000'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
    });
    req.write(JSON.stringify({ text, chatId }));
    req.end();
  } catch {}
}

function handleUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const fromId = message.from.id;
  const text = message.text || '';

  if (!isAuthorized(fromId)) {
    sendMessage(chatId, '❌ Доступ запрещен. Вы не являетесь владельцем.');
    return;
  }

  // Auto-bind owner
  if (ownerId === null) {
    ownerId = fromId;
    saveSecret();
    sendMessage(chatId, `✅ Привязано к вашему ID: ${ownerId}`);
  }

  if (text === '/start') {
    sendMessage(chatId, `✅ Привязано к вашему ID: ${ownerId}\nИспользуйте /help для списка команд`);
    return;
  }

  if (text === '/help') {
    sendMessage(chatId, '📋 <b>Команды:</b>\n/new - новая сессия\n/model - смена модели\n/mode - Build/Plan\n/undo - отмена\n/compact - сжатие\n/stop - прервать\n/status - статус системы\n\n🔧 Inline кнопки под сообщением');
    return;
  }

  if (text === '/new') {
    try { execSync('opencode session new', { encoding: 'utf8' }); sendMessage(chatId, '🆕 Сессия создана'); } catch (e) { sendMessage(chatId, `❌ ${e.message}`); }
    return;
  }

  if (text === '/model') {
    try {
      const health = execSync('curl -sf http://127.0.0.1:4096/global/health 2>/dev/null', 'utf8');
      sendMessage(chatId, `🤖 Health: ${health}`);
    } catch {
      sendMessage(chatId, '❌ Не могу подключиться к OpenCode');
    }
    return;
  }

  if (text === '/mode') {
    sendMessage(chatId, '🔄 Режим: Build / Plan (переключение через кнопки)');
    return;
  }

  if (text === '/undo') {
    try { execSync('opencode revert', { encoding: 'utf8' }); sendMessage(chatId, '↩️ Последний шаг отменен'); } catch {
      sendMessage(chatId, '❌ Нечего отменять');
    }
    return;
  }

  if (text === '/compact') {
    try { execSync('opencode compact --reason manual', { encoding: 'utf8' }); sendMessage(chatId, '📦 Контекст сжат'); } catch {
      sendMessage(chatId, '❌ Ошибка сжатия');
    }
    return;
  }

  if (text === '/stop') {
    try { execSync('opencode abort', { encoding: 'utf8' }); sendMessage(chatId, '⏹️ Генерация остановлена'); } catch {
      sendMessage(chatId, '❌ Ошибка');
    }
    return;
  }

  if (text === '/status') {
    try {
      const h = execSync('curl -sf http://127.0.0.1:4096/global/health 2>/dev/null', 'utf8');
      const p = execSync('curl -sf http://127.0.0.1:3000/__custom/preview 2>/dev/null', 'utf8');
      const t = execSync('curl -sf http://127.0.0.1:3000/__custom/telemetry 2>/dev/null', 'utf8');
      sendMessage(chatId, `📊 4096: ${h}\n8080: ${p}\nRAM/CPU/Disk: ${t}`, 'HTML');
    } catch {
      sendMessage(chatId, '❌ Ошибка получения статуса');
    }
    return;
  }

  if (text.startsWith('/')) {
    sendMessage(chatId, `Неизвестная команда: ${text}`);
    return;
  }

  // Regular text - forward to OpenCode
  forwardToOC(text, chatId);
  sendMessage(chatId, '⏳ Думаю...');
}

function startBot() {
  if (!loadSecret()) {
    console.error('Failed to load tg-secret.json');
    return;
  }

  loadFallbackMod();

  console.log(`Telegram bot starting with token: ${botToken.substring(0, 10)}...`);
  console.log(`OwnerId: ${ownerId || 'not set (auto-bind enabled)'}`);

  let lastCheck = 0;

  setInterval(async () => {
    const now = Date.now();
    if (now - lastCheck < 1000) return;
    lastCheck = now;

    const result = await handleGetUpdates(lastUpdateId);
    if (!result || !result.ok) return;

    if (!result.result || result.result.length === 0) return;

    for (const update of result.result) {
      lastUpdateId = update.update_id + 1;
      handleUpdate(update);
    }
  }, 1500);
}

module.exports = { loadSecret, saveSecret, isAuthorized, loadFallbackMod, forwardToOC, handleUpdate, startBot, sendMessage, editMessageText };