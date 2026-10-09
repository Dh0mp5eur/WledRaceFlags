/* File de délai et synchro TV (de sync/delay.py et sync/nascar.py). */
(function (root) {
  'use strict';
  var RF = root.RF;

  function EventDelayQueue() { this._events = []; this._seq = 0; }
  EventDelayQueue.prototype.schedule = function (event, delaySeconds, now) {
    var cur = now == null ? RF.clock() : now;
    this._events.push({ fireAt: cur + Math.max(0, delaySeconds), seq: this._seq++, event: event });
    this._events.sort(function (a, b) { return a.fireAt - b.fireAt || a.seq - b.seq; });
  };
  /* Renvoie le dernier événement échu et écarte les plus anciens. */
  EventDelayQueue.prototype.popLatestReady = function (now) {
    var cur = now == null ? RF.clock() : now, last = null;
    while (this._events.length && this._events[0].fireAt <= cur) last = this._events.shift();
    return last ? last.event : null;
  };
  EventDelayQueue.prototype.clear = function () { this._events = []; };
  EventDelayQueue.prototype.size = function () { return this._events.length; };

  function NascarTvSynchronizer(opts) {
    this._initial = opts.initialTvLap;
    this._fallback = opts.fallbackLapSeconds || 45;
    this._max = opts.maximumDelay || 600;
    this._startedAt = opts.startedAt == null ? RF.clock() : opts.startedAt;
  }
  NascarTvSynchronizer.prototype.delaySeconds = function (snapshot, now) {
    if (snapshot.lap == null) return 0;
    var lapSeconds = snapshot.metadata && snapshot.metadata.average_lap_seconds;
    if (typeof lapSeconds !== 'number' || !(lapSeconds > 0)) lapSeconds = this._fallback;
    var cur = now == null ? RF.clock() : now;
    var elapsed = Math.max(0, cur - this._startedAt);
    var tvLap = this._initial + elapsed / lapSeconds;
    return Math.min(Math.max(0, (snapshot.lap - tvLap) * lapSeconds), this._max);
  };

  /* Retard fixe, en secondes, pour une diffusion TV ou un flux vidéo en retard sur le chronométrage.
     Réglable en cours de course : le nouveau retard s'applique aux prochains drapeaux. */
  function FixedDelaySynchronizer(opts) { this._delay = Math.max(0, (opts && opts.delaySeconds) || 0); }
  FixedDelaySynchronizer.prototype.setDelay = function (seconds) { this._delay = Math.max(0, +seconds || 0); };
  FixedDelaySynchronizer.prototype.getDelay = function () { return this._delay; };
  /* Premier relevé après le démarrage : on ignore depuis quand l'état dure, donc il est appliqué tout de suite plutôt que retardé. */
  FixedDelaySynchronizer.prototype.delaySeconds = function (snapshot, now, isInitial) { return isInitial ? 0 : this._delay; };

  /* Retard de la diffusion, déduit de l'horloge de course lue à l'écran et de celle du chronométrage au même instant.
     « remaining » : la diffusion en retard affiche encore plus de temps restant. « elapsed » : elle affiche moins de temps écoulé. */
  RF.streamDelaySeconds = function (kind, typedSeconds, timingSeconds) {
    return Math.round(kind === 'elapsed' ? timingSeconds - typedSeconds : typedSeconds - timingSeconds);
  };

  RF.FixedDelaySynchronizer = FixedDelaySynchronizer;
  RF.EventDelayQueue = EventDelayQueue;
  RF.NascarTvSynchronizer = NascarTvSynchronizer;
})(typeof window !== 'undefined' ? window : global);
