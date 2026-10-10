/* Boucle de scrutation (de application.py). Asynchrone, arrêt via AbortSignal. */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;

  function progressSuffix(ev) {
    if (ev.remainingSeconds != null) return RF.t('engine.suffixRemaining', { time: RF.formatDuration(ev.remainingSeconds) });
    if (ev.lap != null) return RF.t('engine.suffixLap', { lap: ev.lap });
    return '';
  }

  /* opts: source, output, pollInterval, synchronizer, observers[], signal, onLog(kind,msg), onProgress(snapshot), onFlag(event) */
  function RaceFlagEngine(opts) {
    this.source = opts.source; this.output = opts.output;
    this.pollInterval = opts.pollInterval; this.sync = opts.synchronizer || null;
    this.observers = opts.observers || [];
    this.signal = opts.signal;
    this.skipInitialGreen = !!opts.skipInitialGreen;
    this.log = opts.onLog || function () {};
    this.onProgress = opts.onProgress || function () {};
    this.onFlag = opts.onFlag || function () {};
    this.clock = opts.clock || RF.clock;
    this.delayed = new RF.EventDelayQueue();
    this.lastSeen = null; this.lastApplied = null;
  }
  RaceFlagEngine.prototype.run = function () {
    var self = this, signal = self.signal;
    var errorDelay = Math.max(self.pollInterval, 0.1);
    function finish() {
      self.delayed.clear();
      try { self.source.close(); } catch (e) {}
      self.observers.forEach(function (o) { try { o.close(); } catch (e) { self.log('error', RF.t('engine.recorderError', { detail: e.message })); } });
      return Promise.resolve(self.output.close()).catch(function (e) { self.log('error', RF.t('log.outputError', { detail: e.message })); });
    }
    function loop() {
      if (signal.aborted) return;
      return self._applyReady().then(function () {
        try { self.output.checkHealth(); } catch (e) { self.log('error', RF.t('log.outputError', { detail: e.message })); }
        return self.source.poll().then(function (snapshot) {
          errorDelay = Math.max(self.pollInterval, 0.1);
          self.onProgress(snapshot);
          return self._process(snapshot).then(function () { return self._sleep(self.pollInterval); });
        }, function (e) {
          if (RF.isError(e, 'SourceNotReady')) return self._sleep(e.waitSeconds);
          if (RF.isError(e, 'SourceFinished')) { self.log('info', RF.t('engine.sourceEnded')); self.finished = true; return; }
          if (signal.aborted) return;
          self.log('error', RF.t('engine.sourceError', { detail: e && e.message || e }));
          var d = errorDelay; errorDelay = Math.min(errorDelay * 2, 60);
          return self._sleep(d);
        });
      }).then(function () { if (!self.finished) return loop(); });
    }
    if (self.source.setSignal) self.source.setSignal(signal);
    return Promise.resolve().then(loop).then(finish, function (e) { return finish().then(function () { throw e; }); });
  };
  /* Pause annulable par l'arrêt de la course, et réveillable par wake() (par exemple après un recalage du replay). */
  RaceFlagEngine.prototype._sleep = function (seconds) {
    var self = this, child = new AbortController(), signal = self.signal;
    var onAbort = function () { child.abort(); };
    signal.addEventListener('abort', onAbort);
    self._wake = function () { child.abort(); };
    return RF.sleep(seconds, child.signal).then(function (aborted) {
      signal.removeEventListener('abort', onAbort); self._wake = null; return aborted;
    });
  };
  /* Interrompt l'attente en cours : la source est interrogée tout de suite. */
  RaceFlagEngine.prototype.wake = function () { if (this._wake) this._wake(); };
  RaceFlagEngine.prototype._process = function (snapshot) {
    var self = this;
    if (snapshot.flag === self.lastSeen) return Promise.resolve();
    var first = self.lastSeen === null;
    self.lastSeen = snapshot.flag;
    self.delayed.clear();
    var event = RF.eventFromSnapshot(snapshot);
    self.observers.forEach(function (o) { o.onEvent(event); });
    if (snapshot.flag === F.UNKNOWN) {
      self.log('warn', RF.t('engine.unknownState', { state: JSON.stringify(snapshot.rawState) }));
      return Promise.resolve();
    }
    /* Un vert ou un damier qui n'est pas annoncé n'est pas un événement : aucun effet.
       - démarrage d'un suivi live en cours de course (skipInitialGreen), le premier relevé est l'état en vigueur ;
       - replay positionné en cours de course, au lancement ou à un recalage (metadata.replay_seek).
       Les états persistants (jaune, rouge) sont appliqués, et un vert qui suit un état inconnu (avant le départ) l'est aussi.
       Le départ de course d'un replay (offset 0) est un événement annoncé : il joue l'effet. */
    var seek = !!(snapshot.metadata && snapshot.metadata.replay_seek);
    if ((snapshot.flag === F.GREEN || snapshot.flag === F.CHEQUERED) && ((first && self.skipInitialGreen) || seek)) return self._quiet(event, seek);
    var delay = self.sync ? self.sync.delaySeconds(snapshot, self.clock(), first) : 0;
    if (delay > 0) {
      self.delayed.schedule(event, delay, self.clock());
      self.log('info', RF.t('engine.scheduled', { flag: event.flag, progress: progressSuffix(event), seconds: Math.round(delay) }));
      return Promise.resolve();
    }
    return self._apply(event);
  };
  /* Prend acte d'un état normal non annoncé sans jouer d'effet. Si un jaune ou un rouge tenait la bande (recalage depuis
     une neutralisation vers un point sous vert), on arrête cet effet et on rend la main, sans clignotement. */
  RaceFlagEngine.prototype._quiet = function (event, seek) {
    var self = this, held = self.lastApplied === F.YELLOW || self.lastApplied === F.RED;
    self.lastApplied = event.flag;
    self.onFlag(event);
    self.log('info', RF.t(seek ? 'engine.quietReplay' : 'engine.quietLive', { flag: event.flag, progress: progressSuffix(event), held: held ? RF.t('engine.heldStopped') : '' }));
    if (!held) return Promise.resolve();
    return Promise.resolve(self.output.release()).then(null, function (err) { self.log('error', RF.t('log.outputError', { detail: err.message })); });
  };
  RaceFlagEngine.prototype._applyReady = function () {
    var ev = this.delayed.popLatestReady(this.clock());
    return ev ? this._apply(ev) : Promise.resolve();
  };
  RaceFlagEngine.prototype._apply = function (event) {
    var self = this;
    if (event.flag === self.lastApplied) return Promise.resolve();
    return Promise.resolve(self.output.apply(event)).then(function () {
      self.lastApplied = event.flag;
      self.onFlag(event);
      self.log('flag', '[FLAG] ' + event.flag + progressSuffix(event));
    }, function (e) { self.log('error', RF.t('log.outputError', { detail: e.message })); });
  };

  RF.RaceFlagEngine = RaceFlagEngine;
  RF.progressSuffix = progressSuffix;
})(typeof window !== 'undefined' ? window : global);
