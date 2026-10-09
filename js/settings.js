/* Configuration persistée dans le navigateur (localStorage), avec validation (de config.py). */
(function (root) {
  'use strict';
  var RF = root.RF;
  var KEY = 'raceflags.settings.v1';

  RF.DEFAULT_SETTINGS = {
    source: { type: 'nascar', pollInterval: 2.0, requestTimeout: 10.0 },
    wled: { requestTimeout: 5.0, brightness: 255, greenBlinks: 3, greenBlinkSeconds: 0.5, breatheEffectId: 2,
            releaseOnExit: true, restoreState: true, greenPreset: null, yellowPreset: null, redPreset: null },
    wec: { sessionId: null, apiUrl: 'https://insights.griiip.com', seriesName: 'FIA World Endurance Championship' },
    imsa: { apiUrl: 'https://dcqsrdkhg933g.cloudfront.net', raceOnly: true },
    tvSync: { enabled: false, fixedDelaySeconds: 0, initialTvLap: 1, sampleSize: 5, fallbackLapSeconds: 45.0, maximumDelay: 600.0 },
    devices: [],           // [{ url, name, enabled }]
    scan: { prefix: '192.168.1.', from: 1, to: 254 }
  };

  function num(v, name, min, max, integer) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (typeof v === 'boolean' || !isFinite(n)) throw new Error(name + ' doit être un nombre');
    if (integer && Math.floor(n) !== n) throw new Error(name + ' doit être un entier');
    if (n < min || (max != null && n > max)) throw new Error(name + ' doit être compris entre ' + min + ' et ' + (max == null ? '∞' : max));
    return n;
  }
  function optPreset(v, name) { return v === null || v === '' || v === undefined ? null : num(v, name, 1, 250, true); }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  /* Fusionne avec les valeurs par défaut et valide. Lève une Error française si invalide. */
  RF.validateSettings = function (raw) {
    var D = RF.DEFAULT_SETTINGS, r = obj(raw);
    var s = obj(r.source), w = obj(r.wled), c = obj(r.wec), im = obj(r.imsa), t = obj(r.tvSync), sc = obj(r.scan);
    var out = {
      source: {
        type: ['nascar', 'wec', 'imsa'].indexOf(s.type == null ? D.source.type : s.type) !== -1 ? (s.type || D.source.type) : (function () { throw new Error('source.type inconnu'); })(),
        pollInterval: num(s.pollInterval == null ? D.source.pollInterval : s.pollInterval, 'Intervalle', 0.2, 3600),
        requestTimeout: num(s.requestTimeout == null ? D.source.requestTimeout : s.requestTimeout, 'Délai source', 0.5, 120)
      },
      wled: {
        requestTimeout: num(w.requestTimeout == null ? D.wled.requestTimeout : w.requestTimeout, 'Délai WLED', 0.5, 120),
        brightness: num(w.brightness == null ? D.wled.brightness : w.brightness, 'Luminosité', 0, 255, true),
        greenBlinks: num(w.greenBlinks == null ? D.wled.greenBlinks : w.greenBlinks, 'Clignotements', 1, 20, true),
        greenBlinkSeconds: num(w.greenBlinkSeconds == null ? D.wled.greenBlinkSeconds : w.greenBlinkSeconds, 'Durée de clignotement', 0.1, 10),
        breatheEffectId: num(w.breatheEffectId == null ? D.wled.breatheEffectId : w.breatheEffectId, 'Effet breathe', 0, 255, true),
        releaseOnExit: w.releaseOnExit == null ? D.wled.releaseOnExit : !!w.releaseOnExit,
        restoreState: w.restoreState == null ? D.wled.restoreState : !!w.restoreState,
        greenPreset: optPreset(w.greenPreset, 'Preset vert'),
        yellowPreset: optPreset(w.yellowPreset, 'Preset jaune'),
        redPreset: optPreset(w.redPreset, 'Preset rouge')
      },
      wec: {
        sessionId: c.sessionId == null || c.sessionId === '' ? null : num(c.sessionId, 'Session WEC', 1, 1000000, true),
        apiUrl: String(c.apiUrl || D.wec.apiUrl), seriesName: String(c.seriesName || D.wec.seriesName)
      },
      imsa: {
        apiUrl: String(im.apiUrl || D.imsa.apiUrl), raceOnly: im.raceOnly == null ? D.imsa.raceOnly : !!im.raceOnly
      },
      tvSync: {
        enabled: !!(t.enabled == null ? D.tvSync.enabled : t.enabled),
        fixedDelaySeconds: num(t.fixedDelaySeconds == null ? D.tvSync.fixedDelaySeconds : t.fixedDelaySeconds, 'Retard de la diffusion', 0, 3600),
        initialTvLap: num(t.initialTvLap == null ? D.tvSync.initialTvLap : t.initialTvLap, 'Tour TV', 1, 10000, true),
        sampleSize: num(t.sampleSize == null ? D.tvSync.sampleSize : t.sampleSize, 'Échantillon', 1, 100, true),
        fallbackLapSeconds: num(t.fallbackLapSeconds == null ? D.tvSync.fallbackLapSeconds : t.fallbackLapSeconds, 'Durée de tour', 1, 3600),
        maximumDelay: num(t.maximumDelay == null ? D.tvSync.maximumDelay : t.maximumDelay, 'Délai maximal', 1, 7200)
      },
      devices: (Array.isArray(r.devices) ? r.devices : []).filter(function (d) { return d && d.url; }).map(function (d) {
        return { url: RF.normalizeWledUrl(d.url), name: String(d.name || d.url), enabled: d.enabled !== false };
      }),
      scan: {
        prefix: RF.isValidPrefix(sc.prefix || D.scan.prefix) ? (sc.prefix || D.scan.prefix) : (function () { throw new Error('Préfixe réseau invalide (ex. 192.168.1.)'); })(),
        from: num(sc.from == null ? D.scan.from : sc.from, 'Début de plage', 0, 255, true),
        to: num(sc.to == null ? D.scan.to : sc.to, 'Fin de plage', 0, 255, true)
      }
    };
    return out;
  };

  RF.defaultSettings = function () { return RF.validateSettings({}); };

  RF.loadSettings = function (storage) {
    try {
      var st = storage || root.localStorage;
      var text = st.getItem(KEY);
      return text ? RF.validateSettings(JSON.parse(text)) : RF.defaultSettings();
    } catch (e) { return RF.defaultSettings(); }
  };
  /* Renvoie true si la sauvegarde a réussi. */
  RF.saveSettings = function (settings, storage) {
    try { (storage || root.localStorage).setItem(KEY, JSON.stringify(settings)); return true; } catch (e) { return false; }
  };
})(typeof window !== 'undefined' ? window : global);
