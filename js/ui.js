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

  /* ---------- Réglages ---------- */
  var FIELDS = [
    ['source', 'requestTimeout', 'Délai source (s)', 'number', { step: '0.5', min: '0.5' }],
    ['wled', 'requestTimeout', 'Délai WLED (s)', 'number', { step: '0.5', min: '0.5' }],
    ['wled', 'brightness', 'Luminosité (0-255)', 'number', { min: '0', max: '255' }],
    ['wled', 'greenBlinks', 'Clignotements verts', 'number', { min: '1', max: '20' }],
    ['wled', 'greenBlinkSeconds', 'Durée de clignotement (s)', 'number', { step: '0.1', min: '0.1' }],
    ['wled', 'breatheEffectId', 'Identifiant effet « breathe »', 'number', { min: '0', max: '255' }],
    ['wled', 'greenPreset', 'Preset vert/damier', 'number', { min: '1', max: '250', placeholder: 'aucun' }],
    ['wled', 'yellowPreset', 'Preset jaune', 'number', { min: '1', max: '250', placeholder: 'aucun' }],
    ['wled', 'redPreset', 'Preset rouge', 'number', { min: '1', max: '250', placeholder: 'aucun' }],
    ['wled', 'releaseOnExit', 'Rendre la main à l\'arrêt', 'checkbox', {}],
    ['wled', 'restoreState', 'Restaurer l\'état d\'origine du WLED en rendant la main', 'checkbox', {}],
    ['tvSync', 'sampleSize', 'Tours pour la moyenne', 'number', { min: '1' }],
    ['tvSync', 'fallbackLapSeconds', 'Durée de tour par défaut (s)', 'number', { min: '1' }],
    ['tvSync', 'maximumDelay', 'Délai TV maximal (s)', 'number', { min: '1' }],
    ['wec', 'seriesName', 'Série WEC', 'text', {}],
    ['wec', 'apiUrl', 'API WEC', 'text', {}],
    ['imsa', 'raceOnly', 'IMSA : courses seulement', 'checkbox', {}],
    ['imsa', 'apiUrl', 'API IMSA', 'text', {}]
  ];

  /* Bulles d'aide de la page Réglages. Tout nouveau réglage de FIELDS doit avoir ici sa description. */
  var TIPS = {
    'source.requestTimeout': "Délai maximal, en secondes, pour obtenir une réponse des flux de course NASCAR ou WEC. Au-delà, la requête échoue et sera retentée automatiquement.",
    'wled.requestTimeout': "Délai maximal, en secondes, pour qu'un appareil WLED réponde. Un appareil éteint ou injoignable est signalé en erreur après ce délai.",
    'wled.brightness': "Luminosité de 0 à 255 appliquée aux couleurs pleines des drapeaux et au clignotement vert. Elle ne s'applique pas aux presets.",
    'wled.greenBlinks': "Nombre de clignotements verts affichés pour un drapeau vert ou à damier, avant de rendre la main (de 1 à 20).",
    'wled.greenBlinkSeconds': "Durée en secondes de chaque phase, allumée ou éteinte, du clignotement vert.",
    'wled.breatheEffectId': "Numéro de l'effet WLED utilisé en continu pour le jaune et le rouge, après une seconde de couleur pleine. Le 2 correspond à Breathe.",
    'wled.greenPreset': "Numéro d'un preset WLED (de 1 à 250) appliqué à la place du clignotement vert. Il sert aussi pour le drapeau à damier. Vide : effet par défaut.",
    'wled.yellowPreset': "Numéro d'un preset WLED (de 1 à 250) appliqué à la place de l'effet jaune par défaut. Vide : effet par défaut.",
    'wled.redPreset': "Numéro d'un preset WLED (de 1 à 250) appliqué à la place de l'effet rouge par défaut. Vide : effet par défaut.",
    'wled.releaseOnExit': "À l'arrêt, rend le contrôle de la bande à WLED ou à une autre source de lumière, comme Hyperion, en désactivant le mode « live override ».",
    'wled.restoreState': "Mémorise l'état de la bande (marche, luminosité, effet, couleurs ou preset) avant le premier drapeau, et le remet en rendant la main. Sans cela, la bande garde la dernière couleur d'un drapeau.",
    'tvSync.sampleSize': "Nombre de derniers tours du leader utilisés pour calculer la durée moyenne d'un tour. Cette moyenne sert à la synchronisation avec la TV (NASCAR).",
    'tvSync.fallbackLapSeconds': "Durée de tour supposée, en secondes, tant qu'aucune moyenne n'est disponible. Elle sert à calculer le décalage avec la TV.",
    'tvSync.maximumDelay': "Décalage maximal, en secondes, appliqué aux drapeaux pour suivre la retransmission TV. Il plafonne le délai calculé.",
    'wec.seriesName': "Nom exact de la série utilisé pour détecter automatiquement la course WEC en cours.",
    'wec.apiUrl': "Adresse de l'API de chronométrage WEC. À modifier seulement si elle change.",
    'imsa.raceOnly': "N'applique les drapeaux IMSA que pendant une session de course. Pendant les essais et les qualifications, la bande garde son état. Décochez pour suivre aussi ces sessions.",
    'imsa.apiUrl': "Adresse du flux de chronométrage IMSA (SessionInfo.json). À modifier seulement si IMSA la change."
  };

  function nameSpan(text, tip) {
    var s = document.createElement('span');
    s.className = 'name'; s.textContent = text;
    if (tip) { s.setAttribute('data-tip', tip); s.setAttribute('tabindex', '-1'); }
    return s;
  }

  function buildSettingsGrid() {
    var grid = $('settings-grid');
    FIELDS.forEach(function (f) {
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = f[3]; input.id = 'f-' + f[0] + '-' + f[1];
      Object.keys(f[4]).forEach(function (k) { input.setAttribute(k, f[4][k]); });
      var name = nameSpan(f[2], TIPS[f[0] + '.' + f[1]]);
      if (f[3] === 'checkbox') { label.className = 'check'; label.appendChild(input); label.appendChild(name); }
      else { label.appendChild(name); label.appendChild(input); }
      grid.appendChild(label);
    });
  }

  function fillForms() {
    FIELDS.forEach(function (f) {
      var el = $('f-' + f[0] + '-' + f[1]), v = settings[f[0]][f[1]];
      if (f[3] === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    });
    $('s-pollInterval').value = settings.source.pollInterval;
    $('s-sessionId').value = settings.wec.sessionId == null ? '' : settings.wec.sessionId;
    $('tv-enabled').checked = settings.tvSync.enabled;
    $('tv-lap').value = settings.tvSync.initialTvLap;
    $('fixed-delay').value = settings.tvSync.fixedDelaySeconds;
    if (settings.tvSync.fixedDelaySeconds > 0) delayMsg('Retard : ' + settings.tvSync.fixedDelaySeconds + ' s.', false);
    $('scan-prefix').value = settings.scan.prefix; $('scan-from').value = settings.scan.from; $('scan-to').value = settings.scan.to;
    setMode(localGet('mode') || settings.source.type, false);
    updateModeVisibility();
    renderDevices();
  }

  function readForms() {
    var raw = JSON.parse(JSON.stringify(settings));
    FIELDS.forEach(function (f) {
      var el = $('f-' + f[0] + '-' + f[1]);
      raw[f[0]][f[1]] = f[3] === 'checkbox' ? el.checked : el.value;
    });
    raw.source.pollInterval = $('s-pollInterval').value;
    raw.wec.sessionId = $('s-sessionId').value;
    raw.tvSync.enabled = $('tv-enabled').checked;
    raw.tvSync.initialTvLap = $('tv-lap').value;
    raw.tvSync.fixedDelaySeconds = $('fixed-delay').value;
    raw.scan = { prefix: $('scan-prefix').value.trim(), from: $('scan-from').value, to: $('scan-to').value };
    var mode = $('mode').value;
    if (mode === 'nascar' || mode === 'wec' || mode === 'imsa') raw.source.type = mode;
    return raw;
  }

  /* Valide et enregistre ; renvoie true si les réglages sont valides. */
  function commit() {
    try {
      settings = RF.validateSettings(readForms());
      $('settings-error').textContent = '';
      if (!RF.saveSettings(settings)) $('settings-error').textContent = 'Stockage du navigateur indisponible : les réglages ne seront pas conservés.';
      return true;
    } catch (e) { $('settings-error').textContent = e.message; return false; }
  }

  function localGet(k) { try { return localStorage.getItem('raceflags.' + k); } catch (e) { return null; } }
  function localSet(k, v) { try { localStorage.setItem('raceflags.' + k, v); } catch (e) {} }

  /* ---------- Journal ---------- */
  function log(kind, msg) {
    var pre = $('log'), line = document.createElement('div');
    line.className = kind === 'flag' ? 'log-flag' : kind;
    line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    pre.appendChild(line);
    while (pre.childNodes.length > 300) pre.removeChild(pre.firstChild);
    pre.scrollTop = pre.scrollHeight;
  }

  function setBadge(flag, text) {
    var b = $('flag-badge');
    b.className = 'flag ' + (flag || 'idle');
    b.textContent = text || ({ green: 'vert', yellow: 'jaune', red: 'rouge', chequered: 'damier' }[flag] || 'arrêté');
  }

  /* ---------- Appareils ---------- */
  function renderDevices() {
    var tbody = document.querySelector('#devices tbody');
    tbody.textContent = '';
    if (!settings.devices.length) {
      var tr0 = tbody.insertRow(), td0 = tr0.insertCell(); td0.colSpan = 5; td0.className = 'hint';
      td0.textContent = 'Aucun appareil. Lancez un scan ou ajoutez une adresse.';
    }
    settings.devices.forEach(function (d, i) {
      var tr = tbody.insertRow();
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = d.enabled;
      cb.onchange = function () { d.enabled = cb.checked; RF.saveSettings(settings); $('confirm-error').textContent = ''; };
      tr.insertCell().appendChild(cb);
      var nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = d.name;
      nameInput.onchange = function () { d.name = nameInput.value || d.url; RF.saveSettings(settings); };
      tr.insertCell().appendChild(nameInput);
      tr.insertCell().textContent = d.url.replace(/^https?:\/\//, '');
      var st = status[d.url], td = tr.insertCell();
      td.className = 'status ' + (st ? (st.ok ? 'ok' : 'ko') : ''); td.textContent = st ? st.text : '—';
      var del = document.createElement('button'); del.textContent = 'Retirer'; del.className = 'small';
      del.onclick = function () { settings.devices.splice(i, 1); RF.saveSettings(settings); renderDevices(); };
      tr.insertCell().appendChild(del);
    });
  }

  /* ---------- Version en ligne (page en https) ----------
     Les WLED répondent en http : depuis une page https, seul Chrome (ou Edge) les joint, après l'autorisation
     « accès au réseau local ». localAccess : 'http' (page en http, rien à faire), 'granted', 'prompt', 'denied' ou 'unsupported'. */
  var localAccess = location.protocol === 'https:' ? 'prompt' : 'http';
  var LOCAL_ACCESS_TEXT = {
    prompt: ['', "Version en ligne (https) : pour joindre vos WLED, le navigateur va demander l'accès aux appareils du réseau local. Acceptez cette demande."],
    denied: ['error', "L'accès au réseau local est refusé pour ce site : les WLED sont injoignables. Autorisez-le dans les paramètres du site (icône à gauche de l'adresse), puis rechargez la page."],
    unsupported: ['error', "Cette page est en https et ce navigateur bloque les WLED, qui répondent en http. Utilisez Chrome ou Edge sur ordinateur ou Android, ou hébergez l'application en http sur votre réseau (voir le README du projet)."]
  };
  function showLocalAccessNotice() {
    var t = LOCAL_ACCESS_TEXT[localAccess];
    Array.prototype.forEach.call(document.querySelectorAll('.local-access-notice'), function (p) {
      p.hidden = !t;
      if (t) { p.className = 'notice local-access-notice' + (t[0] ? ' ' + t[0] : ''); p.textContent = t[1]; }
    });
  }
  /* Interroge l'autorisation (nom actuel puis ancien nom) ; un navigateur qui ne connaît ni l'un ni l'autre bloque les WLED. */
  function checkLocalAccess() {
    if (localAccess === 'http') return Promise.resolve();
    var perms = navigator.permissions;
    function ask(names) {
      if (!names.length || !perms || !perms.query) return Promise.reject(new Error('non pris en charge'));
      return perms.query({ name: names[0] }).catch(function () { return ask(names.slice(1)); });
    }
    return ask(['local-network', 'local-network-access']).then(function (p) {
      localAccess = p.state;
      p.onchange = function () { localAccess = p.state; showLocalAccessNotice(); };
    }, function () { localAccess = 'unsupported'; }).then(showLocalAccessNotice);
  }
  var localAccessReady = Promise.resolve();
  function wledBlocked() { return localAccess === 'unsupported' || localAccess === 'denied'; }
  function unreachableText() {
    return localAccess === 'http' || localAccess === 'granted' ? 'injoignable (réseau ou CORS)' : 'bloqué par le navigateur (page https)';
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
    if (!enabledDevices().length) { $('confirm-error').textContent = 'Cochez au moins un appareil.'; return; }
    $('confirm-error').textContent = '';
    RF.saveSettings(settings); localSet('devicesConfirmed', '1');
    go('race');
  }

  function upsertDevice(dev) {
    var existing = settings.devices.filter(function (d) { return d.url === dev.url; })[0];
    if (existing) { if (dev.name && existing.name === existing.url) existing.name = dev.name; }
    else settings.devices.push({ url: dev.url, name: dev.name || dev.url, enabled: true });
    status[dev.url] = { ok: true, text: 'en ligne' + (dev.version ? ' (v' + dev.version + ')' : '') };
    RF.saveSettings(settings);
    renderDevices();
  }

  function checkDevice(d) {
    status[d.url] = { ok: false, text: '…' };
    return RF.probeWled(d.url, 2500).then(function (info) {
      status[d.url] = info ? { ok: true, text: 'en ligne' + (info.version ? ' (v' + info.version + ')' : '') }
                           : { ok: false, text: unreachableText() };
    });
  }

  function addManual() {
    var host = $('add-host').value.trim();
    if (!host) return;
    var url = RF.normalizeWledUrl(host);
    $('btn-add').disabled = true;
    RF.probeWled(url, 3000).then(function (info) {
      if (info) { upsertDevice(info); log('info', 'Appareil ajouté: ' + info.name + ' (' + info.url + ')'); }
      else {
        settings.devices.push({ url: url, name: host, enabled: true });
        status[url] = { ok: false, text: unreachableText() };
        RF.saveSettings(settings); renderDevices();
        log('warn', 'Ajouté mais injoignable: ' + url);
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
    log('info', 'Scan de ' + sc.prefix + sc.from + ' à ' + sc.prefix + sc.to + '…');
    RF.scanSubnet({
      prefix: sc.prefix, from: sc.from, to: sc.to, signal: scanCtrl.signal,
      onProgress: function (d, t) { $('scan-status').textContent = d + ' / ' + t; },
      onFound: function (dev) { found++; upsertDevice(dev); log('info', 'Trouvé: ' + dev.name + ' (' + dev.url + ')'); }
    }).then(function () {
      var cancelled = scanCtrl.signal.aborted;
      $('scan-status').textContent = (cancelled ? 'Annulé. ' : 'Terminé. ') + found + ' appareil(s) trouvé(s).';
      if (!found && !cancelled) log('warn', 'Aucun WLED trouvé. Vérifiez le préfixe réseau ou ajoutez l\'adresse à la main.' +
        (localAccess === 'http' ? '' : ' Page en https : vérifiez aussi que l\'accès au réseau local est autorisé pour ce site.'));
    }).then(function () { scanCtrl = null; $('btn-scan').disabled = false; $('btn-scan-cancel').hidden = true; });
  }

  /* ---------- Sorties WLED ---------- */
  function buildOutput() {
    var devices = settings.devices.filter(function (d) { return d.enabled; });
    if (!devices.length) throw new Error('Aucun appareil WLED coché.');
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
    if (run) return log('warn', 'Arrêtez la course avant de tester.');
    if (!commit()) return;
    var prev = testOutput ? testOutput.close().catch(function () {}) : Promise.resolve();
    prev.then(function () {
      testOutput = buildOutput();
      return testOutput.apply({ source: 'test', flag: flag, occurredAt: new Date(), lap: null, totalLaps: null, remainingSeconds: null, metadata: {} });
    }).then(function () { log('flag', '[TEST] ' + flag); setBadge(flag); },
            function (e) { log('error', '[ERREUR SORTIE] ' + e.message); });
  }

  function releaseAll() {
    if (run) return;
    var out;
    try { out = testOutput || buildOutput(); } catch (e) { return log('error', e.message); }
    out.release().then(function () { log('info', 'Main rendue aux appareils.'); setBadge(null); testOutput = null; },
                       function (e) { log('error', '[ERREUR SORTIE] ' + e.message); });
  }

  /* ---------- Race ---------- */
  var CHAMPIONSHIP_NAMES = { nascar: 'NASCAR', wec: 'FIA WEC', imsa: 'IMSA' };
  var MODES = ['nascar', 'wec', 'imsa'];      // les championnats ; le replay est une section de chaque onglet
  /* Sélection du championnat par onglets ; #mode (champ caché) garde la valeur lue par le reste du code. */
  function setMode(mode, save) {
    if (MODES.indexOf(mode) === -1) mode = 'nascar';
    $('mode').value = mode;
    Array.prototype.forEach.call(document.querySelectorAll('#mode-tabs .tab'), function (t) {
      var on = t.getAttribute('data-mode') === mode;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; t.classList.toggle('active', on);
    });
    updateModeVisibility();
    loadArchive();
    if ($('replay-msg')) replayMsg('', 'hint');
    if (save) { commit(); localSet('mode', mode); }
  }

  function updateModeVisibility() {
    var mode = $('mode').value;
    function toggle(cls, show) { Array.prototype.forEach.call(document.querySelectorAll('.' + cls), function (el) { el.classList.toggle('hidden-mode', !show); }); }
    toggle('mode-wec', mode === 'wec'); toggle('mode-nascar', mode === 'nascar'); toggle('mode-fixed', mode === 'wec' || mode === 'imsa');
    var archive = replayUsesArchive();
    toggle('arc-only', archive); toggle('file-only', !archive);
  }

  /* Message sous le bouton du replay : kind 'error' (rouge) ou 'hint' (gris). */
  function replayMsg(text, kind) { $('replay-msg').textContent = text; $('replay-msg').className = kind === 'hint' ? 'hint' : 'error'; }

  /* ---------- Replay depuis l'archive NASCAR ---------- */
  var archiveCache = {}, archiveToken = 0;
  function replayUsesArchive() { return $('mode').value === 'nascar' && $('replay-source').value === 'archive'; }
  /* Fichiers de la course absents (403/404) ou refus signalé comme erreur réseau : pas encore publiés. */
  function archiveUnavailable(e) { return /403|404|lap-times|lap-notes/.test(e && e.message || ''); }
  function archiveStatus(text, isError) { $('arc-status').textContent = text; $('arc-status').className = (isError ? 'error' : 'hint') + ' mode-nascar' + (replayUsesArchive() ? ' arc-only' : ' arc-only hidden-mode'); }
  function fillArchiveSelect(races) {
    var sel = $('arc-race'), keep = sel.value;
    sel.textContent = '';
    races.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.date.slice(8, 10) + '/' + r.date.slice(5, 7) + '  ' + r.name + (r.track ? '  (' + r.track + (r.laps ? ', ' + r.laps + ' tours' : '') + ')' : '');
      sel.appendChild(o);
    });
    if (keep && races.some(function (r) { return String(r.id) === keep; })) sel.value = keep;
  }
  function loadArchive() {
    if (!replayUsesArchive()) return;
    if (!$('arc-year').value) $('arc-year').value = new Date().getFullYear();
    var year = $('arc-year').value, series = $('arc-series').value, key = year + '/' + series, token = ++archiveToken;
    if (archiveCache[key]) { fillArchiveSelect(archiveCache[key]); archiveStatus(archiveCache[key].length + ' course(s) disponible(s). La plus récente est sélectionnée.', false); return; }
    $('arc-race').textContent = ''; archiveStatus('Chargement de la liste des courses…', false);
    RF.listNascarRaces(year, series).then(function (races) {
      if (token !== archiveToken) return;                       // une requête plus récente a pris le relais
      archiveCache[key] = races; fillArchiveSelect(races);
      archiveStatus(races.length ? races.length + ' course(s) disponible(s). La plus récente est sélectionnée.' : 'Aucune course passée pour cette série et cette année.', false);
    }, function (e) { if (token === archiveToken) archiveStatus(e.message, true); });
  }

  /* Réglages de lecture lus à l'écran : servent au lancement et au recalage d'un replay en cours. */
  function replayParams() {
    var video = RF.parseDuration($('replay-video').value), startAt = RF.parseDuration($('replay-start').value);
    if (video === null) throw new Error('Délai vidéo invalide (HH:MM:SS).');
    if (startAt === null) throw new Error('Point de départ invalide (HH:MM:SS).');
    var lap = parseInt($('replay-lap').value, 10);
    if (!(lap > 0)) lap = null;                                  // 0 ou vide : pas de départ par tour, on utilise le temps
    return { videoOffset: video, startAt: lap ? 0 : startAt, startLap: lap, speed: parseFloat($('replay-speed').value) };
  }

  /* Compteur de tour du replay : recalculé à partir de l'horloge, il avance même entre deux changements de drapeau. */
  function showReplayProgress() {
    if (!run || run.kind !== 'replay' || !run.source || !run.source.progress) return;
    var p = run.source.progress();
    if (p && p.lap != null) $('progress').textContent = 'Tour ' + p.lap + (p.totalLaps ? ' / ' + p.totalLaps : '');
  }

  /* Recale le replay en cours avec les réglages affichés, sans l'arrêter ni toucher à l'état de l'appareil. */
  function resyncReplay() {
    if (!run || run.kind !== 'replay' || !run.source) return;
    var p;
    if (typeof run.source.resync !== 'function') return replayMsg('Les fichiers de la page ne sont pas à la même version (cache du navigateur). Rechargez avec Ctrl+F5.', 'error');
    try { p = replayParams(); run.source.resync(p); } catch (e) { return replayMsg(e.message, 'error'); }
    if (run.engine) run.engine.wake();
    showReplayProgress();
    var from = p.startLap ? 'tour ' + p.startLap : RF.formatDuration(p.startAt);
    log('info', 'Replay resynchronisé : départ ' + from + ', délai vidéo ' + p.videoOffset + ' s, vitesse ' + p.speed + '.');
    replayMsg('Replay recalé : départ ' + from + ', délai vidéo ' + p.videoOffset + ' s.', 'hint');
  }

  function readReplayFile() {
    var f = $('replay-file').files[0];
    if (!f) return Promise.reject(new Error('Choisissez un fichier d\'enregistrement.'));
    return f.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error('Fichier JSON invalide: ' + e.message); }
    });
  }

  function createSource(mode, championship) {
    if (mode === 'nascar') return Promise.resolve(new RF.NascarSource({ timeout: settings.source.requestTimeout, lapSampleSize: settings.tvSync.sampleSize }));
    if (mode === 'imsa') return Promise.resolve(new RF.ImsaSource({ apiUrl: settings.imsa.apiUrl, raceOnly: settings.imsa.raceOnly, timeout: settings.source.requestTimeout }));
    if (mode === 'wec') return Promise.resolve(new RF.WecSource({ sessionId: settings.wec.sessionId, apiUrl: settings.wec.apiUrl, seriesName: settings.wec.seriesName, timeout: settings.source.requestTimeout }));
    var fromArchive = replayUsesArchive();
    var docPromise;
    if (fromArchive) {
      var raceId = $('arc-race').value;
      if (!raceId) return Promise.reject(new Error('Choisissez une course dans l\'archive NASCAR.'));
      replayMsg('Téléchargement de la course depuis l\'archive NASCAR…', 'hint');
      docPromise = RF.importNascarRace({ year: $('arc-year').value, series: $('arc-series').value, raceId: raceId }).catch(function (e) {
        throw new Error(archiveUnavailable(e) ? 'Les données de cette course ne sont pas encore publiées dans l\'archive NASCAR, ou le réseau est indisponible. Réessayez plus tard.' : e.message);
      });
    } else docPromise = readReplayFile();
    return docPromise.then(function (doc) {
      replayMsg('', 'hint');
      // Un enregistrement est propre à un championnat : on refuse de le rejouer sur un autre onglet.
      if (doc && doc.source && doc.source !== championship) {
        var from = CHAMPIONSHIP_NAMES[doc.source] || doc.source;
        throw new Error('Cet enregistrement vient de ' + from + ' : utilisez l\'onglet ' + from + ' pour le rejouer (onglet actuel : ' + CHAMPIONSHIP_NAMES[championship] + ').');
      }
      return new RF.ReplaySource(Object.assign({ document: doc }, replayParams()));
    });
  }

  function setRunning(on, kind) {
    // Pendant un suivi, seule la section utilisée reste affichée : lancer un replay masque le live, et inversement. À l'arrêt, les deux reviennent.
    $('panel-live').hidden = on && kind === 'replay';
    $('panel-replay').hidden = on && kind === 'live';
    var resync = on && kind === 'replay';                       // pendant un replay, le bouton du replay sert à recaler
    $('btn-start-live').disabled = on; $('btn-start-replay').disabled = on && !resync; $('btn-stop').disabled = !on;
    $('btn-start-replay').textContent = resync ? 'Resynchroniser le replay' : 'Lancer le replay';
    $('btn-start-replay').title = resync ? 'Recale le replay en cours avec le délai, le départ, le tour et la vitesse ci-dessus, sans le relancer' : 'Lance le replay avec les réglages ci-dessus';
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
    if (!$('no-wled').checked && !enabledDevices().length) { go('wled'); $('confirm-error').textContent = 'Sélectionnez au moins un appareil WLED.'; return log('warn', 'Sélectionnez au moins un appareil WLED.'); }
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
        recorder = new RF.RaceRecorder({ source: mode, name: mode.toUpperCase() + ' ' + new Date().toLocaleString(),
          onChange: function (n) { $('btn-download').hidden = false; $('btn-download').textContent = 'Télécharger l\'enregistrement (' + n + ')'; } });
        observers.push(recorder);
      }
      var sync = null;
      if (mode === 'nascar' && settings.tvSync.enabled) sync = new RF.NascarTvSynchronizer({ initialTvLap: settings.tvSync.initialTvLap, fallbackLapSeconds: settings.tvSync.fallbackLapSeconds, maximumDelay: settings.tvSync.maximumDelay });
      else if (mode === 'wec' || mode === 'imsa') sync = new RF.FixedDelaySynchronizer({ delaySeconds: settings.tvSync.fixedDelaySeconds });   // toujours créé : réglable en cours de course
      var interval = mode === 'replay' ? 0 : settings.source.pollInterval;
      run = { ctrl: ctrl, recorder: recorder, sync: sync, kind: kind, source: source }; _lastRec = recorder;
      setRunning(true, kind); acquireWakeLock(); setBadge(null, 'en attente');
      log('info', 'Démarré: ' + (mode === 'replay' ? 'replay ' + championship.toUpperCase() : mode) + (mode === 'replay' ? '' : ', intervalle ' + interval + ' s') + (sync && mode === 'nascar' ? ', synchro TV tour ' + settings.tvSync.initialTvLap : '') + (sync && sync.getDelay && sync.getDelay() > 0 ? ', retard ' + sync.getDelay() + ' s' : '') + (noWled ? ', sans WLED' : ''));
      var engine = new RF.RaceFlagEngine({
        source: source, output: output, pollInterval: interval, skipInitialGreen: mode !== 'replay', synchronizer: sync, observers: observers, signal: ctrl.signal,
        onLog: log, onFlag: function (ev) { setBadge(ev.flag); },
        onProgress: function (s) {
          lastTiming = { remaining: s.remainingSeconds, elapsed: s.metadata && s.metadata.elapsed ? RF.parseDuration(s.metadata.elapsed) : null, at: RF.clock() };
          if (s.flag !== 'unknown' && noWled) setBadge(s.flag);
          if (run && run.kind === 'replay' && run.source && run.source.progress) showReplayProgress();       // tour calculé par l'horloge du replay
          else $('progress').textContent = s.remainingSeconds != null ? 'Temps restant ' + RF.formatDuration(s.remainingSeconds)
            : s.lap != null ? 'Tour ' + s.lap + (s.totalLaps ? ' / ' + s.totalLaps : '') : '';
        }
      });
      run.engine = engine;
      if (kind === 'replay' && source.progress) { run.progressTimer = setInterval(showReplayProgress, 500); showReplayProgress(); }
      if (kind === 'replay') replayMsg('Replay en cours. Modifiez le délai, le départ, le tour ou la vitesse, puis cliquez sur « Resynchroniser le replay » pour recaler sans relancer.', 'hint');
      return engine.run().then(function () { log('info', 'Arrêté.'); }, function (e) { log('error', 'Erreur: ' + e.message); });
    }).catch(function (e) { log('error', e.message); if (kind === 'replay') replayMsg(e.message, 'error'); }).then(function () {
      var rec = run && run.recorder;
      if (run && run.progressTimer) clearInterval(run.progressTimer);
      run = null; setRunning(false); releaseWakeLock(); setBadge(null);
      if ($('replay-msg').className === 'hint') replayMsg('', 'hint');          // une erreur éventuelle reste affichée
      if (rec && rec.count()) { $('btn-download').hidden = false; }
      activeOutput = null;
    });
  }

  function stop() { if (run) { run.ctrl.abort(); $('btn-stop').disabled = true; } }

  function downloadRecording() { /* le dernier enregistrement reste accessible après l'arrêt */
    if (!lastRecorder()) return;
    var d = lastRecorder().document;
    RF.downloadJson(d, 'enregistrement-' + d.source + '-' + d.started_at.replace(/[:.]/g, '-') + '.json');
  }
  function lastRecorder() { return (run && run.recorder) || _lastRec; }

  /* ---------- Import / export ---------- */
  /* Télécharge le fichier de replay de la course choisie (pour le garder ou le rejouer plus tard comme « Fichier »). */
  function downloadArchiveRace() {
    var raceId = $('arc-race').value;
    if (!raceId) return archiveStatus('Choisissez une course.', true);
    $('btn-arc-download').disabled = true; archiveStatus('Téléchargement…', false);
    RF.importNascarRace({ year: $('arc-year').value, series: $('arc-series').value, raceId: raceId })
      .then(function (doc) {
        RF.downloadJson(doc, 'nascar-' + doc.metadata.year + '-' + doc.metadata.race_id + '.json');
        archiveStatus(doc.events.length + ' changements de drapeau, ' + doc.metadata.total_laps + ' tours : fichier téléchargé.', false);
      }, function (e) { archiveStatus(archiveUnavailable(e) ? 'Les données de cette course ne sont pas encore publiées, ou le réseau est indisponible.' : e.message, true); })
      .then(function () { $('btn-arc-download').disabled = false; });
  }

  function exportConfig() { if (commit()) RF.downloadJson(settings, 'raceflags-config.json'); }
  function importConfig(file) {
    file.text().then(function (t) {
      settings = RF.validateSettings(JSON.parse(t)); RF.saveSettings(settings); fillForms(); log('info', 'Configuration importée.');
    }).catch(function (e) { $('settings-error').textContent = 'Import impossible: ' + e.message; });
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
  function delayMsg(text, isError) { $('delay-msg').textContent = text; $('delay-msg').className = isError ? 'error' : 'hint'; }
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
    delayMsg(d !== want ? 'Retard limité à ' + d + ' s.' : 'Retard : ' + d + ' s.', false);
    refreshClock();
  }

  /* Saisie au clavier : dès le premier chiffre, l'horloge se fige et on relève celle du chronométrage. */
  function beginEdit() {
    if (clockEditing) return true;
    var ref = run ? timingNow(clockKind()) : null;
    if (ref == null) { delayMsg(run ? 'L\'horloge du chronométrage n\'est pas encore connue.' : 'Démarrez le suivi de la course avant de caler le retard.', true); return false; }
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
    if (typed === null) return delayMsg('Minutes et secondes : de 0 à 59.', true);        // reste en saisie
    var d = RF.streamDelaySeconds(kind, typed, clockRef);
    if (d < 0) { d = 0; delayMsg('Votre diffusion semble en avance sur le chronométrage : retard mis à 0. Vérifiez le type d\'horloge.', true); }
    else if (d > 3600) { delayMsg('Écart de plus d\'une heure : vérifiez le type d\'horloge et l\'heure saisie.', true); return endEdit(); }
    else delayMsg('Retard calculé : ' + d + ' s.', false);
    applyDelay(d);
    log('info', 'Retard de la diffusion calé sur ' + d + ' s (horloge ' + (kind === 'elapsed' ? 'écoulée' : 'restante') + ' ' + RF.formatDuration(typed) + ').');
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
        else if (k === 'Escape') { endEdit(); delayMsg('', false); }
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

  /* ---------- Initialisation ---------- */
  function init() {
    localAccessReady = checkLocalAccess();
    initTheme(); initCalibration();
    // Valeurs par défaut du replay depuis l'archive : à poser avant fillForms, qui charge déjà la liste des courses.
    $('arc-year').value = new Date().getFullYear();
    $('replay-source').value = localGet('replaySource') === 'file' ? 'file' : 'archive';
    buildSettingsGrid();
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
      if (run && run.sync && run.sync.setDelay && isFinite(v) && v >= 0) { run.sync.setDelay(v); log('info', 'Retard de la diffusion : ' + v + ' s (valable pour les prochains drapeaux).'); }
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
    $('btn-export').onclick = exportConfig;
    $('import-config').onchange = function (e) { if (e.target.files[0]) importConfig(e.target.files[0]); e.target.value = ''; };
    $('btn-reset').onclick = function () { settings = RF.defaultSettings(); RF.saveSettings(settings); fillForms(); };
    $('btn-clear-log').onclick = function () { $('log').textContent = ''; };
    if (settings.devices.length) Promise.all(settings.devices.map(checkDevice)).then(renderDevices);
    log('info', 'Prêt. Les réglages sont enregistrés dans ce navigateur.');
  }
  init();
})();
