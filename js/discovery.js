/* Détection des WLED par balayage HTTP d'un /24 (GET /json/info). */
(function (root) {
  'use strict';
  var RF = root.RF;

  RF.isValidPrefix = function (p) { return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.$/.test(p) && p.split('.').slice(0, 3).every(function (n) { return +n <= 255; }); };

  /* Déduit "a.b.c." d'un nom d'hôte IPv4 privé (192.168/16, 10/8, 172.16/12), sinon null. */
  RF.prefixFromHost = function (host) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host || '');
    if (!m) return null;
    var o = m.slice(1).map(Number);
    if (o.some(function (n) { return n > 255; })) return null;
    var priv = o[0] === 10 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
    return priv ? o[0] + '.' + o[1] + '.' + o[2] + '.' : null;
  };

  RF.probeWled = function (host, timeoutMs, signal) {
    var base = RF.normalizeWledUrl(host);
    return RF.fetchJson(base + '/json/info', RF.wledFetchOptions(base, {}), timeoutMs, signal).then(function (info) {
      if (!info || typeof info !== 'object' || (info.brand !== 'WLED' && !info.ver && !info.leds)) return null;
      return { url: base, name: info.name || host, version: info.ver || '', mac: info.mac || '', leds: info.leds ? info.leds.count : null };
    }, function () { return null; });
  };

  /* opts: prefix "192.168.1.", from, to, concurrency, timeoutMs, signal, onProgress(done,total), onFound(dev) */
  RF.scanSubnet = function (opts) {
    var prefix = opts.prefix, from = opts.from || 1, to = opts.to || 254;
    var conc = opts.concurrency || 30, timeoutMs = opts.timeoutMs || 800, signal = opts.signal;
    var hosts = [];
    for (var i = from; i <= to; i++) hosts.push(prefix + i);
    var next = 0, done = 0, found = [];
    function worker() {
      if (signal && signal.aborted) return Promise.resolve();
      if (next >= hosts.length) return Promise.resolve();
      var host = hosts[next++];
      return RF.probeWled(host, timeoutMs, signal).then(function (dev) {
        done++;
        if (dev) { found.push(dev); if (opts.onFound) opts.onFound(dev); }
        if (opts.onProgress) opts.onProgress(done, hosts.length);
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < Math.min(conc, hosts.length); w++) workers.push(worker());
    return Promise.all(workers).then(function () { return found; });
  };
})(typeof window !== 'undefined' ? window : global);
