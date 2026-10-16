# WLED Race Flags

**Français** | [English](README.md)

Suivez les drapeaux d'une course automobile en direct et reproduisez-les sur vos bandes LED [WLED](https://kno.wled.ge/) :
la pièce passe au jaune pendant une neutralisation, au rouge quand la course est arrêtée, et clignote en vert à la relance.

Championnats pris en charge : **NASCAR**, **FIA WEC**, **European Le Mans Series (ELMS)**, **IMSA WeatherTech** et **GT World Challenge Europe**.

L'application tourne **entièrement dans le navigateur** : du HTML, du CSS et du JavaScript purs, sans build, sans dépendance
et sans serveur applicatif. Il suffit de servir les fichiers (ou d'ouvrir `index.html`) sur un appareil du même réseau que vos WLED.

> Interface bilingue français / anglais : la langue est choisie d'après celle du navigateur, et le sélecteur **FR / EN** en haut à droite la change à tout moment (le choix est mémorisé).

## Fonctionnalités

- **Suivi en direct** des flux de chronométrage publics de NASCAR, du FIA WEC, de l'ELMS, d'IMSA et du GT World Challenge Europe (Endurance et Sprint Cup).
  L'onglet GTWC propose aussi les courses de soutien du meeting SRO (GT4, GT2, McLaren Trophy…) : choisissez la *Série* et la *Course*, ou laissez *Automatique* suivre la course en cours.
- **Effets sur la bande** :
  - vert ou damier : clignotements verts, puis la main est rendue ;
  - jaune et rouge : une seconde de couleur pleine, puis un effet « breathe » tant que le drapeau dure ;
  - chaque effet peut être remplacé par un **preset WLED** de votre choix.
- **Plusieurs appareils** pilotés en même temps, avec **détection sur le réseau local** ou ajout manuel (IP ou `wled-xxxx.local`).
- **Rend la main proprement** : à l'arrêt (ou à la fermeture de l'onglet), la bande retrouve son état d'origine,
  ou le contrôle revient à une autre source comme Hyperion.
- **Démarrage en pleine course** : un vert déjà en cours ne fait pas clignoter la bande ; un jaune ou un rouge est appliqué tout de suite.
- **Synchronisation avec la diffusion** : le chronométrage officiel est souvent en avance d'une minute ou plus sur la TV.
  - NASCAR : synchronisation automatique à partir de la durée des tours ;
  - WEC, ELMS, IMSA et GT World Challenge Europe : « Horloge de ma diffusion » à faire coïncider avec l'horloge affichée à l'écran, réglable pendant la course.
- **Enregistrement et replay** : chaque suivi en direct peut être téléchargé en JSON et rejoué plus tard,
  à partir d'un temps ou d'un tour, à vitesse variable, avec recalage en cours de replay.
- **Archive NASCAR** : rejouez n'importe quelle course passée (Cup, Xfinity, Truck) directement depuis l'archive officielle, sans fichier.
- Réglages enregistrés dans le navigateur, avec **export et import** en JSON. Thème clair ou sombre, utilisable sur téléphone.

## Version en ligne

L'application est publiée avec GitHub Pages : **<https://dh0mp5eur.github.io/WledRaceFlags/>**.
Rien à installer, mais elle est servie en https alors que les WLED répondent en http, ce qui limite les navigateurs :

| Navigateur | Version en ligne |
|---|---|
| Chrome, Edge (ordinateur, Android) | Fonctionne après avoir **accepté l'accès au réseau local** demandé par le navigateur à la première connexion à un WLED |
| Firefox, Safari, tout navigateur sur iPhone ou iPad | Ne peut pas joindre les WLED : utilisez une installation locale (ci-dessous) |

Les lives **FIA WEC** et **ELMS** ne fonctionnent pas depuis la version en ligne (voir « Limites connues ») ; NASCAR, IMSA, le GT World Challenge Europe et les replays, si.
Les appareils doivent être désignés par une adresse IP privée (`192.168.1.50`) ou un nom du réseau local (`wled-xxxx.local`, `wled.lan`).
Si l'accès a été refusé, rétablissez-le dans les paramètres du site (icône à gauche de l'adresse), puis rechargez la page.
L'application affiche un bandeau qui explique la situation quand les WLED sont bloqués.

## Installation locale

Elle fonctionne avec tous les navigateurs.

Prérequis : un navigateur récent et au moins un appareil [WLED](https://kno.wled.ge/) sur le réseau local.

```sh
git clone https://github.com/Dh0mp5eur/WledRaceFlags.git
cd WledRaceFlags
python3 -m http.server 8000
```

Ouvrez ensuite `http://localhost:8000`, ou `http://<IP-du-PC>:8000` depuis un téléphone ou une tablette du même réseau.

N'importe quel serveur de fichiers statiques convient. Ouvrir `index.html` directement (`file://`) fonctionne aussi,
mais un serveur HTTP est préférable : la page a alors une vraie origine http, ce qui évite les cas particuliers des flux de course.

> **Servez la page en http, pas en https.** Les WLED répondent en http, et la plupart des navigateurs bloquent les appels en http
> depuis une page en https (contenu mixte). Seuls Chrome et Edge l'acceptent, après autorisation (voir « Version en ligne »).

## Utilisation

L'application a trois vues, accessibles depuis la barre du haut.

### 1. WLED

- **Scanner le réseau** interroge `/json/info` sur chaque adresse du préfixe indiqué (par défaut `192.168.1.`, de 1 à 254).
  Un navigateur ne connaît pas son propre sous-réseau et ne fait pas de mDNS : si la page est servie par une adresse IP privée,
  le préfixe en est déduit, sinon indiquez le vôtre (il est mémorisé).
- Ou ajoutez un appareil à la main par son adresse IP ou son nom.
- Les boutons **Test** (vert, jaune, rouge) jouent chaque effet sur les appareils pour tout vérifier avant la course.

### 2. Race

Choisissez le championnat avec les onglets. Chaque onglet a deux sections :

- **Live** : suit la course en cours. « Sans WLED » permet de suivre sans piloter la bande.
- **Replay** : rejoue un enregistrement de ce championnat (un fichier téléchargé auparavant ou, pour NASCAR, une course de l'archive).
  - *Départ (temps)* ou *Tour* : point de départ du replay (un tour à 0 signifie « partir du temps »).
  - *Vitesse* et *délai vidéo* : pour caler le replay sur une vidéo.
  - Pendant un replay, le bouton devient **Resynchroniser le replay** : il applique les nouveaux réglages sans relancer.

Un enregistrement ne se rejoue que dans l'onglet de son championnat. Les données de l'archive NASCAR sont publiées
quelques heures après l'arrivée d'une course.

**Caler les drapeaux sur votre TV (WEC, ELMS, IMSA et GT World Challenge Europe)** : l'« Horloge de ma diffusion » défile et montre l'heure que votre diffusion
devrait afficher avec le retard actuel. Faites-la coïncider avec l'écran :

- avec les boutons ▲ ▼ de chaque segment (ou les flèches du clavier) : le retard change aussitôt ;
- ou en tapant l'heure lue à l'écran : l'horloge se fige au premier chiffre, Entrée valide, Échap annule.

### 3. Réglages

Luminosité, nombre et durée des clignotements verts, presets WLED pour chaque drapeau, retour à l'état d'origine,
délais réseau, paramètres de la synchronisation TV et adresses des flux. Chaque réglage a une bulle d'aide.

## Hébergement permanent

Pour garder l'application disponible sur le réseau local, servez les fichiers `index.html`, `css/`, `js/` et `img/`
avec n'importe quel serveur statique. Les tests, les outils et la documentation ne sont pas nécessaires.

Exemple de `Caddyfile` (en http uniquement) :

```caddyfile
http://raceflags.lan {
    root * /var/www/raceflags
    encode zstd gzip
    file_server

    # La page est toujours revalidée ; les scripts et le CSS portent ?v=<empreinte>,
    # leur adresse change à chaque mise à jour.
    @page path / /index.html
    header @page Cache-Control "no-cache"
    @versionnes path /js/* /css/*
    header @versionnes Cache-Control "public, max-age=31536000, immutable"
}
```

Copie vers le serveur, par exemple avec `rsync` (ajoutez `-n -i` pour une simulation) :

```sh
node tools/cache-bust.js
rsync -a --no-owner --no-group --checksum --delete index.html css js img utilisateur@serveur:/var/www/raceflags/
```

## Développement

```
index.html          Page unique (vues WLED, Race, Réglages)
css/app.css         Styles, thèmes clair et sombre
js/core.js          Drapeaux, erreurs, horloge, minuteurs non bridés (Web Worker)
js/sources/         Une source par flux : nascar.js, wec.js (WEC et ELMS), imsa.js, sro.js (GT World Challenge Europe), replay.js
js/engine.js        Boucle de suivi : changements de drapeau, reprises sur erreur, retard
js/sync.js          Synchronisation avec la diffusion (par tour ou retard fixe)
js/wled.js          Client WLED et effets des drapeaux
js/discovery.js     Détection des WLED sur le réseau
js/recording.js     Enregistrement et format de replay
js/nascar-import.js Import depuis l'archive NASCAR
js/settings.js      Valeurs par défaut, validation, stockage local
js/i18n.js          Traductions : RF.t(), langue courante, formats
js/i18n/            Un dictionnaire par langue : fr.js, en.js
js/ui.js            Interface (seul fichier qui touche au DOM)
img/                Icônes de l'application et logos des championnats
tests/              Tests Node sans dépendance, avec un enregistrement d'exemple
tools/              cache-bust.js (empreintes anti-cache), make-icons.py (icônes)
```

Principes :

- Scripts classiques `<script defer>` qui partagent l'espace de noms global `RF`, sans modules ES, pour que l'ouverture en `file://` fonctionne.
- Les commandes WLED partent en `POST` de type `text/plain` (requête « simple », sans pré-vérification CORS).
- Une nouvelle source de données est un fichier `js/sources/<nom>.js` qui expose `poll()`, `setSignal()` et `close()`.
- **Aucun texte visible en dur** : libellés, messages et bulles d'aide passent par `RF.t('clé')` (code) ou `data-i18n` (HTML), avec la clé dans chaque dictionnaire de `js/i18n/`.
  Un test vérifie que les langues ont les mêmes clés et qu'aucun texte n'est resté en dur.

Tests (Node.js, aucune installation) :

```sh
node tests/run.js
```

**Après toute modification de `js/` ou `css/`**, relancez `node tools/cache-bust.js` : il recalcule le paramètre `?v=<empreinte>`
des balises d'`index.html`, pour qu'un navigateur ne mélange jamais anciens et nouveaux fichiers. Un test échoue si l'empreinte est périmée.

### Ajouter une langue

1. Copiez `js/i18n/en.js` en `js/i18n/<code>.js` (par exemple `es.js`), changez le code dans `RF.addMessages('<code>', …)` et traduisez les textes (gardez les `{variables}` ; les pluriels sont des objets `{ one, other }`).
2. Inscrivez le code dans `RF.LANGUAGES` (`js/i18n.js`) et ajoutez la balise `<script defer src="js/i18n/<code>.js">` dans `index.html`, à la suite des autres dictionnaires.
3. Lancez `node tools/cache-bust.js` puis `node tests/run.js` : les tests listent les clés manquantes et les bulles trop longues (220 caractères au plus).

Les icônes de l'application sont générées par `tools/make-icons.py` (Python et `cairosvg`) : modifiez le script et relancez-le
plutôt que d'éditer les images.

## Limites connues

- L'onglet doit rester ouvert pendant la course. Les minuteurs passent par un Web Worker et un verrou d'écran est demandé
  pour limiter le bridage en arrière-plan.
- Les flux de chronométrage sont publics mais non documentés : ils peuvent changer sans préavis. Leurs adresses sont modifiables dans les Réglages.
- **GT World Challenge Europe** : le flux Swiss Timing ne garde pas l'historique des drapeaux, une course ne se rejoue donc qu'à partir d'un enregistrement fait en direct
  (« Enregistrer les changements de drapeau »). Avant le départ, l'onglet attend et indique l'heure prévue (heure du circuit). Les GT World Challenge America, Asia et Australia ne sont pas encore pris en charge.
- **Live FIA WEC et ELMS : uniquement depuis `http://localhost`.** Les deux viennent du même serveur de chronométrage, qui n'autorise (CORS) que les pages ouvertes sur `localhost`
  (n'importe quel port). Depuis la version en ligne, une adresse IP ou un nom comme `raceflags.lan`, le navigateur bloque le flux :
  lancez l'application sur l'ordinateur qui regarde la course (`python3 -m http.server 8000`, puis `http://localhost:8000`).
  NASCAR, IMSA et le replay fonctionnent partout.
- Depuis une page publique (comme la version en ligne), Chrome et Edge demandent l'autorisation d'accéder au réseau local ; les autres navigateurs bloquent les WLED.

## Licence

Copyright © 2026 Dhomps Florian.

Ce projet est un logiciel libre, distribué sous la licence **GNU General Public License v3.0** (voir [`LICENSE`](LICENSE)).
Vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer, y compris dans une version améliorée.
Toute version redistribuée, modifiée ou non, doit rester sous GPL-3.0 et être accompagnée de son code source.

Les logos des championnats (`img/nascar.svg`, `img/wec.svg`, `img/imsa.svg`, `img/elms.png`, `img/gtwc.png`) ne sont pas couverts par cette licence (voir ci-dessous).

## Mentions

Les logos NASCAR, FIA WEC, IMSA et ELMS affichés dans les onglets proviennent de Wikimedia Commons (détails dans [`img/README.fr.md`](img/README.fr.md)).
Les logos NASCAR, FIA WEC et IMSA sont dans le domaine public pour le droit d'auteur ; le logo ELMS est de Kobokem2021, sous licence
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr), recadré et réduit. Le logo GT World Challenge ne vient pas de Wikimedia Commons
(source dans [`img/README.fr.md`](img/README.fr.md)). Ce sont des **marques déposées** de leurs propriétaires, utilisées uniquement pour identifier
le championnat suivi.

Ce projet est indépendant : il n'est affilié ni à NASCAR, ni à la FIA, à l'ACO, à l'ELMS, à IMSA ou à SRO Motorsports Group, ni au projet WLED.
Les données de course appartiennent à leurs éditeurs ; l'application ne fait que lire les flux publics depuis votre navigateur.
