/* Client et sortie WLED (de outputs/wled.py). POST /json/state en text/plain :
   requête "simple" CORS, donc sans pré-vérification OPTIONS. */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var GREEN = [0, 255, 0], YELLOW = [255, 200, 0], RED = [255, 0, 0], OFF = [0, 0, 0];

  RF.normalizeWledUrl = function (input) {
    var s = String(input || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  };

  /* Page en https (version en ligne) : Chrome n'accepte une requête http vers le réseau local qu'avec l'autorisation
     « accès au réseau local », et seulement s'il la sait locale. targetAddressSpace l'annonce, ce qui est indispensable
     pour un nom comme wled.lan (une IP privée ou un nom en .local sont reconnus seuls). Les autres navigateurs ignorent l'option. */
  RF.wledFetchOptions = function (url, options, pageProtocol) {
    if (pageProtocol === undefined) pageProtocol = typeof location !== 'undefined' ? location.protocol : '';
    if (pageProtocol !== 'https:' || !/^http:/i.test(url)) return options;
    return Object.assign({ targetAddressSpace: 'local' }, options);
  };

  function WledClient(opts) {
    this._base = RF.normalizeWledUrl(opts.baseUrl);
    this._timeoutMs = (opts.timeout || 5) * 1000;
    this._fetch = opts.fetchJson || RF.fetchJson;
  }
  WledClient.prototype.postState = function (payload, signal) {
    var self = this;
    return self._fetch(self._base + '/json/state', RF.wledFetchOptions(self._base, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload)
    }), self._timeoutMs, signal).then(function (r) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw RF.OutputError('WLED a retourné une réponse JSON invalide');
      return r;
    }, function (e) {
      if (e && e.name === 'OutputError') throw e;
      throw RF.OutputError('Erreur WLED (' + self._base + '): ' + (e && e.message || e));
    });
  };
  WledClient.prototype.getState = function (signal) {
    var self = this;
    return self._fetch(self._base + '/json/state', RF.wledFetchOptions(self._base, {}), self._timeoutMs, signal);
  };
  WledClient.prototype.takeControl = function () { return this.postState({ lor: 1 }); };
  WledClient.prototype.releaseControl = function () { return this.postState({ lor: 0 }); };
  WledClient.prototype.applyPreset = function (id) { return this.postState({ on: true, ps: id }); };
  WledClient.prototype.solidColor = function (color, brightness) {
    return this.postState({ on: true, bri: brightness, transition: 0, seg: [{ fx: 0, col: [color.slice(), OFF.slice()] }] });
  };
  WledClient.prototype.breathe = function (color, brightness, effectId) {
    return this.postState({ on: true, bri: brightness, seg: [{ fx: effectId, pal: 0, sx: 128, ix: 255, col: [color.slice(), OFF.slice()] }] });
  };

  /* Instantané de l'état à restaurer : preset actif, sinon marche/arrêt, luminosité et segments utilisés. */
  RF.buildRestorePayload = function (state) {
    if (!state || typeof state !== 'object') return null;
    if (typeof state.ps === 'number' && state.ps > 0) return { lor: 0, on: state.on !== false, ps: state.ps };
    var segs = (Array.isArray(state.seg) ? state.seg : []).filter(function (g) { return g && typeof g.id === 'number' && g.stop > g.start; })
      .map(function (g) {
        var o = { id: g.id };
        ['on', 'bri', 'fx', 'sx', 'ix', 'pal', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'col'].forEach(function (k) { if (g[k] !== undefined) o[k] = g[k]; });
        return o;
      });
    if (!segs.length) return null;
    var p = { lor: 0, transition: 0, on: state.on !== false, seg: segs };
    if (typeof state.bri === 'number' && state.bri > 0) p.bri = state.bri;
    return p;
  };

  /* Sortie pour un appareil. Un effet à la fois, annulé par AbortController. */
  function WledOutput(opts) {
    this.client = opts.client || new WledClient({ baseUrl: opts.url, timeout: opts.timeout });
    this.label = opts.label || opts.url;
    this._bri = opts.brightness == null ? 255 : opts.brightness;
    this._blinks = opts.greenBlinks == null ? 3 : opts.greenBlinks;
    this._blinkSeconds = opts.greenBlinkSeconds == null ? 0.5 : opts.greenBlinkSeconds;
    this._breatheId = opts.breatheEffectId == null ? 2 : opts.breatheEffectId;
    this._releaseOnExit = opts.releaseOnExit !== false;
    this._restoreState = opts.restoreState !== false;
    this._saved = null;
    this._presets = {};
    this._presets[F.GREEN] = this._presets[F.CHEQUERED] = opts.greenPreset || null;
    this._presets[F.YELLOW] = opts.yellowPreset || null;
    this._presets[F.RED] = opts.redPreset || null;
    this._ctrl = null; this._task = Promise.resolve(); this._error = null;
  }
  WledOutput.prototype.apply = function (event) {
    var self = this;
    if (event.flag === F.UNKNOWN) return Promise.reject(RF.OutputError('Un état inconnu ne peut pas être envoyé à WLED'));
    var effect = self._effectFor(event.flag);
    return self._stopCurrent().then(function () {
      self._raiseWorkerError();
      var ctrl = self._ctrl = new AbortController();
      return self._captureState().then(function () {
        self._task = self.client.takeControl().then(function () {
          if (ctrl.signal.aborted) return;
          return effect(ctrl.signal);
        }).catch(function (e) {
          if (ctrl.signal.aborted) return;
          self._error = e;
          return self._giveBack().catch(function () {});
        });
      });
    });
  };
  /* Mémorise l'état d'origine une seule fois par course (jamais celui d'un drapeau). */
  WledOutput.prototype._captureState = function () {
    var self = this;
    if (!self._restoreState || self._saved) return Promise.resolve();
    return self.client.getState().then(function (st) { self._saved = RF.buildRestorePayload(st); }, function () { self._saved = null; });
  };
  /* Rend la main : restaure l'état d'origine s'il est connu, sinon simple lor:0. */
  WledOutput.prototype._giveBack = function () {
    var saved = this._saved;
    if (!saved) return this.client.releaseControl();
    this._saved = null;
    var self = this;
    return self.client.postState(saved).catch(function (e) {
      return self.client.releaseControl().then(function () { throw e; });
    });
  };
  WledOutput.prototype.release = function () {
    var self = this;
    return self._stopCurrent().then(function () { self._raiseWorkerError(); return self._giveBack(); });
  };
  /* Requête de dernier recours à la fermeture de l'onglet : restaure l'état mémorisé s'il existe, sinon rend la main. */
  WledOutput.prototype.pagehideRequest = function () {
    return { url: this.client._base + '/json/state', body: JSON.stringify(this._saved || { lor: 0 }) };
  };
  WledOutput.prototype.checkHealth = function () { this._raiseWorkerError(); };
  WledOutput.prototype.close = function () {
    var self = this, firstError = null;
    return self._stopCurrent().then(function () { self._raiseWorkerError(); }).catch(function (e) { firstError = e; })
      .then(function () { return self._releaseOnExit ? self._giveBack() : null; })
      .catch(function (e) { if (!firstError) firstError = e; })
      .then(function () { if (firstError) throw firstError; });
  };
  WledOutput.prototype._effectFor = function (flag) {
    var self = this;
    if (flag === F.GREEN || flag === F.CHEQUERED) return function (s) { return self._green(s); };
    if (flag === F.YELLOW) return function (s) { return self._breathe(F.YELLOW, YELLOW, s); };
    if (flag === F.RED) return function (s) { return self._breathe(F.RED, RED, s); };
    throw RF.OutputError('État WLED non pris en charge: ' + flag);
  };
  WledOutput.prototype._green = function (signal) {
    var self = this, c = self.client, preset = self._presets[F.GREEN];
    if (preset) {
      return c.applyPreset(preset).then(function () { return RF.sleep(self._blinks * self._blinkSeconds * 2, signal); })
        .then(function (aborted) { if (!aborted) return self._giveBack(); });
    }
    var i = 0;
    function step() {
      if (signal.aborted) return;
      if (i++ >= self._blinks) return self._giveBack();
      return c.solidColor(GREEN, self._bri).then(function () { return RF.sleep(self._blinkSeconds, signal); })
        .then(function (aborted) { if (aborted) return; return c.solidColor(OFF, self._bri); })
        .then(function () { if (signal.aborted) return; return RF.sleep(self._blinkSeconds, signal); })
        .then(function (aborted) { if (!aborted) return step(); });
    }
    return step();
  };
  WledOutput.prototype._breathe = function (flag, color, signal) {
    var self = this, c = self.client, preset = self._presets[flag];
    if (preset) return c.applyPreset(preset).then(function () { return RF.waitForAbort(signal); });
    return c.solidColor(color, self._bri).then(function () { return RF.sleep(1.0, signal); }).then(function (aborted) {
      if (aborted) return;
      return c.breathe(color, self._bri, self._breatheId).then(function () { return RF.waitForAbort(signal); });
    });
  };
  WledOutput.prototype._stopCurrent = function () {
    if (this._ctrl) this._ctrl.abort();
    var task = this._task;
    this._ctrl = null;
    return Promise.race([task, RF.sleep(3).then(function () { throw RF.OutputError("L'effet WLED précédent ne s'est pas arrêté"); })]);
  };
  WledOutput.prototype._raiseWorkerError = function () {
    var e = this._error; this._error = null;
    if (e) throw e;
  };

  /* Plusieurs appareils : même drapeau envoyé à tous, les erreurs sont agrégées. */
  function MultiOutput(outputs) { this.outputs = outputs; }
  function settleAll(list, fn) {
    return Promise.all(list.map(function (o) {
      return Promise.resolve().then(function () { return fn(o); }).then(function () { return null; },
        function (e) { return new Error(o.label + ': ' + (e && e.message || e)); });
    })).then(function (errs) {
      errs = errs.filter(Boolean);
      if (errs.length) throw RF.OutputError(errs.map(function (e) { return e.message; }).join(' | '));
    });
  }
  MultiOutput.prototype.apply = function (ev) { return settleAll(this.outputs, function (o) { return o.apply(ev); }); };
  MultiOutput.prototype.release = function () { return settleAll(this.outputs, function (o) { return o.release(); }); };
  MultiOutput.prototype.close = function () { return settleAll(this.outputs, function (o) { return o.close(); }); };
  MultiOutput.prototype.checkHealth = function () {
    var errs = [];
    this.outputs.forEach(function (o) { try { o.checkHealth(); } catch (e) { errs.push(o.label + ': ' + e.message); } });
    if (errs.length) throw RF.OutputError(errs.join(' | '));
  };

  /* Sortie nulle (enregistrement seul). */
  function NullOutput() {}
  NullOutput.prototype.apply = function () { return Promise.resolve(); };
  NullOutput.prototype.release = NullOutput.prototype.close = function () { return Promise.resolve(); };
  NullOutput.prototype.checkHealth = function () {};

  RF.WledClient = WledClient; RF.WledOutput = WledOutput; RF.MultiOutput = MultiOutput; RF.NullOutput = NullOutput;
  RF.COLORS = { GREEN: GREEN, YELLOW: YELLOW, RED: RED, OFF: OFF };
})(typeof window !== 'undefined' ? window : global);
