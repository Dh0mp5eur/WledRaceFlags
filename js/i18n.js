/* Internationalisation : dictionnaires par langue (js/i18n/<code>.js), RF.t(clé, params), langue courante.
   Pour ajouter une langue : un fichier js/i18n/<code>.js, son code dans RF.LANGUAGES et sa balise <script> dans index.html. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};

  RF.LANGUAGES = ['fr', 'en'];
  var FALLBACKS = ['en', 'fr'];                // ordre de repli quand une clé manque dans la langue courante
  var STORAGE_KEY = 'raceflags.lang';
  var messages = {}, listeners = [], warned = {};

  RF.addMessages = function (code, dict) { messages[code] = Object.assign(messages[code] || {}, dict); };
  RF.messages = function (code) { return messages[code] || {}; };

  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }
  function stored() { try { return root.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } }

  /* Langue à utiliser : choix mémorisé s'il existe, sinon la première langue du navigateur que l'on sait traduire (fr-CA donne fr), sinon l'anglais. */
  RF.detectLang = function (storedLang, navLangs) {
    if (storedLang && RF.LANGUAGES.indexOf(storedLang) !== -1) return storedLang;
    var list = navLangs || [];
    for (var i = 0; i < list.length; i++) {
      var primary = String(list[i] || '').toLowerCase().split('-')[0];
      if (RF.LANGUAGES.indexOf(primary) !== -1) return primary;
    }
    return 'en';
  };

  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var current = RF.detectLang(stored(), nav ? (nav.languages && nav.languages.length ? nav.languages : [nav.language]) : []);

  RF.lang = function () { return current; };

  /* persist : mémorise le choix (l'interface le demande, pas les tests). */
  RF.setLang = function (code, persist) {
    if (RF.LANGUAGES.indexOf(code) === -1) return false;
    current = code;
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = code;
    if (persist) { try { root.localStorage.setItem(STORAGE_KEY, code); } catch (e) {} }
    listeners.slice().forEach(function (fn) { try { fn(code); } catch (e) {} });
    return true;
  };
  RF.onLangChange = function (fn) { listeners.push(fn); };

  RF.languageName = function (code) { var d = messages[code]; return d && has(d, '_meta.name') ? d['_meta.name'] : code; };

  /* Forme de pluriel : 'zero' si le texte en prévoit une et que n vaut 0, sinon la catégorie d'Intl.PluralRules (repli sans Intl). */
  function pluralCategory(code, n, forms) {
    if (n === 0 && has(forms, 'zero')) return 'zero';
    var cat;
    try { cat = new Intl.PluralRules(code).select(n); } catch (e) { cat = code === 'fr' ? (n < 2 ? 'one' : 'other') : (n === 1 ? 'one' : 'other'); }
    return has(forms, cat) ? cat : 'other';
  }

  function interpolate(text, params) {
    return text.replace(/\{(\w+)\}/g, function (m, name) { return params && params[name] != null ? String(params[name]) : m; });
  }

  /* Texte d'une clé : langue courante, puis anglais, puis français ; à défaut la clé elle-même (signalée une fois dans la console).
     Une valeur peut être un objet { zero?, one, other } : la forme est choisie d'après params.count. */
  RF.t = function (key, params) {
    var order = [current].concat(FALLBACKS), seen = {};
    for (var i = 0; i < order.length; i++) {
      var code = order[i];
      if (seen[code]) continue;
      seen[code] = true;
      var d = messages[code];
      if (!d || !has(d, key)) continue;
      var v = d[key];
      if (typeof v === 'object' && v !== null) v = v[pluralCategory(code, Number(params && params.count), v)];
      return interpolate(String(v), params);
    }
    if (!warned[key]) { warned[key] = true; if (typeof console !== 'undefined' && console.warn) console.warn('i18n: missing key "' + key + '"'); }
    return key;
  };

  /* ---------- Formats qui dépendent de la langue ---------- */
  /* Langue des formats : celle du navigateur si elle correspond à la langue choisie (un en-GB garde ses 24 h), sinon celle du dictionnaire. */
  RF.locale = function () {
    var l = nav && nav.language;
    if (l && String(l).toLowerCase().split('-')[0] === current) return l;
    return RF.t('_meta.locale');
  };
  RF.formatTime = function (d) { try { return d.toLocaleTimeString(RF.locale()); } catch (e) { return d.toLocaleTimeString(); } };
  RF.formatDateTime = function (d) { try { return d.toLocaleString(RF.locale()); } catch (e) { return d.toLocaleString(); } };
  /* Jour et mois d'une date AAAA-MM-JJ (jj/mm en français, mm/jj en anglais américain). */
  RF.formatDayMonth = function (isoDate) {
    var y = +isoDate.slice(0, 4), m = +isoDate.slice(5, 7), day = +isoDate.slice(8, 10);
    try { return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(RF.locale(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' }); }
    catch (e) { return isoDate.slice(8, 10) + '/' + isoDate.slice(5, 7); }
  };
})(typeof window !== 'undefined' ? window : global);
