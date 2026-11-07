// Numérisation automatique : image → zones de couleur → objets de broderie.
import { Cmd, type EmbObject, type Poly, type Pt, type Stitch, type Thread } from '../core/types';
import { chaikin, douglasPeucker, polyLength, resample, principalAngle, signedArea, splitIslands, normalize } from '../core/geometry';
import { nearestThread, rgbToLab } from '../core/threads';
import { makeFill, makeRun, makeSatin, uid } from '../core/defaults';

export interface RGB { r: number; g: number; b: number }

export type Lab = number[];

export interface AutoOptions {
  widthMm: number;          // largeur du motif obtenu
  colors: number;           // nombre de couleurs (hors fond)
  removeBg: boolean;
  bgOutsideOnly: boolean;   // ne retirer le fond que s'il touche les bords (garde les zones claires intérieures)
  smooth: number;           // 0..3 lissage des contours
  minAreaMm2: number;       // élimine les petites taches
  satinWidth: number;       // zones plus fines que ça → satin
  outline: boolean;         // (ancien) contour silhouette en point triple
  contour: 'none' | 'silhouette' | 'all'; // contour ajouté par-dessus le remplissage
  threadChart: string;      // 'Janome/Elna' | 'Brother' | 'exact'
  denoise: boolean;
  precision: number;        // mm par pixel de l'image de travail (plus petit = plus fin)
  mergeDE: number;          // fusionne les nuances plus proches que ce ΔE (0 = désactivé)
  groups: Lab[][];          // regroupements manuels (couleurs Lab)
  excluded: Lab[];          // couleurs à ne pas broder
  render: 'fill' | 'outline';
  outlineColor: 'each' | 'darkest' | 'lines';
  outlineStitch: 'triple' | 'simple' | 'satin';
  outlineWidth: number;     // largeur du satin de contour (mm)
  keepLines: boolean;       // détecter les traits fins foncés (même anticrénelés) et les garder
  lineSatin: boolean;       // zones longues et fines → colonne satin qui suit le trait
  linesLast: boolean;       // broder les traits de la couleur la plus foncée en dernier (finition)
  outer: boolean;           // contour extérieur complet qui ferme le motif (brodé en tout dernier)
  outerThread: Thread | null; // couleur du contour extérieur (null = la plus foncée du motif)
  outerStitch: 'satin' | 'triple' | 'simple';
  outerWidth: number;       // largeur du satin extérieur (mm)
}

export const defaultAuto: AutoOptions = {
  widthMm: 90, colors: 6, removeBg: true, bgOutsideOnly: true, smooth: 2, minAreaMm2: 2, satinWidth: 2.5, outline: false, contour: 'none',
  threadChart: 'Janome/Elna', denoise: true, precision: 0.2, mergeDE: 0, groups: [], excluded: [],
  render: 'fill', outlineColor: 'lines', outlineStitch: 'triple', outlineWidth: 1.2,
  keepLines: true, lineSatin: true, linesLast: true,
  outer: false, outerThread: null, outerStitch: 'satin', outerWidth: 1,
};

export interface Quantized {
  w: number; h: number; mmPerPx: number;
  labels: Int16Array;       // -1 = fond
  palette: RGB[];
  lab: Lab[];               // couleur Lab de chaque étiquette
  counts: Int32Array;       // nombre de pixels par étiquette
  fate: number[];           // pour chaque nuance détectée : étiquette qui a reçu la majorité de ses pixels
  bgLabel: number;
}

/** Taille (px) de l'image de travail pour une précision donnée. */
export const workSize = (o: AutoOptions) => Math.min(1800, Math.max(150, Math.round(o.widthMm / o.precision)));

/** Redimensionne une image vers un canvas de travail (agrandit jusqu'à ×maxUp pour lisser les contours). */
export function imageToData(img: CanvasImageSource & { width: number; height: number }, maxPx: number, maxUp = 1): ImageData {
  const k = Math.min(maxUp, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Lissage qui préserve les bords (filtre sigma) : chaque pixel prend la moyenne de ses voisins
 * de couleur proche. Efface le bruit JPEG et les dégradés légers sans baver sur les contours.
 */
function sigmaFilter(d: Uint8ClampedArray, w: number, h: number, radius = 2, thr = 48): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const r0 = d[o], g0 = d[o + 1], b0 = d[o + 2];
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const i = (yy * w + xx) * 4;
        if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > thr) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = d[o + 3];
  }
  return out;
}

const dist3 = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** k-means (k-means++) dans l'espace Lab. Retourne les centres et leur poids. */
function kmeans(samples: number[][], k: number, iters = 14): { cents: number[][]; counts: number[] } {
  const n = samples.length;
  const cents: number[][] = [samples[Math.floor(n / 2)].slice()];
  const d2 = new Float64Array(n).fill(Infinity);
  while (cents.length < k) {
    const c = cents[cents.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const dd = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
      if (dd < d2[i]) d2[i] = dd;
      sum += d2[i];
    }
    if (sum === 0) break;
    // tirage déterministe pondéré (reproductible)
    let t = sum * ((cents.length * 0.618034) % 1), pick = 0;
    for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
    cents.push(samples[pick].slice());
  }
  const assign = new Int32Array(n);
  let counts: number[] = [];
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const s = samples[i], q = cents[c];
        const dd = (s[0] - q[0]) ** 2 + (s[1] - q[1]) ** 2 + (s[2] - q[2]) ** 2;
        if (dd < bd) { bd = dd; best = c; }
      }
      assign[i] = best;
    }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const a = acc[assign[i]], s = samples[i]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++; }
    acc.forEach((a, c) => { if (a[3]) cents[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    counts = acc.map((a) => a[3]);
  }
  return { cents, counts };
}

/** Regroupe des étiquettes (union-find) en mettant à jour la couleur moyenne pondérée. */
class Groups {
  parent: number[];
  constructor(public lab: Lab[], public w: number[]) { this.parent = lab.map((_, i) => i); }
  find(i: number): number { while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]]; return i; }
  union(a: number, b: number) {
    a = this.find(a); b = this.find(b);
    if (a === b) return;
    if (this.w[b] > this.w[a]) [a, b] = [b, a];
    const W = this.w[a] + this.w[b] || 1;
    this.lab[a] = this.lab[a].map((v, j) => (v * this.w[a] + this.lab[b][j] * this.w[b]) / W);
    this.w[a] += this.w[b];
    this.parent[b] = a;
  }
  roots() { return this.parent.map((_, i) => this.find(i)); }
}

/** Fusion automatique : réunit les nuances plus proches que `de` (ΔE Lab), la plus proche d'abord. */
function autoMerge(g: Groups, de: number) {
  if (de <= 0) return;
  for (;;) {
    const r = [...new Set(g.roots())];
    let best: [number, number] | null = null, bd = de;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const d = dist3(g.lab[r[i]], g.lab[r[j]]);
      if (d < bd) { bd = d; best = [r[i], r[j]]; }
    }
    if (!best) return;
    g.union(best[0], best[1]);
  }
}

/** Retrouve l'étiquette correspondant à une couleur mémorisée (regroupement manuel, exclusion). */
const MATCH_DE = 9;
function matchLabels(g: Groups, color: Lab): number[] {
  const r = [...new Set(g.roots())];
  return r.filter((l) => dist3(g.lab[l], color) < MATCH_DE);
}

export function quantize(img: ImageData, o: AutoOptions, raw = false): Quantized {
  const { width: w, height: h } = img;
  const d = o.denoise ? sigmaFilter(img.data, w, h) : img.data;
  const N = w * h;
  const lab: number[][] = new Array(N);
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    alpha[i] = img.data[i * 4 + 3];
    lab[i] = rgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  }
  const opaque: number[] = [];
  for (let i = 0; i < N; i++) if (alpha[i] > 127) opaque.push(i);
  const hasAlpha = opaque.length < N * 0.98;
  const k = o.colors + (o.removeBg && !hasAlpha ? 1 : 0);
  const step = Math.max(1, Math.floor(opaque.length / 30000));
  const samples: number[][] = [];
  for (let i = 0; i < opaque.length; i += step) samples.push(lab[opaque[i]]);
  const km = samples.length ? kmeans(samples, Math.max(1, k)) : { cents: [[100, 0, 0]], counts: [1] };
  const cents = km.cents;
  // regroupements : automatique (ΔE), puis manuels
  const g = new Groups(cents.map((c) => c.slice()), km.counts.slice());
  if (!raw) {
    autoMerge(g, o.mergeDE);
    for (const grp of o.groups ?? []) {
      const ls = grp.flatMap((c) => matchLabels(g, c));
      for (let i = 1; i < ls.length; i++) g.union(ls[0], ls[i]);
    }
  }
  const root = g.roots();
  let labels: Int16Array = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    if (alpha[i] <= 127) { labels[i] = -1; continue; }
    let best = 0, bd = Infinity;
    for (let c = 0; c < cents.length; c++) {
      const s = lab[i], q = cents[c];
      const dd = (s[0] - q[0]) ** 2 + (s[1] - q[1]) ** 2 + (s[2] - q[2]) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    labels[i] = root[best];
  }
  const labOf = g.lab.map((c, i) => (root[i] === i ? c : g.lab[root[i]]));
  // filtre de mode 3×3 : supprime le bruit isolé
  const before = labels.slice();
  if (!raw) {
    for (let pass = 0; pass < 2; pass++) labels = modeFilter(labels, w, h, cents.length);
    mergeTransitionColors(labels, w, h, labOf);
    if (o.keepLines) {
      // la couleur des traits est-elle le fond qui sera entièrement retiré ? (logo sur fond noir)
      let darkIsBg = false;
      if (o.removeBg && !hasAlpha && !o.bgOutsideOnly) {
        const cnt = new Map<number, number>();
        const addB = (i: number) => cnt.set(labels[i], (cnt.get(labels[i]) ?? 0) + 1);
        for (let x = 0; x < w; x++) { addB(x); addB((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { addB(y * w); addB(y * w + w - 1); }
        const b = [...cnt.entries()].filter(([l]) => l >= 0).sort((a, c) => c[1] - a[1])[0]?.[0] ?? -1;
        const present = [...new Set(Array.from(labels).filter((l) => l >= 0))];
        const dk = present.reduce((a, c) => (labOf[a][0] < labOf[c][0] ? a : c), present[0]);
        darkIsBg = b >= 0 && b === dk;
      }
      forceThinLines(labels, w, h, lab, labOf, darkIsBg);
    }
  }
  // devenir de chaque nuance (une nuance absorbée suit celle qui l'a reçue lors des regroupements manuels)
  const K = cents.length;
  const flow = new Int32Array(K * (K + 1));
  for (let i = 0; i < N; i++) if (before[i] >= 0) flow[before[i] * (K + 1) + labels[i] + 1]++;
  const fate = cents.map((_, c) => {
    let best = -1, bv = 0;
    for (let d = 0; d <= K; d++) if (flow[c * (K + 1) + d] > bv) { bv = flow[c * (K + 1) + d]; best = d - 1; }
    return best;
  });
  // fond = étiquette dominante sur la bordure
  let bgLabel = -1;
  if (o.removeBg && !hasAlpha) {
    const cnt = new Map<number, number>();
    const add = (i: number) => cnt.set(labels[i], (cnt.get(labels[i]) ?? 0) + 1);
    for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
    bgLabel = [...cnt.entries()].filter(([l]) => l >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    if (bgLabel >= 0) {
      if (o.bgOutsideOnly && !raw) floodFromBorder(labels, w, h, bgLabel);
      else for (let i = 0; i < N; i++) if (labels[i] === bgLabel) labels[i] = -1;
      if (!raw) fillCracks(labels, w, h, Math.max(1, Math.round(0.4 / (o.widthMm / w))));
    }
  }
  // couleurs exclues par l'utilisateur
  if (!raw) for (const c of o.excluded ?? []) {
    const ls = new Set(matchLabels(g, c));
    if (ls.size) for (let i = 0; i < N; i++) if (ls.has(labels[i])) labels[i] = -1;
  }
  const palette: RGB[] = labOf.map((c) => labToRgb(c));
  const mmPerPx = o.widthMm / w;
  if (!raw) removeSmall(labels, w, h, Math.max(1, o.minAreaMm2 / (mmPerPx * mmPerPx)), labOf, Math.max(4, 0.4 / (mmPerPx * mmPerPx)));
  const counts = new Int32Array(cents.length);
  for (let i = 0; i < N; i++) if (labels[i] >= 0) counts[labels[i]]++;
  return { w, h, mmPerPx, labels, palette, lab: labOf, counts, fate, bgLabel };
}

/** Filtre max (ou min) carré de rayon r, séparable. */
function rankFilter(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pick = max ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = src[y * w + x];
    for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) v = pick(v, src[y * w + xx]); }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = tmp[y * w + x];
    for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]); }
    out[y * w + x] = v;
  }
  return out;
}

/**
 * Les traits fins d'un dessin (1–3 px) sont adoucis par l'anticrénelage : leurs pixels sont gris ou
 * vert foncé plutôt que noirs et finissent rangés avec la couleur voisine. On les repère comme
 * « plus sombres que leur voisinage » (top-hat noir sur la luminance) et on les rend à la couleur des traits.
 */
function forceThinLines(labels: Int16Array, w: number, h: number, lab: number[][], labOf: Lab[], darkIsBg = false) {
  const present = [...new Set(Array.from(labels).filter((l) => l >= 0))];
  if (present.length < 2) return;
  const dark = present.reduce((a, b) => (labOf[a][0] < labOf[b][0] ? a : b));
  const Ld = labOf[dark][0];
  if (Ld > 40) return; // pas de couleur de trait franche dans l'image
  const N = w * h;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = labels[i] < 0 ? 100 : lab[i][0];
  // si le noir est le fond retiré, ses traits fins deviendraient des trous : on ne les force pas
  const closed = darkIsBg ? null : rankFilter(rankFilter(L, w, h, 2, true), w, h, 2, false);
  if (closed) for (let i = 0; i < N; i++) {
    if (labels[i] < 0 || labels[i] === dark) continue;
    const depth = closed[i] - L[i];
    // assez creusé par rapport aux voisins, et nettement plus proche du noir que de sa zone
    if (depth > 14 && L[i] < Ld + 0.6 * (labOf[labels[i]][0] - Ld)) labels[i] = dark;
  }
  // inverse : déliés clairs sur fond sombre (calligraphie dorée sur noir…). Les pixels mêlés
  // au noir sont rendus à la couleur claire la plus proche plutôt qu'au fond.
  const opened = rankFilter(rankFilter(L, w, h, 2, false), w, h, 2, true);
  const others = present.filter((l) => l !== dark && labOf[l][0] > Ld + 20);
  if (!others.length) return;
  for (let i = 0; i < N; i++) {
    if (labels[i] !== dark) continue;
    const rise = L[i] - opened[i];
    if (rise <= 8 || L[i] < Ld + 7) continue;
    // couleur claire la plus proche en teinte (on compare a/b normalisés, la luminance étant atténuée)
    const c = lab[i];
    let best = -1, bd = Infinity, bt = 0;
    for (const l of others) {
      const q = labOf[l];
      const t = Math.max(0.1, Math.min(1, (c[0] - Ld) / (q[0] - Ld)));
      const d = Math.hypot(c[1] - q[1] * t, c[2] - q[2] * t);
      if (d < bd) { bd = d; best = l; bt = t; }
    }
    // la teinte doit correspondre (un grain gris du fond ne devient pas un fil coloré)
    const qc = best >= 0 ? Math.hypot(labOf[best][1], labOf[best][2]) * bt : 0;
    const pc = Math.hypot(c[1], c[2]);
    const hueOk = qc < 6 ? pc < 8 : pc > qc * 0.45;
    if (best >= 0 && bd < 6 + 22 * bt && hueOk) labels[i] = best;
  }
}

/**
 * Rebouche les fissures fines laissées par le retrait du fond (rayures, ombres fines) :
 * un pixel de fond encadré à moins de `r` pixels par la même couleur des deux côtés reprend cette couleur.
 */
function fillCracks(labels: Int16Array, w: number, h: number, r: number) {
  const src = labels.slice();
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : src[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (src[y * w + x] !== -1) continue;
    for (const [dx, dy] of dirs) {
      let a = -1, b = -1;
      for (let k = 1; k <= r && a === -1; k++) a = at(x + dx * k, y + dy * k);
      for (let k = 1; k <= r && b === -1; k++) b = at(x - dx * k, y - dy * k);
      if (a >= 0 && a === b) { labels[y * w + x] = a; break; }
    }
  }
}

/** Retire la couleur de fond uniquement là où elle est reliée au bord de l'image. */
function floodFromBorder(labels: Int16Array, w: number, h: number, bg: number) {
  const stack: number[] = [];
  const push = (i: number) => { if (labels[i] === bg) { labels[i] = -1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
}

/**
 * L'anticrénelage crée des couleurs intermédiaires en liseré autour des formes.
 * Une couleur est considérée parasite si elle est presque entièrement en bordure
 * ET se situe entre deux autres couleurs de la palette : ses pixels rejoignent leurs voisins.
 */
function mergeTransitionColors(labels: Int16Array, w: number, h: number, cents: number[][]) {
  const k = cents.length;
  const count = new Int32Array(k), edge = new Int32Array(k);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = labels[y * w + x];
    if (l < 0) continue;
    count[l]++;
    if ((x > 0 && labels[y * w + x - 1] !== l) || (x < w - 1 && labels[y * w + x + 1] !== l) ||
        (y > 0 && labels[(y - 1) * w + x] !== l) || (y < h - 1 && labels[(y + 1) * w + x] !== l)) edge[l]++;
  }
  const segDist = (c: number[], a: number[], b: number[]) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / l2));
    return Math.hypot(c[0] - a[0] - t * ab[0], c[1] - a[1] - t * ab[1], c[2] - a[2] - t * ab[2]);
  };
  const bad = new Set<number>();
  for (let c = 0; c < k; c++) {
    if (!count[c] || edge[c] / count[c] < 0.55) continue;
    let between = false;
    for (let a = 0; a < k && !between; a++) for (let b = a + 1; b < k; b++) {
      if (a === c || b === c || !count[a] || !count[b]) continue;
      if (segDist(cents[c], cents[a], cents[b]) < 14) { between = true; break; }
    }
    // pixels transparents voisins (fond) : comparer aussi avec le blanc
    if (!between) for (let a = 0; a < k; a++) if (a !== c && count[a] && segDist(cents[c], cents[a], [100, 0, 0]) < 10) between = true;
    if (between) bad.add(c);
  }
  if (!bad.size) return;
  for (let pass = 0; pass < 12; pass++) {
    let changed = 0;
    const src = labels.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bad.has(src[i])) continue;
      const votes = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const l = src[yy * w + xx];
        if (!bad.has(l)) votes.set(l, (votes.get(l) ?? 0) + 1);
      }
      if (!votes.size) continue;
      // à égalité, préférer la couleur la plus proche
      let best = -2, bv = -1, bd = Infinity;
      for (const [l, v] of votes) {
        const d = l < 0 ? 50 : Math.hypot(...cents[l].map((q, j) => q - cents[src[i]][j]) as [number, number, number]);
        if (v > bv || (v === bv && d < bd)) { best = l; bv = v; bd = d; }
      }
      labels[i] = best; changed++;
    }
    if (!changed) break;
  }
}

function modeFilter(src: Int16Array, w: number, h: number, k: number): Int16Array {
  const out = new Int16Array(src.length);
  const cnt = new Int32Array(k + 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    cnt.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      cnt[src[yy * w + xx] + 1]++;
    }
    const self = src[y * w + x];
    let best = self, bc = cnt[self + 1];
    for (let c = 0; c <= k; c++) if (cnt[c] > bc + 1) { bc = cnt[c]; best = c - 1; }
    out[y * w + x] = best;
  }
  return out;
}

/** Fusionne les petites taches avec la couleur voisine majoritaire. */
function removeSmall(labels: Int16Array, w: number, h: number, minPx: number, labOf?: Lab[], keepPx = Infinity) {
  const N = w * h;
  const comp = new Int32Array(N).fill(-1);
  const stack: number[] = [];
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue;
    const lab = labels[s];
    const members: number[] = [];
    stack.push(s); comp[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && comp[q] < 0 && labels[q] === lab) { comp[q] = id; stack.push(q); }
    }
    if (members.length < minPx) {
      const cnt = new Map<number, number>();
      for (const p of members) {
        const x = p % w, y = (p / w) | 0;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && labels[q] !== lab) cnt.set(labels[q], (cnt.get(labels[q]) ?? 0) + 1);
        }
      }
      const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
      // petit détail très contrasté (œil, reflet) : on le garde s'il n'est pas minuscule
      const contrast = best && labOf && lab >= 0 && best[0] >= 0 ? dist3(labOf[lab], labOf[best[0]]) : 0;
      if (best && !(contrast > 30 && members.length >= keepPx)) for (const p of members) labels[p] = best[0];
    }
    id++;
  }
}

export function labToRgb([L, A, B]: number[]): RGB {
  let y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
  const g = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c)));
  return { r: g(x * 3.2406 - y * 1.5372 - z * 0.4986), g: g(-x * 0.9689 + y * 1.8758 + z * 0.0415), b: g(x * 0.0557 - y * 0.204 + z * 1.057) };
}

/** Contours (bords de pixels) d'un masque binaire, en coordonnées pixel. */
export function traceMask(mask: Uint8Array, w: number, h: number): Poly[] {
  const W = w + 1;
  const out = new Map<number, number[]>(); // sommet → sommets suivants
  const addEdge = (a: number, b: number) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) addEdge(y * W + x, y * W + x + 1);
    if (!inside(x + 1, y)) addEdge(y * W + x + 1, (y + 1) * W + x + 1);
    if (!inside(x, y + 1)) addEdge((y + 1) * W + x + 1, (y + 1) * W + x);
    if (!inside(x - 1, y)) addEdge((y + 1) * W + x, y * W + x);
  }
  const loops: Poly[] = [];
  for (const [start, nexts] of out) {
    while (nexts.length) {
      const loop: Pt[] = [];
      let cur = start;
      let prevDir = -1;
      let guard = 0;
      do {
        const l = out.get(cur)!;
        let pick = 0;
        if (l.length > 1 && prevDir >= 0) {
          // aux coins diagonaux : tourner du même côté pour séparer les zones
          for (let i = 0; i < l.length; i++) {
            const dir = edgeDir(cur, l[i], W);
            if (dir === (prevDir + 1) % 4) { pick = i; break; }
          }
        }
        const nxt = l.splice(pick, 1)[0];
        prevDir = edgeDir(cur, nxt, W);
        loop.push({ x: cur % W, y: Math.floor(cur / W) });
        cur = nxt;
      } while (cur !== start && out.get(cur)?.length && guard++ < 1e7);
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function edgeDir(a: number, b: number, W: number): number {
  const d = b - a;
  return d === 1 ? 0 : d === W ? 1 : d === -1 ? 2 : 3; // droite, bas, gauche, haut
}

function smoothLoop(p: Poly, level: number): Poly {
  // supprimer l'effet d'escalier, puis arrondir
  let q = douglasPeucker([...p, p[0]], 0.6 + level * 0.15).slice(0, -1);
  if (q.length < 3) q = p;
  if (level > 0) q = chaikin(q, level, true);
  return q;
}

/** Fil correspondant à chaque étiquette (null en mode couleurs exactes). */
export function threadsOf(q: Quantized, chart: string): (Thread | null)[] {
  return q.palette.map((c) => (chart === 'exact' ? null : nearestThread(c, chart)));
}

/** Copie de la quantification où les couleurs qui tombent sur le même fil sont réunies (aperçu). */
export function unifyThreads(q: Quantized, chart: string): Quantized {
  const c = { ...q, labels: q.labels.slice() };
  unifyByThread(c, chart);
  return c;
}

/** Deux couleurs de l'image qui tombent sur le même fil deviennent une seule zone. */
function unifyByThread(q: Quantized, chart: string) {
  if (chart === 'exact') return;
  const keys = q.palette.map((c) => { const t = nearestThread(c, chart); return t.chart + t.code; });
  const first = new Map<string, number>();
  keys.forEach((k, l) => { if (!first.has(k) || (!q.counts[first.get(k)!] && q.counts[l])) first.set(k, l); });
  const remap = keys.map((k) => first.get(k)!);
  for (let i = 0; i < q.labels.length; i++) if (q.labels[i] >= 0) q.labels[i] = remap[q.labels[i]];
}

/**
 * Lignes de séparation entre zones de couleur (et avec le fond), chacune une seule fois.
 * Les lignes s'arrêtent aux jonctions de 3 zones ou plus. Coordonnées en sommets de pixels.
 */
export function boundaryPaths(labels: Int16Array, w: number, h: number, skip?: (a: number, b: number) => boolean): { pts: Pt[]; closed: boolean }[] {
  const W = w + 1;
  const ea: number[] = [], eb: number[] = [];
  const adj = new Map<number, number[]>();
  const addE = (a: number, b: number) => {
    const id = ea.length; ea.push(a); eb.push(b);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(id);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(id);
  };
  const L = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : labels[y * w + x]);
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    // arête verticale à gauche du pixel (x, y)
    if (y < h && L(x - 1, y) !== L(x, y) && !skip?.(L(x - 1, y), L(x, y))) addE(y * W + x, (y + 1) * W + x);
    // arête horizontale au-dessus du pixel (x, y)
    if (x < w && L(x, y - 1) !== L(x, y) && !skip?.(L(x, y - 1), L(x, y))) addE(y * W + x, y * W + x + 1);
  }
  const used = new Uint8Array(ea.length);
  const out: { pts: Pt[]; closed: boolean }[] = [];
  const P = (v: number): Pt => ({ x: v % W, y: Math.floor(v / W) });
  const other = (e: number, v: number) => (ea[e] === v ? eb[e] : ea[e]);
  const walk = (start: number, e0: number) => {
    const pts = [P(start)];
    let v = start, e = e0;
    for (;;) {
      used[e] = 1;
      v = other(e, v);
      pts.push(P(v));
      const l = adj.get(v)!;
      if (l.length !== 2 || v === start) break;
      const nx = l[0] === e ? l[1] : l[0];
      if (used[nx]) break;
      e = nx;
    }
    return { pts, closed: v === start };
  };
  for (const [v, l] of adj) if (l.length !== 2) for (const e of l) if (!used[e]) out.push(walk(v, e));
  for (let e = 0; e < ea.length; e++) if (!used[e]) out.push(walk(ea[e], e));
  return out;
}

/** Amincissement de Zhang-Suen : réduit un masque à des lignes d'un pixel. */
function thin(mask: Uint8Array, w: number, h: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const del: number[] = [];
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const b = p.reduce((s, v) => s + v, 0);
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(y * w + x);
      }
      for (const i of del) mask[i] = 0;
      if (del.length) changed = true;
    }
  }
}

/** Lignes centrales d'un masque (traits d'un dessin), en coordonnées de centres de pixels. */
export function centerlines(src: Uint8Array, w: number, h: number): { pts: Pt[]; closed: boolean; width: number }[] {
  const mask = src.slice();
  const area = mask.reduce((s, v) => s + v, 0);
  thin(mask, w, h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  // voisins dans l'ordre circulaire N, NE, E, SE, S, SO, O, NO
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const ring = (x: number, y: number) => RING.map(([dx, dy]) => at(x + dx, y + dy));
  // retirer les coins en escalier (pixel redondant entre deux voisins orthogonaux)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const p = ring(x, y);
    for (let r = 0; r < 4; r++) {
      const a = p[(r * 2) % 8], b = p[(r * 2 + 2) % 8];
      const opp = [p[(r * 2 + 4) % 8], p[(r * 2 + 5) % 8], p[(r * 2 + 6) % 8]];
      if (a && b && !opp[0] && !opp[1] && !opp[2]) { mask[y * w + x] = 0; break; }
    }
  }
  // classification : nombre de branches = transitions 0→1 autour du pixel
  const N = w * h;
  const branches = new Uint8Array(N);
  let skel = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    skel++;
    const p = ring(i % w, (i / w) | 0);
    let t = 0;
    for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) t++;
    if (t === 0 && p.some((v) => v)) t = 1;
    branches[i] = t;
  }
  const width = skel ? area / skel : 1;
  const isNode = (i: number) => mask[i] && branches[i] !== 2;
  const nbs = (i: number) => {
    const x = i % w, y = (i / w) | 0, out: number[] = [];
    // orthogonaux d'abord
    for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const xx = x + RING[k][0], yy = y + RING[k][1];
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) out.push(yy * w + xx);
    }
    return out;
  };
  const visited = new Uint8Array(N);
  const segs: { idx: number[]; closed: boolean }[] = [];
  const nodePairs = new Set<string>();
  const walk = (start: number, first: number) => {
    const idx = [start, first];
    let prev = start, cur = first;
    visited[first] = 1;
    for (;;) {
      if (isNode(cur)) break;
      const cand = nbs(cur).filter((q) => q !== prev && (isNode(q) ? q !== start || idx.length > 3 : !visited[q]));
      const node = cand.find(isNode);
      const nx = node ?? cand[0];
      if (nx === undefined) break;
      idx.push(nx);
      if (!isNode(nx)) visited[nx] = 1;
      prev = cur; cur = nx;
    }
    return idx;
  };
  for (let i = 0; i < N; i++) {
    if (!isNode(i)) continue;
    for (const q of nbs(i)) {
      if (isNode(q)) {
        const k = i < q ? i + ',' + q : q + ',' + i;
        if (!nodePairs.has(k)) { nodePairs.add(k); segs.push({ idx: [i, q], closed: false }); }
      } else if (!visited[q]) segs.push({ idx: walk(i, q), closed: false });
    }
  }
  // boucles fermées sans embranchement
  for (let i = 0; i < N; i++) {
    if (!mask[i] || isNode(i) || visited[i]) continue;
    visited[i] = 1;
    const n = nbs(i);
    if (!n.length) continue;
    const idx = walk(i, n[0]);
    segs.push({ idx: [i, ...idx.slice(1)], closed: true });
  }
  // supprimer les ergots (petites branches terminées par une extrémité, dues à l'amincissement)
  const spur = Math.max(2, width * 0.8);
  const kept = segs.filter((s) => {
    if (s.closed) return s.idx.length > 4;
    const e0 = branches[s.idx[0]] <= 1, e1 = branches[s.idx[s.idx.length - 1]] <= 1;
    if (e0 && e1) return s.idx.length >= 3;
    if (e0 || e1) return s.idx.length > spur;
    return true;
  });
  // chaîner les segments qui se touchent en traits continus (le plus aligné d'abord)
  const P = (i: number): Pt => ({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
  const lines = kept.map((s) => ({ pts: s.idx.map(P), closed: s.closed, used: false }));
  const out: { pts: Pt[]; closed: boolean; width: number }[] = [];
  const dir = (pts: Pt[], fromEnd: boolean) => {
    const n = pts.length, k = Math.min(n - 1, 4);
    const a = fromEnd ? pts[n - 1 - k] : pts[k], b = fromEnd ? pts[n - 1] : pts[0];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  for (const L of lines) {
    if (L.used) continue;
    L.used = true;
    if (L.closed) { out.push({ pts: L.pts, closed: true, width }); continue; }
    let pts = L.pts.slice();
    for (let side = 0; side < 2; side++) {
      for (;;) {
        const end = pts[pts.length - 1], d = dir(pts, true);
        let best: (typeof lines)[number] | null = null, bestRev = false, bs = -2;
        for (const M of lines) {
          if (M.used || M.closed) continue;
          const a = M.pts[0], b = M.pts[M.pts.length - 1];
          for (const [p, rev] of [[a, false], [b, true]] as [Pt, boolean][]) {
            if (Math.hypot(p.x - end.x, p.y - end.y) > 1.5) continue;
            const md = dir(rev ? M.pts.slice().reverse() : M.pts, false);
            const s = -(d.x * md.x + d.y * md.y); // md pointe vers le début : aligné ⇒ s ≈ 1
            if (s > bs) { bs = s; best = M; bestRev = rev; }
          }
        }
        if (!best || bs < -0.2) break;
        best.used = true;
        const add = bestRev ? best.pts.slice().reverse() : best.pts;
        pts = pts.concat(add.slice(1));
      }
      pts.reverse();
    }
    const closed = pts.length > 4 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1.5;
    out.push({ pts, closed, width });
  }
  return out;
}

function smoothOpen(p: Pt[], level: number): Pt[] {
  let q = douglasPeucker(p, 0.6 + level * 0.15);
  if (level > 0 && q.length > 2) q = chaikin(q, level, false);
  return q;
}

/** Ordre de broderie des tracés : le plus proche du précédent, en inversant si besoin. */
function orderPaths<T extends { pts: Pt[]; closed: boolean }>(paths: T[]): T[] {
  const rest = paths.slice();
  const out: T[] = [];
  let cur: Pt = { x: -1e9, y: -1e9 };
  while (rest.length) {
    let bi = 0, bd = Infinity, rev = false;
    rest.forEach((p, i) => {
      const a = Math.hypot(p.pts[0].x - cur.x, p.pts[0].y - cur.y);
      const b = p.closed ? Infinity : Math.hypot(p.pts[p.pts.length - 1].x - cur.x, p.pts[p.pts.length - 1].y - cur.y);
      if (a < bd) { bd = a; bi = i; rev = false; }
      if (b < bd) { bd = b; bi = i; rev = true; }
    });
    const s = rest.splice(bi, 1)[0];
    if (rev) s.pts.reverse();
    out.push(s);
    cur = s.pts[s.pts.length - 1];
  }
  return out;
}

export interface LinePiece { kind: 'satin' | 'run'; pts: Pt[]; closed: boolean }

/**
 * Sépare d'un masque les composantes longues et fines (traits, liserés, calligraphie).
 * Chaque trait devient un satin dont les deux bords suivent exactement la forme (largeur variable),
 * ou un point triple s'il est très fin. Un trait mal couvert reste un remplissage classique.
 * Retourne le masque des zones restantes à remplir.
 */
function extractLines(mask: Uint8Array, w: number, h: number, mmPerPx: number, o: AutoOptions,
  emit: (pieces: LinePiece[]) => void): Uint8Array {
  const rest = mask.slice();
  const comp = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  const minPx = Math.max(4, o.minAreaMm2 / (mmPerPx * mmPerPx) * 0.5);
  const stepPx = 0.2 / mmPerPx;            // une piqûre tous les 0,2 mm de chaque côté → 0,4 mm par aller-retour
  const pull = 0.1 / mmPerPx;              // compensation de traction
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!mask[s0] || comp[s0] >= 0) continue;
    const px: number[] = [];
    let minX = w, minY = h, maxX = 0, maxY = 0, edges = 0;
    stack.push(s0); comp[s0] = s0;
    while (stack.length) {
      const p = stack.pop()!;
      px.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [q, ok] of [[p - 1, x > 0], [p + 1, x < w - 1], [p - w, y > 0], [p + w, y < h - 1]] as [number, boolean][]) {
        if (!ok || !mask[q]) { edges++; continue; }
        if (comp[q] < 0) { comp[q] = s0; stack.push(q); }
      }
    }
    if (px.length < minPx) continue;
    const widthMm = ((2 * px.length) / edges) * mmPerPx;
    if (widthMm >= o.satinWidth) continue;
    // recadrer
    const cw = maxX - minX + 3, chh = maxY - minY + 3;
    const sub = new Uint8Array(cw * chh);
    for (const p of px) sub[((((p / w) | 0) - minY + 1) * cw) + (p % w) - minX + 1] = 1;
    const inside = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      return xi >= 0 && yi >= 0 && xi < cw && yi < chh && sub[yi * cw + xi] === 1;
    };
    const lines = centerlines(sub, cw, chh);
    const len = lines.reduce((t, l) => t + polyLength(l.pts, l.closed), 0);
    const wPx = px.length / Math.max(1, len);
    if (len < 3 * wPx) continue; // tache compacte : reste un remplissage
    const maxD = Math.max(3, wPx * 2.5);
    const march = (c: Pt, d: Pt) => {
      let t = 0;
      while (t < maxD && inside(c.x + d.x * (t + 0.25), c.y + d.y * (t + 0.25))) t += 0.25;
      return t;
    };
    const covered = new Int32Array(cw * chh);
    let pieceId = 0, overlap = 0, spread = 0, samples = 0;
    const cover = (a: Pt, b: Pt) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2) + 1;
      for (let k = 0; k <= n; k++) {
        const x = Math.floor(a.x + ((b.x - a.x) * k) / n), y = Math.floor(a.y + ((b.y - a.y) * k) / n);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cw || yy >= chh) continue;
          const j = yy * cw + xx, v = covered[j];
          if (v && v !== pieceId && dx === 0 && dy === 0 && sub[j]) { overlap++; covered[j] = -1; }
          else if (!v) covered[j] = pieceId;
        }
      }
    };
    const pieces: LinePiece[] = [];
    const veryThin = wPx * mmPerPx < 0.55;
    for (const l of lines) {
      pieceId++;
      let pts = l.closed ? smoothLoop(l.pts.slice(0, -1), o.smooth) : smoothOpen(l.pts, o.smooth);
      if (pts.length < 2) continue;
      // prolonger les extrémités jusqu'au bord du trait (l'amincissement les raccourcit)
      if (!l.closed) {
        const ext = (end: Pt, prev: Pt) => {
          const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
          const d = { x: (end.x - prev.x) / L, y: (end.y - prev.y) / L };
          const t = Math.max(0, march(end, d) - 0.25);
          return { x: end.x + d.x * t, y: end.y + d.y * t };
        };
        const k = Math.min(pts.length - 1, 3);
        pts = [ext(pts[0], pts[k]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 1 - k])];
      }
      const path = resample(pts, Math.max(0.3, stepPx), l.closed);
      if (path.length < 2) continue;
      if (veryThin) {
        for (let i = 1; i < path.length; i++) cover(path[i - 1], path[i]);
        pieces.push({ kind: 'run', pts: path, closed: l.closed });
        continue;
      }
      // normales lissées, rayons jusqu'aux deux bords
      const n = path.length;
      const Lp: Pt[] = [], Rp: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = path[l.closed ? (i - 3 + n) % n : Math.max(0, i - 3)], b = path[l.closed ? (i + 3) % n : Math.min(n - 1, i + 3)];
        const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
        const c = path[i];
        const ml = march(c, { x: nx, y: ny }), mr = march(c, { x: -nx, y: -ny });
        // compensation proportionnelle à la largeur : les pointes restent pointues
        const pc = pull * Math.min(1, ((ml + mr) * mmPerPx) / 1.2);
        const dl = Math.max(0.05 / mmPerPx, ml + pc), dr = Math.max(0.05 / mmPerPx, mr + pc);
        Lp.push({ x: c.x + nx * dl, y: c.y + ny * dl });
        Rp.push({ x: c.x - nx * dr, y: c.y - ny * dr });
        cover(Lp[i], Rp[i]);
        // éventail : un bord avance beaucoup plus vite que l'autre (angle, jonction, zone triangulaire)
        if (i > 0) {
          samples++;
          const gl = Math.hypot(Lp[i].x - Lp[i - 1].x, Lp[i].y - Lp[i - 1].y);
          const gr = Math.hypot(Rp[i].x - Rp[i - 1].x, Rp[i].y - Rp[i - 1].y);
          if (Math.max(gl, gr) > Math.max(2.5 * stepPx, 0.6 / mmPerPx)) spread++;
        }
      }
      // sous-couche centrale (traits larges), puis satin en revenant
      const out: Pt[] = [];
      const order = [...Array(n).keys()];
      if (wPx * mmPerPx > 1.3) {
        const under = resample(path, 2 / mmPerPx, l.closed);
        out.push(...under);
        order.reverse();
      }
      order.forEach((i, k) => out.push(k % 2 === 0 ? Lp[i] : Rp[i]));
      pieces.push({ kind: 'satin', pts: out, closed: false });
    }
    // couverture insuffisante : on garde le remplissage d'origine pour ce trait
    let miss = 0;
    for (let i = 0; i < sub.length; i++) if (sub[i] && !covered[i]) miss++;
    if (!pieces.length || miss > px.length * 0.18 || overlap > px.length * 0.12 || spread > samples * 0.06) continue;
    const off = (q: Pt): Pt => ({ x: q.x + minX - 1, y: q.y + minY - 1 });
    emit(pieces.map((pc) => ({ ...pc, pts: pc.pts.map(off) })));
    for (const p of px) rest[p] = 0;
  }
  return rest;
}

export interface AutoResult { objects: EmbObject[]; threads: Thread[] }

export function autoDigitize(q: Quantized, o: AutoOptions, threadBase: number): AutoResult {
  unifyByThread(q, o.threadChart);
  const { w, h, mmPerPx, labels } = q;
  const toMm = (p: Pt): Pt => ({ x: (p.x - w / 2) * mmPerPx, y: (p.y - h / 2) * mmPerPx });
  const used = [...new Set(Array.from(labels).filter((l) => l >= 0))];
  // ordre : plus grande surface d'abord (fonds, puis détails)
  const area = new Map<number, number>();
  for (const l of labels) if (l >= 0) area.set(l, (area.get(l) ?? 0) + 1);
  used.sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0));
  const threads: Thread[] = [];
  const objects: EmbObject[] = [];
  const angles = [45, 135, 0, 90, 30, 120, 60, 150];
  const lum = (c: RGB) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const colorIndex = new Map<number, number>();
  const threadFor = (lab: number) => {
    if (colorIndex.has(lab)) return colorIndex.get(lab)!;
    const col = q.palette[lab];
    const t: Thread = o.threadChart === 'exact'
      ? { ...col, name: 'Couleur ' + (threads.length + 1), code: '#' + [col.r, col.g, col.b].map((v) => v.toString(16).padStart(2, '0')).join(''), chart: 'Personnalisé' }
      : nearestThread(col, o.threadChart);
    threads.push(t);
    colorIndex.set(lab, threadBase + threads.length - 1);
    return threadBase + threads.length - 1;
  };
  const maskOf = (pred: (l: number) => boolean) => {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = pred(labels[i]) ? 1 : 0;
    return mask;
  };
  const darkest = used.length ? used.reduce((a, b) => (lum(q.palette[a]) < lum(q.palette[b]) ? a : b)) : -1;
  const minLen = 0.8;
  const lineObj = (pts: Pt[], closed: boolean, ci: number, name: string): EmbObject => {
    if (o.outlineStitch === 'satin') {
      const s = makeSatin(pts, o.outlineWidth, closed, ci);
      s.satin.underlay = o.outlineWidth > 1.5 ? 'center' : 'none';
      s.name = name;
      return s;
    }
    const r = makeRun(pts, closed, ci);
    r.run.repeats = o.outlineStitch === 'triple' ? 3 : 1;
    r.run.length = 2;
    r.name = name;
    return r;
  };
  /** Toutes les limites entre zones, en une couleur, sans repasser deux fois au même endroit. */
  const allBoundaries = (ci: number, name: string) => {
    const paths = boundaryPaths(labels, w, h)
      .map((p) => ({ pts: (p.closed ? smoothLoop(p.pts.slice(0, -1), o.smooth) : smoothOpen(p.pts, o.smooth)).map(toMm), closed: p.closed }))
      .filter((p) => p.pts.length >= 2 && polyLength(p.pts, p.closed) >= minLen);
    for (const p of orderPaths(paths)) objects.push(lineObj(p.pts, p.closed, ci, name));
  };

  /** Contour extérieur complet (silhouette + trous), dans la couleur et l'épaisseur choisies. */
  const addOuter = () => {
    if (!o.outer || !used.length) return;
    let ci: number;
    if (o.outerThread) { threads.push({ ...o.outerThread }); ci = threadBase + threads.length - 1; }
    else ci = threadFor(darkest);
    const loops = traceMask(maskOf((l) => l >= 0), w, h).map((p) => smoothLoop(p, Math.max(1, o.smooth)).map(toMm));
    const paths = loops.filter((l) => Math.abs(signedArea(l)) >= Math.max(1, o.minAreaMm2)).map((pts) => ({ pts, closed: true }));
    for (const p of orderPaths(paths)) {
      if (o.outerStitch === 'satin') {
        const sat = makeSatin(p.pts, o.outerWidth, true, ci);
        sat.satin.underlay = o.outerWidth > 1.6 ? 'center' : 'none';
        sat.name = 'Contour extérieur';
        objects.push(sat);
      } else {
        const r = makeRun(p.pts, true, ci);
        r.run.repeats = o.outerStitch === 'triple' ? 3 : 1; r.run.length = 2; r.name = 'Contour extérieur';
        objects.push(r);
      }
    }
  };

  if (o.render === 'outline') {
    if (o.outlineColor === 'lines' && darkest >= 0) {
      // les traits foncés de l'image deviennent une ligne centrale ; les autres limites sont gardées
      const ci = threadFor(darkest);
      const lines = centerlines(maskOf((l) => l === darkest), w, h);
      const others = boundaryPaths(labels, w, h, (a, b) => a === darkest || b === darkest);
      const paths = [...lines, ...others]
        .map((p) => ({ pts: (p.closed ? smoothLoop(p.pts.slice(0, -1), o.smooth) : smoothOpen(p.pts, o.smooth)).map(toMm), closed: p.closed }))
        .filter((p) => p.pts.length >= 2 && polyLength(p.pts, p.closed) >= minLen);
      for (const p of orderPaths(paths)) objects.push(lineObj(p.pts, p.closed, ci, 'Trait'));
    } else if (o.outlineColor === 'darkest') {
      if (darkest >= 0) allBoundaries(threadFor(darkest), 'Contour');
    } else {
      used.forEach((lab, li) => {
        const ci = threadFor(lab);
        const loops = traceMask(maskOf((l) => l === lab), w, h).map((p) => smoothLoop(p, o.smooth).map(toMm));
        const paths = loops.filter((l) => Math.abs(signedArea(l)) >= o.minAreaMm2 * 0.5).map((pts) => ({ pts, closed: true }));
        for (const p of orderPaths(paths)) objects.push(lineObj(p.pts, true, ci, `Contour ${li + 1}`));
      });
    }
    addOuter();
    return { objects, threads };
  }

  const finish: EmbObject[] = []; // traits de finition, brodés en dernier
  const finishZones: EmbObject[] = []; // zones de la couleur des traits, juste avant eux (un seul passage de cette couleur)
  used.forEach((lab, li) => {
    const ci = threadFor(lab);
    let mask: Uint8Array = maskOf((l) => l === lab);
    if (o.lineSatin) {
      // les traits (zones longues et fines) : satin qui épouse les bords, ou point triple
      const items: { ob: EmbObject; pts: Pt[]; closed: boolean; first: Pt }[] = [];
      mask = extractLines(mask, w, h, mmPerPx, o, (pieces) => {
        for (const pc of pieces) {
          const mm = pc.pts.map(toMm);
          if (mm.length < 2) continue;
          let ob: EmbObject;
          if (pc.kind === 'run') {
            const r = makeRun(mm, pc.closed, ci);
            r.run.repeats = 3; r.run.length = 2;
            ob = r;
          } else {
            ob = { id: uid(), kind: 'stitches', name: '', color: ci, visible: true, locked: false, tie: true,
              stitches: mm.map((q, i) => ({ ...q, cmd: i === 0 ? Cmd.JUMP : Cmd.STITCH })) };
          }
          ob.name = `Trait ${li + 1}`;
          const ends = [mm[0], mm[mm.length - 1]];
          items.push({ ob, pts: ends, closed: pc.closed, first: ends[0] });
        }
      });
      const ordered = orderPaths(items).map((it) => {
        if (it.pts[0] !== it.first) {
          // parcourir le trait dans l'autre sens
          if (it.ob.kind === 'run') it.ob.points.reverse();
          else if (it.ob.kind === 'stitches') { it.ob.stitches.reverse(); it.ob.stitches.forEach((q, i) => (q.cmd = i === 0 ? Cmd.JUMP : Cmd.STITCH)); }
        }
        return it.ob;
      });
      (o.linesLast && lab === darkest ? finish : objects).push(...ordered);
    }
    const loops = traceMask(mask, w, h).map((p) => smoothLoop(p, o.smooth).map(toMm));
    const islands = splitIslands(normalize(loops));
    const ordered = orderIslands(islands);
    for (const isl of ordered) {
      const a = isl.reduce((s, p) => s + signedArea(p), 0);
      if (Math.abs(a) < Math.min(0.3, o.minAreaMm2 * 0.5)) continue; // le bruit a déjà été retiré à la quantification
      const per = isl.reduce((s, p) => s + polyLength(p, true), 0);
      const width = (2 * Math.abs(a)) / per;
      const obj = makeFill(isl, ci, `Zone ${li + 1}`);
      // satin d'un seul angle : seulement si les piqûres restent courtes (forme étroite ET droite).
      // Une forme courbe (arc, pétale) donnerait de longues piqûres en biais : tatami uni à la place.
      const pa = principalAngle(isl[0]);
      const nx = -Math.sin(pa), ny = Math.cos(pa);
      let lo = Infinity, hi = -Infinity;
      for (const q of isl[0]) { const v = q.x * nx + q.y * ny; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (width < o.satinWidth && hi - lo <= Math.max(o.satinWidth * 1.5, width * 2.2)) {
        obj.fill.pattern = 'satin';
        obj.fill.angle = Math.round(((pa * 180) / Math.PI + 90 + 360) % 180);
        obj.fill.underlay = width > 1.5 ? 'center' : 'none';
        obj.fill.pullComp = 0.15;
        obj.name = `Satin ${li + 1}`;
      } else {
        // un seul angle par couleur : remplissage uni d'une zone à l'autre
        obj.fill.angle = angles[li % angles.length];
        obj.fill.underlay = width > 6 ? 'edge+tatami' : width > 1.5 ? 'edge' : 'none';
        obj.fill.spacing = 0.4;
      }
      (o.linesLast && lab === darkest ? finishZones : objects).push(obj);
    }
  });
  objects.push(...finishZones, ...finish);
  const contour = o.contour ?? (o.outline ? 'silhouette' : 'none');
  if (contour === 'all' && darkest >= 0) allBoundaries(threadFor(darkest), 'Contour');
  if (contour === 'silhouette' && darkest >= 0) {
    const ci = threadFor(darkest);
    const loops = traceMask(maskOf((l) => l >= 0), w, h).map((p) => smoothLoop(p, o.smooth).map(toMm));
    for (const l of loops) {
      if (Math.abs(signedArea(l)) < o.minAreaMm2) continue;
      objects.push(lineObj(l, true, ci, 'Contour'));
    }
  }
  addOuter();
  return { objects, threads };
}

function orderIslands(isl: Poly[][]): Poly[][] {
  const out: Poly[][] = [];
  const rest = isl.slice();
  let cur: Pt = { x: -1e9, y: -1e9 };
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((x, i) => { const d = Math.hypot(x[0][0].x - cur.x, x[0][0].y - cur.y); if (d < bd) { bd = d; bi = i; } });
    const s = rest.splice(bi, 1)[0];
    out.push(s);
    cur = s[0][0];
  }
  return out;
}

// ------------------------------------------------------------------ Point de croix

export interface CrossOptions { cellMm: number; colors: number; removeBg: boolean; widthMm: number; threadChart: string }

export function crossStitch(img: ImageData, o: CrossOptions, threadBase: number): AutoResult {
  const cols = Math.max(4, Math.round(o.widthMm / o.cellMm));
  const k = cols / img.width;
  const rows = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  src.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cols, rows);
  const small = ctx.getImageData(0, 0, cols, rows);
  const q = quantize(small, { ...defaultAuto, colors: o.colors, removeBg: o.removeBg, widthMm: o.widthMm, minAreaMm2: 0, denoise: false }, true);
  unifyByThread(q, o.threadChart);
  const s = o.cellMm;
  const ox = -(cols * s) / 2, oy = -(rows * s) / 2;
  const used = [...new Set(Array.from(q.labels).filter((l) => l >= 0))];
  const threads: Thread[] = [];
  const objects: EmbObject[] = [];
  used.forEach((lab, li) => {
    const col = q.palette[lab];
    threads.push(o.threadChart === 'exact' ? { ...col, name: 'Couleur ' + (li + 1), code: '', chart: 'Personnalisé' } : nearestThread(col, o.threadChart));
    const st: Stitch[] = [];
    const P = (x: number, y: number): Pt => ({ x: ox + x * s, y: oy + y * s });
    for (let y = 0; y < rows; y++) {
      // segments continus de cellules de cette couleur sur la rangée
      let x = 0;
      while (x < cols) {
        if (q.labels[y * cols + x] !== lab) { x++; continue; }
        let e = x;
        while (e + 1 < cols && q.labels[y * cols + e + 1] === lab) e++;
        // aller : diagonales « / », retour : diagonales « \ »
        const bl = P(x, y + 1);
        st.push({ ...bl, cmd: Cmd.JUMP });
        for (let i = x; i <= e; i++) {
          st.push({ ...P(i + 1, y), cmd: Cmd.STITCH }, { ...P(i + 1, y + 1), cmd: Cmd.STITCH });
        }
        for (let i = e; i >= x; i--) {
          st.push({ ...P(i, y), cmd: Cmd.STITCH }, { ...P(i, y + 1), cmd: Cmd.STITCH });
        }
        x = e + 1;
      }
    }
    objects.push({ id: uid(), kind: 'stitches', name: `Point de croix ${li + 1}`, color: threadBase + li, visible: true, locked: false, tie: true, stitches: st });
  });
  return { objects, threads };
}

// ------------------------------------------------------------------ PhotoStitch (monochrome)

export interface PhotoOptions { widthMm: number; rowMm: number; maxAmp: number; invert: boolean; contrast: number }

/** Lignes ondulées dont l'amplitude suit la densité de l'image (rendu « gravure »). */
export function photoStitch(img: ImageData, o: PhotoOptions): Stitch[] {
  const { width: w, height: h, data } = img;
  const mmPerPx = o.widthMm / w;
  const Hmm = h * mmPerPx;
  const lumAt = (xm: number, ym: number) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(xm / mmPerPx)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(ym / mmPerPx)));
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return 1;
    let l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    l = Math.min(1, Math.max(0, (l - 0.5) * o.contrast + 0.5));
    return o.invert ? 1 - l : l;
  };
  const st: Stitch[] = [];
  const step = 0.45;
  let row = 0;
  let pendingJump = true;
  let lastPt: Pt | null = null;
  const emit = (p: Pt) => {
    const q = { x: p.x - o.widthMm / 2, y: p.y - Hmm / 2 };
    // zones claires non brodées : on saute au lieu de tirer une ligne droite
    const cmd = pendingJump || (lastPt && Math.hypot(q.x - lastPt.x, q.y - lastPt.y) > 2.5) ? Cmd.JUMP : Cmd.STITCH;
    st.push({ ...q, cmd });
    lastPt = q; pendingJump = false;
  };
  for (let y = o.rowMm / 2; y < Hmm; y += o.rowMm, row++) {
    const ltr = row % 2 === 0;
    let side = 1;
    let blank = 0;
    for (let k = 0; k <= Math.ceil(o.widthMm / step); k++) {
      const xm = ltr ? k * step : o.widthMm - k * step;
      const dark = 1 - lumAt(xm, y);
      const amp = (dark * o.maxAmp) / 2;
      if (amp < 0.15) {
        blank += step;
        if (blank < 2) { if (k % 4 === 0) emit({ x: xm, y }); }
        continue;
      }
      blank = 0;
      emit({ x: xm, y: y + side * amp });
      side = -side;
    }
  }
  return st;
}
