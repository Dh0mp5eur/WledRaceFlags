/* Source IMSA WeatherTech SportsCar Championship.
   Flux public de chronométrage (JSON, CORS ouvert) : champs F drapeau, S session, L tour, TR temps restant. */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var IMSA_API = 'https://dcqsrdkhg933g.cloudfront.net';

  /* Ordre important : « checkered » contient « red », donc le damier est testé avant le rouge. */
  function resolveFlag(value) {
    var n = typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]+/g, '') : '';
    if (!n) return F.UNKNOWN;
    if (n.indexOf('checker') !== -1 || n.indexOf('chequer') !== -1 || n.indexOf('finish') !== -1) return F.CHEQUERED;
    if (n.indexOf('red') !== -1) return F.RED;
    if (n.indexOf('yellow') !== -1 || n.indexOf('fcy') !== -1 || n.indexOf('fullcourse') !== -1 || n.indexOf('caution') !== -1 ||
        n.indexOf('safetycar') !== -1 || n.indexOf('code60') !== -1 || n.indexOf('slowzone') !== -1) return F.YELLOW;
    if (n.indexOf('green') !== -1) return F.GREEN;
    return F.UNKNOWN;   // « Warm Up », « Unflagged »… : on garde le dernier état de l'appareil
  }

  function isRaceSession(name) { return /race/i.test(name || '') && !/practice|qualif|warm/i.test(name || ''); }

  function optionalInt(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }

  /* Chargement JSONP par balise <script> : aucun CORS requis. Le CDN d'IMSA ne renvoie pas toujours l'en-tête CORS
     sur le JSON simple (copie en cache), alors que la balise script n'en a pas besoin. Le fichier appelle toujours
     la fonction globale jsonpSessionInfo, quel que soit le paramètre callback. */
  var JSONP_CALLBACK = 'jsonpSessionInfo';
  function loadJsonp(url, timeoutMs, signal) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || !document.head) return reject(new Error('JSONP indisponible'));
      if (signal && signal.aborted) return reject(new Error('annulé'));
      var script = document.createElement('script'), done = false, timer;
      function finish(err, data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        try { delete root[JSONP_CALLBACK]; } catch (e) { root[JSONP_CALLBACK] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(data);
      }
      function onAbort() { finish(new Error('annulé')); }
      if (signal) signal.addEventListener('abort', onAbort);
      root[JSONP_CALLBACK] = function (data) { finish(null, data); };
      script.onerror = function () { finish(new Error('chargement du script impossible')); };
      timer = setTimeout(function () { finish(new Error('délai dépassé (' + Math.round(timeoutMs / 100) / 10 + ' s)')); }, timeoutMs);
      script.async = true;
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
      document.head.appendChild(script);
    });
  }

  function ImsaSource(opts) {
    opts = opts || {};
    this.name = 'imsa';
    var base = (opts.apiUrl || IMSA_API).replace(/\/+$/, '');
    this._url = base + '/SessionInfo.json';
    this._jsonpUrl = base + '/SessionInfo_JSONP.json';
    this._timeoutMs = (opts.timeout || 10) * 1000;
    this._raceOnly = opts.raceOnly !== false;
    this._signal = null;
  }
  ImsaSource.prototype.setSignal = function (s) { this._signal = s; };
  ImsaSource.prototype.poll = function () {
    var self = this;
    return self._load().then(function (info) {
      if (!info || typeof info !== 'object' || Array.isArray(info)) throw RF.SourceError("Le flux IMSA n'est pas un objet JSON");
      var session = info.S || '';
      var remaining = info.TR ? RF.parseDuration(info.TR) : null;
      var meta = { event_name: info.E || null, session_name: session || null, track: info.T || null, flag_text: info.F || null,
                   elapsed: info.TT || null };
      var flag = resolveFlag(info.F), raw = info.F == null ? null : info.F;
      if (self._raceOnly && !isRaceSession(session)) { flag = F.UNKNOWN; raw = 'session sans course: ' + (session || 'inconnue'); }
      return RF.makeSnapshot({ source: self.name, flag: flag, rawState: raw, lap: optionalInt(info.L),
                               remainingSeconds: remaining, metadata: meta });
    }, function (e) {
      if (e && e.name === 'SourceError') throw e;
      throw RF.SourceError('Impossible de lire le flux IMSA: ' + (e && e.message || e));
    });
  };
  /* JSONP d'abord (navigateur), puis JSON direct si la balise script échoue ; JSON direct seul hors navigateur. */
  ImsaSource.prototype._load = function () {
    var self = this;
    var direct = function () { return RF.fetchJson(self._url, {}, self._timeoutMs, self._signal); };
    if (typeof document === 'undefined' || !document.head) return direct();
    return loadJsonp(self._jsonpUrl, self._timeoutMs, self._signal).catch(function (e) {
      if (self._signal && self._signal.aborted) throw e;
      return direct();
    });
  };
  ImsaSource.prototype.close = function () {};

  RF.ImsaSource = ImsaSource;
  RF._imsaInternals = { resolveFlag: resolveFlag, isRaceSession: isRaceSession, loadJsonp: loadJsonp };
})(typeof window !== 'undefined' ? window : global);
