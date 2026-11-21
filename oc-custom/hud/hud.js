(function () {
  'use strict';

  if (window.__ocHudLoaded) return;
  window.__ocHudLoaded = true;

  var POLL_MS = 5000;
  var state = { status: null, router: null, drawerOpen: false, shutdownArmed: 0 };
  var els = {};

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'class') node.className = attrs[key];
        else if (key === 'text') node.textContent = attrs[key];
        else if (key === 'html') node.innerHTML = attrs[key];
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), attrs[key]);
        else node.setAttribute(key, attrs[key]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child == null) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    }
    return node;
  }

  function fmtBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(0) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  function toast(message) {
    if (!els.toast) {
      els.toast = h('div', { class: 'oc-hud-toast' });
      document.body.appendChild(els.toast);
    }
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      if (els.toast) els.toast.classList.remove('show');
    }, 2600);
  }

  function getSessionId() {
    var fromPath = (location.pathname || '').match(/\/session\/([^/?#]+)/);
    if (fromPath && fromPath[1]) return decodeURIComponent(fromPath[1]);
    var fromHash = (location.hash || '').match(/\/session\/([^/?#]+)/);
    if (fromHash && fromHash[1]) return decodeURIComponent(fromHash[1]);
    if (state.status && state.status.session && state.status.session.id) return state.status.session.id;
    return '';
  }

  function previewTarget() {
    var origin = location.origin || '';
    var replaced = origin.replace(/-3000(\.)/, '-8080$1');
    if (replaced !== origin) return replaced;
    if (state.status && state.status.preview && state.status.preview.url) return state.status.preview.url;
    return origin.replace(/:3000\b/, ':8080');
  }

  function openPreview() {
    window.open(previewTarget(), '_blank', 'noopener');
  }

  function api(path, options) {
    var opts = options || {};
    opts.cache = 'no-store';
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers = opts.headers || {};
      opts.headers['content-type'] = 'application/json';
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function action(name) {
    return api('/__custom/action', { method: 'POST', body: { action: name } })
      .then(function (data) { toast(name + ': ok'); refresh(); return data; })
      .catch(function (e) { toast(name + ': ' + e.message); });
  }

  function plaque(key, value, dotClass) {
    var val = h('span', { class: 'oc-hud-val', text: value });
    var children = [];
    if (dotClass !== undefined && dotClass !== null) children.push(h('span', { class: 'oc-hud-dot ' + dotClass }));
    if (key) children.push(h('span', { class: 'oc-hud-key', text: key }));
    children.push(val);
    var node = h('div', { class: 'oc-hud-plaque' }, children);
    node._val = val;
    node._dot = dotClass;
    return node;
  }

  function buildBar() {
    els.p4096 = plaque('', '4096', '');
    els.prouter = plaque('', '', '');
    els.plim = plaque('', '', '');
    els.pcs = plaque('', '', '');
    els.p8080 = plaque('', '8080', '');
    els.pq = plaque('', '', '');

    els.p8080.addEventListener('click', function (ev) { ev.stopPropagation(); openPreview(); });
    [els.p4096, els.prouter, els.plim, els.pcs, els.pq].forEach(function (p) {
      p.addEventListener('click', function (ev) { ev.stopPropagation(); toggleDrawer(); });
    });

    els.bar = h('div', { id: 'oc-hud-bar' }, [
      els.p4096, els.prouter, els.plim, els.pcs, els.p8080, els.pq
    ]);
    els.bar.addEventListener('click', function () { toggleDrawer(); });
    document.body.insertBefore(els.bar, document.body.firstChild);
  }

  function cell(label) {
    var v = h('div', { class: 'oc-hud-cell-v', text: '—' });
    var node = h('div', { class: 'oc-hud-cell' }, [
      h('div', { class: 'oc-hud-cell-k', text: label }),
      v
    ]);
    node._val = v;
    return node;
  }

  function buildDrawer() {
    els.cCpu = cell('CPU');
    els.cRam = cell('RAM');
    els.cDisk = cell('Disk');
    els.cUptime = cell('Uptime');
    els.cCs = cell('Codespaces');

    els.btnStart = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Старт 8080' });
    els.btnRestart = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Рестарт 8080' });
    els.btnStop = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Стоп 8080' });
    els.linkPreview = h('a', { class: 'oc-hud-link', href: '#', text: 'открыть 8080' });
    els.btnOc = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Рестарт 4096' });
    els.btnLimits = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Сброс лимитов' });
    els.btnShutdown = h('button', { class: 'oc-hud-btn danger', type: 'button', text: 'Выключить сервер' });

    els.btnStart.addEventListener('click', function () { action('preview_start'); });
    els.btnRestart.addEventListener('click', function () { action('preview_restart'); });
    els.btnStop.addEventListener('click', function () { action('preview_stop'); });
    els.linkPreview.addEventListener('click', function (ev) { ev.preventDefault(); openPreview(); });
    els.btnOc.addEventListener('click', function () {
      if (window.confirm('Перезапустить OpenCode (4096)?')) action('restart_opencode');
    });
    els.btnLimits.addEventListener('click', function () { action('reset_limits'); });
    els.btnShutdown.addEventListener('click', function () {
      var now = Date.now();
      if (state.shutdownArmed && now - state.shutdownArmed < 4000) {
        state.shutdownArmed = 0;
        els.btnShutdown.textContent = 'Выключить сервер';
        action('shutdown');
      } else {
        state.shutdownArmed = now;
        els.btnShutdown.textContent = 'Нажмите ещё раз';
        setTimeout(function () {
          if (state.shutdownArmed && Date.now() - state.shutdownArmed >= 4000) {
            state.shutdownArmed = 0;
            els.btnShutdown.textContent = 'Выключить сервер';
          }
        }, 4200);
      }
    });

    // router block
    els.rStatus = h('div', { class: 'oc-hud-router-status', text: 'Роутер: …' });
    els.rList = h('div', { class: 'oc-hud-queue oc-hud-model-list' });
    els.rReset = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Сброс cooldown' });
    els.rRefresh = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Обновить список' });
    els.rReset.addEventListener('click', function () {
      api('/__custom/router/reset', { method: 'POST' }).then(function () { toast('cooldown сброшен'); refresh(); }).catch(function (e) { toast(e.message); });
    });
    els.rRefresh.addEventListener('click', function () {
      api('/__custom/router/refresh', { method: 'POST' }).then(function () { toast('список обновлён'); refresh(); }).catch(function (e) { toast(e.message); });
    });

    els.qTitle = h('div', { class: 'oc-hud-section-title', text: 'Очередь (0)' });
    els.qList = h('div', { class: 'oc-hud-queue' });
    els.qInput = h('textarea', { id: 'oc-hud-qtext', placeholder: 'Добавить сообщение в очередь…' });
    els.qAdd = h('button', { class: 'oc-hud-btn', type: 'button', text: 'Добавить' });
    els.qAdd.addEventListener('click', function () {
      addToQueue(els.qInput.value, function () { els.qInput.value = ''; });
    });
    els.qForm = h('div', { id: 'oc-hud-qform' }, [els.qInput, els.qAdd]);

    els.routerBlock = h('div', { class: 'oc-hud-router' }, [
      h('div', { class: 'oc-hud-section-title', text: 'Авто-роутер' }),
      els.rStatus,
      h('div', { class: 'oc-hud-row' }, [els.rReset, els.rRefresh]),
      els.rList
    ]);

    els.drawer = h('div', { id: 'oc-hud-drawer' }, [
      h('div', { class: 'oc-hud-grid' }, [els.cCpu, els.cRam, els.cDisk, els.cUptime, els.cCs]),
      h('div', { class: 'oc-hud-row' }, [els.btnStart, els.btnRestart, els.btnStop, els.linkPreview]),
      h('div', { class: 'oc-hud-row' }, [els.btnOc, els.btnLimits, els.btnShutdown]),
      els.routerBlock,
      els.qTitle,
      els.qList,
      els.qForm
    ]);
    document.body.appendChild(els.drawer);
  }

  function toggleDrawer() {
    state.drawerOpen = !state.drawerOpen;
    els.drawer.classList.toggle('open', state.drawerOpen);
    if (state.drawerOpen) refresh();
  }

  function setDot(node, cls) {
    var dot = node.querySelector('.oc-hud-dot');
    if (!dot) {
      dot = h('span', { class: 'oc-hud-dot' });
      node.insertBefore(dot, node.firstChild);
    }
    dot.className = 'oc-hud-dot' + (cls ? ' ' + cls : '');
  }

  function shortModelName(id) {
    if (!id) return '—';
    var parts = id.split('/');
    var base = parts.length ? parts[parts.length - 1] : id;
    base = base.replace(/:free$/, '');
    if (base.length > 16) base = base.slice(0, 16);
    return base;
  }

  function renderStatus(s) {
    if (!s) return;
    state.status = s;
    var ocUp = s.oc && s.oc.up;
    els.p4096._val.textContent = ''; // only dot + label
    // p4096 label already "4096"
    setDot(els.p4096, ocUp ? 'ok' : 'bad');

    // limits compact
    var lim = '—';
    if (s.limits) {
      if (s.limits.remaining !== null && s.limits.remaining !== undefined && s.limits.limit !== null && s.limits.limit !== undefined) {
        lim = s.limits.remaining + '/' + s.limits.limit;
      } else if (s.limits.short) {
        var m = String(s.limits.short).match(/(\d+)/);
        lim = m ? m[1] : s.limits.short;
      }
    }
    els.plim._val.textContent = 'L:' + lim;

    // codespace compact
    var cs = s.codespace || {};
    els.pcs._val.textContent = (cs.hoursUsed != null ? cs.hoursUsed : 0) + 'ч';

    // 8080
    var pv = s.preview || {};
    els.p8080._val.textContent = '';
    setDot(els.p8080, pv.running ? 'ok' : 'bad');

    // queue
    var q = s.queue || {};
    els.pq._val.textContent = 'Q:' + (q.total || 0);

    // router plaque
    var r = s.router;
    state.router = r;
    if (r && r.activeModel) {
      els.prouter._val.textContent = shortModelName(r.activeModel);
      var dotCls = r.fallbackActive ? 'warn' : 'ok';
      if (r.readyCount === 0) dotCls = 'bad';
      setDot(els.prouter, dotCls);
    } else {
      els.prouter._val.textContent = 'router';
      setDot(els.prouter, 'bad');
    }

    if (els.cCpu) {
      var sys = s.system || {};
      var ram = sys.ram || {};
      var disk = sys.disk || {};
      els.cCpu._val.textContent = (sys.cpu != null ? sys.cpu : 0) + '%';
      els.cRam._val.textContent = (ram.percent != null ? ram.percent : 0) + '% · ' + fmtBytes(ram.used) + ' / ' + fmtBytes(ram.total);
      els.cDisk._val.textContent = (disk.percent != null ? disk.percent : 0) + '% · ' + fmtBytes(disk.used) + ' / ' + fmtBytes(disk.total);
      els.cUptime._val.textContent = sys.uptimeHuman || 'н/д';
      els.cCs._val.textContent = (cs.hoursUsed != null ? cs.hoursUsed : 0) + ' / ' + (cs.limitHours != null ? cs.limitHours : 120) + 'ч (ост. ' + (cs.remainingHours != null ? cs.remainingHours : 0) + 'ч)';
      els.btnStart.disabled = !!pv.running;
      els.btnStop.disabled = !pv.running;
      renderQueue(q.items || []);
      renderRouter(r);
    }
  }

  function renderQueue(items) {
    els.qTitle.textContent = 'Очередь (' + items.length + ')';
    while (els.qList.firstChild) els.qList.removeChild(els.qList.firstChild);
    if (!items.length) {
      els.qList.appendChild(h('div', { class: 'oc-hud-empty', text: 'Пусто' }));
      return;
    }
    items.forEach(function (item) {
      var del = h('button', { class: 'oc-hud-btn danger', type: 'button', text: '✕' });
      del.addEventListener('click', function () {
        api('/__custom/queue/' + encodeURIComponent(item.id), { method: 'DELETE' })
          .then(function () { refresh(); })
          .catch(function (e) { toast(e.message); });
      });
      els.qList.appendChild(h('div', { class: 'oc-hud-qitem' }, [
        h('div', { class: 'oc-hud-qtext', text: item.text || '' }),
        h('div', { class: 'oc-hud-qmeta', text: (item.sessionId || '').slice(-6) }),
        del
      ]));
    });
  }

  function renderRouter(r) {
    if (!els.rStatus) return;
    if (!r) {
      els.rStatus.textContent = 'Роутер недоступен';
      while (els.rList.firstChild) els.rList.removeChild(els.rList.firstChild);
      return;
    }
    els.rStatus.textContent = 'Активная: ' + (r.activeModel || '—') + ' | готово ' + (r.readyCount || 0) + '/' + (r.totalFreeCount || 0) + (r.fallbackActive ? ' (резерв)' : '');
    while (els.rList.firstChild) els.rList.removeChild(els.rList.firstChild);
    var models = r.models || [];
    models.forEach(function (m) {
      var pinBtn = h('button', { class: 'oc-hud-btn', type: 'button', text: '📌' });
      pinBtn.addEventListener('click', function () {
        api('/__custom/router/pin', { method: 'POST', body: { modelId: m.pinned ? null : m.id } })
          .then(function () { toast(m.pinned ? 'откреплено' : 'закреплено'); refresh(); })
          .catch(function (e) { toast(e.message); });
      });
      var banBtn = h('button', { class: 'oc-hud-btn danger', type: 'button', text: '🚫' });
      banBtn.addEventListener('click', function () {
        api('/__custom/router/ban', { method: 'POST', body: { modelId: m.id, banned: !m.banned } })
          .then(function () { toast(m.banned ? 'разбанено' : 'забанено'); refresh(); })
          .catch(function (e) { toast(e.message); });
      });
      var cd = m.cooldownLeftSec ? (' · cd ' + m.cooldownLeftSec + 's') : '';
      var row = h('div', { class: 'oc-hud-qitem' }, [
        h('div', { class: 'oc-hud-qtext', text: m.id + ' · ' + m.score + ' · ctx ' + (m.context_length || 0) + cd }),
        h('div', { class: 'oc-hud-qmeta', text: m.status }),
        pinBtn,
        banBtn
      ]);
      els.rList.appendChild(row);
    });
  }

  function refresh() {
    return Promise.all([
      api('/__custom/status'),
      api('/__custom/router/status').catch(function () { return null; })
    ]).then(function (res) {
      var s = res[0];
      state.status = s;
      if (res[1]) {
        s.router = res[1];
        state.router = res[1];
      }
      renderStatus(s);
    }).catch(function () {
      if (els.p4096) {
        els.p4096._val.textContent = '';
        setDot(els.p4096, 'bad');
      }
    });
  }

  function readPromptText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    if (el.isContentEditable) return el.innerText || el.textContent || '';
    return '';
  }

  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearPrompt(el) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, '');
    } else if (el.isContentEditable) {
      el.textContent = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function findPromptInput() {
    var active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
      if (active.closest && active.closest('[data-component="prompt-input"], form, [data-action="prompt-submit"]')) return active;
    }
    var ce = document.querySelector('[data-component="prompt-input"] [contenteditable="true"], [contenteditable="true"]');
    if (ce) return ce;
    return document.querySelector('textarea');
  }

  function addToQueue(text, onDone) {
    var value = (text || '').trim();
    if (!value) { toast('Пустое сообщение'); return; }
    var sid = getSessionId();
    var send = function (sessionId) {
      api('/__custom/queue', { method: 'POST', body: { sessionId: sessionId, text: value } })
        .then(function () { toast('Добавлено в очередь'); if (onDone) onDone(); refresh(); })
        .catch(function (e) { toast(e.message); });
    };
    if (sid) { send(sid); return; }
    refresh().then(function () {
      var fallback = getSessionId();
      if (!fallback) { toast('Не найдена сессия'); return; }
      send(fallback);
    });
  }

  function ensureAddButton() {
    if (document.getElementById('oc-hud-addq')) return;
    var submit = document.querySelector('[data-action="prompt-submit"]');
    if (!submit || !submit.parentNode) return;
    var btn = h('button', { id: 'oc-hud-addq', type: 'button', title: 'Добавить в очередь' }, '+Q');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var input = findPromptInput();
      var text = readPromptText(input);
      addToQueue(text, function () { clearPrompt(input); });
    });
    submit.parentNode.insertBefore(btn, submit);
  }

  function startObserver() {
    ensureAddButton();
    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; ensureAddButton(); }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    buildBar();
    buildDrawer();
    startObserver();
    refresh();
    setInterval(refresh, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
