/* Import d'une course NASCAR historique (de nascar_history.py). */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var ARCHIVE = 'https://cf.nascar.com/cacher';
  var SERIES = { cup: 1, xfinity: 2, truck: 3 };
  var HIST = { 1: F.GREEN, 2: F.YELLOW, 3: F.RED, 4: F.CHEQUERED, 5: F.CHEQUERED, 7: F.YELLOW };

  function positiveInt(v, label) {
    var n = typeof v === 'boolean' ? NaN : parseInt(v, 10);
    if (!(n > 0)) throw new Error('Le ' + label + ' NASCAR est invalide');
    return n;
  }
  function parseRaceDuration(v) {
    if (typeof v !== 'string') return null;
    var p = v.split(':');
    if (p.length !== 3) return null;
    var n = p.map(parseFloat);
    if (n.some(function (x) { return !isFinite(x); })) return null;
    var d = n[0] * 3600 + n[1] * 60 + n[2];
    return isFinite(d) && d > 0 ? d : null;
  }
  function entries(obj) { return Object.keys(obj).map(function (k) { return [k, obj[k]]; }); }
  function notesByLap(data) {
    var res = {};
    if (!data || typeof data.laps !== 'object' || data.laps === null || Array.isArray(data.laps)) return res;
    entries(data.laps).forEach(function (e) {
      var lap = parseInt(e[0], 10);
      if (isNaN(lap) || !Array.isArray(e[1])) return;
      var texts = e[1].filter(function (i) { return i && typeof i.Note === 'string'; }).map(function (i) { return i.Note; });
      if (texts.length) res[lap] = texts.join(' | ');
    });
    return res;
  }
  function noteFlagsByLap(data) {
    var res = {};
    if (!data || typeof data.laps !== 'object' || data.laps === null || Array.isArray(data.laps)) return res;
    entries(data.laps).forEach(function (e) {
      var lap = parseInt(e[0], 10);
      if (isNaN(lap) || !Array.isArray(e[1])) return;
      e[1].forEach(function (i) {
        var f = i && parseInt(i.FlagState, 10);
        if (i && !isNaN(f) && HIST[f] !== undefined) res[lap] = f;
      });
    });
    return res;
  }
  function redFlagDelays(data) {
    var out = [], notes = notesByLap(data);
    Object.keys(notes).forEach(function (lap) {
      var m = /red flag time:\s*(?:(\d+):)?(\d+):(\d+)/i.exec(notes[lap]);
      if (m) out.push([parseInt(lap, 10), (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3])]);
    });
    return out;
  }
  function lapOffsets(data, totalLaps, official) {
    if (!data || !Array.isArray(data.laps)) throw new Error('Les temps au tour NASCAR sont invalides');
    var byLap = {};
    data.laps.forEach(function (driver) {
      if (!driver || !Array.isArray(driver.Laps)) return;
      driver.Laps.forEach(function (it) {
        if (!it) return;
        var lap = parseInt(it.Lap, 10), t = parseFloat(it.LapTime), pos = parseInt(it.RunningPos, 10);
        if (isNaN(lap) || isNaN(pos) || !isFinite(t)) return;
        if (lap >= 1 && lap <= totalLaps && t > 0) (byLap[lap] = byLap[lap] || []).push([pos, t]);
      });
    });
    var known = [];
    Object.keys(byLap).forEach(function (l) { byLap[l].forEach(function (r) { known.push(r[1]); }); });
    if (!known.length) throw new Error('Aucun temps au tour NASCAR exploitable');
    var fallback = RF.median(known), durations = [];
    for (var lap = 1; lap <= totalLaps; lap++) {
      var rows = byLap[lap] || [];
      var leaders = rows.filter(function (r) { return r[0] === 1; }).map(function (r) { return r[1]; });
      durations.push(leaders.length ? leaders[0] : rows.length ? RF.median(rows.map(function (r) { return r[1]; })) : fallback);
    }
    var measured = durations.reduce(function (a, b) { return a + b; }, 0);
    var scale = official != null && measured > 0 ? official / measured : 1;
    var offsets = [0];
    durations.forEach(function (d) { offsets.push(offsets[offsets.length - 1] + d * scale); });
    return offsets;
  }
  function raceStartTime(race) {
    if (Array.isArray(race.schedule)) {
      for (var i = 0; i < race.schedule.length; i++) {
        var it = race.schedule[i];
        if (it && it.run_type === 3 && typeof it.start_time_utc === 'string') {
          var s = it.start_time_utc;
          var d = RF.parseDate(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
          if (d) return d;
        }
      }
    }
    return new Date();
  }
  function findRace(data, seriesId, raceId) {
    if (!data || typeof data !== 'object') throw new Error('La liste des courses NASCAR est invalide');
    var races = data['series_' + seriesId];
    if (!Array.isArray(races)) throw new Error('La série NASCAR est absente de la liste des courses');
    for (var i = 0; i < races.length; i++) if (races[i] && races[i].race_id === raceId) return races[i];
    throw new Error('Course NASCAR ' + raceId + ' introuvable');
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  function buildRecording(o) {
    var race = o.race, lapTimes = o.lapTimes, lapNotes = o.lapNotes;
    var totalLaps = positiveInt(race.actual_laps || race.scheduled_laps, 'nombre de tours');
    var official = parseRaceDuration(race.total_race_time);
    var offsets = lapOffsets(lapTimes, totalLaps, official);
    var notes = notesByLap(lapNotes), delays = redFlagDelays(lapNotes);
    var rawFlags = lapTimes && lapTimes.flags;
    if (!Array.isArray(rawFlags)) throw new Error('La chronologie des drapeaux NASCAR est absente');
    var start = raceStartTime(race);
    var byLap = {};
    rawFlags.forEach(function (it) {
      var lap = it && parseInt(it.LapsCompleted, 10), f = it && parseInt(it.FlagState, 10);
      if (it && !isNaN(lap) && !isNaN(f)) byLap[lap] = f;
    });
    var nf = noteFlagsByLap(lapNotes);
    Object.keys(nf).forEach(function (l) { byLap[l] = nf[l]; });

    var transitions = [], previous = null;
    Object.keys(byLap).map(Number).sort(function (a, b) { return a - b; }).forEach(function (lap) {
      var raw = byLap[lap], flag = HIST[raw] || F.UNKNOWN;
      if (flag === F.UNKNOWN || flag === previous) return;
      transitions.push([lap, raw, flag]); previous = flag;
    });
    if (!transitions.length) throw new Error('Aucune transition de drapeau NASCAR exploitable');
    if (transitions[0][2] === F.GREEN) transitions[0] = [0, transitions[0][1], transitions[0][2]];
    if (transitions[transitions.length - 1][2] !== F.CHEQUERED) transitions.push([totalLaps, 4, F.CHEQUERED]);

    function delayBefore(lap) { return delays.reduce(function (s, d) { return d[0] < lap ? s + d[1] : s; }, 0); }
    var events = transitions.map(function (t) {
      var lap = Math.min(Math.max(t[0], 0), totalLaps);
      var offset = offsets[lap] + delayBefore(lap);
      return {
        offset: round3(offset), source: 'nascar', flag: t[2],
        occurred_at: new Date(start.getTime() + offset * 1000).toISOString(),
        raw_state: t[1], lap: lap, total_laps: totalLaps, remaining_seconds: null,
        metadata: { historical: true, timing: 'estimated_from_leader_lap_times', note: notes[lap] === undefined ? null : notes[lap] }
      };
    });
    var timeline = [];
    for (var lap = 1; lap <= totalLaps; lap++) timeline.push({ lap: lap, offset: round3(offsets[lap - 1] + delayBefore(lap)) });
    return {
      format: RF.RECORDING_FORMAT, version: RF.RECORDING_VERSION, source: 'nascar',
      name: o.name || String(race.race_name || 'NASCAR ' + race.race_id), started_at: start.toISOString(),
      metadata: {
        year: race.race_season, series: o.series, race_id: race.race_id, track: race.track_name, total_laps: totalLaps,
        official_duration_seconds: official, red_flag_delay_seconds: delays.reduce(function (s, d) { return s + d[1]; }, 0),
        timing: 'estimated_from_leader_lap_times'
      },
      lap_timeline: timeline, events: events
    };
  }

  /* Télécharge les trois fichiers d'archive et construit l'enregistrement. */
  RF.importNascarRace = function (o) {
    var year = parseInt(o.year, 10), raceId = parseInt(o.raceId, 10), seriesId = SERIES[o.series];
    if (!(year >= 2000 && year <= 2100)) return Promise.reject(new Error("L'année NASCAR est invalide"));
    if (!seriesId) return Promise.reject(new Error('Série NASCAR inconnue: ' + o.series));
    if (!(raceId > 0)) return Promise.reject(new Error("L'identifiant de course doit être supérieur à zéro"));
    var base = (o.base || ARCHIVE) + '/' + year;
    function get(url) { return RF.fetchJson(url, {}, 30000).catch(function (e) { throw new Error('Impossible de télécharger ' + url + ': ' + e.message); }); }
    return get(base + '/race_list_basic.json').then(function (list) {
      var race = findRace(list, seriesId, raceId);
      return Promise.all([get(base + '/' + seriesId + '/' + raceId + '/lap-times.json'),
                          get(base + '/' + seriesId + '/' + raceId + '/lap-notes.json')]).then(function (r) {
        return buildRecording({ race: race, lapTimes: r[0], lapNotes: r[1], series: o.series, name: o.name });
      });
    });
  };
  /* Courses déjà partantes d'une saison et d'une série, les plus récentes d'abord. race_date est l'heure locale de l'Est sans fuseau :
     on la lit en UTC-5 pour ne proposer une course qu'environ une heure après son départ. */
  RF.listNascarRaces = function (year, series, opts) {
    opts = opts || {};
    var seriesId = SERIES[series], y = parseInt(year, 10);
    if (!(y >= 2000 && y <= 2100)) return Promise.reject(new Error("L'année NASCAR est invalide"));
    if (!seriesId) return Promise.reject(new Error('Série NASCAR inconnue: ' + series));
    var now = opts.now == null ? Date.now() : opts.now;
    return RF.fetchJson((opts.base || ARCHIVE) + '/' + y + '/race_list_basic.json', {}, 30000).then(function (list) {
      var races = list && list['series_' + seriesId];
      if (!Array.isArray(races)) throw new Error('Aucune course NASCAR pour cette série et cette année');
      return races.filter(function (r) {
        if (!r || !r.race_id || typeof r.race_date !== 'string') return false;
        var t = Date.parse(r.race_date.slice(0, 19) + '-05:00');
        return !isNaN(t) && t <= now;
      }).map(function (r) {
        return { id: r.race_id, name: String(r.race_name || 'Course ' + r.race_id), track: r.track_name || '', date: r.race_date.slice(0, 10),
                 laps: r.actual_laps || r.scheduled_laps || null };
      }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
    }, function (e) { throw new Error('Impossible de lire la liste des courses NASCAR: ' + (e && e.message || e)); });
  };
  RF.buildNascarRecording = buildRecording;
})(typeof window !== 'undefined' ? window : global);
