/* Interface : branche les modules RF aux éléments de index.html. */
(function () {
  'use strict';
  var RF = window.RF;
  var $ = function (id) { return document.getElementById(id); };
  var settings = RF.loadSettings();
  var status = {};                 // url -> { ok, text }
  var run = null;                  // { ctrl, recorder }
  var testOutput = null;
  var _lastRec = null;
  var scanCtrl = null;
  var wakeLock = null;
  var activeOutput = null;     // dernière sortie construite : sert à rendre la main si l'onglet se ferme

  /* ---------- Langue ---------- */
  /* Un message est soit une chaîne brute (message d'un module, déjà traduit), soit { key, params } traduit à l'affichage, donc retraduisible. */
  function M(key, params) { return { key: key, params: params }; }
  function msgText(m) { return typeof m === 'string' ? m : RF.t(m.key, m.params); }
  /* Écrit un message dans un élément en gardant sa clé : un changement de langue le retraduit (voir refreshLanguage). */
  function setMsg(el, m) { el._msg = m || null; el.textContent = m ? msgText(m) : ''; }
  var MSG_IDS = ['replay-msg', 'arc-status', 'delay-msg', 'scan-status', 'confirm-error', 'settings-error', 'gtwc-status', 'wec-status', 'elms-status'];

  /* data-i18n : texte de l'élément. data-i18n-attr : « attribut:clé;attribut:clé ». */
  function applyI18n(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n]'), function (el) { el.textContent = RF.t(el.getAttribute('data-i18n')); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-attr]'), function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) el.setAttribute(pair.slice(0, i), RF.t(pair.slice(i + 1)));
      });
    });
  }

  /* ---------- Réglages ---------- */
  var FIELDS = RF.SETTINGS_FIELDS;      // [groupe, clé, type, attributs, placeholder « aucun » ?] ; textes : settings.field.* et settings.tip.*

  function nameSpan(group, key) {
    var s = document.createElement('span');
    s.className = 'name'; s.setAttribute('tabindex', '-1');
    s.setAttribute('data-i18n', 'settings.field.' + group + '.' + key);
    s.setAttribute('data-i18n-attr', 'data-tip:settings.tip.' + group + '.' + key);
    return s;
  }

  function buildSettingsGrid() {
    var grid = $('settings-grid');
    FIELDS.forEach(function (f) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = f[2]; input.id = 'f-' + f[0] + '-' + f[1];
      Object.keys(f[3]).forEach(function (k) { input.setAttribute(k, f[3][k]); });
      if (f[4]) input.setAttribute('data-i18n-attr', 'placeholder:settings.none');
      var name = nameSpan(f[0], f[1]);
      if (f[2] === 'checkbox') { label.className = 'check'; label.appendChild(input); label.appendChild(name); }
      else { label.appendChild(name); label.appendChild(input); }
      grid.appendChild(label);
    });
  }

  function fillForms() {
    FIELDS.forEach(function (f) {
      var el = $('f-' + f[0] + '-' + f[1]), v = settings[f[0]][f[1]];
      if (f[2] === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    });
    $('s-pollInterval').value = settings.source.pollInterval;
    $('tv-enabled').checked = settings.tvSync.enabled;
    $('tv-lap').value = settings.tvSync.initialTvLap;
    $('fixed-delay').value = settings.tvSync.fixedDelaySeconds;
    if (settings.tvSync.fixedDelaySeconds > 0) delayMsg(M('clock.delay', { seconds: settings.tvSync.fixedDelaySeconds }), false);
    $('scan-prefix').value = settings.scan.prefix; $('scan-from').value = settings.scan.from; $('scan-to').value = settings.scan.to;
    setMode(localGet('mode') || settings.source.type, false);
    updateModeVisibility();
    renderDevices();
  }

  function readForms() {
    var raw = JSON.parse(JSON.stringify(settings));
    FIELDS.forEach(function (f) {
      var el = $('f-' + f[0] + '-' + f[1]);
      raw[f[0]][f[1]] = f[2] === 'checkbox' ? el.checked : el.value;
    });
    raw.source.pollInterval = $('s-pollInterval').value;
    Object.keys(GRIIIP_TABS).forEach(function (m) { var sel = $(GRIIIP_TABS[m].select); if (sel.options.length) raw[m].sessionId = sel.value || null; });   // menu pas encore rempli : réglage gardé
    if ($('gtwc-series').options.length) { raw.gtwc.series = $('gtwc-series').value || null; raw.gtwc.unitId = $('gtwc-race').value || null; }   // menus pas encore remplis : réglages gardés
    raw.tvSync.enabled = $('tv-enabled').checked;
    raw.tvSync.initialTvLap = $('tv-lap').value;
    raw.tvSync.fixedDelaySeconds = $('fixed-delay').value;
    raw.scan = { prefix: $('scan-prefix').value.trim(), from: $('scan-from').value, to: $('scan-to').value };
    var mode = $('mode').value;
    if (MODES.indexOf(mode) !== -1) raw.source.type = mode;
    return raw;
  }

  /* Valide et enregistre ; renvoie true si les réglages sont valides. */
  function commit() {
    try {
      settings = RF.validateSettings(readForms());
      setMsg($('settings-error'), null);
      if (!RF.saveSettings(settings)) setMsg($('settings-error'), M('settings.storageUnavailable'));
      return true;
    } catch (e) { setMsg($('settings-error'), e.message); return false; }
  }

  function localGet(k) { try { return localStorage.getItem('raceflags.' + k); } catch (e) { return null; } }
  function localSet(k, v) { try { localStorage.setItem('raceflags.' + k, v); } catch (e) {} }

  /* ---------- Journal ---------- */
  function log(kind, msg) {
    var pre = $('log'), line = document.createElement('div');
    line.className = kind === 'flag' ? 'log-flag' : kind;
    line.textContent = RF.formatTime(new Date()) + '  ' + msg;
    pre.appendChild(line);
    while (pre.childNodes.length > 300) pre.removeChild(pre.firstChild);
    pre.scrollTop = pre.scrollHeight;
  }

  /* textKey : clé du texte à afficher à la place du nom du drapeau (ex. 'flag.waiting'). On garde l'état, pas le texte : il est retraduit au changement de langue. */
  var badgeState = { flag: null, key: null };
  function setBadge(flag, textKey) {
    badgeState = { flag: flag || null, key: textKey || null };
    var b = $('flag-badge');
    b.className = 'flag ' + (flag || 'idle');
    b.textContent = RF.t(textKey || (flag && /^(green|yellow|red|chequered)$/.test(flag) ? 'flag.' + flag : 'flag.idle'));
  }

  /* ---------- Appareils ---------- */
  function renderDevices() {
    var tbody = document.querySelector('#devices tbody');
    tbody.textContent = '';
    if (!settings.devices.length) {
      var tr0 = tbody.insertRow(), td0 = tr0.insertCell(); td0.colSpan = 5; td0.className = 'hint';
      td0.textContent = RF.t('wled.none');
    }
    settings.devices.forEach(function (d, i) {
      var tr = tbody.insertRow();
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.enabled;
      cb.onchange = function () { d.enabled = cb.checked; RF.saveSettings(settings); setMsg($('confirm-error'), null); };
      tr.insertCell().appendChild(cb);
      var nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = d.name;
      nameInput.onchange = function () { d.name = nameInput.value || d.url; RF.saveSettings(settings); };
      tr.insertCell().appendChild(nameInput);
      tr.insertCell().textContent = d.url.replace(/^https?:\/\//, '');
      var st = status[d.url], td = tr.insertCell();
      td.className = 'status ' + (st ? (st.ok ? 'ok' : 'ko') : ''); td.textContent = st ? (st.key ? RF.t(st.key, st.params) : st.text) : '—';
      var del = document.createElement('button'); del.textContent = RF.t('wled.remove'); del.className = 'small';
      del.onclick = function () { settings.devices.splice(i, 1); RF.saveSettings(settings); renderDevices(); };
      tr.insertCell().appendChild(del);
    });
  }

  /* ---------- Version en ligne (page en https) ----------
     Les WLED répondent en http : depuis une page https, seul Chrome (ou Edge) les joint, après l'autorisation
     « accès au réseau local ». localAccess : 'http' (page en http, rien à faire), 'granted', 'prompt', 'denied' ou 'unsupported'. */
  var localAccess = location.protocol === 'https:' ? 'prompt' : 'http';
  var LOCAL_ACCESS_CLASS = { prompt: '', denied: 'error', unsupported: 'error' };      // texte : localAccess.<état>
  function showLocalAccessNotice() {
    var cls = LOCAL_ACCESS_CLASS[localAccess];
    Array.prototype.forEach.call(document.querySelectorAll('.local-access-notice'), function (p) {
      p.hidden = cls === undefined;
      if (cls !== undefined) { p.className = 'notice local-access-notice' + (cls ? ' ' + cls : ''); p.textContent = RF.t('localAccess.' + localAccess); }
    });
  }
  /* Interroge l'autorisation (nom actuel puis ancien nom) ; un navigateur qui ne connaît ni l'un ni l'autre bloque les WLED. */
  function checkLocalAccess() {
    if (localAccess === 'http') return Promise.resolve();
    var perms = navigator.permissions;
    function ask(names) {
      if (!names.length || !perms || !perms.query) return Promise.reject(new Error('unsupported'));
      return perms.query({ name: names[0] }).catch(function () { return ask(names.slice(1)); });
    }
    return ask(['local-network', 'local-network-access']).then(function (p) {
      localAccess = p.state;
      p.onchange = function () { localAccess = p.state; showLocalAccessNotice(); };
    }, function () { localAccess = 'unsupported'; }).then(showLocalAccessNotice);
  }
  var localAccessReady = Promise.resolve();
  function wledBlocked() { return localAccess === 'unsupported' || localAccess === 'denied'; }
  function unreachableKey() {
    return localAccess === 'http' || localAccess === 'granted' ? 'wled.status.unreachable' : 'wled.status.blocked';
  }

  /* ---------- Navigation (SPA, routes par #/) ---------- */
  var ROUTES = ['wled', 'race', 'settings'];
  function enabledDevices() { return settings.devices.filter(function (d) { return d.enabled; }); }
  function currentRoute() {
    var r = (location.hash || '').replace(/^#\/?/, '');
    return ROUTES.indexOf(r) !== -1 ? r : null;
  }
  function go(route) { if (currentRoute() === route) render(); else location.hash = '#/' + route; }
  var autoScanned = false;
  function render() {
    var route = currentRoute();
    if (!route) { route = localGet('devicesConfirmed') === '1' && enabledDevices().length ? 'race' : 'wled'; location.replace('#/' + route); return; }
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.hidden = v.getAttribute('data-view') !== route; });
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) { a.classList.toggle('active', a.getAttribute('data-route') === route); });
    window.scrollTo(0, 0);
    if (route === 'wled' && !autoScanned && !settings.devices.length && !scanCtrl) {
      autoScanned = true;
      localAccessReady.then(function () { if (!wledBlocked() && !settings.devices.length && !scanCtrl) scan(); });   // inutile si le navigateur bloque les WLED
    }
  }
  function confirmDevices() {
    if (!enabledDevices().length) { setMsg($('confirm-error'), M('wled.errNoneChecked')); return; }
    setMsg($('confirm-error'), null);
    RF.saveSettings(settings); localSet('devicesConfirmed', '1');
    go('race');
  }

  function onlineStatus(version) { return version ? { ok: true, key: 'wled.status.onlineVersion', params: { version: version } } : { ok: true, key: 'wled.status.online' }; }

  function upsertDevice(dev) {
    var existing = settings.devices.filter(function (d) { return d.url === dev.url; })[0];
    if (existing) { if (dev.name && existing.name === existing.url) existing.name = dev.name; }
    else settings.devices.push({ url: dev.url, name: dev.name || dev.url, enabled: true });
    status[dev.url] = onlineStatus(dev.version);
    RF.saveSettings(settings);
    renderDevices();
  }

  function checkDevice(d) {
    status[d.url] = { ok: false, text: '…' };
    return RF.probeWled(d.url, 2500).then(function (info) {
      status[d.url] = info ? onlineStatus(info.version)
                           : { ok: false, key: unreachableKey() };
    });
  }

  function addManual() {
    var host = $('add-host').value.trim();
    if (!host) return;
    var url = RF.normalizeWledUrl(host);
    $('btn-add').disabled = true;
    RF.probeWled(url, 3000).then(function (info) {
      if (info) { upsertDevice(info); log('info', RF.t('log.deviceAdded', { name: info.name, url: info.url })); }
      else {
        settings.devices.push({ url: url, name: host, enabled: true });
        status[url] = { ok: false, key: unreachableKey() };
        RF.saveSettings(settings); renderDevices();
        log('warn', RF.t('log.deviceUnreachable', { url: url }));
      }
      $('add-host').value = '';
    }).then(function () { $('btn-add').disabled = false; });
  }

  function scan() {
    if (!commit()) return;
    var sc = settings.scan;
    scanCtrl = new AbortController();
    $('btn-scan').disabled = true; $('btn-scan-cancel').hidden = false;
    var found = 0;
    log('info', RF.t('log.scan', { from: sc.prefix + sc.from, to: sc.prefix + sc.to }));
    RF.scanSubnet({
      prefix: sc.prefix, from: sc.from, to: sc.to, signal: scanCtrl.signal,
      onProgress: function (d, t) { setMsg($('scan-status'), d + ' / ' + t); },
      onFound: function (dev) { found++; upsertDevice(dev); log('info', RF.t('log.deviceFound', { name: dev.name, url: dev.url })); }
    }).then(function () {
      var cancelled = scanCtrl.signal.aborted;
      setMsg($('scan-status'), M(cancelled ? 'wled.scan.cancelled' : 'wled.scan.done', { count: found }));
      if (!found && !cancelled) log('warn', RF.t('log.scanNone') + (localAccess === 'http' ? '' : ' ' + RF.t('log.scanNoneHttps')));
    }).then(function () { scanCtrl = null; $('btn-scan').disabled = false; $('btn-scan-cancel').hidden = true; });
  }

  /* ---------- Sorties WLED ---------- */
  function buildOutput() {
    var devices = settings.devices.filter(function (d) { return d.enabled; });
    if (!devices.length) throw new Error(RF.t('wled.errNoDevice'));
    var w = settings.wled;
    var multi = new RF.MultiOutput(devices.map(function (d) {
      return new RF.WledOutput({
        url: d.url, label: d.name, timeout: w.requestTimeout, brightness: w.brightness, greenBlinks: w.greenBlinks,
        greenBlinkSeconds: w.greenBlinkSeconds, breatheEffectId: w.breatheEffectId, releaseOnExit: w.releaseOnExit, restoreState: w.restoreState,
        greenPreset: w.greenPreset, yellowPreset: w.yellowPreset, redPreset: w.redPreset
      });
    }));
    activeOutput = multi;
    return multi;
  }

  function testFlag(flag) {
    if (run) return log('warn', RF.t('log.stopBeforeTest'));
    if (!commit()) return;
    var prev = testOutput ? testOutput.close().catch(function () {}) : Promise.resolve();
    prev.then(function () {
      testOutput = buildOutput();
      return testOutput.apply({ source: 'test', flag: flag, occurredAt: new Date(), lap: null, totalLaps: null, remainingSeconds: null, metadata: {} });
    }).then(function () { log('flag', '[TEST] ' + flag); setBadge(flag); },
            function (e) { log('error', RF.t('log.outputError', { detail: e.message })); });
  }

  function releaseAll() {
    if (run) return;
    var out;
    try { out = testOutput || buildOutput(); } catch (e) { return log('error', e.message); }
    out.release().then(function () { log('info', RF.t('log.released')); setBadge(null); testOutput = null; },
                       function (e) { log('error', RF.t('log.outputError', { detail: e.message })); });
  }

  /* ---------- Race ---------- */
  var CHAMPIONSHIP_NAMES = { nascar: 'NASCAR', wec: 'FIA WEC', imsa: 'IMSA', elms: 'ELMS', gtwc: 'GT World Challenge Europe' };
  var MODES = ['nascar', 'wec', 'imsa', 'elms', 'gtwc'];      // les championnats ; le replay est une section de chaque onglet
  var FIXED_DELAY_MODES = ['wec', 'imsa', 'elms', 'gtwc'];      // sans tour pour la synchro TV : retard fixe et « Horloge de ma diffusion »
  /* Sélection du championnat par onglets ; #mode (champ caché) garde la valeur lue par le reste du code. */
  function setMode(mode, save) {
    if (MODES.indexOf(mode) === -1) mode = 'nascar';
    $('mode').value = mode;
    Array.prototype.forEach.call(document.querySelectorAll('#mode-tabs .tab'), function (t) {
      var on = t.getAttribute('data-mode') === mode;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; t.classList.toggle('active', on);
    });
    updateModeVisibility();
    loadArchive(); loadSroCatalog(); loadGriiipSessions();
    if ($('replay-msg')) replayMsg('', 'hint');
    if (save) { commit(); localSet('mode', mode); }
  }

  function updateModeVisibility() {
    var mode = $('mode').value;
    function toggle(cls, show) { Array.prototype.forEach.call(document.querySelectorAll('.' + cls), function (el) { el.classList.toggle('hidden-mode', !show); }); }
    toggle('mode-wec', mode === 'wec'); toggle('mode-elms', mode === 'elms'); toggle('mode-gtwc', mode === 'gtwc'); toggle('mode-nascar', mode === 'nascar'); toggle('mode-fixed', FIXED_DELAY_MODES.indexOf(mode) !== -1);
    var archive = replayUsesArchive();
    toggle('arc-only', archive); toggle('file-only', !archive);
  }

  /* Message sous le bouton du replay : kind 'error' (rouge) ou 'hint' (gris). */
  function replayMsg(m, kind) { setMsg($('replay-msg'), m); $('replay-msg').className = kind === 'hint' ? 'hint' : 'error'; }

  /* ---------- Replay depuis l'archive NASCAR ---------- */
  var archiveCache = {}, archiveToken = 0, archiveShown = null;        // archiveShown : courses du menu, pour le reformater au changement de langue
  function replayUsesArchive() { return $('mode').value === 'nascar' && $('replay-source').value === 'archive'; }
  /* Fichiers de la course absents (403/404) ou refus signalé comme erreur réseau : pas encore publiés. */
  function archiveUnavailable(e) { return /403|404|lap-times|lap-notes/.test(e && e.message || ''); }
  function archiveStatus(m, isError) { setMsg($('arc-status'), m); $('arc-status').className = (isError ? 'error' : 'hint') + ' mode-nascar' + (replayUsesArchive() ? ' arc-only' : ' arc-only hidden-mode'); }
  function fillArchiveSelect(races) {
    var sel = $('arc-race'), keep = sel.value;
    archiveShown = races;
    sel.textContent = '';
    races.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = RF.formatDayMonth(r.date) + '  ' + r.name + (r.track ? '  (' + r.track + (r.laps ? ', ' + RF.t('archive.laps', { count: r.laps }) : '') + ')' : '');
      sel.appendChild(o);
    });
    if (keep && races.some(function (r) { return String(r.id) === keep; })) sel.value = keep;
  }
  function loadArchive() {
    if (!replayUsesArchive()) return;
    if (!$('arc-year').value) $('arc-year').value = new Date().getFullYear();
    var year = $('arc-year').value, series = $('arc-series').value, key = year + '/' + series, token = ++archiveToken;
    if (archiveCache[key]) { fillArchiveSelect(archiveCache[key]); archiveStatus(archiveCache[key].length ? M('archive.available', { count: archiveCache[key].length }) : M('archive.none'), false); return; }
    $('arc-race').textContent = ''; archiveShown = null; archiveStatus(M('archive.loading'), false);
    RF.listNascarRaces(year, series).then(function (races) {
      if (token !== archiveToken) return;                       // une requête plus récente a pris le relais
      archiveCache[key] = races; fillArchiveSelect(races);
      archiveStatus(races.length ? M('archive.available', { count: races.length }) : M('archive.none'), false);
    }, function (e) { if (token === archiveToken) archiveStatus(e.message, true); });
  }

  /* ---------- Onglet GT World Challenge Europe : séries et courses SRO du meeting en cours (Swiss Timing) ---------- */
  var sroCatalog = null, sroCatalogAt = 0, sroToken = 0;
  var SRO_STATE_KEYS = ['session.stateUpcoming', 'session.stateRunning', 'session.stateFinished'];
  function loadSroCatalog(force) {
    if ($('mode').value !== 'gtwc') return;
    if (sroCatalog && !force && Date.now() - sroCatalogAt < 60000) return fillSroSelects();
    var token = ++sroToken;
    if (!sroCatalog) setMsg($('gtwc-status'), M('gtwc.loading'));
    RF.listSroRaces({ apiUrl: settings.gtwc.apiUrl, timeout: settings.source.requestTimeout }).then(function (cat) {
      if (token !== sroToken) return;
      sroCatalog = cat; sroCatalogAt = Date.now();
      fillSroSelects();
      setMsg($('gtwc-status'), cat.races.length ? null : M('gtwc.noMeeting'));
    }, function (e) { if (token === sroToken) setMsg($('gtwc-status'), e.message); });
  }
  /* Remplit les deux menus d'après le catalogue et les réglages ; la course gardée n'est plus proposée si elle n'est pas de la série choisie. */
  function fillSroSelects() {
    if (!sroCatalog) return;
    var ser = $('gtwc-series'), race = $('gtwc-race');
    var wantSeries = ser.options.length ? ser.value : (settings.gtwc.series || ''), wantRace = race.options.length ? race.value : (settings.gtwc.unitId || '');
    function opt(sel, value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o); }
    ser.textContent = '';
    opt(ser, '', RF.t('gtwc.defaultSeries')); opt(ser, 'all', RF.t('gtwc.allSeries'));
    sroCatalog.series.forEach(function (s) { opt(ser, String(s.id).toLowerCase(), s.name); });
    ser.value = Array.prototype.some.call(ser.options, function (o) { return o.value === wantSeries; }) ? wantSeries : '';
    race.textContent = '';
    opt(race, '', RF.t('gtwc.autoRace'));
    sroCatalog.races.filter(function (r) { return RF.sroMatchSeries(r, ser.value || null, settings.gtwc.seriesMatch); }).forEach(function (r) {
      var d = /^(\d\d)\.(\d\d)\.(\d{4})\s+(\d\d:\d\d)/.exec(r.begin || '');
      opt(race, r.id, RF.t('gtwc.raceOption', { day: d ? RF.formatDayMonth(d[3] + '-' + d[2] + '-' + d[1]) : '', time: d ? d[4] : '', name: r.name,
        series: r.series, state: RF.t(SRO_STATE_KEYS[r.state] || 'session.stateUpcoming') }));
    });
    race.value = Array.prototype.some.call(race.options, function (o) { return o.value === wantRace; }) ? wantRace : '';
  }

  /* ---------- Onglets WEC et ELMS : sessions du week-end (flux live griiip) ---------- */
  var GRIIIP_TABS = { wec: { select: 'wec-session', status: 'wec-status' }, elms: { select: 'elms-session', status: 'elms-status' } };
  var griiipCache = {}, griiipToken = {};          // championnat -> { sessions, at } ; jeton de la dernière requête
  function loadGriiipSessions(force) {
    var mode = $('mode').value, cfg = GRIIIP_TABS[mode];
    if (!cfg) return;
    var c = griiipCache[mode];
    if (c && !force && Date.now() - c.at < 60000) return fillGriiipSelect(mode);
    var token = griiipToken[mode] = (griiipToken[mode] || 0) + 1;
    if (!c) setMsg($(cfg.status), M('griiip.loading'));
    RF.listGriiipSessions({ apiUrl: settings[mode].apiUrl, seriesName: settings[mode].seriesName, timeout: settings.source.requestTimeout }).then(function (list) {
      if (token !== griiipToken[mode]) return;
      griiipCache[mode] = { sessions: list, at: Date.now() };
      fillGriiipSelect(mode);
      setMsg($(cfg.status), list.length ? null : M('griiip.noSession'));
    }, function (e) { if (token === griiipToken[mode]) setMsg($(cfg.status), e.message); });
  }
  /* Menu : automatique (course), session en cours (tous types), puis chaque session ; la session gardée disparaît si elle n'est plus dans le flux. */
  function fillGriiipSelect(mode) {
    var cfg = GRIIIP_TABS[mode], c = griiipCache[mode];
    if (!cfg || !c) return;
    var sel = $(cfg.select), saved = settings[mode].sessionId;
    var want = sel.options.length ? sel.value : (saved == null ? '' : String(saved));
    function opt(value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o); }
    sel.textContent = '';
    opt('', RF.t('griiip.autoRace')); opt('live', RF.t('griiip.anySession'));
    c.sessions.forEach(function (x) {
      var d = new Date(x.start), ok = !isNaN(d.getTime());
      var iso = ok ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '';
      opt(String(x.sid), RF.t('griiip.sessionOption', { day: ok ? RF.formatDayMonth(iso) : '', time: ok ? RF.formatHourMinute(d) : '', name: x.name || x.sid,
        state: RF.t(x.started ? (x.chequered ? 'session.stateFinished' : 'session.stateRunning') : 'session.stateUpcoming') }));
    });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === want; }) ? want : '';
  }

  /* Réglages de lecture lus à l'écran : servent au lancement et au recalage d'un replay en cours. */
  function replayParams() {
    var video = RF.parseDuration($('replay-video').value), startAt = RF.parseDuration($('replay-start').value);
    if (video === null) throw new Error(RF.t('replay.errVideo'));
    if (startAt === null) throw new Error(RF.t('replay.errStart'));
    var lap = parseInt($('replay-lap').value, 10);
    if (!(lap > 0)) lap = null;                                  // 0 ou vide : pas de départ par tour, on utilise le temps
    return { videoOffset: video, startAt: lap ? 0 : startAt, startLap: lap, speed: parseFloat($('replay-speed').value) };
  }

  /* Compteur de tour du replay : recalculé à partir de l'horloge, il avance même entre deux changements de drapeau. */
  function showReplayProgress() {
    if (!run || run.kind !== 'replay' || !run.source || !run.source.progress) return;
    var p = run.source.progress();
    if (p && p.lap != null) setProgress(p.totalLaps ? 'race.lapOf' : 'race.lap', { lap: p.lap, total: p.totalLaps });
  }
  /* Compteur sous les boutons : on garde la clé et les valeurs pour le retraduire au changement de langue. */
  var progressState = null;
  function setProgress(key, params) { progressState = key ? { key: key, params: params } : null; $('progress').textContent = key ? RF.t(key, params) : ''; }

  /* Recale le replay en cours avec les réglages affichés, sans l'arrêter ni toucher à l'état de l'appareil. */
  function resyncReplay() {
    if (!run || run.kind !== 'replay' || !run.source) return;
    var p;
    if (typeof run.source.resync !== 'function') return replayMsg(M('replay.errVersion'), 'error');
    try { p = replayParams(); run.source.resync(p); } catch (e) { return replayMsg(e.message, 'error'); }
    if (run.engine) run.engine.wake();
    showReplayProgress();
    var at = p.startLap ? { lap: p.startLap } : { time: RF.formatDuration(p.startAt) };
    log('info', RF.t(p.startLap ? 'log.replayResyncedLap' : 'log.replayResyncedTime', Object.assign({ video: p.videoOffset, speed: p.speed }, at)));
    replayMsg(M(p.startLap ? 'replay.resyncedLap' : 'replay.resyncedTime', Object.assign({ video: p.videoOffset }, at)), 'hint');
  }

  function readReplayFile() {
    var f = $('replay-file').files[0];
    if (!f) return Promise.reject(new Error(RF.t('replay.errNoFile')));
    return f.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error(RF.t('replay.errBadJson', { detail: e.message })); }
    });
  }

  function createSource(mode, championship) {
    if (mode === 'nascar') return Promise.resolve(new RF.NascarSource({ timeout: settings.source.requestTimeout, lapSampleSize: settings.tvSync.sampleSize }));
    if (mode === 'imsa') return Promise.resolve(new RF.ImsaSource({ apiUrl: settings.imsa.apiUrl, raceOnly: settings.imsa.raceOnly, timeout: settings.source.requestTimeout }));
    if (mode === 'wec') return Promise.resolve(new RF.WecSource({ sessionId: settings.wec.sessionId, apiUrl: settings.wec.apiUrl, seriesName: settings.wec.seriesName, timeout: settings.source.requestTimeout }));
    if (mode === 'gtwc') return Promise.resolve(new RF.SroSource({ series: settings.gtwc.series, unitId: settings.gtwc.unitId, apiUrl: settings.gtwc.apiUrl, seriesMatch: settings.gtwc.seriesMatch, timeout: settings.source.requestTimeout }));
    if (mode === 'elms') return Promise.resolve(new RF.WecSource({ name: 'elms', label: 'ELMS', sessionId: settings.elms.sessionId, apiUrl: settings.elms.apiUrl, seriesName: settings.elms.seriesName, timeout: settings.source.requestTimeout }));
    var fromArchive = replayUsesArchive();
    var docPromise;
    if (fromArchive) {
      var raceId = $('arc-race').value;
      if (!raceId) return Promise.reject(new Error(RF.t('replay.errNoRace')));
      replayMsg(M('replay.downloading'), 'hint');
      docPromise = RF.importNascarRace({ year: $('arc-year').value, series: $('arc-series').value, raceId: raceId }).catch(function (e) {
        throw new Error(archiveUnavailable(e) ? RF.t('replay.errNotPublished') : e.message);
      });
    } else docPromise = readReplayFile();
    return docPromise.then(function (doc) {
      replayMsg('', 'hint');
      // Un enregistrement est propre à un championnat : on refuse de le rejouer sur un autre onglet.
      if (doc && doc.source && doc.source !== championship) {
        var from = CHAMPIONSHIP_NAMES[doc.source] || doc.source;
        throw new Error(RF.t('replay.errWrongChampionship', { from: from, current: CHAMPIONSHIP_NAMES[championship] }));
      }
      return new RF.ReplaySource(Object.assign({ document: doc }, replayParams()));
    });
  }

  /* Pendant un replay, le bouton du replay sert à recaler : texte et bulle d'après l'état courant (run). */
  function updateReplayButton() {
    var resync = !!(run && run.kind === 'replay');
    $('btn-start-replay').textContent = RF.t(resync ? 'replay.resyncButton' : 'replay.startButton');
    $('btn-start-replay').title = RF.t(resync ? 'replay.resyncTitle' : 'replay.startTitle');
  }

  function setRunning(on, kind) {
    // Pendant un suivi, seule la section utilisée reste affichée : lancer un replay masque le live, et inversement. À l'arrêt, les deux reviennent.
    $('panel-live').hidden = on && kind === 'replay';
    $('panel-replay').hidden = on && kind === 'live';
    var resync = on && kind === 'replay';                       // pendant un replay, le bouton du replay sert à recaler
    $('btn-start-live').disabled = on; $('btn-start-replay').disabled = on && !resync; $('btn-stop').disabled = !on;
    updateReplayButton();
    Array.prototype.forEach.call(document.querySelectorAll('#mode-tabs .tab'), function (t) { t.disabled = on; });
    if (on) $('btn-download').hidden = true;
  }

  function acquireWakeLock() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () {}); } catch (e) {}
  }
  function releaseWakeLock() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

  /* kind : 'live' (flux du championnat de l'onglet) ou 'replay' (fichier d'enregistrement du même championnat). */
  function start(kind) {
    if (run) return;
    if (!commit()) return;
    if (!$('no-wled').checked && !enabledDevices().length) { go('wled'); setMsg($('confirm-error'), M('wled.errSelectOne')); return log('warn', RF.t('wled.errSelectOne')); }
    replayMsg('', 'hint');
    var championship = $('mode').value, noWled = $('no-wled').checked;
    var mode = kind === 'replay' ? 'replay' : championship;
    localSet('mode', championship);
    var output;
    try { output = noWled ? new RF.NullOutput() : buildOutput(); } catch (e) { return log('error', e.message); }
    var prev = testOutput; testOutput = null;
    (prev ? prev.close().catch(function () {}) : Promise.resolve()).then(function () { return createSource(mode, championship); }).then(function (source) {
      var ctrl = new AbortController();
      var observers = [], recorder = null;
      if ($('rec-enabled').checked && mode !== 'replay') {
        recorder = new RF.RaceRecorder({ source: mode, name: mode.toUpperCase() + ' ' + RF.formatDateTime(new Date()),
          onChange: function (n) { $('btn-download').hidden = false; setDownloadLabel(n); } });
        observers.push(recorder);
      }
      var sync = null;
      if (mode === 'nascar' && settings.tvSync.enabled) sync = new RF.NascarTvSynchronizer({ initialTvLap: settings.tvSync.initialTvLap, fallbackLapSeconds: settings.tvSync.fallbackLapSeconds, maximumDelay: settings.tvSync.maximumDelay });
      else if (FIXED_DELAY_MODES.indexOf(mode) !== -1) sync = new RF.FixedDelaySynchronizer({ delaySeconds: settings.tvSync.fixedDelaySeconds });   // toujours créé : réglable en cours de course
      var interval = mode === 'replay' ? 0 : settings.source.pollInterval;
      run = { ctrl: ctrl, recorder: recorder, sync: sync, kind: kind, source: source }; _lastRec = recorder;
      setRunning(true, kind); acquireWakeLock(); setBadge(null, 'flag.waiting');
      log('info', RF.t('log.started', { what: [
        mode === 'replay' ? RF.t('log.startReplay', { name: championship.toUpperCase() }) : mode,
        mode === 'replay' ? '' : RF.t('log.startInterval', { seconds: interval }),
        sync && mode === 'nascar' ? RF.t('log.startTvLap', { lap: settings.tvSync.initialTvLap }) : '',
        sync && sync.getDelay && sync.getDelay() > 0 ? RF.t('log.startDelay', { seconds: sync.getDelay() }) : '',
        noWled ? RF.t('log.startNoWled') : ''
      ].filter(Boolean).join(', ') }));
      var engine = new RF.RaceFlagEngine({
        source: source, output: output, pollInterval: interval, skipInitialGreen: mode !== 'replay', synchronizer: sync, observers: observers, signal: ctrl.signal,
        onLog: log, onFlag: function (ev) { setBadge(ev.flag); },
        onProgress: function (s) {
          lastTiming = { remaining: s.remainingSeconds, elapsed: s.metadata && s.metadata.elapsed != null ? RF.parseDuration(s.metadata.elapsed) : null, at: RF.clock() };
          if (s.flag !== 'unknown' && noWled) setBadge(s.flag);
          if (run && run.kind === 'replay' && run.source && run.source.progress) showReplayProgress();       // tour calculé par l'horloge du replay
          else if (s.remainingSeconds != null) setProgress('race.timeRemaining', { time: RF.formatDuration(s.remainingSeconds) });
          else if (s.lap != null) setProgress(s.totalLaps ? 'race.lapOf' : 'race.lap', { lap: s.lap, total: s.totalLaps });
          else setProgress(null);
        }
      });
      run.engine = engine;
      if (kind === 'replay' && source.progress) { run.progressTimer = setInterval(showReplayProgress, 500); showReplayProgress(); }
      if (kind === 'replay') replayMsg(M('replay.running'), 'hint');
      return engine.run().then(function () { log('info', RF.t('log.stopped')); }, function (e) { log('error', RF.t('log.error', { detail: e.message })); });
    }).catch(function (e) { log('error', e.message); if (kind === 'replay') replayMsg(e.message, 'error'); }).then(function () {
      var rec = run && run.recorder;
      if (run && run.progressTimer) clearInterval(run.progressTimer);
      run = null; setRunning(false); releaseWakeLock(); setBadge(null);
      if ($('replay-msg').className === 'hint') replayMsg('', 'hint');          // une erreur éventuelle reste affichée
      if (rec && rec.count()) { $('btn-download').hidden = false; }
      activeOutput = null;
    });
  }

  /* Bouton de téléchargement du dernier enregistrement : on garde le nombre de changements pour retraduire le texte. */
  var downloadCount = null;
  function setDownloadLabel(n) { downloadCount = n; $('btn-download').textContent = RF.t('race.download', { count: n }); }

  function stop() { if (run) { run.ctrl.abort(); $('btn-stop').disabled = true; } }

  function downloadRecording() { /* le dernier enregistrement reste accessible après l'arrêt */
    if (!lastRecorder()) return;
    var d = lastRecorder().document;
    RF.downloadJson(d, RF.t('file.recording') + '-' + d.source + '-' + d.started_at.replace(/[:.]/g, '-') + '.json');
  }
  function lastRecorder() { return (run && run.recorder) || _lastRec; }

  /* ---------- Import / export ---------- */
  /* Télécharge le fichier de replay de la course choisie (pour le garder ou le rejouer plus tard comme « Fichier »). */
  function downloadArchiveRace() {
    var raceId = $('arc-race').value;
    if (!raceId) return archiveStatus(M('archive.errChoose'), true);
    $('btn-arc-download').disabled = true; archiveStatus(M('archive.downloading'), false);
    RF.importNascarRace({ year: $('arc-year').value, series: $('arc-series').value, raceId: raceId })
      .then(function (doc) {
        RF.downloadJson(doc, 'nascar-' + doc.metadata.year + '-' + doc.metadata.race_id + '.json');
        archiveStatus(M('archive.downloaded', { count: doc.events.length, laps: doc.metadata.total_laps }), false);
      }, function (e) { archiveStatus(archiveUnavailable(e) ? M('archive.errNotPublished') : e.message, true); })
      .then(function () { $('btn-arc-download').disabled = false; });
  }

  function exportConfig() { if (commit()) RF.downloadJson(settings, 'raceflags-config.json'); }
  function importConfig(file) {
    file.text().then(function (t) {
      settings = RF.validateSettings(JSON.parse(t)); RF.saveSettings(settings); fillForms(); log('info', RF.t('log.configImported'));
    }).catch(function (e) { setMsg($('settings-error'), M('settings.importFailed', { detail: e.message })); });
  }

  /* ---------- Fermeture de l'onglet : rend la main au mieux ---------- */
  window.addEventListener('pagehide', function () {
    if (!activeOutput) return;
    activeOutput.outputs.forEach(function (o) {
      try { var r = o.pagehideRequest(); fetch(r.url, RF.wledFetchOptions(r.url, { method: 'POST', body: r.body, headers: { 'Content-Type': 'text/plain' }, keepalive: true })); } catch (e) {}
    });
  });
  document.addEventListener('visibilitychange', function () { if (run && document.visibilityState === 'visible') acquireWakeLock(); });

  /* Bulle d'aide : se cale à droite si elle déborde de l'écran. */
  function placeTip(e) {
    var el = e.target.closest ? e.target.closest('.name') : null;
    if (!el || !el.getAttribute('data-tip')) return;
    var r = el.getBoundingClientRect();
    el.classList.toggle('tip-right', r.left + 290 > window.innerWidth);
  }
  document.addEventListener('mouseover', placeTip);
  document.addEventListener('focusin', function (e) { var l = e.target.closest && e.target.closest('label'); if (l) placeTip({ target: l.querySelector('.name') || l }); });

  /* ---------- Horloge de ma diffusion (heures / minutes / secondes) ---------- */
  var lastTiming = null;     // dernier relevé du chronométrage : { remaining, elapsed, at }
  var CLOCK_IDS = ['delay-h', 'delay-m', 'delay-s'], CLOCK_STEPS = [3600, 60, 1];
  var clockEditing = false;  // saisie au clavier en cours : l'horloge est figée
  var clockRef = null;       // horloge du chronométrage relevée au premier chiffre tapé

  function timingNow(kind) {
    if (!lastTiming) return null;
    var v = kind === 'elapsed' ? lastTiming.elapsed : lastTiming.remaining;
    if (v == null) return null;
    var dt = RF.clock() - lastTiming.at;
    return kind === 'elapsed' ? v + dt : Math.max(0, v - dt);
  }
  function delayMsg(m, isError) { setMsg($('delay-msg'), m); $('delay-msg').className = isError ? 'error' : 'hint'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clockKind() { return $('delay-ref-kind').value; }
  function currentDelay() { return parseFloat($('fixed-delay').value) || 0; }

  /* Horloge que la diffusion devrait afficher avec le retard actuel (retard 0 : celle du chronométrage). */
  function expectedStreamClock(kind) {
    var t = timingNow(kind);
    if (t == null) return null;
    var d = currentDelay();
    return kind === 'elapsed' ? Math.max(0, t - d) : t + d;
  }
  function refreshClock() {
    if (clockEditing) return;
    var v = run ? expectedStreamClock(clockKind()) : null;
    var p = v == null ? ['', '', ''] : [Math.floor(v / 3600), Math.floor(v % 3600 / 60), Math.floor(v % 60)].map(pad2);
    CLOCK_IDS.forEach(function (id, i) { if ($(id).value !== p[i]) $(id).value = p[i]; });
  }
  function endEdit() { clockEditing = false; clockRef = null; refreshClock(); }

  function applyDelay(d) {
    $('fixed-delay').value = d;
    if (run && run.sync && run.sync.setDelay) run.sync.setDelay(d);
    commit();
  }

  /* ▲ ▼ et flèches du clavier : ajustent le retard en direct, l'horloge continue de défiler et l'utilisateur la fait coïncider avec son écran. */
  function nudge(step) {
    if (clockEditing && clockRef !== null) commitTyped();
    endEdit();
    var want = currentDelay() + (clockKind() === 'elapsed' ? -step : step);
    var d = Math.min(3600, Math.max(0, Math.round(want)));
    applyDelay(d);
    delayMsg(M(d !== want ? 'clock.limited' : 'clock.delay', { seconds: d }), false);
    refreshClock();
  }

  /* Saisie au clavier : dès le premier chiffre, l'horloge se fige et on relève celle du chronométrage. */
  function beginEdit() {
    if (clockEditing) return true;
    var ref = run ? timingNow(clockKind()) : null;
    if (ref == null) { delayMsg(M(run ? 'clock.errUnknown' : 'clock.errNotStarted'), true); return false; }
    clockEditing = true; clockRef = ref;
    return true;
  }
  function typedClockSeconds() {
    var v = CLOCK_IDS.map(function (id) { var t = $(id).value.trim(); return t === '' ? 0 : parseInt(t, 10); });
    if (v.some(function (n) { return isNaN(n) || n < 0; }) || v[1] > 59 || v[2] > 59) return null;
    return v[0] * 3600 + v[1] * 60 + v[2];
  }
  function commitTyped() {
    if (!clockEditing) return;
    if (clockRef === null) return endEdit();
    var kind = clockKind(), typed = typedClockSeconds();
    if (typed === null) return delayMsg(M('clock.errRange'), true);        // reste en saisie
    var d = RF.streamDelaySeconds(kind, typed, clockRef);
    if (d < 0) { d = 0; delayMsg(M('clock.errAhead'), true); }
    else if (d > 3600) { delayMsg(M('clock.errTooFar'), true); return endEdit(); }
    else delayMsg(M('clock.computed', { seconds: d }), false);
    applyDelay(d);
    log('info', RF.t(kind === 'elapsed' ? 'log.delayCalibratedElapsed' : 'log.delayCalibratedRemaining', { seconds: d, time: RF.formatDuration(typed) }));
    endEdit();
  }

  function initCalibration() {
    CLOCK_IDS.forEach(function (id, i) {
      var el = $(id);
      el.addEventListener('focus', function () { el.select(); });
      el.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); nudge((k === 'ArrowUp' ? 1 : -1) * CLOCK_STEPS[i]); }
        else if (k === 'Enter') { e.preventDefault(); commitTyped(); }
        else if (k === 'Escape') { endEdit(); delayMsg(null, false); }
        else if (/^[0-9]$/.test(k) || k === 'Backspace' || k === 'Delete') {
          var wasEditing = clockEditing;
          if (!beginEdit()) e.preventDefault(); else if (!wasEditing) el.select();      // le premier chiffre remplace tout le segment
        }
      });
      el.addEventListener('input', function () {
        el.value = el.value.replace(/\D/g, '').slice(0, 2);
        if (el.value.length === 2 && i < 2) { var n = $(CLOCK_IDS[i + 1]); n.focus(); n.select(); }   // passe au segment suivant
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#delay-clock .step'), function (b) {
      b.addEventListener('click', function () { nudge(parseInt(b.getAttribute('data-step'), 10)); });
    });
    $('delay-clock').addEventListener('focusout', function (e) {
      if (e.relatedTarget && $('delay-clock').contains(e.relatedTarget)) return;     // on reste dans l'horloge
      commitTyped();
    });
    $('delay-ref-kind').addEventListener('change', endEdit);
    setInterval(refreshClock, 250);
  }

  /* ---------- Thème clair / sombre ---------- */
  function systemPrefersDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function initTheme() {
    var stored = localGet('theme');
    var dark = stored === 'dark' ? true : stored === 'light' ? false : systemPrefersDark();
    $('theme-dark').checked = dark;
    $('theme-dark').onchange = function () {
      var t = $('theme-dark').checked ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
      localSet('theme', t);
    };
  }

  /* ---------- Langue : sélecteur et rafraîchissement à chaud ---------- */
  /* Retraduit tout ce qui est déjà affiché, sans toucher au suivi en cours : jamais setMode, fillForms ni loadArchive (ils valideraient les réglages,
     relanceraient des requêtes et effaceraient les messages). Le journal est un historique : les lignes déjà écrites gardent leur langue. */
  function refreshLanguage() {
    applyI18n(document);
    setBadge(badgeState.flag, badgeState.key);
    renderDevices();
    showLocalAccessNotice();
    updateReplayButton();
    if (archiveShown) fillArchiveSelect(archiveShown);
    fillSroSelects(); Object.keys(GRIIIP_TABS).forEach(fillGriiipSelect);
    if (downloadCount != null) setDownloadLabel(downloadCount);
    if (progressState) setProgress(progressState.key, progressState.params);
    MSG_IDS.forEach(function (id) { var el = $(id); if (el._msg && typeof el._msg !== 'string') el.textContent = msgText(el._msg); });
  }

  function initLang() {
    var sel = $('lang-select');
    RF.LANGUAGES.forEach(function (code) {
      var o = document.createElement('option');
      o.value = code; o.textContent = code.toUpperCase(); o.lang = code; o.title = RF.languageName(code);
      sel.appendChild(o);
    });
    RF.setLang(RF.lang());                    // aligne <html lang> si le script du <head> a posé une langue inconnue
    sel.value = RF.lang();
    sel.addEventListener('change', function () { RF.setLang(sel.value, true); });
    RF.onLangChange(function () { sel.value = RF.lang(); refreshLanguage(); });
  }

  /* ---------- Initialisation ---------- */
  function init() {
    initLang();
    localAccessReady = checkLocalAccess();
    initTheme(); initCalibration();
    // Valeurs par défaut du replay depuis l'archive : à poser avant fillForms, qui charge déjà la liste des courses.
    $('arc-year').value = new Date().getFullYear();
    $('replay-source').value = localGet('replaySource') === 'file' ? 'file' : 'archive';
    buildSettingsGrid();
    applyI18n(document);
    setBadge(null); updateReplayButton();
    document.documentElement.classList.remove('i18n-pending');
    // Premier lancement : le préfixe du scan est celui de l'adresse de la page si elle est en IP privée.
    var guess = RF.prefixFromHost(location.hostname);
    if (guess && !settings.devices.length && settings.scan.prefix === RF.DEFAULT_SETTINGS.scan.prefix) { settings.scan.prefix = guess; RF.saveSettings(settings); }
    fillForms();
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#mode-tabs .tab'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { setMode(t.getAttribute('data-mode'), true); });
      t.addEventListener('keydown', function (e) {            // flèches gauche / droite entre onglets
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        var n = tabs[(i + d + tabs.length) % tabs.length];
        if (n.disabled) return;
        e.preventDefault(); n.focus(); setMode(n.getAttribute('data-mode'), true);
      });
    });
    document.querySelector('main').addEventListener('change', function (e) {
      if (e.target.id && /^(f-|s-|tv-|scan-|fixed-)/.test(e.target.id)) commit();
    });
    $('fixed-delay').addEventListener('change', function () {
      var v = parseFloat($('fixed-delay').value);
      if (run && run.sync && run.sync.setDelay && isFinite(v) && v >= 0) { run.sync.setDelay(v); log('info', RF.t('log.delayChanged', { seconds: v })); }
    });
    $('replay-file').addEventListener('change', function () { replayMsg('', 'hint'); });
    $('btn-start-live').onclick = function () { start('live'); };
    $('btn-start-replay').onclick = function () { if (run && run.kind === 'replay') resyncReplay(); else start('replay'); };
    $('btn-stop').onclick = stop;
    $('btn-download').onclick = downloadRecording;
    $('btn-confirm').onclick = confirmDevices;
    window.addEventListener('hashchange', render); render();
    $('btn-add').onclick = addManual;
    $('add-host').onkeydown = function (e) { if (e.key === 'Enter') addManual(); };
    $('btn-check').onclick = function () { Promise.all(settings.devices.map(checkDevice)).then(renderDevices); renderDevices(); };
    $('btn-scan').onclick = scan;
    $('btn-scan-cancel').onclick = function () { if (scanCtrl) scanCtrl.abort(); };
    Array.prototype.forEach.call(document.querySelectorAll('.test'), function (b) { b.onclick = function () { testFlag(b.getAttribute('data-flag')); }; });
    $('btn-release').onclick = releaseAll;
    $('btn-arc-download').onclick = downloadArchiveRace;
    $('replay-source').addEventListener('change', function () { localSet('replaySource', $('replay-source').value); replayMsg('', 'hint'); updateModeVisibility(); loadArchive(); });
    $('arc-year').addEventListener('change', loadArchive);
    $('arc-series').addEventListener('change', loadArchive);
    $('arc-race').addEventListener('change', function () { replayMsg('', 'hint'); });
    $('gtwc-series').addEventListener('change', function () { fillSroSelects(); commit(); });
    $('gtwc-race').addEventListener('change', commit);
    $('wec-session').addEventListener('change', commit);
    $('elms-session').addEventListener('change', commit);
    $('btn-export').onclick = exportConfig;
    $('import-config').onchange = function (e) { if (e.target.files[0]) importConfig(e.target.files[0]); e.target.value = ''; };
    $('btn-reset').onclick = function () { settings = RF.defaultSettings(); RF.saveSettings(settings); fillForms(); };
    $('btn-clear-log').onclick = function () { $('log').textContent = ''; };
    if (settings.devices.length) Promise.all(settings.devices.map(checkDevice)).then(renderDevices);
    log('info', RF.t('log.ready'));
  }
  init();
})();
