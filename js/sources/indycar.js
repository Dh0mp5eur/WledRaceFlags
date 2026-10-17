/* Source NTT IndyCar Series et INDY NXT : flux du leaderboard officiel (Azure Blob, sans CDN), un seul fichier pour les deux séries.
   timing_results.heartbeat : currentFlag / SessionStatus (GREEN, YELLOW, RED, WHITE, CHECKERED, WARM, COLD), SessionType (P, Q, R), Series (I, L),
   lapNumber (tours finis du leader) et totalLaps en course, overallTimeToGo. CORS : seule l'origine exacte http://localhost:3000 est autorisée. */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var INDYCAR_API = 'https://indycar.blob.core.windows.net/racecontrol';
  var ALLOWED_ORIGIN = 'http://localhost:3000';
  var SERIES = { I: 'NTT IndyCar Series', L: 'INDY NXT' };

  /* Ordre important : « checkered » contient « red », donc le damier est testé avant le rouge.
     WHITE (dernier tour) : la course continue sous vert. WARM (tours de chauffe), COLD (piste fermée) : état inconnu. */
  function resolveFlag(value) {
    var n = typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]+/g, '') : '';
    if (!n) return F.UNKNOWN;
    if (n.indexOf('checker') !== -1 || n.indexOf('chequer') !== -1) return F.CHEQUERED;
    if (n.indexOf('red') !== -1) return F.RED;
    if (n.indexOf('yellow') !== -1 || n.indexOf('caution') !== -1) return F.YELLOW;
    if (n.indexOf('green') !== -1 || n.indexOf('white') !== -1) return F.GREEN;
    return F.UNKNOWN;
  }
  function optionalInt(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function pageOrigin() { try { return root.location && /^https?:$/.test(root.location.protocol) ? root.location.origin : null; } catch (e) { return null; } }

  /* opts : apiUrl, series ('I', 'L' ou 'all'), raceOnly (course seulement), timeout (s). */
  function IndycarSource(opts) {
    opts = opts || {};
    this.name = 'indycar';
    this._url = (opts.apiUrl || INDYCAR_API).replace(/\/+$/, '') + '/timingscoring-ris.json';
    this._series = opts.series || 'I';
    this._raceOnly = opts.raceOnly !== false;
    this._timeoutMs = (opts.timeout || 10) * 1000;
    this._signal = null;
  }
  IndycarSource.prototype.setSignal = function (s) { this._signal = s; };
  IndycarSource.prototype.close = function () {};

  IndycarSource.prototype._load = function () {
    var self = this;
    return RF.fetchJson(self._url + '?' + Date.now(), {}, self._timeoutMs, self._signal).catch(function (e) {
      var origin = pageOrigin();
      if (origin && origin !== ALLOWED_ORIGIN && e && e.name === 'TypeError' && !(self._signal && self._signal.aborted))
        throw RF.SourceError(RF.t('err.indycar.origin', { origin: origin, allowed: ALLOWED_ORIGIN }));      // refus CORS : le navigateur ne dit que « Failed to fetch »
      throw RF.SourceError(RF.t('err.indycar.readFailed', { detail: e && e.message || e }));
    });
  };

  IndycarSource.prototype.poll = function () {
    var self = this;
    return self._load().then(function (doc) {
      var hb = doc && doc.timing_results && doc.timing_results.heartbeat;
      if (!hb || typeof hb !== 'object') throw RF.SourceError(RF.t('err.indycar.badData'));
      var type = String(hb.SessionType || '').toUpperCase(), isRace = type === 'R';
      var flagText = hb.currentFlag || hb.SessionStatus || null;
      var flag = resolveFlag(flagText), raw = flagText;
      var lapsDone = optionalInt(hb.lapNumber), total = optionalInt(hb.totalLaps);
      if (total !== null && total <= 0) total = null;
      var lap = null;
      if (isRace && lapsDone !== null) lap = flag === F.CHEQUERED ? lapsDone : total ? Math.min(lapsDone + 1, total) : lapsDone + 1;   // tour en cours du leader
      var remaining = isRace && total ? null : RF.parseDuration(hb.overallTimeToGo);          // course aux tours : le temps restant n'a pas de sens
      var meta = { series_name: SERIES[hb.Series] || hb.Series || null, event_name: hb.eventName || null, session_name: hb.SessionName || null,
                   session_type: type || null, track: hb.trackName || null, flag_text: flagText };
      if (self._series !== 'all' && hb.Series !== self._series) {
        flag = F.UNKNOWN; raw = RF.t('err.indycar.otherSeries', { series: SERIES[self._series] || self._series, current: meta.series_name || '?' });
      } else if (self._raceOnly && !isRace) {
        flag = F.UNKNOWN; raw = RF.t('err.indycar.notRace', { session: hb.SessionName || type || '?' });
      }
      return RF.makeSnapshot({ source: self.name, flag: flag, rawState: raw, lap: lap, totalLaps: isRace ? total : null,
                               remainingSeconds: remaining, metadata: meta });
    });
  };

  RF.IndycarSource = IndycarSource;
  RF.INDYCAR_ALLOWED_ORIGIN = ALLOWED_ORIGIN;
  RF._indycarInternals = { resolveFlag: resolveFlag };
})(typeof window !== 'undefined' ? window : global);
