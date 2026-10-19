import ClipperLib from 'clipper-lib';
import type { Pt, Poly } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePt(p: Pt, ang: number, c: Pt = { x: 0, y: 0 }): Pt {
  const s = Math.sin(ang), co = Math.cos(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }
export function bboxOf(pts: Iterable<Pt>): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
export function bboxUnion(a: BBox | null, b: BBox): BBox {
  if (!a) return { ...b };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
export const bboxValid = (b: BBox) => isFinite(b.minX) && isFinite(b.maxX);

export function polyLength(pts: Pt[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

export function signedArea(p: Poly): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
  return a / 2;
}

export function pointInPoly(pt: Pt, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Règle pair-impair sur un ensemble de contours (extérieurs + trous). */
export function pointInContours(pt: Pt, contours: Poly[]): boolean {
  let n = 0;
  for (const c of contours) if (pointInPoly(pt, c)) n++;
  return n % 2 === 1;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[], closed: boolean): { d: number; seg: number } {
  let best = Infinity, seg = -1;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < best) { best = d; seg = i; }
  }
  return { d: best, seg };
}

/** Rééchantillonne une polyligne à pas constant (conserve le dernier point). */
export function resample(pts: Pt[], step: number, closed = false): Pt[] {
  if (pts.length < 2) return pts.slice();
  const src = closed ? [...pts, pts[0]] : pts;
  const out: Pt[] = [src[0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const L = dist(a, b);
    if (L === 0) continue;
    let t = step - carry;
    while (t <= L + 1e-9) {
      out.push(lerp(a, b, t / L));
      t += step;
    }
    carry = L - (t - step);
  }
  const last = src[src.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Découpe une polyligne en segments de longueur max, en gardant les sommets (angles nets). */
export function subdivide(pts: Pt[], maxLen: number, closed = false): Pt[] {
  if (pts.length < 2) return pts.slice();
  const src = closed ? [...pts, pts[0]] : pts;
  const out: Pt[] = [src[0]];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const L = dist(a, b);
    const n = Math.max(1, Math.ceil(L / maxLen - 1e-6));
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

export function douglasPeucker(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplification d'un polygone fermé. */
export function simplifyClosed(p: Poly, eps: number): Poly {
  if (p.length < 4) return p.slice();
  // couper au point le plus éloigné du premier pour éviter un artefact
  let far = 0, fd = 0;
  for (let i = 1; i < p.length; i++) { const d = dist(p[0], p[i]); if (d > fd) { fd = d; far = i; } }
  const a = douglasPeucker(p.slice(0, far + 1), eps);
  const b = douglasPeucker([...p.slice(far), p[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export function chaikin(p: Pt[], iterations = 1, closed = true): Pt[] {
  let pts = p;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/** Courbe lisse passant par les points (Catmull-Rom), utile pour le dessin à main levée. */
export function catmullRom(pts: Pt[], closed: boolean, segs = 6): Pt[] {
  if (pts.length < 3) return pts.slice();
  const n = pts.length;
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < segs; s++) {
      const t = s / segs, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// ---------------------------------------------------------------- Clipper
const SCALE = 1000;
const toC = (p: Poly) => p.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));
const fromC = (p: { X: number; Y: number }[]): Poly => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));

/** Décalage (positif = élargir) de contours en règle pair-impair. */
export function offsetContours(contours: Poly[], delta: number, round = false): Poly[] {
  const valid = contours.filter((c) => c.length >= 3);
  if (!valid.length) return [];
  if (Math.abs(delta) < 1e-6) return normalize(valid);
  const norm = normalize(valid);
  const co = new ClipperLib.ClipperOffset(2, 0.05 * SCALE);
  co.AddPaths(norm.map(toC), round ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, delta * SCALE);
  return (out as { X: number; Y: number }[][]).map(fromC).filter((p) => p.length >= 3);
}

/** Décalage d'une polyligne ouverte en ruban (pour les traits épais). */
export function strokeToPolygon(pts: Pt[], width: number, closed: boolean): Poly[] {
  if (pts.length < 2) return [];
  const co = new ClipperLib.ClipperOffset(2, 0.05 * SCALE);
  co.AddPath(toC(pts), ClipperLib.JoinType.jtRound, closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound);
  const out = new ClipperLib.Paths();
  co.Execute(out, (width / 2) * SCALE);
  return (out as { X: number; Y: number }[][]).map(fromC);
}

/** Corrige auto-intersections et orientation (règle pair-impair). */
export function normalize(contours: Poly[]): Poly[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(contours.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptSubject, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return (out as { X: number; Y: number }[][]).map(fromC).filter((p) => p.length >= 3);
}

export function booleanOp(a: Poly[], b: Poly[], op: 'union' | 'difference' | 'intersection' | 'xor'): Poly[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptClip, true);
  const type = { union: ClipperLib.ClipType.ctUnion, difference: ClipperLib.ClipType.ctDifference, intersection: ClipperLib.ClipType.ctIntersection, xor: ClipperLib.ClipType.ctXor }[op];
  const out = new ClipperLib.Paths();
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return (out as { X: number; Y: number }[][]).map(fromC).filter((p) => p.length >= 3);
}

/** Sépare des contours pair-impair en îlots (un extérieur + ses trous). */
export function splitIslands(contours: Poly[]): Poly[][] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(contours.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  const islands: Poly[][] = [];
  const walk = (node: any) => {
    for (const child of node.Childs()) {
      // child = extérieur ; ses enfants = trous ; petits-enfants = nouveaux îlots
      const isl: Poly[] = [fromC(child.Contour())];
      for (const hole of child.Childs()) {
        isl.push(fromC(hole.Contour()));
        walk(hole);
      }
      islands.push(isl);
    }
  };
  walk(tree);
  return islands;
}

export function contoursArea(contours: Poly[]): number {
  return normalize(contours).reduce((s, p) => s + signedArea(p), 0);
}

// ---------------------------------------------------------------- Scanlines

export interface Span { a: number; b: number }
export interface Row { y: number; spans: Span[] }

/**
 * Intersecte les contours (déjà tournés de -angle) avec des horizontales espacées de `spacing`.
 * Retourne les rangées avec leurs intervalles intérieurs [a,b] (règle pair-impair).
 */
export function scanRows(contours: Poly[], spacing: number, phase = 0.5): Row[] {
  const bb = bboxOf(contours.flat());
  const rows: Row[] = [];
  const edges: [Pt, Pt][] = [];
  for (const c of contours) for (let i = 0; i < c.length; i++) edges.push([c[i], c[(i + 1) % c.length]]);
  const start = Math.floor(bb.minY / spacing) * spacing + spacing * phase;
  for (let y = start; y < bb.maxY; y += spacing) {
    const xs: number[] = [];
    for (const [p, q] of edges) {
      if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    const spans: Span[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-3) spans.push({ a: xs[i], b: xs[i + 1] });
    if (spans.length) rows.push({ y, spans });
  }
  return rows;
}

export function rotateContours(contours: Poly[], ang: number): Poly[] {
  if (!ang) return contours.map((c) => c.map((p) => ({ ...p })));
  return contours.map((c) => c.map((p) => rotatePt(p, ang)));
}

/** Axe principal (ACP) d'un nuage de points, en radians. */
export function principalAngle(pts: Pt[]): number {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Le segment [a,b] reste-t-il à l'intérieur des contours ? (test par échantillonnage) */
export function segmentInside(a: Pt, b: Pt, contours: Poly[], step = 0.5): boolean {
  const L = dist(a, b);
  const n = Math.max(2, Math.ceil(L / step));
  for (let i = 1; i < n; i++) if (!pointInContours(lerp(a, b, i / n), contours)) return false;
  return true;
}

// ---------------------------------------------------------------- Matrices 2D

export type Mat = [number, number, number, number, number, number]; // a b c d e f
export const IDENT: Mat = [1, 0, 0, 1, 0, 0];
export function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const applyMat = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const matTranslate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const matScale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
export const matRotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
/** Transformation autour d'un pivot. */
export function matAround(m: Mat, c: Pt): Mat {
  return matMul(matTranslate(c.x, c.y), matMul(m, matTranslate(-c.x, -c.y)));
}
