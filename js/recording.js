/* Enregistrement en mémoire au format raceflags-recording v1 (de recording.py). */
(function (root) {
  'use strict';
  var RF = root.RF;

  function jsonSafe(v) {
    if (v === undefined) return null;
    if (v === null || ['boolean', 'number', 'string'].indexOf(typeof v) !== -1) return typeof v === 'number' && !isFinite(v) ? null : v;
    if (Array.isArray(v)) return v.map(jsonSafe);
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = jsonSafe(v[k]); }); return o; }
    return String(v);
  }

  function RaceRecorder(opts) {
    this._clock = opts.clock || RF.clock;
    this._startedAt = this._clock();
    this.document = {
      format: RF.RECORDING_FORMAT, version: RF.RECORDING_VERSION, source: opts.source,
      name: opts.name || null, started_at: new Date().toISOString(), events: []
    };
    this.onChange = opts.onChange || null;
  }
  RaceRecorder.prototype.onEvent = function (event) {
    this.document.events.push({
      offset: Math.round(Math.max(0, this._clock() - this._startedAt) * 1000) / 1000,
      source: event.source, flag: event.flag, occurred_at: event.occurredAt.toISOString(),
      raw_state: jsonSafe(event.rawState), lap: event.lap, total_laps: event.totalLaps,
      remaining_seconds: event.remainingSeconds, metadata: jsonSafe(event.metadata)
    });
    if (this.onChange) this.onChange(this.document.events.length);
  };
  RaceRecorder.prototype.close = function () {};
  RaceRecorder.prototype.count = function () { return this.document.events.length; };

  /* Télécharge un document JSON via un lien temporaire (fonctionne en file://). */
  RF.downloadJson = function (doc, filename) {
    var blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };
  RF.RaceRecorder = RaceRecorder;
  RF._jsonSafe = jsonSafe;
})(typeof window !== 'undefined' ? window : global);
