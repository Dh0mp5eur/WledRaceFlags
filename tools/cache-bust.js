#!/usr/bin/env node
/* Anti-cache sans serveur dédié : ajoute ?v=<empreinte> à chaque script et feuille de style locaux d'index.html.
   L'empreinte vient du contenu de js/ et de css/app.css : elle change dès qu'un fichier change, donc le navigateur
   recharge tous les fichiers ensemble (plus de mélange ancienne/nouvelle version avec python -m http.server).
   Usage : node tools/cache-bust.js   (à relancer après toute modification de js/ ou css/) */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var root = path.join(__dirname, '..');

function listJs(dir) {
  return fs.readdirSync(dir).reduce(function (acc, name) {
    var p = path.join(dir, name), st = fs.statSync(p);
    if (st.isDirectory()) return acc.concat(listJs(p));
    return /\.js$/.test(name) ? acc.concat([p]) : acc;
  }, []);
}
function fingerprint() {
  var h = crypto.createHash('sha1');
  listJs(path.join(root, 'js')).concat([path.join(root, 'css', 'app.css')]).sort().forEach(function (f) {
    h.update(path.relative(root, f).split(path.sep).join('/')); h.update(fs.readFileSync(f));
  });
  return h.digest('hex').slice(0, 10);
}
var LOCAL_TAG = /((?:src|href)="(?:js|css)\/[^"?]+)(?:\?v=[0-9a-f]+)?"/g;
function apply(html, version) { return html.replace(LOCAL_TAG, '$1?v=' + version + '"'); }

module.exports = { fingerprint: fingerprint, apply: apply, LOCAL_TAG: LOCAL_TAG };

if (require.main === module) {
  var file = path.join(root, 'index.html'), v = fingerprint();
  var before = fs.readFileSync(file, 'utf8'), after = apply(before, v);
  if (after !== before) fs.writeFileSync(file, after);
  console.log('index.html : version ' + v + (after !== before ? ' (mise à jour)' : ' (déjà à jour)'));
}
