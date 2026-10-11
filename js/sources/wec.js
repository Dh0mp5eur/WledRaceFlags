/* Source griiip (insights.griiip.com) : FIA WEC et ELMS, qui ne diffèrent que par le nom de série (de sources/wec.py).
   Le navigateur ne peut pas fixer Origin/Referer : le serveur n'autorise (CORS) que les pages sur localhost. */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var WEC_API = 'https://insights.griiip.com';
  var WEC_FLAG_MAP = {
    green: F.GREEN, greenflag: F.GREEN,
    yellow: F.YELLOW, yellowflag: F.YELLOW, fcy: F.YELLOW, fullcourseyellow: F.YELLOW,
    sc: F.YELLOW, safetycar: F.YELLOW, slowzone: F.YELLOW, code60: F.YELLOW,
    red: F.RED, redflag: F.RED,
    chequered: F.CHEQUERED, chequeredflag: F.CHEQUERED, checkered: F.CHEQUERED,
    checkeredflag: F.CHEQUERED, chequeredyellow: F.CHEQUERED
  };

  function optionalInt(value, field, label) {
    if (value == null) return null;
    if (typeof value === 'boolean') throw RF.SourceError(RF.t('err.griiip.badField', { name: label, field: field, value: value }));
    var n = parseInt(value, 10);
    if (isNaN(n)) throw RF.SourceError(RF.t('err.griiip.badField', { name: label, field: field, value: JSON.stringify(value) }));
    return n;
  }
  function normalizeFlag(v) {
    return typeof v === 'string' ? v.toLowerCase().replace(/[ _-]/g, '') : '';
  }
  function resolveFlag(value) {
    var n = normalizeFlag(value);
    if (Object.prototype.hasOwnProperty.call(WEC_FLAG_MAP, n)) return WEC_FLAG_MAP[n];
    if (n.indexOf('chequered') !== -1 || n.indexOf('checkered') !== -1) return F.CHEQUERED;
    if (n.indexOf('yellow') !== -1 || n.indexOf('safetycar') !== -1 || n.indexOf('fcy') === 0 ||
        n.indexOf('slowzone') !== -1 || n.indexOf('code60') !== -1) return F.YELLOW;
    if (n.indexOf('red') !== -1) return F.RED;
    if (n.indexOf('green') !== -1) return F.GREEN;
    return F.UNKNOWN;
  }
  function latestTrackFlag(flags) {
    for (var i = flags.length - 1; i >= 0; i--) {
      var item = flags[i];
      if (!item || typeof item !== 'object') continue;
      var sectors = item.sectorNumbers;
      if (sectors != null && !(Array.isArray(sectors) && sectors.length === 0)) continue;
      return item;
    }
    return null;
  }
  function sessionId(item, label) {
    var v = item.sid;
    if (v == null && item.connectionStatus && typeof item.connectionStatus === 'object') v = item.connectionStatus.sid;
    return optionalInt(v, 'sid', label);
  }
  /* Temps écoulé de la session en millisecondes, ou null. Le serveur ne met à jour elapsedTimeMillis que de temps en temps (relevé daté par ts) :
     tant que l'horloge tourne (increment non nul), on ajoute le temps passé depuis, jusqu'à l'heure du serveur (tsNow). Sans cela le temps
     restant restait figé plusieurs minutes (constaté en ELMS, même API que le WEC). */
  function clockElapsedMs(clock) {
    if (!clock || typeof clock !== 'object' || typeof clock.elapsedTimeMillis === 'boolean') return null;
    var ms = parseFloat(clock.elapsedTimeMillis);
    if (!isFinite(ms) || ms < 0) return null;
    var at = Date.parse(clock.ts), now = Date.parse(clock.tsNow);
    if (clock.increment !== 0 && isFinite(at) && isFinite(now) && now > at) ms += now - at;
    return ms;
  }
  function remainingSeconds(item) {
    var ll = item.lengthLimit;
    if (!ll || typeof ll !== 'object' || typeof ll.timeLimitSeconds === 'boolean') return null;
    var total = parseFloat(ll.timeLimitSeconds), el = clockElapsedMs(item.clock);
    if (!isFinite(total) || el === null || total <= 0) return null;
    return Math.max(0, total - el / 1000);
  }
  /* Temps de course écoulé en secondes (pour caler le retard de la diffusion), ou null. */
  function elapsedSeconds(item) {
    var ms = clockElapsedMs(item.clock);
    return ms === null ? null : ms / 1000;
  }
  function sessionMetadata(item) {
    return { event_name: item.eventName, session_name: item.sessionName, series_name: item.seriesName,
             season_name: item.seasonName, start_time: item.startTime };
  }

  /* opts.name : nom de la source dans les instantanés et les enregistrements ('wec', 'elms') ; opts.label : nom affiché dans les messages. */
  function WecSource(opts) {
    opts = opts || {};
    this.name = opts.name || 'wec';
    this._label = opts.label || 'WEC';
    this._api = (opts.apiUrl || WEC_API).replace(/\/+$/, '');
    this._series = opts.seriesName || 'FIA World Endurance Championship';
    this._timeoutMs = (opts.timeout || 10) * 1000;
    this._sessionId = opts.sessionId || null;
    this._meta = {};
    this._signal = null;
  }
  WecSource.prototype.setSignal = function (s) { this._signal = s; };
  WecSource.prototype._get = function (path) {
    var label = this._label;
    return RF.fetchJson(this._api + path, { headers: { Accept: 'application/json' } }, this._timeoutMs, this._signal)
      .catch(function (e) { throw RF.SourceError(RF.t('err.griiip.readFailed', { name: label, detail: e && e.message || e })); });
  };
  WecSource.prototype._discover = function () {
    var self = this;
    return self._get('/live/session-info/?includeViewers=false').then(function (sessions) {
      if (!Array.isArray(sessions)) throw RF.SourceError(RF.t('err.griiip.badSessions', { name: self._label }));
      var best = null;
      sessions.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        if (item.seriesName !== self._series) return;
        if (item.sessionType !== 'Race' || !item.isStarted) return;
        var sid = sessionId(item, self._label);
        if (sid == null) return;
        var start = String(item.startTime || '');
        if (!best || start >= best.start) best = { start: start, sid: sid, item: item };
      });
      if (!best) throw RF.SourceError(RF.t('err.griiip.noRace', { series: self._series }));
      self._sessionId = best.sid;
      self._meta = sessionMetadata(best.item);
    });
  };
  WecSource.prototype._liveStatus = function () {
    var self = this;
    return self._get('/meta/sessions-schedule-live').then(function (sessions) {
      if (!Array.isArray(sessions)) return { flags: null, remaining: null, error: RF.t('err.griiip.badSchedule', { name: self._label }) };
      for (var i = 0; i < sessions.length; i++) {
        var item = sessions[i];
        if (!item || typeof item !== 'object' || sessionId(item, self._label) !== self._sessionId) continue;
        return { flags: Array.isArray(item.sessionFlags) ? item.sessionFlags : null, remaining: remainingSeconds(item), elapsed: elapsedSeconds(item), error: null };
      }
      return { flags: null, remaining: null, error: null };
    }, function (e) { return { flags: null, remaining: null, error: e.message }; });
  };
  WecSource.prototype.poll = function () {
    var self = this;
    var ready = self._sessionId == null ? self._discover() : Promise.resolve();
    return ready.then(function () { return self._liveStatus(); }).then(function (st) {
      if (st.flags) return st;
      return self._get('/live/race-flags/' + self._sessionId).then(function (flags) { st.flags = flags; return st; });
    }).then(function (st) {
      if (!Array.isArray(st.flags)) throw RF.SourceError(RF.t('err.griiip.badFlags', { name: self._label }));
      var entry = latestTrackFlag(st.flags);
      if (!entry) throw RF.SourceError(RF.t('err.griiip.noTrackFlag', { name: self._label, id: self._sessionId }));
      var meta = Object.assign({}, self._meta, { session_id: self._sessionId, race_flag_id: entry.raceFlagID, flag_info: entry.info || '' });
      if (st.elapsed != null) meta.elapsed = st.elapsed;
      if (st.error) meta.progress_error = st.error;
      return RF.makeSnapshot({
        source: self.name, flag: resolveFlag(entry.flag), rawState: entry.flag,
        eventTime: entry.ts ? RF.parseDate(entry.ts) : null,
        lap: optionalInt(entry.lapNumber, 'lapNumber', self._label), remainingSeconds: st.remaining, metadata: meta
      });
    });
  };
  WecSource.prototype.close = function () {};

  RF.WecSource = WecSource;
  RF._wecInternals = { resolveFlag: resolveFlag, latestTrackFlag: latestTrackFlag, remainingSeconds: remainingSeconds, elapsedSeconds: elapsedSeconds };
})(typeof window !== 'undefined' ? window : global);
