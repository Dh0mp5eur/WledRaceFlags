/* Source GT World Challenge Europe (SRO), chronométrage Swiss Timing : JSON public, CORS « * » (utilisable depuis n'importe quelle page).
   Saison -> meeting actif -> programme -> course GTWC (Endurance ou Sprint Cup) -> chrono de la séance (UntInfo : TrackFlag, ChequeredFlag, RemainingTime). */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var SRO_API = 'https://ps-cache.web.swisstiming.com/node/db/RAC_PROD';
  /* TrackFlag : codes du client officiel (puissances de 2). 268435456 = tour de chauffe, 0 = rien : état inconnu. */
  var BIT = { GREEN: 1, YELLOW: 4, RED: 8, SAFETY_CAR: 32, CODE60: 64 };
  var STATE = { NOT_STARTED: 0, RUNNING: 1, FINISHED: 2 };
  var REDISCOVER_MS = 60000;      // tant qu'aucune course ne roule, le programme est relu au plus une fois par minute
  var MISSING_RETRY_MS = 20000;   // chrono pas encore créé (404 avant le départ) : nouvel essai toutes les 20 s
  var RESYNC_MS = 180000;         // nouveau document qui annonce une fin plus tardive de plus de 3 min : l'horloge a été arrêtée, on repart de sa valeur

  function values(x) {
    if (Array.isArray(x)) return x;
    return x && typeof x === 'object' ? Object.keys(x).map(function (k) { return x[k]; }) : [];
  }
  /* « 17.10.2026 17:00:00 » (heure du circuit) -> « 2026-10-17 17:00:00 », triable. */
  function sortable(d) {
    var m = /^(\d\d)\.(\d\d)\.(\d{4})\s+(.*)$/.exec(String(d || ''));
    return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] : '';
  }
  /* Le damier passe avant tout : ChequeredFlag est un booléen à part, TrackFlag peut rester à 1 après l'arrivée. */
  function resolveFlag(info) {
    if (!info || typeof info !== 'object') return F.UNKNOWN;
    if (info.ChequeredFlag === true) return F.CHEQUERED;
    var f = Number(info.TrackFlag);
    if (!isFinite(f) || f <= 0) return F.UNKNOWN;
    if (f & BIT.RED) return F.RED;
    if (f & (BIT.YELLOW | BIT.SAFETY_CAR | BIT.CODE60)) return F.YELLOW;
    if (f & BIT.GREEN) return F.GREEN;
    return F.UNKNOWN;
  }
  /* Tour du leader (ListIndex 0) : UntInfo n'a pas de compteur de tours. */
  function leaderLap(results) {
    var lead = values(results).filter(function (r) { return r && r.ListIndex === 0; })[0];
    var n = lead && lead.MainResult ? parseInt(lead.MainResult.TotalLapCount, 10) : NaN;
    return isNaN(n) ? null : n;
  }
  /* Course à suivre parmi les courses GTWC des meetings actifs : en cours, sinon la prochaine, sinon la dernière terminée. */
  function pickUnit(candidates) {
    function by(state) { return candidates.filter(function (c) { return c.state === state; }).sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }); }
    var running = by(STATE.RUNNING), next = by(STATE.NOT_STARTED), done = by(STATE.FINISHED);
    return running.length ? running[running.length - 1] : next.length ? next[0] : done.length ? done[done.length - 1] : null;
  }

  /* Série choisie : 'all' (toutes), un identifiant de série Swiss Timing, ou vide (morceau de nom seriesMatch, par défaut le GT World Challenge Europe). */
  function matchSeries(race, series, seriesMatch) {
    if (series === 'all') return true;
    if (series) return String(race.seriesId || '').toLowerCase() === String(series).toLowerCase();
    return String(race.series || '').toLowerCase().indexOf(String(seriesMatch || 'GTWorldChEU').toLowerCase()) !== -1;
  }

  /* opts : apiUrl, series ('all', identifiant de série ou vide), seriesMatch (morceau du nom, sans casse), unitId (course imposée), timeout (s), name, label. */
  function SroSource(opts) {
    opts = opts || {};
    this.name = opts.name || 'gtwc';
    this._label = opts.label || 'SRO';
    this._api = (opts.apiUrl || SRO_API).replace(/\/+$/, '');
    this._seriesSel = opts.series || null;
    this._seriesMatch = opts.seriesMatch || 'GTWorldChEU';
    this._timeoutMs = (opts.timeout || 10) * 1000;
    this._fixed = opts.unitId ? String(opts.unitId).toUpperCase() : null;
    this._unit = null;              // { id, season, name, series, seriesId, meeting, track, begin, state }
    this._discoveredAt = -Infinity;
    this._lastUid = -1;             // compteur de mises à jour du chrono : une copie plus ancienne servie par le CDN est ignorée
    this._last = null;              // dernier document lu (content.full)
    this._endAt = null;             // heure estimée (ms) où le temps restant atteindra zéro, tant que l'horloge de course tourne
    this._missingAt = null;         // heure du dernier 404 du chrono
    this._now = opts.now || function () { return Date.now(); };
    this._signal = null;
  }
  SroSource.prototype.setSignal = function (s) { this._signal = s; };
  SroSource.prototype.close = function () {};

  SroSource.prototype._get = function (path) {
    var self = this;
    return RF.fetchJson(self._api + path, {}, self._timeoutMs, self._signal).then(function (doc) {
      return doc;
    }, function (e) {
      var err = RF.SourceError(RF.t('err.sro.readFailed', { name: self._label, detail: e && e.message || e }));
      err.notFound = /HTTP 404/.test(e && e.message || '');
      throw err;
    });
  };
  function full(doc) { return doc && doc.content && doc.content.full && typeof doc.content.full === 'object' ? doc.content.full : null; }

  SroSource.prototype._season = function () {
    return this._get('/SRO_SEASONS_JSON.json').then(function (doc) {
      var f = full(doc), s = f && f.CurrentSeason;
      if (!s) throw RF.SourceError(RF.t('err.sro.badData', { name: 'SRO' }));
      return String(s);
    });
  };

  /* Courses (Type 0) de toutes les séries des meetings actifs : { season, series: [{ id, name }], races: [...] }, triées par heure de départ. */
  SroSource.prototype._catalog = function () {
    var self = this;
    return self._season().then(function (season) {
      return self._get('/SRO_' + season + '_SEASON_JSON.json').then(function (doc) {
        var f = full(doc);
        if (!f) throw RF.SourceError(RF.t('err.sro.badData', { name: self._label }));
        var meetings = values(f.Meetings).filter(function (m) { return m && m.State === STATE.RUNNING && m.Id; });
        return Promise.all(meetings.map(function (m) {
          return self._get('/SRO_' + season + '_SCHEDULE_' + String(m.Id).toUpperCase() + '_JSON.json').then(function (d) { return { meeting: m, schedule: full(d) || {} }; });
        })).then(function (list) {
          var races = [], series = [], seen = {};
          list.forEach(function (x) {
            var comps = {};
            values(x.schedule.Competitions).forEach(function (c) { if (c && c.Id) comps[c.Id] = c; });
            values(x.schedule.Units).forEach(function (u) {
              var c = u && comps[u.CompetitionId];
              if (!c || u.Type !== 0 || !u.Id) return;                                 // Type 0 : course
              races.push({ id: String(u.Id).toUpperCase(), season: season, name: u.Name, series: c.Name, seriesId: c.SerieId, meeting: x.meeting.Name,
                           track: x.meeting.Location, begin: u.BeginTime, key: sortable(u.BeginTime), state: u.State,
                           duration: RF.parseDuration(u.Duration) });
              if (c.SerieId && !seen[c.SerieId]) { seen[c.SerieId] = true; series.push({ id: c.SerieId, name: c.Name }); }
            });
          });
          races.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
          return { season: season, series: series, races: races };
        });
      });
    });
  };

  SroSource.prototype._discover = function () {
    var self = this;
    self._discoveredAt = self._now();
    return self._catalog().then(function (cat) {
      if (self._fixed) {
        self._unit = cat.races.filter(function (r) { return r.id === self._fixed; })[0] || { id: self._fixed, season: cat.season, state: null };
        return;
      }
      var best = pickUnit(cat.races.filter(function (r) { return matchSeries(r, self._seriesSel, self._seriesMatch); }));
      if (best || !self._unit) self._unit = best;
    });
  };

  SroSource.prototype._ensureUnit = function () {
    var u = this._unit;
    if (u && (this._fixed || u.state === STATE.RUNNING)) return Promise.resolve();
    if (u && this._now() - this._discoveredAt < REDISCOVER_MS) return Promise.resolve();
    return this._discover();
  };

  /* Pas de course à suivre, ou chrono pas encore ouvert : état inconnu (l'appareil garde son état, le vert du départ jouera son effet). */
  SroSource.prototype._waiting = function (text) {
    return RF.makeSnapshot({ source: this.name, flag: F.UNKNOWN, rawState: text, metadata: this._meta() });
  };
  SroSource.prototype._meta = function () {
    var u = this._unit || {};
    return { series_name: u.series || null, event_name: u.meeting || null, session_name: u.name || null, track: u.track || null,
             start_time: u.begin || null, unit_id: u.id || null };
  };

  SroSource.prototype.poll = function () {
    var self = this;
    return self._ensureUnit().then(function () {
      var u = self._unit;
      if (!u) return self._waiting(RF.t('err.sro.noRace', { name: self._label }));
      var notStarted = RF.t('err.sro.notStarted', { race: u.name || u.id, start: u.begin || '?' });
      if (self._missingAt != null && self._now() - self._missingAt < MISSING_RETRY_MS) return self._waiting(notStarted);   // chrono absent il y a peu : pas de requête (404 en console)
      return self._get('/SRO_' + u.season + '_TIMING_' + u.id + '_JSON.json?t=' + self._now()).then(function (doc) {
        var f = full(doc);
        if (!f || !f.UntInfo || typeof f.UntInfo !== 'object') throw RF.SourceError(RF.t('err.sro.badData', { name: self._label }));
        self._missingAt = null;
        var uid = typeof doc.uid === 'number' ? doc.uid : -1;
        var isNew = !(uid >= 0 && uid <= self._lastUid && self._last);
        if (uid >= 0 && uid < self._lastUid && self._last) { f = self._last; uid = self._lastUid; }   // copie périmée du CDN : on garde le document le plus récent
        self._lastUid = uid; self._last = f;
        if (u.state !== STATE.FINISHED) u.state = STATE.RUNNING;                          // le chrono existe : la course a commencé
        var info = f.UntInfo, meta = self._meta(), flag = resolveFlag(info);
        var remaining = self._remaining(RF.parseDuration(info.RemainingTime), flag, isNew);
        meta.sync = uid;
        if (u.duration != null && remaining != null) meta.elapsed = Math.max(0, u.duration - remaining);   // la TV montre souvent le temps écoulé
        return RF.makeSnapshot({
          source: self.name, flag: flag, rawState: 'TrackFlag=' + info.TrackFlag + (info.ChequeredFlag ? ' ChequeredFlag' : ''),
          lap: leaderLap(f.Results), remainingSeconds: remaining, metadata: meta
        });
      }, function (e) {
        if (e && e.notFound) { self._missingAt = self._now(); return self._waiting(notStarted); }
        throw e;
      });
    });
  };

  /* RemainingTime n'est recalculé qu'à chaque nouveau document (toutes les une à deux minutes, constaté le 2026-10-17) et le CDN peut en servir
     une copie vieille de 60 s : tel quel, le temps restant restait figé et l'horloge de la diffusion reculait à chaque relevé.
     Tant que l'horloge de course tourne (vert ou jaune), chaque nouveau document donne une borne haute de l'heure de fin (maintenant + restant,
     puisqu'il a été publié avant d'être lu) : on garde la plus petite et le temps restant défile. Rouge, damier ou départ pas donné : horloge arrêtée. */
  SroSource.prototype._remaining = function (rem, flag, isNew) {
    if (rem == null || (flag !== F.GREEN && flag !== F.YELLOW)) { this._endAt = null; return rem; }
    var now = this._now(), end = now + rem * 1000;
    if (this._endAt == null || (isNew && (end < this._endAt || end - this._endAt > RESYNC_MS))) this._endAt = end;
    return Math.max(0, Math.round((this._endAt - now) / 1000));
  };

  RF.SroSource = SroSource;
  /* Pour les menus de l'onglet : séries et courses des meetings SRO en cours. opts : apiUrl, timeout (s). */
  RF.listSroRaces = function (opts) { return new SroSource(opts)._catalog(); };
  RF.sroMatchSeries = matchSeries;
  RF.SRO_RACE_STATE = STATE;
  RF._sroInternals = { resolveFlag: resolveFlag, leaderLap: leaderLap, pickUnit: pickUnit, sortable: sortable };
})(typeof window !== 'undefined' ? window : global);
