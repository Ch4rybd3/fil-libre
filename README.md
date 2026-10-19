# Fil Libre — studio de broderie machine

Application web (100 % dans le navigateur, aucune donnée envoyée) pour créer des motifs
pour l'**Elna eXpressive 830** (format **JEF**) et toute brodeuse lisant **DST** ou **EXP**.
Alternative libre aux principales fonctions d'Elna eXuberance.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # version statique dans dist/ (ouvrir dist/index.html via un serveur)
npm test           # tests du moteur de points et des formats
```

## Fonctions

| Domaine | Fonctions |
|---|---|
| Numérisation | Image → broderie automatique (réduction de couleurs, suppression du fond, vectorisation, satin/tatami selon la largeur), point de croix, PhotoStitch, image de fond pour décalquer |
| Types de points | Point avant (simple / triple / quintuple), colonne satin, remplissage tatami / satin / contour, appliqué (placement → arrêt → fixation → arrêt → bordure) |
| Réglages | Densité, longueur de point, angle, décalage du motif, compensation de traction, sous-couches (centrale, contour, zigzag, tatami), satin fractionné, points d'arrêt, coupes |
| Lettrage | 17 polices libres + vos polices TTF/OTF, texte en arc, interlettrage, multi-ligne, satin / tatami / point avant, monogrammes avec cadre |
| Édition | Formes (cercle, rectangle, étoile, cœur, fleur…), main levée, nœuds, déplacer / redimensionner / pivoter / miroir, aligner, combiner / séparer, conversion entre types, bordure et contour décalé, suppression des chevauchements, ordre de broderie par glisser-déposer, annuler / rétablir |
| Fils | Nuanciers Janome/Elna (codes JEF) et Brother, couleurs libres, optimisation de l'ordre des couleurs |
| Vérification | Rendu réaliste, simulateur de broderie, sauts, statistiques (points, couleurs, coupes, durée), alerte de dépassement du cercle |
| Fichiers | Export JEF / DST / EXP / PNG, import JEF / DST / EXP, projet `.fillibre`, fiche d'impression, sauvegarde automatique |

Cercles proposés : RE28b 200×280, SQ20b 200×200, RE20b 140×200, SQ14b 140×140 (+ formats courants).

## Organisation du code

- `src/core` — modèle, géométrie (Clipper), générateurs de points, lettrage, plan de broderie
- `src/formats` — lecture / écriture JEF, DST, EXP
- `src/digitize` — numérisation automatique, point de croix, PhotoStitch
- `src/ui` — interface (canevas, outils, panneaux, dialogues)
