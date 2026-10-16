#!/usr/bin/env python3
"""Génère les icônes de l'application (SVG et PNG) dans img/.

Dessin original : deux drapeaux à damier croisés en X (comme l'icône de l'onglet Race), dont les carreaux sombres prennent les couleurs
des LED (du vert au rouge), avec un accent orange. Aucun logo existant n'est repris. Dépendance : cairosvg (pip install cairosvg).

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


# Proportions : grande étoffe, hampe courte. Les hampes se croisent en (256, CROSS_Y), inclinées de ANGLE degrés ;
# ABOVE et BELOW sont les longueurs de hampe au-dessus et au-dessous du croisement. Le cadre de vue est calculé d'après le dessin.
ANGLE, CROSS_Y, ABOVE, BELOW = 30, 300, 230, 110
CLOTH_W, CLOTH_H, POLE_W, FINIAL_R = 190, 150, 14, 14


def pole_ends():
    t = math.radians(ANGLE)
    top = (256 + ABOVE * math.sin(t), CROSS_Y - ABOVE * math.cos(t))
    bottom = (256 - BELOW * math.sin(t), CROSS_Y + BELOW * math.cos(t))
    return top, bottom


def crossed(flag):
    """Deux drapeaux croisés en X. flag(L) dessine un drapeau hampe verticale : haut de la hampe en (0, 0), étoffe vers +x, longueur L.
    Le drapeau de droite va du haut à droite au bas à gauche ; celui de gauche est son miroir, dessiné dessous."""
    top, bottom = pole_ends()
    dx, dy = bottom[0] - top[0], bottom[1] - top[1]
    angle = math.degrees(math.atan2(-dx, dy))          # rotation qui envoie (0, 1) sur la direction de la hampe
    one = '<g transform="translate(%.1f %.1f) rotate(%.2f)">%s</g>' % (top[0], top[1], angle, flag(math.hypot(dx, dy)))
    return '<g transform="matrix(-1 0 0 1 512 0)">%s</g>\n  %s' % (one, one)


def bounds(margin):
    """Limites du dessin (les deux drapeaux, contour et pointe compris), élargies de margin : (x0, y0, x1, y1)."""
    top, bottom = pole_ends()
    a = math.atan2(-(bottom[0] - top[0]), bottom[1] - top[1])
    c, s = math.cos(a), math.sin(a)
    local = [(x, y) for x in (POLE_W / 2, POLE_W / 2 + CLOTH_W) for y in (-12, CLOTH_H + 12)]     # étoffe ondulée et contour
    local += [(0, -6 - FINIAL_R), (POLE_W / 2, math.hypot(bottom[0] - top[0], bottom[1] - top[1]))]
    pts = [(top[0] + x * c - y * s, top[1] + x * s + y * c) for x, y in local]
    pts += [(512 - x, y) for x, y in pts]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin


def square_box(margin):
    x0, y0, x1, y1 = bounds(margin)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return cx - side / 2, cy - side / 2, side


def icon_svg(opaque=False):
    """Icône complète. Par défaut le fond est transparent et la vue est resserrée sur le dessin ; opaque=True ajoute un fond sombre plein
    (icône d'écran d'accueil iOS, dont le système arrondit les coins)."""
    pole = '#d6d6d6' if opaque else POLE
    colors = ['#2ecc40', '#ffd60a', '#ff9f0a', '#ff2d2d']      # quatre colonnes : du vert au rouge

    def flag(length):
        cloth = flag_squares(POLE_W / 2, 2, CLOTH_W, CLOTH_H, 4, 3, 10, 300, colors)
        return ('<rect x="%g" y="0" width="%g" height="%.1f" rx="%g" fill="%s"/>' % (-POLE_W / 2, POLE_W, length, POLE_W / 2, pole) +
                '<circle cx="0" cy="-6" r="%g" fill="%s"/>' % (FINIAL_R, AMBER) + '<g>%s</g>' % cloth)
    drawing = crossed(flag)
    x, y, side = square_box(4)
    if opaque:          # fond plein 512 x 512, dessin réduit au centre : marge pour les coins arrondis par iOS
        k = 512 * 0.8 / side
        drawing = '<g transform="translate(256 256) scale(%.4f) translate(%.1f %.1f)">%s</g>' % (k, -(x + side / 2), -(y + side / 2), drawing)
        box, background = '0 0 512 512', ('<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/>'
                                          '<stop offset="1" stop-color="%s"/></linearGradient></defs>\n  <rect width="512" height="512" fill="url(#bg)"/>' % (BG_TOP, BG_BOTTOM))
    else:
        box, background = '%.1f %.1f %.1f %.1f' % (x, y, side, side), ''
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="%(box)s">
  %(bg)s
  <!-- deux drapeaux à damier croisés : les carreaux sombres prennent les couleurs des LED -->
  %(drawing)s
</svg>
''' % dict(box=box, bg=background, drawing=drawing)


def favicon_svg():
    """Version simplifiée pour 16 à 32 px : mêmes drapeaux croisés, gros carreaux (3 x 2), contour orange épais, hampe plus large."""
    def flag(length):
        w3 = CLOTH_W / 3.0
        squares = ['<rect x="%g" y="2" width="%g" height="%g" fill="%s"/>' % (POLE_W / 2, CLOTH_W, CLOTH_H, LIGHT)]
        colors = ['#2ecc40', '#ffd60a', '#ff2d2d']
        for r in range(2):
            for c in range(3):
                if (r + c) % 2 == 0:
                    squares.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>' % (POLE_W / 2 + w3 * c, 2 + CLOTH_H / 2 * r, w3, CLOTH_H / 2, colors[c]))
        return ('<rect x="-12" y="0" width="24" height="%.1f" rx="12" fill="%s"/>' % (length, POLE) + ''.join(squares) +
                '<rect x="%g" y="2" width="%g" height="%g" fill="none" stroke="%s" stroke-width="18" stroke-linejoin="round"/>' % (POLE_W / 2, CLOTH_W, CLOTH_H, AMBER))
    x, y, side = square_box(10)
    return '''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="%(box)s">
  %(drawing)s
</svg>
''' % dict(box='%.1f %.1f %.1f %.1f' % (x, y, side, side), drawing=crossed(flag))


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
