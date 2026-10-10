/* Tests sans dépendance : node tests/run.js (Node >= 12, fetch fourni par le faux WLED via http). */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
if (!global.AbortController) {
  global.AbortController = function () {
    var listeners = [], sig = { aborted: false,
      addEventListener: function (t, f) { listeners.push(f); },
      removeEventListener: function (t, f) { listeners = listeners.filter(function (x) { return x !== f; }); } };
    this.signal = sig;
    this.abort = function () { if (sig.aborted) return; sig.aborted = true; listeners.slice().forEach(function (f) { f(); }); };
  };
}
global.window = undefined;
var js = path.join(__dirname, '..', 'js');
global.RF = undefined;
['core', 'i18n', 'i18n/fr', 'i18n/en', 'sources/nascar', 'sources/wec', 'sources/imsa', 'sources/replay', 'sync', 'wled', 'discovery', 'settings', 'recording', 'nascar-import', 'engine']
  .forEach(function (f) { require(path.join(js, f + '.js')); });
var RF = global.RF, F = RF.FlagState;
RF.setLang('fr');          // les assertions sur les messages sont en français ; Node expose navigator.language, donc la détection ne suffit pas

var tests = [], failed = 0;
function test(name, fn) { tests.push([name, fn]); }

test('anti-cache : l\'empreinte ?v= d\'index.html correspond aux scripts et au CSS', function () {
  var cb = require('../tools/cache-bust.js');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var want = cb.fingerprint();
  var tags = html.match(/(?:src|href)="(?:js|css)\/[^"]+"/g) || [];
  assert.ok(tags.length >= 10, 'balises locales introuvables');
  var bad = tags.filter(function (t) { return t.indexOf('?v=' + want + '"') === -1; });
  assert.deepEqual(bad, [], 'empreinte périmée ou absente : lancez « node tools/cache-bust.js » (attendu ' + want + ')');
});

test('WLED : requêtes annoncées comme locales seulement depuis une page https', function () {
  var o = { method: 'POST' };
  assert.strictEqual(RF.wledFetchOptions('http://wled.lan', o, 'http:'), o);
  assert.strictEqual(RF.wledFetchOptions('https://wled.lan', o, 'https:'), o);
  assert.deepEqual(RF.wledFetchOptions('http://wled.lan', o, 'https:'), { targetAddressSpace: 'local', method: 'POST' });
  assert.deepEqual(o, { method: 'POST' });
  assert.strictEqual(RF.wledFetchOptions('http://192.168.1.5', o), o);     // Node : pas de page, rien n'est ajouté
});

test('drapeaux NASCAR et WEC', function () {
  assert.equal(RF.NASCAR_FLAG_MAP[7], F.YELLOW);
  var r = RF._wecInternals.resolveFlag;
  assert.equal(r('Full Course Yellow'), F.YELLOW);
  assert.equal(r('SAFETY_CAR'), F.YELLOW);
  assert.equal(r('Chequered'), F.CHEQUERED);
  assert.equal(r('red flag'), F.RED);
  assert.equal(r('???'), F.UNKNOWN);
  assert.equal(RF._wecInternals.latestTrackFlag([{ flag: 'a', sectorNumbers: [] }, { flag: 'b', sectorNumbers: [3] }]).flag, 'a');
});

test('IMSA : correspondance des drapeaux (le damier n\'est pas pris pour du rouge)', function () {
  var r = RF._imsaInternals.resolveFlag;
  assert.equal(r('Green'), F.GREEN); assert.equal(r('Yellow'), F.YELLOW); assert.equal(r('Red'), F.RED);
  assert.equal(r('Checkered'), F.CHEQUERED); assert.equal(r('Chequered Flag'), F.CHEQUERED); assert.equal(r('Finish'), F.CHEQUERED);
  assert.equal(r('Full Course Yellow'), F.YELLOW); assert.equal(r('FCY'), F.YELLOW); assert.equal(r('Code 60'), F.YELLOW);
  assert.equal(r('Red Flag'), F.RED);
  assert.equal(r('Warm Up'), F.UNKNOWN); assert.equal(r(''), F.UNKNOWN); assert.equal(r(null), F.UNKNOWN);
  assert.ok(RF._imsaInternals.isRaceSession('WeatherTech Championship - Race'));
  assert.ok(!RF._imsaInternals.isRaceSession('WeatherTech Championship - Practice 1'));
  assert.ok(!RF._imsaInternals.isRaceSession('WeatherTech Championship - Qualifying'));
});

test('IMSA : lecture du flux, filtre course seulement', function () {
  var current = { S: 'WeatherTech Championship - Race', E: 'Road Atlanta', T: 'Road Atlanta', F: 'Yellow', L: 22, TT: '00:29:41', TR: '09:30:19' };
  return new Promise(function (resolve, reject) {
    var srv = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/SessionInfo.json') return res.end(JSON.stringify(current));
      res.writeHead(404); res.end('{}');
    });
    srv.listen(0, '127.0.0.1', function () {
      var url = 'http://127.0.0.1:' + srv.address().port;
      new RF.ImsaSource({ apiUrl: url }).poll().then(function (snap) {
        assert.equal(snap.flag, F.YELLOW); assert.equal(snap.lap, 22); assert.equal(snap.remainingSeconds, 9 * 3600 + 30 * 60 + 19);
        assert.equal(snap.metadata.event_name, 'Road Atlanta'); assert.equal(snap.source, 'imsa');
        current = { S: 'WeatherTech Championship - Practice 2', F: 'Green', L: 3 };
        return new RF.ImsaSource({ apiUrl: url }).poll();
      }).then(function (snap) {
        assert.equal(snap.flag, F.UNKNOWN); assert.ok(/sans course/.test(snap.rawState));
        return new RF.ImsaSource({ apiUrl: url, raceOnly: false }).poll();
      }).then(function (snap) {
        assert.equal(snap.flag, F.GREEN);
        return new RF.ImsaSource({ apiUrl: 'http://127.0.0.1:1' }).poll().then(function () { throw new Error('devrait échouer'); }, function (e) { assert.equal(e.name, 'SourceError'); });
      }).then(function () { srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

test('IMSA : chargement JSONP par balise script, repli sur le JSON direct', function () {
  var added = [], mode = 'ok';
  global.document = { head: { appendChild: function (sc) {
      added.push(sc.src); sc.parentNode = global.document.head;
      setTimeout(function () {
        if (mode === 'ok') global.jsonpSessionInfo({ S: 'WeatherTech Championship - Race', F: 'Red', L: 7, TR: '01:00:00' });
        else sc.onerror();
      }, 5);
    }, removeChild: function () {} }, createElement: function () { return {}; } };
  return new RF.ImsaSource({ apiUrl: 'http://cdn.invalid' }).poll().then(function (snap) {
    assert.equal(snap.flag, F.RED); assert.equal(snap.lap, 7);
    assert.ok(/SessionInfo_JSONP\.json\?_=\d+$/.test(added[0]), added[0]);
    assert.equal(typeof global.jsonpSessionInfo, 'undefined');         // la fonction globale est nettoyée
    // balise en erreur : repli sur le JSON direct (ici injoignable -> SourceError)
    mode = 'error';
    return new RF.ImsaSource({ apiUrl: 'http://127.0.0.1:1' }).poll().then(function () { throw new Error('devrait échouer'); },
      function (e) { assert.equal(e.name, 'SourceError'); assert.equal(added.length, 2); });
  }).then(function () { delete global.document; }, function (e) { delete global.document; throw e; });
});

test('réglages : source imsa acceptée, valeurs par défaut IMSA', function () {
  assert.equal(RF.validateSettings({ source: { type: 'imsa' } }).source.type, 'imsa');
  var d = RF.defaultSettings();
  assert.equal(d.imsa.raceOnly, true); assert.ok(/cloudfront/.test(d.imsa.apiUrl));
  assert.equal(RF.validateSettings({ imsa: { raceOnly: false } }).imsa.raceOnly, false);
});

test('WEC : temps restant et écoulé issus de l\'horloge de session', function () {
  var w = RF._wecInternals, item = { lengthLimit: { timeLimitSeconds: 21600 }, clock: { elapsedTimeMillis: 3600000 } };
  assert.equal(w.remainingSeconds(item), 18000); assert.equal(w.elapsedSeconds(item), 3600);
  assert.equal(w.elapsedSeconds({}), null); assert.equal(w.elapsedSeconds({ clock: { elapsedTimeMillis: true } }), null);
  assert.equal(w.elapsedSeconds({ clock: { elapsedTimeMillis: 'x' } }), null);
});

test('médiane, durées, dates', function () {
  assert.equal(RF.median([3, 1, 2]), 2); assert.equal(RF.median([1, 2, 3, 4]), 2.5);
  assert.equal(RF.formatDuration(3725), '01:02:05');
  assert.equal(RF.parseDuration('1:02:05'), 3725); assert.equal(RF.parseDuration('45:00'), 2700); assert.equal(RF.parseDuration('x'), null);
  assert.equal(RF.parseDate('2026-09-06T21:17:30.291655+00:00').getTime(), Date.UTC(2026, 8, 6, 21, 17, 30, 291));
});

test('file de délai : seul le dernier événement échu est rendu', function () {
  var q = new RF.EventDelayQueue();
  q.schedule('a', 1, 0); q.schedule('b', 2, 0); q.schedule('c', 10, 0);
  assert.equal(q.popLatestReady(0.5), null);
  assert.equal(q.popLatestReady(3), 'b');
  assert.equal(q.size(), 1);
});

test('synchro TV', function () {
  var s = new RF.NascarTvSynchronizer({ initialTvLap: 10, fallbackLapSeconds: 45, maximumDelay: 600, startedAt: 0 });
  assert.equal(s.delaySeconds({ lap: 12, metadata: { average_lap_seconds: 40 } }, 0), 80);
  assert.equal(s.delaySeconds({ lap: 12, metadata: {} }, 45), 45);       // tv lap 11 -> (12-11)*45
  assert.equal(s.delaySeconds({ lap: 5, metadata: {} }, 0), 0);
  assert.equal(s.delaySeconds({ lap: 1000, metadata: {} }, 0), 600);
  assert.equal(s.delaySeconds({ lap: null, metadata: {} }, 0), 0);
});

/* ----- internationalisation (js/i18n.js, js/i18n/*.js) ----- */
var LANGS = RF.LANGUAGES;
function dict(code) { return RF.messages(code); }
function varsOf(v) {                                  // variables {x} d'un texte, ou de toutes les formes d'un pluriel
  var texts = typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : [v], vars = {};
  texts.forEach(function (t) { (t.match(/\{(\w+)\}/g) || []).forEach(function (x) { vars[x] = true; }); });
  return Object.keys(vars).sort().join(',');
}
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }
function readText(f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); }
function listJsFiles(dir, out) {
  fs.readdirSync(path.join(__dirname, '..', dir)).forEach(function (n) {
    var rel = dir + '/' + n;
    if (fs.statSync(path.join(__dirname, '..', rel)).isDirectory()) { if (n !== 'i18n') listJsFiles(rel, out); }
    else if (/\.js$/.test(n)) out.push(rel);
  });
  return out;
}
var NAMESPACES = Object.keys(dict('fr')).map(function (k) { return k.split('.')[0]; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
var DYNAMIC_PREFIXES = ['flag.', 'localAccess.', 'settings.field.', 'settings.tip.', '_meta.'];     // clés construites en code : texte + variable
/* Clés citées dans le code (littéraux « espace.nom ») et dans index.html (data-i18n, data-i18n-attr). */
function usedKeys() {
  var keys = {}, re = new RegExp("(['\"])((?:" + NAMESPACES.join('|') + ")(?:\\.[A-Za-z0-9_]+)+)\\1", 'g'), m;
  var reAttr = new RegExp("(['\"])[a-z-]+:((?:" + NAMESPACES.join('|') + ")(?:\\.[A-Za-z0-9_]+)+)\\1", 'g');      // 'placeholder:settings.none'
  listJsFiles('js', []).forEach(function (f) {
    var src = stripComments(readText(f));
    while ((m = re.exec(src))) keys[m[2]] = f;
    while ((m = reAttr.exec(src))) keys[m[2]] = f;
  });
  var html = readText('index.html');
  (html.match(/data-i18n="[^"]+"/g) || []).forEach(function (x) { keys[x.slice(11, -1)] = 'index.html'; });
  (html.match(/data-i18n-attr="[^"]+"/g) || []).forEach(function (x) { x.slice(16, -1).split(';').forEach(function (pair) { keys[pair.slice(pair.indexOf(':') + 1)] = 'index.html'; }); });
  RF.SETTINGS_FIELDS.forEach(function (f) { keys['settings.field.' + f[0] + '.' + f[1]] = 'SETTINGS_FIELDS'; keys['settings.tip.' + f[0] + '.' + f[1]] = 'SETTINGS_FIELDS'; });
  return keys;
}

test('i18n : langue détectée (mémorisée, navigateur, repli anglais)', function () {
  assert.equal(RF.detectLang(null, ['fr-FR']), 'fr');
  assert.equal(RF.detectLang(null, ['fr-CA', 'en']), 'fr');
  assert.equal(RF.detectLang(null, ['en-US']), 'en');
  assert.equal(RF.detectLang(null, ['de-DE']), 'en');                          // langue non traduite : anglais
  assert.equal(RF.detectLang(null, ['de-DE', 'fr']), 'fr');                    // la première langue connue de la liste
  assert.equal(RF.detectLang(null, []), 'en');
  assert.equal(RF.detectLang('en', ['fr-FR']), 'en');                          // le choix mémorisé l'emporte
  assert.equal(RF.detectLang('xx', ['fr-FR']), 'fr');                          // choix mémorisé inconnu : ignoré
});

test('i18n : texte, variables, pluriels, repli et langue inconnue', function () {
  try {
    RF.addMessages('fr', { 'test.hello': 'Bonjour {name}', 'test.items': { zero: 'aucun', one: '{count} objet', other: '{count} objets' }, 'test.frOnly': 'seulement fr' });
    RF.addMessages('en', { 'test.hello': 'Hello {name}', 'test.items': { one: '{count} item', other: '{count} items' } });
    RF.setLang('fr');
    assert.equal(RF.t('test.hello', { name: 'Ana' }), 'Bonjour Ana');
    assert.equal(RF.t('test.hello'), 'Bonjour {name}');                        // variable absente : laissée telle quelle
    assert.equal(RF.t('test.items', { count: 0 }), 'aucun');
    assert.equal(RF.t('test.items', { count: 1 }), '1 objet');
    assert.equal(RF.t('test.items', { count: 5 }), '5 objets');
    RF.setLang('en');
    assert.equal(RF.t('test.items', { count: 0 }), '0 items');                 // pas de forme « zero » en anglais : « other »
    assert.equal(RF.t('test.items', { count: 1 }), '1 item');
    assert.equal(RF.t('test.frOnly'), 'seulement fr');                         // clé absente en anglais : repli sur le français
    assert.equal(RF.t('test.nowhere'), 'test.nowhere');                        // absente partout : la clé elle-même
    assert.equal(RF.setLang('xx'), false); assert.equal(RF.lang(), 'en');      // langue inconnue refusée
  } finally {
    RF.setLang('fr');
    LANGS.forEach(function (code) { ['test.hello', 'test.items', 'test.frOnly'].forEach(function (k) { delete dict(code)[k]; }); });     // dictionnaires laissés propres
  }
});

test('i18n : formats d\'heure et de date', function () {
  try {
    ['fr', 'en'].forEach(function (code) {
      RF.setLang(code);
      assert.ok(/^\d\d[\/.\-]\d\d$/.test(RF.formatDayMonth('2026-10-07')), code + ' : ' + RF.formatDayMonth('2026-10-07'));
      assert.ok(/\d/.test(RF.formatTime(new Date(0))) && /\d/.test(RF.formatDateTime(new Date(0))));
    });
    assert.equal(RF.languageName('fr'), 'Français'); assert.equal(RF.languageName('en'), 'English');
  } finally { RF.setLang('fr'); }
});

test('i18n : mêmes clés, mêmes variables et mêmes formes de pluriel dans chaque langue', function () {
  var ref = dict(LANGS[0]), problems = [];
  LANGS.slice(1).forEach(function (code) {
    var d = dict(code);
    Object.keys(ref).forEach(function (k) { if (!(k in d)) problems.push(code + ' : clé absente ' + k); });
    Object.keys(d).forEach(function (k) {
      if (!(k in ref)) return problems.push(LANGS[0] + ' : clé absente ' + k + ' (présente en ' + code + ')');
      if (varsOf(ref[k]) !== varsOf(d[k])) problems.push(k + ' : variables différentes (' + varsOf(ref[k]) + ' / ' + varsOf(d[k]) + ')');
      if ((typeof ref[k] === 'object') !== (typeof d[k] === 'object')) problems.push(k + ' : pluriel dans une langue seulement');
      if (typeof d[k] === 'object' && !('other' in d[k])) problems.push(k + ' : forme « other » manquante en ' + code);
    });
  });
  assert.deepEqual(problems, []);
});

test('i18n : toute clé citée existe, aucune clé orpheline', function () {
  var used = usedKeys(), problems = [];
  LANGS.forEach(function (code) {
    Object.keys(used).forEach(function (k) { if (!(k in dict(code))) problems.push(code + ' : clé citée dans ' + used[k] + ' mais absente : ' + k); });
  });
  Object.keys(dict('fr')).forEach(function (k) {
    if (used[k] || DYNAMIC_PREFIXES.some(function (p) { return k.indexOf(p) === 0; })) return;
    problems.push('clé inutilisée : ' + k);
  });
  assert.deepEqual(problems, []);
  // une clé construite en code ne peut avoir qu'un préfixe déclaré
  var bad = [];
  listJsFiles('js', []).forEach(function (f) {
    (stripComments(readText(f)).match(/'((?:[A-Za-z_]+\.)+)'\s*\+/g) || []).forEach(function (x) {
      var pre = x.match(/'([^']+)'/)[1]; if (NAMESPACES.indexOf(pre.split('.')[0]) !== -1 && DYNAMIC_PREFIXES.indexOf(pre) === -1) bad.push(f + ' : ' + pre);
    });
  });
  assert.deepEqual(bad, [], 'préfixe de clé dynamique non déclaré (DYNAMIC_PREFIXES)');
});

test('chaque réglage de la grille a libellé, nom court et bulle d\'aide dans chaque langue', function () {
  assert.ok(RF.SETTINGS_FIELDS.length > 10);
  var missing = [];
  LANGS.forEach(function (code) {
    RF.SETTINGS_FIELDS.forEach(function (f) {
      ['settings.field.', 'settings.tip.'].forEach(function (pre) { if (!dict(code)[pre + f[0] + '.' + f[1]]) missing.push(code + ' ' + pre + f[0] + '.' + f[1]); });
    });
    if (!dict(code)['settings.none']) missing.push(code + ' settings.none');
  });
  assert.deepEqual(missing, [], 'texte manquant (settings.field.* / settings.tip.* dans js/i18n/)');
});

test('bulles d\'aide : au plus 220 caractères dans chaque langue', function () {
  var long = [];
  LANGS.forEach(function (code) {
    var d = dict(code);
    Object.keys(d).forEach(function (k) { if (/^(settings\.)?tip\./.test(k) && d[k].length > 220) long.push(code + ' ' + k + ' (' + d[k].length + ')'); });
  });
  assert.deepEqual(long, []);
});

test('index.html : bulles et textes passent par data-i18n', function () {
  var html = readText('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!/\sdata-tip="/.test(html), 'data-tip littéral : utilisez data-i18n-attr="data-tip:tip.xxx"');
  var BRANDS = /^(WLED|Race|Live|Replay|NASCAR|FIA WEC|IMSA|Cup|Xfinity|Truck|WLED Race Flags|Race Flags)$/;
  var DYNAMIC_IDS = ['btn-start-replay', 'btn-download', 'flag-badge'];       // textes écrits par ui.js
  var bad = [], re = /<(\w+)([^>]*)>([^<]+)<\/\1>/g, m;
  while ((m = re.exec(html))) {
    var text = m[3].trim(), attrs = m[2];
    if (!/[A-Za-zÀ-ÿ]{3}/.test(text) || BRANDS.test(text)) continue;
    var id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
    if (/\sdata-i18n="/.test(attrs) || DYNAMIC_IDS.indexOf(id) !== -1) continue;
    bad.push(m[1] + ' : ' + text);
  }
  assert.deepEqual(bad, [], 'texte visible sans data-i18n');
});

test('js : aucun texte français resté en dur (hors dictionnaires)', function () {
  var ACCENTS = /[àâçéèêëîïôûùüœÀÉ«»]|\b(les|des|est|pas|sans|avec|pour|dans|vous|votre|rendue|aucun|aucune|impossible|erreur)\b/i, bad = [];
  listJsFiles('js', []).forEach(function (f) {
    var src = stripComments(readText(f)), re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g, m;
    while ((m = re.exec(src))) { var lit = m[1] || m[2] || ''; if (ACCENTS.test(lit)) bad.push(f + ' : ' + lit.slice(0, 60)); }
  });
  assert.deepEqual(bad, [], 'passez ces textes par RF.t et js/i18n/*.js : ' + bad.join(' | '));
});

test('i18n : messages d\'erreur en anglais', function () {
  try {
    RF.setLang('en');
    assert.throws(function () { RF.validateSettings({ wled: { brightness: 999 } }); }, /Brightness must be between 0 and 255/);
    assert.throws(function () { RF.validateSettings({ scan: { prefix: 'x' } }); }, /Invalid network prefix/);
    assert.throws(function () { new RF.ReplaySource({ document: {}, speed: 0 }); }, /speed must be greater than zero/);
    assert.throws(function () { RF.loadRecording({ format: 'x' }); }, /Unrecognized recording format/);
  } finally { RF.setLang('fr'); }
});

test('préfixe de scan déduit de l\'adresse de la page', function () {
  assert.equal(RF.prefixFromHost('192.168.4.20'), '192.168.4.');
  assert.equal(RF.prefixFromHost('10.0.7.3'), '10.0.7.');
  assert.equal(RF.prefixFromHost('172.20.1.9'), '172.20.1.');
  assert.equal(RF.prefixFromHost('172.32.1.9'), null);
  assert.equal(RF.prefixFromHost('8.8.8.8'), null);
  assert.equal(RF.prefixFromHost('localhost'), null);
  assert.equal(RF.prefixFromHost('999.168.1.1'), null);
});

test('retard fixe : valeur constante, réglable', function () {
  var s = new RF.FixedDelaySynchronizer({ delaySeconds: 70 });
  assert.equal(s.delaySeconds({ lap: 3, metadata: {} }), 70); assert.equal(s.delaySeconds({ lap: null }), 70);
  assert.equal(s.delaySeconds({}, 0, true), 0);                                // état déjà en cours au démarrage : immédiat
  s.setDelay(15); assert.equal(s.delaySeconds({}), 15);
  s.setDelay(-5); assert.equal(s.getDelay(), 0); s.setDelay('abc'); assert.equal(s.getDelay(), 0);
  assert.equal(RF.validateSettings({ tvSync: { fixedDelaySeconds: '70' } }).tvSync.fixedDelaySeconds, 70);
  assert.throws(function () { RF.validateSettings({ tvSync: { fixedDelaySeconds: -1 } }); }, /Retard/);
});

test('moteur : le retard fixe retarde l\'effet, et un retard réglé en cours de route vaut pour les suivants', function () {
  var applied = [], t0 = Date.now(), ctrl = new AbortController(), step = 0;
  var seq = [F.GREEN, F.YELLOW];                       // vert initial ignoré, puis jaune retardé (ce n'est pas le premier relevé)
  var source = { name: 't', setSignal: function () {}, close: function () {},
    poll: function () { var f = seq[Math.min(step++, seq.length - 1)]; return Promise.resolve(RF.makeSnapshot({ source: 't', flag: f })); } };
  var out = { apply: function (e) { applied.push([e.flag, Date.now() - t0]); return Promise.resolve(); }, release: function () { return Promise.resolve(); },
              close: function () { return Promise.resolve(); }, checkHealth: function () {} };
  var sync = new RF.FixedDelaySynchronizer({ delaySeconds: 0.4 });
  var eng = new RF.RaceFlagEngine({ source: source, output: out, pollInterval: 0.05, skipInitialGreen: true, synchronizer: sync,
    signal: ctrl.signal, onLog: function () {} });
  setTimeout(function () { assert.equal(applied.length, 0, 'rien avant la fin du retard'); }, 250);
  setTimeout(function () { ctrl.abort(); }, 900);
  return eng.run().then(function () {
    assert.equal(applied.length, 1); assert.equal(applied[0][0], 'yellow');
    assert.ok(applied[0][1] >= 380 && applied[0][1] < 800, 'appliqué après ~400 ms, mesuré ' + applied[0][1]);
  });
});

test('calage du retard : horloge restante ou écoulée', function () {
  // chronométrage : 9:03:00 restant ; la diffusion affiche encore 9:04:10 -> elle a 70 s de retard
  assert.equal(RF.streamDelaySeconds('remaining', 9 * 3600 + 4 * 60 + 10, 9 * 3600 + 3 * 60), 70);
  // temps écoulé : chronométrage 0:56:30 ; la diffusion affiche 0:55:20 -> 70 s de retard
  assert.equal(RF.streamDelaySeconds('elapsed', 55 * 60 + 20, 56 * 60 + 30), 70);
  assert.ok(RF.streamDelaySeconds('remaining', 100, 160) < 0);                    // diffusion en avance : négatif, ramené à 0 par l'interface
});

test('moteur : un jaune déjà en cours au démarrage est appliqué sans retard', function () {
  var applied = [], ctrl = new AbortController(), t0 = Date.now();
  var source = { name: 't', setSignal: function () {}, close: function () {},
    poll: function () { return Promise.resolve(RF.makeSnapshot({ source: 't', flag: F.YELLOW })); } };
  var out = { apply: function (e) { applied.push([e.flag, Date.now() - t0]); return Promise.resolve(); }, release: function () { return Promise.resolve(); },
              close: function () { return Promise.resolve(); }, checkHealth: function () {} };
  var eng = new RF.RaceFlagEngine({ source: source, output: out, pollInterval: 0.05, skipInitialGreen: true,
    synchronizer: new RF.FixedDelaySynchronizer({ delaySeconds: 5 }), signal: ctrl.signal, onLog: function () {} });
  setTimeout(function () { ctrl.abort(); }, 300);
  return eng.run().then(function () { assert.equal(applied.length, 1); assert.equal(applied[0][0], 'yellow'); assert.ok(applied[0][1] < 200); });
});

test('réglages : défauts, bornes, persistance', function () {
  var d = RF.defaultSettings();
  assert.equal(d.wled.brightness, 255); assert.equal(d.source.pollInterval, 2);
  assert.throws(function () { RF.validateSettings({ wled: { brightness: 300 } }); }, /Luminosité/);
  assert.throws(function () { RF.validateSettings({ scan: { prefix: '10.0.' } }); }, /Préfixe/);
  assert.equal(RF.validateSettings({ wled: { greenPreset: '' } }).wled.greenPreset, null);
  assert.equal(RF.validateSettings({ devices: [{ url: '192.168.1.5/' }] }).devices[0].url, 'http://192.168.1.5');
  var store = {}, st = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } };
  var s = RF.defaultSettings(); s.wled.brightness = 120;
  assert.ok(RF.saveSettings(s, st)); assert.equal(RF.loadSettings(st).wled.brightness, 120);
  assert.equal(RF.loadSettings({ getItem: function () { throw new Error('x'); } }).wled.brightness, 255);
});

test('replay : enregistrement réel, départ au tour 150', function () {
  var doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fs.readdirSync(path.join(__dirname, 'fixtures'))[0])));
  var now = 0, clock = function () { return now; };
  var src = new RF.ReplaySource({ document: doc, startLap: 150, speed: 1, clock: clock });
  return src.poll().then(function (snap) {
    assert.ok(snap.flag); assert.equal(snap.lap, 150);
    return src.poll().then(function () { throw new Error('devrait ne pas être prêt'); }, function (e) { assert.equal(e.name, 'SourceNotReady'); });
  });
});

test('replay : recalage à chaud, sans relancer', function () {
  var now = 0, clock = function () { return now; };
  var ev = function (offset, flag, lap) { return { offset: offset, flag: flag, occurred_at: '2026-01-01T00:00:00Z', lap: lap }; };
  var doc = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', events: [ev(0, 'green', 0), ev(10, 'yellow', 5), ev(20, 'red', 9), ev(30, 'chequered', 12)],
              lap_timeline: [{ lap: 1, offset: 0 }, { lap: 5, offset: 10 }, { lap: 9, offset: 20 }, { lap: 12, offset: 30 }] };
  var src = new RF.ReplaySource({ document: doc, clock: clock });
  return src.poll().then(function (s) {
    assert.equal(s.flag, 'green'); now = 12;
    return src.poll();
  }).then(function (s) {
    assert.equal(s.flag, 'yellow');
    src.resync({ startAt: 25 });                                 // l'horloge repart de maintenant, à 25 s dans la course
    return src.poll();
  }).then(function (s) {
    assert.equal(s.flag, 'red');                                 // état en vigueur à 25 s
    return src.poll().then(function () { throw new Error('devrait attendre'); }, function (e) { assert.equal(e.name, 'SourceNotReady'); assert.equal(e.waitSeconds, 5); });
  }).then(function () {
    assert.throws(function () { src.resync({ speed: 0 }); }, /vitesse/);             // refusé : le replay en cours reste intact
    assert.throws(function () { src.resync({ startLap: 99 }); }, /absent/);
    now = 17;
    return src.poll();
  }).then(function (s) {
    assert.equal(s.flag, 'chequered');                           // 17 - 12 = 5 s après le recalage -> 30 s dans la course
    src.resync({ startLap: 5, videoOffset: 3, speed: 2 });
    return src.poll().then(function () { throw new Error('devrait attendre le délai vidéo'); }, function (e) { assert.equal(e.waitSeconds, 3); });
  }).then(function () {
    now = 20;                                                    // délai vidéo écoulé : tour 5 = 10 s dans la course
    return src.poll();
  }).then(function (s) { assert.equal(s.flag, 'yellow'); assert.equal(s.lap, 5); });
});

test('moteur : wake() interrompt une longue attente', function () {
  var applied = [], ctrl = new AbortController(), calls = 0, t0 = Date.now();
  var source = { name: 't', setSignal: function () {}, close: function () {},
    poll: function () {
      calls++;
      if (calls === 1) return Promise.reject(RF.SourceNotReady(30));          // attendrait 30 s sans wake()
      return Promise.resolve(RF.makeSnapshot({ source: 't', flag: F.YELLOW }));
    } };
  var out = { apply: function (e) { applied.push([e.flag, Date.now() - t0]); return Promise.resolve(); }, release: function () { return Promise.resolve(); },
              close: function () { return Promise.resolve(); }, checkHealth: function () {} };
  var eng = new RF.RaceFlagEngine({ source: source, output: out, pollInterval: 0.05, signal: ctrl.signal, onLog: function () {} });
  setTimeout(function () { eng.wake(); }, 150);
  setTimeout(function () { ctrl.abort(); }, 700);
  return eng.run().then(function () {
    assert.equal(applied.length, 1); assert.equal(applied[0][0], 'yellow');
    assert.ok(applied[0][1] >= 140 && applied[0][1] < 600, 'appliqué juste après wake(), mesuré ' + applied[0][1] + ' ms');
  });
});

test('replay : seul un positionnement en cours de course est marqué replay_seek', function () {
  var ev = function (offset, flag) { return { offset: offset, flag: flag, occurred_at: '2026-01-01T00:00:00Z', lap: 1 }; };
  var doc = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', events: [ev(0, 'green'), ev(10, 'yellow'), ev(20, 'green')] };
  var now = 0, clock = function () { return now; };
  return new RF.ReplaySource({ document: doc, clock: clock }).poll().then(function (s) {
    assert.equal(s.flag, 'green'); assert.equal(s.metadata.replay_seek, false);          // départ de course à l'offset 0 : annoncé
    return new RF.ReplaySource({ document: doc, startAt: 5, clock: clock }).poll();
  }).then(function (s) {
    assert.equal(s.flag, 'green'); assert.equal(s.metadata.replay_seek, true);           // en cours de course : état non annoncé
    return new RF.ReplaySource({ document: doc, startAt: 10, clock: clock }).poll();
  }).then(function (s) { assert.equal(s.flag, 'yellow'); assert.equal(s.metadata.replay_seek, false); });   // pile sur un événement : annoncé
});

test('replay : le tour courant avance avec l\'horloge, sans événement de drapeau', function () {
  var now = 0, clock = function () { return now; };
  var ev = function (offset, flag, lap) { return { offset: offset, flag: flag, occurred_at: '2026-01-01T00:00:00Z', lap: lap, total_laps: 5 }; };
  var doc = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', metadata: { total_laps: 5 }, events: [ev(0, 'green', 0), ev(35, 'yellow', 4)],
              lap_timeline: [1, 2, 3, 4, 5].map(function (l) { return { lap: l, offset: (l - 1) * 10 }; }) };     // tour L commence à (L-1)*10 s
  var src = new RF.ReplaySource({ document: doc, clock: clock });
  assert.deepEqual(src.progress(), { lap: 1, totalLaps: 5 });
  now = 9.9; assert.equal(src.progress().lap, 1);
  now = 10; assert.equal(src.progress().lap, 2);                     // pas de drapeau entre 0 et 35 s : le compteur avance quand même
  now = 25; assert.equal(src.progress().lap, 3);
  now = 999; assert.equal(src.progress().lap, 5);                    // après la fin : dernier tour
  // vitesse x2, départ au tour 3, délai vidéo
  now = 100; var s2 = new RF.ReplaySource({ document: doc, clock: clock, startLap: 3, speed: 2, videoOffset: 4 });
  assert.equal(s2.progress().lap, 3);                                // tour 3 = 20 s ; pas encore démarré
  now = 103; assert.equal(s2.progress().lap, 3);                     // délai vidéo pas écoulé (3 s sur 4)
  now = 106; assert.equal(s2.progress().lap, 3);                     // (6-4)*2 = 4 s après 20 s : 24 s, le tour 4 commence à 30 s
  now = 110; assert.equal(s2.progress().lap, 4);                     // (10-4)*2 = 12 s après 20 s : 32 s
  return Promise.resolve();
});

test('replay : tour courant après recalage, et repli sans chronologie des tours', function () {
  var now = 0, clock = function () { return now; };
  var ev = function (offset, flag, lap) { return { offset: offset, flag: flag, occurred_at: '2026-01-01T00:00:00Z', lap: lap, total_laps: 9 }; };
  var withTl = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', events: [ev(0, 'green', 0)],
                 lap_timeline: [1, 2, 3, 4].map(function (l) { return { lap: l, offset: (l - 1) * 10 }; }) };
  var src = new RF.ReplaySource({ document: withTl, clock: clock });
  assert.equal(src.progress().totalLaps, 9);                         // total pris sur les événements quand metadata est absent
  now = 5; src.resync({ startLap: 4 }); assert.equal(src.progress().lap, 4);
  now = 6; src.resync({ startAt: 12 }); assert.equal(src.progress().lap, 2);
  var live = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', events: [ev(0, 'green', 0), ev(10, 'yellow', 7)] };   // enregistrement en direct : pas de chronologie
  var s2 = new RF.ReplaySource({ document: live, clock: clock });
  assert.equal(s2.progress(), null);                                 // aucun événement lu pour l'instant
  return s2.poll().then(function () {
    assert.equal(s2.progress().lap, null); assert.equal(s2.progress().totalLaps, 9);        // l'événement de départ n'a pas de numéro de tour
    now = 16; return s2.poll();
  }).then(function () { assert.equal(s2.progress().lap, 7); });                             // dès le prochain événement, son tour est connu
});

test('replay : rejette les entrées invalides', function () {
  assert.throws(function () { RF.loadRecording({ format: 'x' }); }, /Format/);
  assert.throws(function () { new RF.ReplaySource({ document: {}, speed: 0 }); }, /vitesse/);
});

/* ----- faux WLED ----- */
var fakeState = null;      // si défini, renvoyé par GET /json/state
function fakeWled(cb) {
  var log = [];
  var srv = http.createServer(function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', '*'); res.writeHead(204); return res.end(); }
    var body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/json/info') return res.end(JSON.stringify({ brand: 'WLED', name: 'Faux', ver: '0.14', leds: { count: 30 } }));
      if (req.url === '/json/state' && req.method === 'GET') {
        if (!fakeState) { res.writeHead(404); return res.end('{}'); }
        return res.end(JSON.stringify(fakeState));
      }
      if (req.url === '/json/state') { log.push(JSON.parse(body)); return res.end('{"success":true}'); }
      res.writeHead(404); res.end('{}');
    });
  });
  srv.listen(0, '127.0.0.1', function () { cb(srv, log, 'http://127.0.0.1:' + srv.address().port); });
}
global.fetch = global.fetch || function (url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var u = new (require('url').URL)(url);
    var req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers }, function (res) {
      var d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () { resolve({ ok: res.statusCode < 400, status: res.statusCode, json: function () { return Promise.resolve(JSON.parse(d)); } }); });
    });
    req.on('error', reject);
    if (opts.signal) opts.signal.addEventListener('abort', function () { req.abort(); reject(new Error('aborted')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
};

test('WLED : vert clignote 3 fois puis rend la main', function () {
  return new Promise(function (resolve, reject) {
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url, greenBlinks: 2, greenBlinkSeconds: 0.05 });
      out.apply({ flag: F.GREEN }).then(function () { return new Promise(function (r) { setTimeout(r, 500); }); }).then(function () {
        assert.deepEqual(log[0], { lor: 1 });
        assert.deepEqual(log[1].seg[0].col[0], [0, 255, 0]);
        assert.deepEqual(log[2].seg[0].col[0], [0, 0, 0]);
        assert.equal(log.length, 1 + 4 + 1);
        assert.deepEqual(log[log.length - 1], { lor: 0 });
        return out.close();
      }).then(function () { srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

test('WLED : rouge = plein puis breathe, remplacé par jaune, close libère', function () {
  return new Promise(function (resolve, reject) {
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url, breatheEffectId: 2, brightness: 200 });
      out.apply({ flag: F.RED }).then(function () { return new Promise(function (r) { setTimeout(r, 1300); }); }).then(function () {
        var last = log[log.length - 1];
        assert.equal(last.seg[0].fx, 2); assert.equal(last.bri, 200); assert.deepEqual(last.seg[0].col[0], [255, 0, 0]);
        return out.apply({ flag: F.YELLOW });
      }).then(function () { return new Promise(function (r) { setTimeout(r, 100); }); }).then(function () {
        assert.deepEqual(log[log.length - 1].seg[0].col[0], [255, 200, 0]);
        return out.close();
      }).then(function () { assert.deepEqual(log[log.length - 1], { lor: 0 }); srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

test('WLED : preset et inconnu refusé', function () {
  return new Promise(function (resolve, reject) {
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url, yellowPreset: 7 });
      out.apply({ flag: F.UNKNOWN }).then(function () { throw new Error('devrait échouer'); }, function (e) { assert.equal(e.name, 'OutputError'); })
        .then(function () { return out.apply({ flag: F.YELLOW }); })
        .then(function () { return new Promise(function (r) { setTimeout(r, 100); }); })
        .then(function () { assert.deepEqual(log[1], { on: true, ps: 7 }); return out.close(); })
        .then(function () { srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

var SAVED = { on: true, bri: 180, lor: 0, ps: -1, pl: -1, seg: [
  { id: 0, start: 0, stop: 60, on: true, bri: 255, fx: 9, sx: 100, ix: 50, pal: 3, c1: 1, c2: 2, c3: 3, col: [[1, 2, 3, 0], [4, 5, 6, 0], [0, 0, 0, 0]] },
  { id: 1, start: 0, stop: 0, fx: 0 }] };

test('restauration : payload depuis un état (segments, preset)', function () {
  var p = RF.buildRestorePayload(SAVED);
  assert.equal(p.lor, 0); assert.equal(p.bri, 180); assert.equal(p.seg.length, 1);      // segment vide ignoré
  assert.equal(p.seg[0].fx, 9); assert.deepEqual(p.seg[0].col[1], [4, 5, 6, 0]);
  assert.deepEqual(RF.buildRestorePayload({ on: true, ps: 4, seg: SAVED.seg }), { lor: 0, on: true, ps: 4 });
  assert.equal(RF.buildRestorePayload(null), null); assert.equal(RF.buildRestorePayload({ seg: [] }), null);
});

test('restauration : jaune puis close remet l\'état d\'origine, une seule capture', function () {
  return new Promise(function (resolve, reject) {
    fakeState = SAVED;
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url });
      out.apply({ flag: F.YELLOW }).then(function () { return new Promise(function (r) { setTimeout(r, 1300); }); })
        .then(function () { return out.apply({ flag: F.RED }); })
        .then(function () { return new Promise(function (r) { setTimeout(r, 100); }); })
        .then(function () { return out.close(); }).then(function () {
          var last = log[log.length - 1];
          assert.equal(last.lor, 0); assert.equal(last.seg[0].fx, 9); assert.equal(last.bri, 180);
          assert.equal(log.filter(function (p) { return p.lor === 0; }).length, 1);        // pas de lor:0 intermédiaire
          fakeState = null; srv.close(); resolve();
        }, function (e) { fakeState = null; srv.close(); reject(e); });
    });
  });
});

test('restauration : requête de fermeture d\'onglet = état mémorisé, sinon lor:0', function () {
  var out = new RF.WledOutput({ url: 'http://192.168.1.50/' });
  assert.equal(out.pagehideRequest().url, 'http://192.168.1.50/json/state');
  assert.deepEqual(JSON.parse(out.pagehideRequest().body), { lor: 0 });
  out._saved = RF.buildRestorePayload(SAVED);
  var body = JSON.parse(out.pagehideRequest().body);
  assert.equal(body.lor, 0); assert.equal(body.seg[0].fx, 9); assert.equal(body.bri, 180);
});

test('restauration : désactivée = simple lor:0 ; lecture impossible = simple lor:0', function () {
  return new Promise(function (resolve, reject) {
    fakeState = SAVED;
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url, restoreState: false });
      out.apply({ flag: F.RED }).then(function () { return new Promise(function (r) { setTimeout(r, 100); }); })
        .then(function () { return out.close(); }).then(function () {
          assert.deepEqual(log[log.length - 1], { lor: 0 });
          fakeState = null; srv.close(); resolve();
        }, function (e) { fakeState = null; srv.close(); reject(e); });
    });
  });
});

test('restauration : le vert terminé restaure aussi l\'état', function () {
  return new Promise(function (resolve, reject) {
    fakeState = SAVED;
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url, greenBlinks: 1, greenBlinkSeconds: 0.05 });
      out.apply({ flag: F.GREEN }).then(function () { return new Promise(function (r) { setTimeout(r, 400); }); }).then(function () {
        var last = log[log.length - 1];
        assert.equal(last.lor, 0); assert.equal(last.seg[0].fx, 9);
        fakeState = null; srv.close(); resolve();
      }, function (e) { fakeState = null; srv.close(); reject(e); });
    });
  });
});

test('découverte : trouve le faux WLED, ignore le reste', function () {
  return new Promise(function (resolve, reject) {
    fakeWled(function (srv, log, url) {
      RF.probeWled(url, 800).then(function (dev) {
        assert.equal(dev.name, 'Faux'); assert.equal(dev.version, '0.14');
        return RF.probeWled('http://127.0.0.1:1', 300);
      }).then(function (none) { assert.equal(none, null); srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

test('moteur : replay accéléré contre le faux WLED', function () {
  return new Promise(function (resolve, reject) {
    fakeWled(function (srv, log, url) {
      var doc = { format: RF.RECORDING_FORMAT, version: 1, source: 'nascar', events: [
        { offset: 0, flag: 'green', occurred_at: '2026-01-01T00:00:00Z', lap: 0 },
        { offset: 1, flag: 'yellow', occurred_at: '2026-01-01T00:00:01Z', lap: 5 },
        { offset: 2, flag: 'red', occurred_at: '2026-01-01T00:00:02Z', lap: 6 }] };
      var applied = [], ctrl = new AbortController();
      var eng = new RF.RaceFlagEngine({
        source: new RF.ReplaySource({ document: doc, speed: 10 }),
        output: new RF.WledOutput({ url: url, greenBlinks: 1, greenBlinkSeconds: 0.01 }),
        pollInterval: 0, signal: ctrl.signal, onFlag: function (e) { applied.push(e.flag); }, onLog: function () {}
      });
      eng.run().then(function () {
        assert.deepEqual(applied, ['green', 'yellow', 'red']);
        assert.deepEqual(log[log.length - 1], { lor: 0 });
        srv.close(); resolve();
      }, function (e) { srv.close(); reject(e); });
    });
  });
});

function scriptedSource(flags) {
  var i = 0;
  return { name: 'test', setSignal: function () {}, close: function () {},
    poll: function () {
      if (i >= flags.length) return Promise.reject(RF.SourceFinished('fin'));
      return Promise.resolve(RF.makeSnapshot({ source: 'test', flag: flags[i++], lap: i }));
    } };
}
function runEngine(flags, skip) {
  var applied = [], logs = [];
  var out = { apply: function (e) { applied.push(e.flag); return Promise.resolve(); }, release: function () { return Promise.resolve(); },
              close: function () { return Promise.resolve(); }, checkHealth: function () {} };
  var eng = new RF.RaceFlagEngine({ source: scriptedSource(flags), output: out, pollInterval: 0, skipInitialGreen: skip,
    signal: new AbortController().signal, onLog: function (k, m) { logs.push(m); } });
  return eng.run().then(function () { return { applied: applied, logs: logs }; });
}

test('moteur : un vert déjà en cours au démarrage ne déclenche aucun effet', function () {
  return runEngine([F.GREEN, F.GREEN, F.YELLOW, F.GREEN], true).then(function (r) {
    assert.deepEqual(r.applied, ['yellow', 'green']);                        // le vert initial est ignoré, le retour au vert joué
    assert.ok(r.logs.some(function (l) { return /déjà en cours/.test(l); }));
  });
});

test('moteur : démarrage en jaune ou rouge appliqué ; damier initial ignoré', function () {
  return runEngine([F.YELLOW, F.GREEN], true).then(function (r) {
    assert.deepEqual(r.applied, ['yellow', 'green']);
    return runEngine([F.CHEQUERED], true);
  }).then(function (r) { assert.deepEqual(r.applied, []); });
});

test('moteur : vert après un état inconnu (avant le départ) joué ; replay garde son vert initial', function () {
  return runEngine([F.UNKNOWN, F.GREEN], true).then(function (r) {
    assert.deepEqual(r.applied, ['green']);
    return runEngine([F.GREEN, F.YELLOW], false);
  }).then(function (r) { assert.deepEqual(r.applied, ['green', 'yellow']); });
});

test('archive NASCAR : liste des courses passées, plus récentes d\'abord', function () {
  var list = { series_1: [
    { race_id: 10, race_name: 'Ancienne', track_name: 'A', race_date: '2026-03-01T15:00:00', actual_laps: 200 },
    { race_id: 12, race_name: 'Future', track_name: 'C', race_date: '2026-12-01T15:00:00', scheduled_laps: 100 },
    { race_id: 11, race_name: 'Récente', track_name: 'B', race_date: '2026-09-27T15:00:00', actual_laps: 267 },
    { race_id: 13, race_name: 'Ce soir', track_name: 'D', race_date: '2026-10-04T17:30:00', scheduled_laps: 267 },
    { race_name: 'Sans identifiant', race_date: '2026-01-01T10:00:00' }], series_2: [] };
  return new Promise(function (resolve, reject) {
    var srv = http.createServer(function (req, res) {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/2026/race_list_basic.json') return res.end(JSON.stringify(list));
      res.writeHead(404); res.end('{}');
    });
    srv.listen(0, '127.0.0.1', function () {
      var base = 'http://127.0.0.1:' + srv.address().port;
      var at = function (iso) { return { base: base, now: Date.parse(iso) }; };
      RF.listNascarRaces(2026, 'cup', at('2026-10-04T12:00:00Z')).then(function (races) {
        assert.deepEqual(races.map(function (r) { return r.id; }), [11, 10]);                    // ni future, ni sans id ; récente d'abord
        assert.equal(races[0].laps, 267); assert.equal(races[0].date, '2026-09-27');
        return RF.listNascarRaces(2026, 'cup', at('2026-10-04T22:45:00Z'));                    // 17h30 ET = 22h30 UTC-5 : une heure après le départ
      }).then(function (races) {
        assert.deepEqual(races.map(function (r) { return r.id; }), [13, 11, 10]);
        return RF.listNascarRaces(2026, 'truck', at('2026-10-04T22:45:00Z')).then(function () { throw new Error('devrait échouer'); }, function (e) { assert.ok(/Aucune course/.test(e.message)); });
      }).then(function () {
        return RF.listNascarRaces(1999, 'cup').then(function () { throw new Error('devrait échouer'); }, function (e) { assert.ok(/année/.test(e.message)); });
      }).then(function () {
        return RF.listNascarRaces(2026, 'moto').then(function () { throw new Error('devrait échouer'); }, function (e) { assert.ok(/Série/.test(e.message)); });
      }).then(function () { srv.close(); resolve(); }, function (e) { srv.close(); reject(e); });
    });
  });
});

function seekEngine(steps) {              // steps : [{ flag, seek }]
  var applied = [], released = 0, logs = [], i = 0, ctrl = new AbortController();
  var source = { name: 't', setSignal: function () {}, close: function () {},
    poll: function () {
      if (i >= steps.length) return Promise.reject(RF.SourceFinished('fin'));
      var s = steps[i++];
      return Promise.resolve(RF.makeSnapshot({ source: 't', flag: s.flag, metadata: s.seek ? { replay_seek: true } : {} }));
    } };
  var out = { apply: function (e) { applied.push(e.flag); return Promise.resolve(); }, release: function () { released++; return Promise.resolve(); },
              close: function () { return Promise.resolve(); }, checkHealth: function () {} };
  var eng = new RF.RaceFlagEngine({ source: source, output: out, pollInterval: 0, skipInitialGreen: false, signal: ctrl.signal, onLog: function (k, m) { logs.push(m); } });
  return eng.run().then(function () { return { applied: applied, released: released, logs: logs }; });
}

test('replay : un vert non annoncé (positionnement) ne joue aucun effet, le vert annoncé si', function () {
  return seekEngine([{ flag: F.GREEN, seek: true }]).then(function (r) {
    assert.deepEqual(r.applied, []); assert.equal(r.released, 0);
    assert.ok(r.logs.some(function (l) { return /point de départ.*aucun effet/.test(l); }));
    return seekEngine([{ flag: F.GREEN, seek: false }]);                                  // départ de course annoncé par l'enregistrement
  }).then(function (r) {
    assert.deepEqual(r.applied, ['green']);
    return seekEngine([{ flag: F.GREEN, seek: true }, { flag: F.YELLOW, seek: false }, { flag: F.GREEN, seek: false }]);
  }).then(function (r) { assert.deepEqual(r.applied, ['yellow', 'green']); });             // les vraies transitions jouent l'effet
});

test('replay : jaune ou rouge au point de départ appliqué ; recalage vers un vert arrête l\'effet sans clignotement', function () {
  return seekEngine([{ flag: F.YELLOW, seek: true }, { flag: F.GREEN, seek: true }]).then(function (r) {
    assert.deepEqual(r.applied, ['yellow']);               // pas de vert joué
    assert.equal(r.released, 1);                           // mais la bande est rendue
    assert.ok(r.logs.some(function (l) { return /l'effet précédent est arrêté/.test(l); }));
    return seekEngine([{ flag: F.RED, seek: true }, { flag: F.CHEQUERED, seek: true }]);
  }).then(function (r) { assert.deepEqual(r.applied, ['red']); assert.equal(r.released, 1); });
});

test('replay : recalage d\'un jaune vers un vert avec la vraie sortie WLED, état d\'origine restauré', function () {
  return new Promise(function (resolve, reject) {
    fakeState = SAVED;
    fakeWled(function (srv, log, url) {
      var out = new RF.WledOutput({ url: url });
      var steps = [{ flag: F.YELLOW, seek: true }, { flag: F.GREEN, seek: true }], i = 0, ctrl = new AbortController();
      var source = { name: 't', setSignal: function () {}, close: function () {},
        poll: function () {
          if (i >= steps.length) return Promise.reject(RF.SourceFinished('fin'));
          if (i === 1) return new Promise(function (r) { setTimeout(r, 400); }).then(function () { var s = steps[i++]; return RF.makeSnapshot({ source: 't', flag: s.flag, metadata: { replay_seek: true } }); });
          var s0 = steps[i++]; return Promise.resolve(RF.makeSnapshot({ source: 't', flag: s0.flag, metadata: { replay_seek: true } }));
        } };
      var eng = new RF.RaceFlagEngine({ source: source, output: out, pollInterval: 0, signal: ctrl.signal, onLog: function () {} });
      eng.run().then(function () {
        var greens = log.filter(function (p) { return p.seg && p.seg[0] && p.seg[0].col && JSON.stringify(p.seg[0].col[0]) === '[0,255,0]'; });
        assert.equal(greens.length, 0, 'aucun clignotement vert');
        // La restauration est le dernier envoi qui contient des segments ; l'arrêt de la course ajoute ensuite un simple lor:0.
        var restores = log.filter(function (p) { return p.lor === 0 && p.seg; });
        assert.equal(restores.length, 1, 'une seule restauration');
        assert.equal(restores[0].seg[0].fx, 9); assert.equal(restores[0].bri, 180);                // état d'origine
      }).then(function () { fakeState = null; srv.close(); resolve(); }, function (e) { fakeState = null; srv.close(); reject(e); });
    });
  });
});

test('import NASCAR : construit un enregistrement rejouable', function () {
  var doc = RF.buildNascarRecording({
    race: { race_id: 9, race_name: 'Test', actual_laps: 4, total_race_time: '00:04:00', race_season: 2026, track_name: 'T', schedule: [] },
    lapTimes: { laps: [{ Laps: [1, 2, 3, 4].map(function (l) { return { Lap: l, LapTime: 50, RunningPos: 1 }; }) }],
                flags: [{ LapsCompleted: 0, FlagState: 1 }, { LapsCompleted: 2, FlagState: 2 }, { LapsCompleted: 3, FlagState: 1 }] },
    lapNotes: { laps: {} }, series: 'cup'
  });
  assert.deepEqual(doc.events.map(function (e) { return e.flag; }), ['green', 'yellow', 'green', 'chequered']);
  assert.equal(doc.events[1].offset, 120);       // 2 tours x 60 s (50 s mis à l'échelle sur 240 s)
  assert.equal(doc.lap_timeline.length, 4);
  RF.loadRecording(doc);
});

(function runAll(i) {
  if (i >= tests.length) { console.log(failed ? '\n' + failed + ' échec(s)' : '\nTous les tests passent (' + tests.length + ')'); process.exit(failed ? 1 : 0); }
  var t = tests[i];
  Promise.resolve().then(t[1]).then(function () { console.log('ok   ' + t[0]); }, function (e) { failed++; console.log('FAIL ' + t[0] + '\n     ' + (e && e.stack || e)); }).then(function () { runAll(i + 1); });
})(0);
