# Logos des championnats

**Français** | [English](README.md)

Fichiers utilisés comme icônes des onglets de la page Race. Ils sont enregistrés ici pour que l'application reste utilisable hors ligne.

| Fichier | Championnat | Source | Licence indiquée |
|---|---|---|---|
| `nascar.svg` | NASCAR | https://commons.wikimedia.org/wiki/File:NASCAR.svg | Domaine public (Wikimedia Commons) |
| `wec.svg` | FIA World Endurance Championship | https://commons.wikimedia.org/wiki/File:WEC_Logo.svg | Domaine public (Wikimedia Commons) |
| `imsa.svg` | IMSA WeatherTech SportsCar Championship | https://commons.wikimedia.org/wiki/File:IMSA_SportsCar_Championship_logo.svg | Domaine public (Wikimedia Commons) |
| `elms.png` | European Le Mans Series | https://commons.wikimedia.org/wiki/File:European_Le_Mans_Series_Logo.jpg | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr), auteur Kobokem2021 |

Les fichiers NASCAR, WEC et IMSA sont marqués « trademarked » sur Wikimedia Commons : le droit d'auteur est libre mais ce sont des **marques déposées** de leurs propriétaires
(NASCAR, FIA et ACO, IMSA). Le logo ELMS est lui aussi une marque de l'ACO. Elles servent ici uniquement à identifier le championnat suivi, dans un outil personnel. Ce projet n'est affilié à aucun d'eux.

`elms.png` est une copie modifiée du fichier de Commons (JPEG 3200 × 1387) : marges blanches recadrées, réduit à 360 px de large. Il reste sous CC BY-SA 4.0,
crédit : « European Le Mans Series Logo » par Kobokem2021, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr), via Wikimedia Commons, recadré et réduit.

Avant d'ajouter ou de remplacer un logo : vérifier la licence sur la page du fichier de Wikimedia Commons et mettre ce tableau à jour.

## Icônes de l'application

`icon.svg`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png` et `icon-512.png` sont des dessins **originaux** : un drapeau à damier qui flotte, dont les carreaux sombres prennent les couleurs des LED du vert au rouge,
avec un contour orange. Les icônes ont un **fond transparent** (hampe gris moyen et contour orange pour rester lisibles sur fond clair comme sur fond sombre), sauf `apple-touch-icon.png`, volontairement opaque sur fond sombre : iOS remplit la transparence en noir. Ils ne reprennent aucun logo existant et ne sont pas soumis à une marque déposée. Ils sont générés par `tools/make-icons.py` (dépendance : `cairosvg`) :
modifier les couleurs ou le dessin dans ce script, puis le relancer, plutôt que d'éditer les fichiers à la main.
