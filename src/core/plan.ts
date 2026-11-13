// Transforme le dessin (objets) en séquence de points prête à exporter.
import { Cmd, type Design, type EmbObject, type Poly, type Pt, type Stitch } from './types';
import { appliqueStitches, fillRegion, runPath, satinColumn } from './stitchgen';
import { textGlyphs } from './text';
import { dist, bboxOf, type BBox, bboxValid } from './geometry';

export interface PlanStitch extends Stitch { color: number; obj: number }
export interface Plan {
  stitches: PlanStitch[];
  colorChanges: number;
  stops: number;
  trims: number;
  stitchCount: number;
  jumps: number;
  bbox: BBox | null;
  colorSeq: number[];       // couleurs dans l'ordre de broderie
}

export interface PlanOptions { trimDistance: number }
export const defaultPlanOptions: PlanOptions = { trimDistance: 3 };

const cache = new Map<string, { key: string; st: Stitch[] }>();

/** Libère le cache des points d'objets temporaires (aperçus). */
export function forgetObjects(ids: string[]) { for (const id of ids) cache.delete(id); }

function asStitches(pts: Pt[]): Stitch[] {
  return pts.map((p, i) => ({ x: p.x, y: p.y, cmd: i === 0 ? Cmd.JUMP : Cmd.STITCH }));
}

/** Contours d'un objet texte (lettres), ou null si la police charge encore. */
export function textContours(o: EmbObject): Poly[][] | null {
  if (o.kind !== 'text') return null;
  const g = textGlyphs(o);
  return g ? g.map((x) => x.contours) : null;
}

export function objectStitches(o: EmbObject): Stitch[] {
  const key = JSON.stringify(o);
  const c = cache.get(o.id);
  if (c && c.key === key) return c.st;
  let st: Stitch[] = [];
  switch (o.kind) {
    case 'run':
      st = asStitches(runPath(o.points, o.closed, o.run));
      break;
    case 'satin':
      st = asStitches(satinColumn(o.points, o.width, o.closed, o.satin));
      break;
    case 'fill':
      st = fillRegion(o.contours, o.fill);
      break;
    case 'applique':
      st = appliqueStitches(o.contours, o.borderWidth, o.satin);
      break;
    case 'stitches':
      st = o.stitches;
      break;
    case 'text': {
      const glyphs = textGlyphs(o);
      if (!glyphs) return []; // police en cours de chargement : pas de cache
      let cur: Pt | null = null;
      for (const g of glyphs) {
        let part: Stitch[] = [];
        if (o.style === 'run') {
          for (const ring of g.contours) part.push(...asStitches(runPath(ring, true, o.run)));
        } else {
          const fp = { ...o.fill, pattern: o.style === 'satin' ? 'satin' as const : o.fill.pattern };
          part = fillRegion(g.contours, fp, cur);
          if (o.outline) for (const ring of g.contours) part.push(...asStitches(runPath(ring, true, o.run)));
        }
        if (part.length) { st.push(...part); cur = part[part.length - 1]; }
      }
      break;
    }
  }
  cache.set(o.id, { key, st });
  return st;
}

export function objectBBox(o: EmbObject): BBox | null {
  let pts: Pt[] = [];
  switch (o.kind) {
    case 'run': case 'satin': pts = o.points; break;
    case 'fill': case 'applique': pts = o.contours.flat(); break;
    case 'stitches': pts = o.stitches; break;
    case 'text': {
      const g = textGlyphs(o);
      pts = g ? g.flatMap((x) => x.contours.flat()) : [{ x: o.x - o.size, y: o.y - o.size / 2 }, { x: o.x + o.size, y: o.y + o.size / 2 }];
      break;
    }
  }
  if (!pts.length) return null;
  const bb = bboxOf(pts);
  if (o.kind === 'satin') { const h = o.width / 2; bb.minX -= h; bb.minY -= h; bb.maxX += h; bb.maxY += h; }
  return bb;
}

/** Point situé à `d` mm le long de la suite de points, en partant de `from` dans le sens `dir`. */
function walk(out: PlanStitch[], from: number, dir: 1 | -1, d: number, stop: (s: PlanStitch) => boolean): Pt | null {
  let acc = 0, prev: Pt = out[from];
  for (let i = from + dir; i >= 0 && i < out.length && !stop(out[i]); i += dir) {
    if (out[i].cmd !== Cmd.STITCH) break;
    const L = dist(prev, out[i]);
    if (acc + L >= d) { const t = (d - acc) / L; return { x: prev.x + (out[i].x - prev.x) * t, y: prev.y + (out[i].y - prev.y) * t }; }
    acc += L; prev = out[i];
  }
  return acc >= 0.3 ? prev : null;
}

/**
 * Points d'arrêt : uniquement là où le fil est coupé (début, coupe, changement de couleur).
 * Les petits sauts sans coupe gardent le fil continu et n'en ont pas besoin, ce qui évite
 * d'accumuler des nœuds sous la broderie. Chaque arrêt fait 2 allers-retours de ~0,6 mm.
 */
function addTies(out: PlanStitch[], tieOf: (obj: number) => boolean): PlanStitch[] {
  const cut = (s: PlanStitch) => s.cmd === Cmd.TRIM || s.cmd === Cmd.COLOR;
  const res: PlanStitch[] = [];
  let needIn = true;
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (cut(s)) needIn = true;
    res.push(s);
    if (s.cmd !== Cmd.STITCH) continue;
    if (needIn) {
      needIn = false;
      const m = tieOf(s.obj) ? walk(out, i, 1, 0.6, cut) : null;
      if (m) for (const q of [m, s, m, s]) res.push({ ...s, x: q.x, y: q.y });
    }
    // dernier point avant une coupe (ou la fin) : arrêt
    let j = i + 1;
    while (j < out.length && out[j].cmd !== Cmd.STITCH && !cut(out[j])) j++;
    if (j >= out.length || cut(out[j])) {
      const m = tieOf(s.obj) ? walk(out, i, -1, 0.6, cut) : null;
      if (m) for (const q of [m, s, m, s]) res.push({ ...s, x: q.x, y: q.y });
    }
  }
  return res;
}

/** En dessous, la machine pique presque au même trou : nœuds et casse de fil. */
const MIN_STITCH = 0.3;

export function buildPlan(design: Design, opts: PlanOptions = defaultPlanOptions): Plan {
  const out: PlanStitch[] = [];
  let color = -1;
  let last: Pt | null = null;
  let colorChanges = 0, stops = 0, trims = 0, jumps = 0, stitchCount = 0;
  const colorSeq: number[] = [];
  design.objects.forEach((o, oi) => {
    if (!o.visible) return;
    let st = objectStitches(o);
    if (!st.length) return;
    if (color !== o.color) {
      if (color >= 0 && last) {
        out.push({ ...last, cmd: Cmd.TRIM, color, obj: oi }); trims++;
        out.push({ ...last, cmd: Cmd.COLOR, color: o.color, obj: oi }); colorChanges++;
      }
      color = o.color;
      colorSeq.push(color);
    }
    for (const s of st) {
      let cmd = s.cmd;
      if (cmd === Cmd.COLOR) continue; // les blocs importés sont découpés par couleur
      if (cmd === Cmd.JUMP) {
        if (!last) { out.push({ x: s.x, y: s.y, cmd: Cmd.JUMP, color, obj: oi }); last = s; jumps++; continue; }
        const d = dist(last, s);
        if (d < 0.05) continue;
        if (d <= 1.0) cmd = Cmd.STITCH; // micro-saut : simple point
        else {
          if (d > opts.trimDistance) { out.push({ ...last, cmd: Cmd.TRIM, color, obj: oi }); trims++; }
          out.push({ x: s.x, y: s.y, cmd: Cmd.JUMP, color, obj: oi }); jumps++;
          last = s; continue;
        }
      }
      if (cmd === Cmd.STOP) { out.push({ x: s.x, y: s.y, cmd: Cmd.STOP, color, obj: oi }); stops++; continue; }
      if (cmd === Cmd.TRIM) { out.push({ x: s.x, y: s.y, cmd: Cmd.TRIM, color, obj: oi }); trims++; continue; }
      if (cmd === Cmd.STITCH && last && dist(last, s) < MIN_STITCH && out.length && out[out.length - 1].cmd === Cmd.STITCH) {
        continue; // points trop courts : la machine ferait des nœuds
      }
      if (!last) { out.push({ x: s.x, y: s.y, cmd: Cmd.JUMP, color, obj: oi }); jumps++; last = s; continue; }
      out.push({ x: s.x, y: s.y, cmd: Cmd.STITCH, color, obj: oi });
      stitchCount++;
      last = s;
    }
  });
  if (last) { out.push({ ...(last as Pt), cmd: Cmd.TRIM, color, obj: -1 }); trims++; }
  const vis = design.objects;
  out.splice(0, out.length, ...addTies(out, (oi) => !!vis[oi]?.tie));
  stitchCount = out.reduce((n, s) => n + (s.cmd === Cmd.STITCH ? 1 : 0), 0);
  const bbPts = out.filter((s) => s.cmd === Cmd.STITCH);
  const bb = bbPts.length ? bboxOf(bbPts) : null;
  return { stitches: out, colorChanges, stops, trims, stitchCount, jumps, bbox: bb && bboxValid(bb) ? bb : null, colorSeq };
}

/** Durée approximative de broderie (min) : vitesse machine + changements de fil. */
export function estimateMinutes(p: Plan, spm = 700): number {
  return p.stitchCount / spm + p.colorChanges * 0.5 + p.stops * 0.75 + p.trims * 0.05;
}
