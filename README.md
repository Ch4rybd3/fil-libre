# Fil Libre — studio de broderie machine

Application web (100 % dans le navigateur, aucune donnée envoyée) pour créer des motifs
pour l'**Elna eXpressive 830** (format **JEF**) et toute brodeuse lisant **DST** ou **EXP**.
Alternative libre aux principales fonctions d'Elna eXuberance.

## 🚀 Utiliser sans rien installer

La dernière version est en ligne : **https://ch4rybd3.github.io/fil-libre/**

Tout se passe dans votre navigateur : vos images et vos motifs ne quittent jamais votre ordinateur.
Navigateurs conseillés : Firefox, Chrome, Edge ou Chromium récents.

## 💻 Installer sur son ordinateur

Utile pour travailler hors ligne ou modifier le code.

### 1. Installer les prérequis

Il faut **Git** et **Node.js 22.12 ou plus récent** (Node 24 LTS conseillé).

| Système | Commande / lien |
|---|---|
| **Windows** | Télécharger Node.js LTS sur [nodejs.org](https://nodejs.org/fr/download) et Git sur [git-scm.com](https://git-scm.com/download/win) — ou, dans PowerShell : `winget install OpenJS.NodeJS.LTS Git.Git` |
| **macOS** | `brew install node git` (avec [Homebrew](https://brew.sh)) — ou l'installeur de [nodejs.org](https://nodejs.org/fr/download) |
| **Ubuntu / Debian** | `sudo apt install git` puis Node.js via [nodejs.org](https://nodejs.org/fr/download) (les paquets `apt` sont souvent trop anciens) |
| **Arch / Omarchy** | `sudo pacman -S nodejs npm git` |

Vérifier dans un terminal :

```bash
node -v   # doit afficher v22.12 ou plus
git --version
```

### 2. Récupérer et lancer Fil Libre

```bash
git clone https://github.com/Ch4rybd3/fil-libre.git
cd fil-libre
npm install
npm run dev
```

Ouvrez ensuite **http://localhost:5180** dans votre navigateur. C'est tout !
Pour arrêter : `Ctrl + C` dans le terminal. Pour relancer plus tard : `cd fil-libre` puis `npm run dev`.

> 📱 Le serveur écoute sur tout le réseau local : depuis une tablette ou un autre ordinateur
> du même Wi-Fi, ouvrez `http://<adresse-IP-de-l'ordinateur>:5180`.

### 3. Mettre à jour

```bash
cd fil-libre
git pull
npm install
```

### Autres commandes

```bash
npm run build      # version statique dans dist/ (à héberger sur n'importe quel serveur web)
npm run preview    # tester la version de dist/ localement
npm test           # tests du moteur de points et des formats
```

### Problèmes fréquents

- **`npm: command not found` / `node` introuvable** — fermez et rouvrez le terminal après l'installation de Node.js.
- **Erreur `Unsupported engine` ou erreur de syntaxe au lancement** — votre Node.js est trop ancien : installez la version LTS.
- **Le port 5180 est déjà utilisé** — Vite en choisit un autre automatiquement ; l'adresse exacte s'affiche dans le terminal.
- **Ouvrir `dist/index.html` en double-cliquant ne marche pas** — utilisez `npm run preview` (le navigateur bloque le chargement des polices en `file://`).

## 🧵 Envoyer un motif à la brodeuse

1. Dans Fil Libre : bouton **Exporter JEF** ou menu **Exporter pour la brodeuse…** (`Ctrl+E`), au format JEF (ou DST / EXP selon votre machine).
2. Copiez le fichier `.jef` sur une clé USB.
3. Branchez la clé sur l'eXpressive 830 et ouvrez le motif depuis le menu USB.

Vérifiez que le cercle choisi dans Fil Libre correspond à celui monté sur la machine.
Les codes de cercle JEF sont donnés au mieux : faites un essai sur une chute de tissu avant un projet important.

Votre travail est sauvegardé automatiquement dans le navigateur ; utilisez **Enregistrer le projet**
(fichier `.fillibre`) pour le garder durablement ou le transférer sur un autre ordinateur.

## Fonctions

| Domaine | Fonctions |
|---|---|
| Numérisation | Image → broderie automatique : réduction de couleurs, fusion automatique des nuances proches, regroupement / exclusion manuels des couleurs (pastilles cliquables), précision réglable, suppression du fond qui garde les zones claires intérieures, satin/tatami selon la largeur, contour par-dessus ; mode **contours seuls** (ligne centrale des traits du dessin, limites entre couleurs ou contour de chaque zone, en point triple, simple ou satin) ; point de croix, PhotoStitch, image de fond pour décalquer |
| Types de points | Point avant (simple / triple / quintuple), colonne satin, remplissage tatami / satin / contour, appliqué (placement → arrêt → fixation → arrêt → bordure) |
| Réglages | Densité, longueur de point, angle, décalage du motif, compensation de traction, sous-couches (centrale, contour, zigzag, tatami), satin fractionné, points d'arrêt, coupes |
| Lettrage | 107 polices libres avec catalogue et aperçus (bâton, empattement, script, manuscrite, fantaisie, gothique…) + vos polices TTF/OTF ; alphabets latin, cyrillique, grec, hébreu, arabe (lettres liées), japonais, chinois, coréen, thaï, géorgien, arménien, symboles et emoji (police de secours automatique pour les caractères absents) ; texte en arc, interlettrage, multi-ligne, satin / tatami / point avant, monogrammes avec cadre |
| Édition | Formes (cercle, rectangle, étoile, cœur, fleur…), main levée, nœuds, déplacer / redimensionner / pivoter / miroir, aligner, combiner / séparer, conversion entre types, bordure et contour décalé, suppression des chevauchements, ordre de broderie par glisser-déposer, annuler / rétablir |
| Fils | Nuanciers Janome/Elna (codes JEF) et Brother, couleurs libres, optimisation de l'ordre des couleurs |
| Vérification | Rendu réaliste, simulateur de broderie, sauts, statistiques (points, couleurs, coupes, durée), alerte de dépassement du cercle |
| Fichiers | Export JEF / DST / EXP / PNG, import JEF / DST / EXP, projet `.fillibre`, fiche d'impression, sauvegarde automatique |

Cercles proposés : RE28b 200×280, SQ20b 200×200, RE20b 140×200, SQ14b 140×140 (+ formats courants).

## Organisation du code
## Organisation du code

- `src/core` — modèle, géométrie (Clipper), générateurs de points, lettrage, plan de broderie
- `src/formats` — lecture / écriture JEF, DST, EXP
- `src/digitize` — numérisation automatique, point de croix, PhotoStitch
- `src/ui` — interface (canevas, outils, panneaux, dialogues)

## Licence

Code sous licence [MIT](LICENSE). Les polices de `public/fonts` proviennent de Google Fonts et
restent sous leur propre licence (SIL Open Font License, Apache 2.0 ou Ubuntu Font Licence).
Elles ont été figées à une graisse et allégées (sans hinting) avec fontTools ; les polices chinoises,
japonaises et coréennes (5 à 10 Mo) ne sont téléchargées qu'au premier usage.
Fil Libre n'est ni affilié ni approuvé par Elna ou Janome.
