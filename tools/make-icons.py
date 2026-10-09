#!/usr/bin/env python3
"""Génère les icônes de l'application (SVG et PNG) dans img/.

Dessin original : un drapeau à damier qui flotte, dont les carreaux sombres prennent les couleurs des LED (du vert au rouge),
sur fond sombre avec un accent orange. Aucun logo existant n'est repris. Dépendance : cairosvg (pip install cairosvg).

Usage : python3 tools/make-icons.py
Fichiers produits : favicon.svg, icon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
"""
import math
import os

import cairosvg

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')

AMBER = '#ffa000'          # accent orange, proche de l'interface WLED
BG_TOP, BG_BOTTOM = '#202020', '#0c0c0c'
COLUMN_COLORS = ['#2ecc40', '#a6e22e', '#ffd60a', '#ff9f0a', '#ff5a1f', '#ff2d2d']   # du vert au rouge, une couleur par colonne
LIGHT = '#f4f4f4'
POLE = '#9aa0a6'          # gris moyen : visible sur fond blanc comme sur fond sombre


def flag_squares(x0, y0, width, height, cols, rows, amplitude, wavelength, colors):
    """Damier ondulé : chaque case est un quadrilatère dont les coins montent ou descendent selon une sinusoïde.
    L'ondulation grandit en s'éloignant de la hampe, comme un vrai drapeau."""
    def dy(x):
        k = (x - x0) / width
        return amplitude * k * math.sin(2 * math.pi * (x - x0) / wavelength)
    out = []
    for r in range(rows):
        for c in range(cols):
            xa, xb = x0 + width * c / cols, x0 + width * (c + 1) / cols
            ya, yb = y0 + height * r / rows, y0 + height * (r + 1) / rows
            pts = [(xa, ya + dy(xa)), (xb, ya + dy(xb)), (xb, yb + dy(xb)), (xa, yb + dy(xa))]
            fill = LIGHT if (r + c) % 2 == 0 else colors[c % len(colors)]
            out.append('<polygon points="%s" fill="%s"/>' % (' '.join('%.1f,%.1f' % p for p in pts), fill))
    # contour orange du tissu
    top = [(x0 + width * i / 24, y0 + dy(x0 + width * i / 24)) for i in range(25)]
    bottom = [(x0 + width * i / 24, y0 + height + dy(x0 + width * i / 24)) for i in range(24, -1, -1)]
    outline = ' '.join('%.1f,%.1f' % p for p in top + bottom)
    out.append('<polygon points="%s" fill="none" stroke="%s" stroke-width="6" stroke-linejoin="round"/>' % (outline, AMBER))
    return '\n    '.join(out)


def icon_svg(opaque=False):
    """Icône complète. Par défaut le fond est transparent et la vue est resserrée sur le dessin ; opaque=True ajoute un fond sombre plein
    (icône d'écran d'accueil iOS, dont le système arrondit les coins)."""
    flag = flag_squares(114, 104, 300, 240, 6, 4, 20, 380, COLUMN_COLORS)
    if opaque:
        box, background, pole = '0 0 512 512', ('<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/>'
                                                 '<stop offset="1" stop-color="%s"/></linearGradient></defs>\n  <rect width="512" height="512" fill="url(#bg)"/>' % (BG_TOP, BG_BOTTOM)), '#d6d6d6'
    else:
        box, background, pole = '57 52 400 400', '', POLE
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="%(box)s">
  %(bg)s
  <!-- hampe -->
  <rect x="96" y="76" width="18" height="372" rx="9" fill="%(pole)s"/>
  <circle cx="105" cy="72" r="16" fill="%(amber)s"/>
  <!-- drapeau à damier : les carreaux sombres prennent les couleurs des LED -->
  <g>
    %(flag)s
  </g>
</svg>
''' % dict(box=box, bg=background, pole=pole, amber=AMBER, flag=flag)


def favicon_svg():
    """Version simplifiée pour 16 à 32 px : gros carreaux, trois couleurs, pas de détails fins."""
    colors = ['#2ecc40', '#ffd60a', '#ff2d2d']
    # Fond blanc sous le damier : seuls les carreaux colorés sont dessinés, ce qui évite les coutures sombres du lissage.
    squares = ['<rect x="17" y="9" width="42" height="39" fill="%s"/>' % LIGHT]
    for r in range(3):
        for c in range(3):
            if (r + c) % 2 == 1:
                squares.append('<rect x="%d" y="%d" width="14" height="13" fill="%s"/>' % (17 + 14 * c, 9 + 13 * r, colors[c]))
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="8 5 54 54">
  <rect x="11" y="6" width="5" height="52" rx="2.5" fill="%(pole)s"/>
  %(sq)s
  <rect x="17" y="9" width="42" height="39" fill="none" stroke="%(amber)s" stroke-width="2.4"/>
</svg>
''' % dict(pole=POLE, sq='\n  '.join(squares), amber=AMBER)


def write(name, content):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(content)
    print('écrit', name)


def png(svg, name, size):
    cairosvg.svg2png(bytestring=svg.encode('utf-8'), write_to=os.path.join(OUT, name), output_width=size, output_height=size)
    print('écrit', name, '%dx%d' % (size, size))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    transparent, small, opaque = icon_svg(False), favicon_svg(), icon_svg(True)
    write('icon.svg', transparent)
    write('favicon.svg', small)
    png(small, 'favicon-32.png', 32)
    png(opaque, 'apple-touch-icon.png', 180)
    png(transparent, 'icon-192.png', 192)
    png(transparent, 'icon-512.png', 512)
