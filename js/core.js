/* Noyau commun : espace de noms RF, drapeaux, erreurs, utilitaires. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};

  RF.FlagState = Object.freeze({
    GREEN: 'green', YELLOW: 'yellow', RED: 'red', CHEQUERED: 'chequered', UNKNOWN: 'unknown'
  });
  var VALID_FLAGS = Object.keys(RF.FlagState).map(function (k) { return RF.FlagState[k]; });
  RF.isFlag = function (v) { return VALID_FLAGS.indexOf(v) !== -1; };

  function makeError(name) {
    function E(message, extra) {
      var e = new Error(message);
      e.name = name;
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      return e;
    }
    return E;
  }
  RF.SourceError = makeError('SourceError');
  RF.OutputError = makeError('OutputError');
  RF.SourceFinished = makeError('SourceFinished');
  RF.SourceNotReady = function (waitSeconds) {
    var e = new Error(RF.t('err.core.notReady'));
    e.name = 'SourceNotReady';
    e.waitSeconds = Math.max(0, waitSeconds);
    return e;
  };
  RF.isError = function (e, name) { return !!e && e.name === name; };

  /* Horloge monotone en secondes. */
  RF.clock = function () {
    return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
  };

  RF.median = function (values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  RF.formatDuration = function (seconds) {
    var t = Math.max(0, Math.floor(seconds));
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
  };

  /* "HH:MM:SS", "MM:SS" ou "SS" -> secondes ; null si invalide. */
  RF.parseDuration = function (text) {
    if (typeof text === 'number') return isFinite(text) && text >= 0 ? text : null;
    if (typeof text !== 'string' || !text.trim()) return null;
    var parts = text.trim().split(':').map(Number);
    if (parts.length > 3 || parts.some(function (n) { return !isFinite(n) || n < 0; })) return null;
    return parts.reduce(function (acc, n) { return acc * 60 + n; }, 0);
  };

  /* Date.parse tolérant aux fractions de seconde longues (microsecondes). */
  RF.parseDate = function (value) {
    if (value instanceof Date) return value;
    if (typeof value !== 'string') return null;
    var s = value.replace(/(\.\d{3})\d+/, '$1');
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  RF.makeSnapshot = function (o) {
    return {
      source: o.source, flag: o.flag, receivedAt: o.receivedAt || new Date(),
      rawState: o.rawState === undefined ? null : o.rawState,
      eventTime: o.eventTime || null,
      lap: o.lap == null ? null : o.lap,
      totalLaps: o.totalLaps == null ? null : o.totalLaps,
      remainingSeconds: o.remainingSeconds == null ? null : o.remainingSeconds,
      metadata: o.metadata || {}
    };
  };

  RF.eventFromSnapshot = function (s) {
    return {
      source: s.source, flag: s.flag, occurredAt: s.eventTime || s.receivedAt,
      rawState: s.rawState, lap: s.lap, totalLaps: s.totalLaps,
      remainingSeconds: s.remainingSeconds, metadata: s.metadata
    };
  };

  /* fetch avec délai maximal ; renvoie le JSON ou lève une Error. */
  RF.fetchJson = function (url, options, timeoutMs, externalSignal) {
    options = options || {};
    var ctrl = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
    var onAbort = function () { ctrl.abort(); };
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener('abort', onAbort);
    }
    var opts = Object.assign({}, options, { signal: ctrl.signal, cache: 'no-store' });
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).catch(function (e) {
      if (timedOut) throw new Error(RF.t('err.core.timeout', { seconds: Math.round(timeoutMs / 1000 * 10) / 10 }));
      throw e;
    }).then(function (v) { cleanup(); return v; }, function (e) { cleanup(); throw e; });
    function cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };

  /* Pause annulable. Résout true si interrompue par le signal, false sinon.
     Les minuteurs d'un Worker ne sont pas bridés dans les onglets masqués. */
  var worker = null, workerSeq = 0, workerWaiters = {}, workerFailed = false;
  function getWorker() {
    if (worker || workerFailed) return worker;
    try {
      var code = 'onmessage=function(e){var id=e.data.id;setTimeout(function(){postMessage(id)},e.data.ms)}';
      worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      worker.onmessage = function (e) {
        var cb = workerWaiters[e.data];
        if (cb) { delete workerWaiters[e.data]; cb(); }
      };
      worker.onerror = function () { workerFailed = true; worker = null; };
    } catch (e) { workerFailed = true; worker = null; }
    return worker;
  }
  RF.sleep = function (seconds, signal) {
    return new Promise(function (resolve) {
      if (signal && signal.aborted) return resolve(true);
      var done = false, id = null, tid = null;
      function finish(aborted) {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        if (id !== null) delete workerWaiters[id];
        if (tid !== null) clearTimeout(tid);
        resolve(aborted);
      }
      function onAbort() { finish(true); }
      if (signal) signal.addEventListener('abort', onAbort);
      var ms = Math.max(0, seconds * 1000);
      var w = typeof Worker !== 'undefined' ? getWorker() : null;
      if (w) {
        id = ++workerSeq;
        workerWaiters[id] = function () { finish(false); };
        w.postMessage({ id: id, ms: ms });
      } else {
        tid = setTimeout(function () { finish(false); }, ms);
      }
    });
  };

  /* Attente indéfinie jusqu'au signal. */
  RF.waitForAbort = function (signal) {
    return new Promise(function (resolve) {
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', function () { resolve(); });
    });
  };
})(typeof window !== 'undefined' ? window : global);
