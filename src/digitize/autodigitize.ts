// Numérisation automatique : image → zones de couleur → objets de broderie.
import { Cmd, type EmbObject, type Poly, type Pt, type Stitch, type Thread } from '../core/types';
import { chaikin, douglasPeucker, polyLength, principalAngle, signedArea, splitIslands, normalize } from '../core/geometry';
import { nearestThread, rgbToLab } from '../core/threads';
import { makeFill, makeRun, uid } from '../core/defaults';

export interface RGB { r: number; g: number; b: number }

export interface AutoOptions {
  widthMm: number;          // largeur du motif obtenu
  colors: number;           // nombre de couleurs (hors fond)
  removeBg: boolean;
  smooth: number;           // 0..3 lissage des contours
  minAreaMm2: number;       // élimine les petites taches
  satinWidth: number;       // zones plus fines que ça → satin
  outline: boolean;         // contour en point avant dans la couleur la plus foncée
  threadChart: string;      // 'Janome/Elna' | 'Brother' | 'exact'
  denoise: boolean;
}

export const defaultAuto: AutoOptions = {
  widthMm: 90, colors: 5, removeBg: true, smooth: 2, minAreaMm2: 2, satinWidth: 2.5, outline: false, threadChart: 'Janome/Elna', denoise: true,
};

export interface Quantized {
  w: number; h: number; mmPerPx: number;
  labels: Int16Array;       // -1 = fond
  palette: RGB[];
  bgLabel: number;
}

/** Redimensionne une image vers un canvas de travail. */
export function imageToData(img: CanvasImageSource & { width: number; height: number }, maxPx: number): ImageData {
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function boxBlur(d: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const i = (yy * w + xx) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
    }
    const o = (y * w + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return out;
}

/** k-means (k-means++) dans l'espace Lab. */
function kmeans(samples: number[][], k: number, iters = 12): number[][] {
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
  }
  return cents;
}

export function quantize(img: ImageData, o: AutoOptions, raw = false): Quantized {
  const { width: w, height: h } = img;
  const d = o.denoise ? boxBlur(img.data, w, h) : img.data;
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
  const step = Math.max(1, Math.floor(opaque.length / 25000));
  const samples: number[][] = [];
  for (let i = 0; i < opaque.length; i += step) samples.push(lab[opaque[i]]);
  const cents = samples.length ? kmeans(samples, Math.max(1, k)) : [[100, 0, 0]];
  let labels: Int16Array = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    if (alpha[i] <= 127) { labels[i] = -1; continue; }
    let best = 0, bd = Infinity;
    for (let c = 0; c < cents.length; c++) {
      const s = lab[i], q = cents[c];
      const dd = (s[0] - q[0]) ** 2 + (s[1] - q[1]) ** 2 + (s[2] - q[2]) ** 2;
      if (dd < bd) { bd = dd; best = c; }
    }
    labels[i] = best;
  }
  // filtre de mode 3×3 : supprime le bruit isolé
  if (!raw) {
    for (let pass = 0; pass < 2; pass++) labels = modeFilter(labels, w, h, cents.length);
    mergeTransitionColors(labels, w, h, cents);
  }
  // fond = étiquette dominante sur la bordure
  let bgLabel = -1;
  if (o.removeBg && !hasAlpha) {
    const cnt = new Map<number, number>();
    const add = (i: number) => cnt.set(labels[i], (cnt.get(labels[i]) ?? 0) + 1);
    for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
    bgLabel = [...cnt.entries()].filter(([l]) => l >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    if (bgLabel >= 0) for (let i = 0; i < N; i++) if (labels[i] === bgLabel) labels[i] = -1;
  }
  const palette: RGB[] = cents.map((c) => labToRgb(c));
  const mmPerPx = o.widthMm / w;
  if (!raw) removeSmall(labels, w, h, Math.max(1, o.minAreaMm2 / (mmPerPx * mmPerPx)));
  return { w, h, mmPerPx, labels, palette, bgLabel };
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
function removeSmall(labels: Int16Array, w: number, h: number, minPx: number) {
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
      if (best) for (const p of members) labels[p] = best[0];
    }
    id++;
  }
}

function labToRgb([L, A, B]: number[]): RGB {
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

/** Deux couleurs de l'image qui tombent sur le même fil deviennent une seule zone. */
function unifyByThread(q: Quantized, chart: string) {
  if (chart === 'exact') return;
  const first = new Map<string, number>();
  const remap = q.palette.map((c, l) => {
    const t = nearestThread(c, chart);
    const k = t.chart + t.code;
    if (!first.has(k)) first.set(k, l);
    return first.get(k)!;
  });
  for (let i = 0; i < q.labels.length; i++) if (q.labels[i] >= 0) q.labels[i] = remap[q.labels[i]];
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
  used.forEach((lab, li) => {
    const col = q.palette[lab];
    const t: Thread = o.threadChart === 'exact'
      ? { ...col, name: 'Couleur ' + (li + 1), code: '#' + [col.r, col.g, col.b].map((v) => v.toString(16).padStart(2, '0')).join(''), chart: 'Personnalisé' }
      : nearestThread(col, o.threadChart);
    threads.push(t);
    const ci = threadBase + threads.length - 1;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = labels[i] === lab ? 1 : 0;
    const loops = traceMask(mask, w, h).map((p) => smoothLoop(p, o.smooth).map(toMm));
    const islands = splitIslands(normalize(loops));
    const ordered = orderIslands(islands);
    for (const isl of ordered) {
      const a = isl.reduce((s, p) => s + signedArea(p), 0);
      if (Math.abs(a) < o.minAreaMm2 * 0.5) continue;
      const per = isl.reduce((s, p) => s + polyLength(p, true), 0);
      const width = (2 * Math.abs(a)) / per;
      const obj = makeFill(isl, ci, `Zone ${li + 1}`);
      if (width < o.satinWidth) {
        obj.fill.pattern = 'satin';
        obj.fill.angle = Math.round(((principalAngle(isl[0]) * 180) / Math.PI + 90 + 360) % 180);
        obj.fill.underlay = width > 1.5 ? 'center' : 'none';
        obj.fill.pullComp = 0.15;
        obj.name = `Satin ${li + 1}`;
      } else {
        obj.fill.angle = angles[li % angles.length];
        obj.fill.underlay = width > 6 ? 'edge+tatami' : 'edge';
      }
      objects.push(obj);
    }
  });
  if (o.outline && used.length) {
    const darkest = used.reduce((a, b) => (lum(q.palette[a]) < lum(q.palette[b]) ? a : b));
    const ci = threadBase + used.indexOf(darkest);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = labels[i] >= 0 ? 1 : 0;
    const loops = traceMask(mask, w, h).map((p) => smoothLoop(p, o.smooth).map(toMm));
    for (const l of loops) {
      if (Math.abs(signedArea(l)) < o.minAreaMm2) continue;
      const r = makeRun(l, true, ci);
      r.run.repeats = 3; r.name = 'Contour';
      objects.push(r);
    }
  }
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
