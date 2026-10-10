/* Source NASCAR live (de sources/nascar.py). */
(function (root) {
  'use strict';
  var RF = root.RF;
  var F = RF.FlagState;
  var NASCAR_API = 'https://cf.nascar.com/live/feeds/live-feed.json';
  var NASCAR_FLAG_MAP = { 1: F.GREEN, 2: F.YELLOW, 3: F.RED, 5: F.CHEQUERED, 7: F.YELLOW };

  function optionalInt(value, field) {
    if (value == null) return null;
    if (typeof value === 'boolean') throw RF.SourceError(RF.t('err.nascar.badField', { field: field, value: value }));
    var n = parseInt(value, 10);
    if (isNaN(n)) throw RF.SourceError(RF.t('err.nascar.badField', { field: field, value: JSON.stringify(value) }));
    return n;
  }

  function leaderLapTime(vehicles) {
    if (!Array.isArray(vehicles)) return null;
    var valid = vehicles.filter(function (v) { return v && typeof v === 'object'; });
    if (!valid.length) return null;
    function pos(v) { var p = parseInt(v.running_position == null ? 999 : v.running_position, 10); return isNaN(p) ? 999 : p; }
    var leader = valid.reduce(function (best, v) { return pos(v) < pos(best) ? v : best; });
    var t = parseFloat(leader.last_lap_time);
    return isFinite(t) && t > 0 ? t : null;
  }

  function NascarSource(opts) {
    opts = opts || {};
    this.name = 'nascar';
    this._url = opts.url || NASCAR_API;
    this._timeoutMs = (opts.timeout || 10) * 1000;
    this._lapTimes = [];
    this._sample = Math.max(1, opts.lapSampleSize || 5);
    this._signal = null;
  }
  NascarSource.prototype.setSignal = function (s) { this._signal = s; };
  NascarSource.prototype.poll = function () {
    var self = this;
    return RF.fetchJson(self._url, {}, self._timeoutMs, self._signal).then(function (data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw RF.SourceError(RF.t('err.nascar.notObject'));
      var rawFlag = optionalInt(data.flag_state, 'flag_state');
      var lap = optionalInt(data.lap_number, 'lap_number');
      var total = optionalInt(data.laps_in_race, 'laps_in_race');
      var lt = leaderLapTime(data.vehicles);
      if (lt !== null) { self._lapTimes.push(lt); if (self._lapTimes.length > self._sample) self._lapTimes.shift(); }
      return RF.makeSnapshot({
        source: self.name,
        flag: NASCAR_FLAG_MAP[rawFlag] || F.UNKNOWN,
        rawState: rawFlag, lap: lap, totalLaps: total,
        metadata: { average_lap_seconds: RF.median(self._lapTimes) }
      });
    }, function (e) {
      if (e && e.name === 'SourceError') throw e;
      throw RF.SourceError(RF.t('err.nascar.readFailed', { detail: e && e.message || e }));
    });
  };
  NascarSource.prototype.close = function () {};

  RF.NascarSource = NascarSource;
  RF.NASCAR_FLAG_MAP = NASCAR_FLAG_MAP;
  RF._nascarInternals = { leaderLapTime: leaderLapTime };
})(typeof window !== 'undefined' ? window : global);
