/* Source replay (de sources/replay.py). Reçoit le document JSON déjà lu. */
(function (root) {
  'use strict';
  var RF = root.RF;
  RF.RECORDING_FORMAT = 'raceflags-recording';
  RF.RECORDING_VERSION = 1;

  function fail(key, params) { return new Error(RF.t(key, params)); }
  function optInt(v, key, params) {
    if (v == null) return null;
    if (typeof v === 'boolean') throw fail(key, params);
    var n = parseInt(v, 10);
    if (isNaN(n)) throw fail(key, params);
    return n;
  }

  function parseEvent(item, index, defaultSource) {
    if (!item || typeof item !== 'object') throw fail('err.replay.eventInvalid', { index: index });
    var offset = Number(item.offset);
    if (item.offset == null || !isFinite(offset)) throw fail('err.replay.eventOffset', { index: index });
    if (offset < 0) throw fail('err.replay.eventOffsetNegative', { index: index });
    if (!RF.isFlag(item.flag)) throw fail('err.replay.eventFlag', { index: index, flag: item.flag });
    var occurred = RF.parseDate(item.occurred_at);
    if (!occurred) throw fail('err.replay.eventOccurredAt', { index: index });
    var remaining = item.remaining_seconds;
    if (remaining != null) {
      if (typeof remaining === 'boolean') throw fail('err.replay.eventRemaining', { index: index });
      remaining = Number(remaining);
      if (!isFinite(remaining) || remaining < 0) throw fail('err.replay.eventRemaining', { index: index });
    }
    var metadata = item.metadata == null ? {} : item.metadata;
    if (typeof metadata !== 'object' || Array.isArray(metadata)) throw fail('err.replay.eventMetadata', { index: index });
    var source = item.source == null ? defaultSource : item.source;
    if (typeof source !== 'string' || !source) throw fail('err.replay.eventSource', { index: index });
    return {
      offset: offset, effectiveOffset: offset, source: source, flag: item.flag, occurredAt: occurred,
      rawState: item.raw_state === undefined ? null : item.raw_state,
      lap: optInt(item.lap, 'err.replay.eventLap', { index: index }),
      totalLaps: optInt(item.total_laps, 'err.replay.eventTotalLaps', { index: index }),
      remainingSeconds: remaining, metadata: metadata
    };
  }

  function parseLapTimeline(value) {
    if (value == null) return {};
    if (!Array.isArray(value)) throw fail('err.replay.badTimeline');
    var timeline = {}, prev = -1;
    value.forEach(function (item, i) {
      var lap = item && parseInt(item.lap, 10), off = item && Number(item.offset);
      if (!item || !(lap > 0) || timeline[lap] !== undefined || !isFinite(off) || off < prev)
        throw fail('err.replay.badTimelineLap', { index: i });
      timeline[lap] = off; prev = off;
    });
    return timeline;
  }

  function loadRecording(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw fail('err.replay.notObject');
    if (doc.format !== RF.RECORDING_FORMAT) throw fail('err.replay.badFormat');
    if (doc.version !== RF.RECORDING_VERSION) throw fail('err.replay.badVersion', { version: doc.version });
    if (typeof doc.source !== 'string' || !doc.source) throw fail('err.replay.badSource');
    if (!Array.isArray(doc.events) || !doc.events.length) throw fail('err.replay.noEvents');
    var events = doc.events.map(function (it, i) { return parseEvent(it, i, doc.source); });
    for (var i = 1; i < events.length; i++)
      if (events[i].offset < events[i - 1].offset) throw fail('err.replay.offsetsNotIncreasing');
    return { source: doc.source, events: events, timeline: parseLapTimeline(doc.lap_timeline), name: doc.name || null };
  }

  function selectEvents(events, startAt, startLap) {
    var index = 0;
    while (index < events.length && events[index].offset <= startAt) index++;   // bisect_right
    var selected = events.slice(index);
    if (index > 0) {
      var cur = events[index - 1];
      selected.unshift(Object.assign({}, cur, {
        effectiveOffset: startAt, lap: startLap == null ? null : startLap,
        // replay_seek : on se positionne en cours de course, l'état en vigueur n'est pas annoncé par l'enregistrement.
        // Un événement placé exactement au point de départ (le départ de course à l'offset 0) reste, lui, un événement annoncé.
        metadata: { replay_seek_from_offset: cur.offset, replay_seek: startAt > cur.offset }
      }));
    }
    return selected;
  }

  /* Paramètres de lecture : validés avant toute modification de l'état, pour qu'un recalage refusé laisse le replay intact. */
  function parseParams(o) {
    var p = { videoOffset: o.videoOffset || 0, startAt: o.startAt || 0, startLap: o.startLap == null ? null : o.startLap, speed: o.speed == null ? 1 : o.speed };
    if (!isFinite(p.videoOffset) || p.videoOffset < 0) throw fail('err.replay.videoNegative');
    if (!isFinite(p.startAt) || p.startAt < 0) throw fail('err.replay.startNegative');
    if (p.startLap !== null && !(p.startLap > 0)) throw fail('err.replay.lapPositive');
    if (p.startLap !== null && p.startAt) throw fail('err.replay.startAndLap');
    if (!isFinite(p.speed) || p.speed <= 0) throw fail('err.replay.speedPositive');
    return p;
  }

  function ReplaySource(opts) {
    var p = parseParams(opts);
    this._clock = opts.clock || RF.clock;
    var rec = loadRecording(opts.document);
    this._rec = rec;
    // Index des tours (début de chaque tour, en secondes) pour retrouver le tour courant à partir de l'horloge.
    var laps = Object.keys(rec.timeline).map(Number).sort(function (a, b) { return a - b; });
    this._lapNumbers = laps; this._lapOffsets = laps.map(function (l) { return rec.timeline[l]; });
    var meta = opts.document && opts.document.metadata, withTotal = rec.events.filter(function (e) { return e.totalLaps != null; })[0];
    this._totalLaps = (meta && parseInt(meta.total_laps, 10)) || (withTotal ? withTotal.totalLaps : null);
    this._lastEvent = null;
    this._sourceName = rec.source;
    this.name = 'replay:' + rec.source;
    this._apply(p);
  }
  /* Positionne la lecture : l'horloge repart de zéro maintenant, au point de départ demandé. */
  ReplaySource.prototype._apply = function (p) {
    var rec = this._rec, startAt;
    if (p.startLap !== null) {
      if (!Object.keys(rec.timeline).length) throw fail('err.replay.noLapOffsets');
      if (rec.timeline[p.startLap] === undefined) throw fail('err.replay.lapMissing', { lap: p.startLap });
      startAt = rec.timeline[p.startLap];
    } else startAt = p.startAt;
    var events = selectEvents(rec.events, startAt, p.startLap);
    this._videoOffset = p.videoOffset; this._speed = p.speed;
    this._startAt = startAt; this._events = events; this._index = 0;
    this._startedAt = this._clock();
  };
  /* Position courante dans l'enregistrement, en secondes : le replay avance à la vitesse choisie une fois le délai vidéo écoulé. */
  ReplaySource.prototype.position = function () {
    var wall = this._clock() - this._startedAt;
    return this._startAt + Math.max(0, (wall - this._videoOffset) * this._speed);
  };
  /* Tour en cours et nombre total de tours. Calculé à partir de l'horloge : il avance même quand aucun drapeau ne change.
     Sans chronologie des tours (enregistrement fait en direct), on ne connaît que le tour du dernier événement. */
  ReplaySource.prototype.progress = function () {
    var offs = this._lapOffsets, laps = this._lapNumbers;
    if (!offs.length) return this._lastEvent ? { lap: this._lastEvent.lap, totalLaps: this._totalLaps } : null;
    var pos = this.position(), lo = 0, hi = offs.length - 1, found = -1;
    while (lo <= hi) {                                           // dernier tour dont le début est passé
      var mid = (lo + hi) >> 1;
      if (offs[mid] <= pos) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return { lap: laps[found < 0 ? 0 : found], totalLaps: this._totalLaps };
  };
  /* Recale le replay en cours sans le relancer : mêmes paramètres que le constructeur, valables à partir de maintenant. */
  ReplaySource.prototype.resync = function (o) { this._apply(parseParams(o)); };
  ReplaySource.prototype.setSignal = function () {};
  ReplaySource.prototype.poll = function () {
    if (this._index >= this._events.length) return Promise.reject(RF.SourceFinished('finished'));
    var wallElapsed = this._clock() - this._startedAt;
    var replayElapsed = Math.max(0, (wallElapsed - this._videoOffset) * this._speed);
    if (wallElapsed < this._videoOffset) return Promise.reject(RF.SourceNotReady(this._videoOffset - wallElapsed));
    var event = this._events[this._index];
    var target = event.effectiveOffset - this._startAt;
    if (replayElapsed < target) return Promise.reject(RF.SourceNotReady((target - replayElapsed) / this._speed));
    while (this._index + 1 < this._events.length) {
      var next = this._events[this._index + 1];
      if (next.effectiveOffset - this._startAt > replayElapsed) break;
      this._index++; event = next;
    }
    this._index++;
    this._lastEvent = event;
    return Promise.resolve(RF.makeSnapshot({
      source: event.source, flag: event.flag, eventTime: event.occurredAt, rawState: event.rawState,
      lap: event.lap, totalLaps: event.totalLaps, remainingSeconds: event.remainingSeconds, metadata: event.metadata
    }));
  };
  ReplaySource.prototype.close = function () {};

  RF.ReplaySource = ReplaySource;
  RF.loadRecording = loadRecording;
})(typeof window !== 'undefined' ? window : global);
