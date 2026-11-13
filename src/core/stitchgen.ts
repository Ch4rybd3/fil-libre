// Générateurs de points : point avant, satin, remplissage (tatami / satin / contour), appliqué.
import { Cmd, type FillParams, type Poly, type Pt, type RunParams, type SatinParams, type Stitch } from './types';
import {
  dist, lerp, offsetContours, rotateContours, rotatePt, scanRows, segmentInside, subdivide, rad,
  splitIslands, signedArea, resample, normalize, polyLength,
} from './geometry';

const S = (p: Pt): Stitch => ({ x: p.x, y: p.y, cmd: Cmd.STITCH });
const J = (p: Pt): Stitch => ({ x: p.x, y: p.y, cmd: Cmd.JUMP });

// ------------------------------------------------------------------ Point avant

export function runPath(pts: Pt[], closed: boolean, p: RunParams): Pt[] {
  if (pts.length < 2) return pts.slice();
  const base = subdivide(pts, Math.max(0.5, p.length), closed)
    .filter((q, i, arr) => i === 0 || dist(q, arr[i - 1]) >= 0.05); // pas de point au même trou
  if (p.repeats === 1) return base;
  // point triple (« bean ») : a→b→a→b pour chaque segment
  const out: Pt[] = [base[0]];
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1], b = base[i];
    for (let r = 0; r < p.repeats; r++) out.push(r % 2 === 0 ? b : a);
  }
  return out;
}

// ------------------------------------------------------------------ Satin colonne

function normals(pts: Pt[], closed: boolean): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: -dy / L, y: dx / L };
  });
}

/** Bords gauche/droit d'une colonne échantillonnée à pas `step`. */
function satinRails(center: Pt[], width: number, closed: boolean, step: number): { L: Pt[]; R: Pt[] } {
  const fine = resample(center, Math.min(step, 0.25), closed);
  if (closed && fine.length > 2 && dist(fine[0], fine[fine.length - 1]) < 1e-6) fine.pop();
  const nm = normals(fine, closed);
  // lisser les normales pour éviter les à-coups aux sommets
  const sm = nm.map((_, i) => {
    let x = 0, y = 0;
    for (let k = -3; k <= 3; k++) {
      const j = closed ? (i + k + nm.length) % nm.length : Math.max(0, Math.min(nm.length - 1, i + k));
      x += nm[j].x; y += nm[j].y;
    }
    const L = Math.hypot(x, y) || 1;
    return { x: x / L, y: y / L };
  });
  const pts = closed ? [...fine, fine[0]] : fine;
  const nrm = closed ? [...sm, sm[0]] : sm;
  // ré-échantillonnage au pas voulu le long de la ligne centrale
  const L: Pt[] = [], R: Pt[] = [];
  let acc = 0, next = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += dist(pts[i - 1], pts[i]);
    if (acc + 1e-9 >= next || i === pts.length - 1) {
      const c = pts[i], n = nrm[i], h = width / 2;
      L.push({ x: c.x + n.x * h, y: c.y + n.y * h });
      R.push({ x: c.x - n.x * h, y: c.y - n.y * h });
      next = acc + step;
    }
  }
  return { L, R };
}

function splitLong(a: Pt, b: Pt, maxLen: number, phase: number): Pt[] {
  const L = dist(a, b);
  if (L <= maxLen) return [b];
  const n = Math.ceil(L / maxLen);
  const out: Pt[] = [];
  // points intermédiaires décalés d'une colonne à l'autre pour ne pas créer de sillon
  for (let k = 1; k < n; k++) out.push(lerp(a, b, Math.min(0.95, Math.max(0.05, (k + (phase - 0.33) * 0.6) / n))));
  out.push(b);
  return out;
}

export function satinColumn(center: Pt[], width: number, closed: boolean, p: SatinParams): Pt[] {
  if (center.length < 2) return [];
  const out: Pt[] = [];
  const w = width + p.pullComp * 2;
  const reversed = [...center].reverse();
  let satinPath = center;
  const ul = p.underlay;
  if (ul.includes('edge')) {
    const { L, R } = satinRails(center, Math.max(0.2, width - 1.2), closed, 2);
    out.push(...subdivide(L, 2.5), ...subdivide([...R].reverse(), 2.5));
  }
  if (ul === 'center') {
    out.push(...subdivide(center, 2.5, closed));
    satinPath = reversed;
  }
  if (ul.includes('zigzag')) {
    const fwd = ul === 'zigzag' ? center : center;
    const { L, R } = satinRails(fwd, Math.max(0.2, width - 1.2), closed, 1.8);
    for (let i = 0; i < L.length; i++) out.push(i % 2 ? R[i] : L[i]);
    satinPath = reversed;
  }
  // densité = distance entre deux piqûres successives d'un même bord (un aller-retour complet)
  const { L, R } = satinRails(satinPath, w, closed, Math.max(0.1, p.density / 2));
  let prev: Pt | null = out.length ? out[out.length - 1] : null;
  for (let i = 0; i < L.length; i++) {
    const q = i % 2 === 0 ? L[i] : R[i];
    if (prev && dist(prev, q) > p.maxLength) out.push(...splitLong(prev, q, p.maxLength, (i % 3) / 3));
    else out.push(q);
    prev = q;
  }
  return out;
}

// ------------------------------------------------------------------ Remplissage

interface Section { rows: { y: number; a: number; b: number; idx: number }[] }

function buildSections(contours: Poly[], spacing: number): Section[] {
  const rows = scanRows(contours, spacing);
  const open: { sec: Section; last: { a: number; b: number }; row: number }[] = [];
  const done: Section[] = [];
  rows.forEach((row, ri) => {
    const used = new Set<number>();
    const nextOpen: typeof open = [];
    for (const s of row.spans) {
      const cands = open.filter((o) => o.row === ri - 1 && o.last.a < s.b && s.a < o.last.b);
      let target: (typeof open)[number] | undefined;
      if (cands.length === 1) {
        const o = cands[0];
        const overlaps = row.spans.filter((t) => o.last.a < t.b && t.a < o.last.b).length;
        if (overlaps === 1 && !used.has(open.indexOf(o))) target = o;
      }
      if (target) {
        used.add(open.indexOf(target));
        target.sec.rows.push({ y: row.y, a: s.a, b: s.b, idx: ri });
        nextOpen.push({ sec: target.sec, last: s, row: ri });
      } else {
        const sec: Section = { rows: [{ y: row.y, a: s.a, b: s.b, idx: ri }] };
        nextOpen.push({ sec, last: s, row: ri });
      }
    }
    for (const o of open) if (!nextOpen.some((n) => n.sec === o.sec)) done.push(o.sec);
    open.length = 0;
    open.push(...nextOpen);
  });
  for (const o of open) done.push(o.sec);
  return done;
}

/** Points d'une rangée : extrémités + grille globale décalée (motif « brique »). */
function rowPoints(y: number, from: number, to: number, idx: number, p: FillParams, satin: boolean, maxLen: number): Pt[] {
  const out: Pt[] = [{ x: from, y }];
  const dir = to >= from ? 1 : -1;
  const Lspan = Math.abs(to - from);
  if (satin) {
    if (Lspan > maxLen) {
      const n = Math.ceil(Lspan / maxLen);
      // positions de fractionnement pseudo-aléatoires : évite les sillons visibles
      const ph = (((idx * 0.618034) % 1) - 0.5) * 0.8;
      for (let k = 1; k < n; k++) out.push({ x: from + dir * Lspan * Math.min(0.95, Math.max(0.05, (k + ph) / n)), y });
    }
    out.push({ x: to, y });
    return out;
  }
  const len = p.length;
  const off = ((idx * p.offset) % 1) * len;
  const minGap = Math.min(0.6, len * 0.3);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const grid: number[] = [];
  for (let x = Math.ceil((lo - off) / len) * len + off; x < hi; x += len) {
    if (x - lo > minGap && hi - x > minGap) grid.push(x);
  }
  if (dir < 0) grid.reverse();
  for (const x of grid) out.push({ x, y });
  out.push({ x: to, y });
  return out;
}

function sectionPath(sec: Section, reverseRows: boolean, startRight: boolean, p: FillParams, satin: boolean, maxLen: number): Pt[] {
  const rows = reverseRows ? [...sec.rows].reverse() : sec.rows;
  const out: Pt[] = [];
  rows.forEach((r, k) => {
    const ltr = (k % 2 === 0) !== startRight;
    const pts = rowPoints(r.y, ltr ? r.a : r.b, ltr ? r.b : r.a, r.idx, p, satin, maxLen);
    if (out.length) {
      const prev = out[out.length - 1];
      // transition entre deux rangées: rester sur le bord
      if (dist(prev, pts[0]) > p.length) out.push(...subdivide([prev, pts[0]], p.length).slice(1, -1));
    }
    out.push(...pts);
  });
  return out;
}


/** Projection d'un point sur le contour le plus proche. */
function projectOnRings(p: Pt, rings: Poly[]) {
  let best = { ring: -1, seg: -1, t: 0, d: Infinity };
  rings.forEach((r, ri) => {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d < best.d) best = { ring: ri, seg: i, t, d };
    }
  });
  return best;
}

/** Chemin le long du bord entre deux points situés sur le même contour (le plus court des deux sens). */
function edgeWalk(a: Pt, b: Pt, rings: Poly[]): Pt[] | null {
  const pa = projectOnRings(a, rings), pb = projectOnRings(b, rings);
  if (pa.ring < 0 || pa.ring !== pb.ring || pa.d > 0.35 || pb.d > 0.35) return null;
  const ring = rings[pa.ring], n = ring.length;
  let fwd: Pt[], bwd: Pt[];
  if (pa.seg === pb.seg && pa.t <= pb.t) fwd = [a, b];
  else {
    fwd = [a];
    let i = pa.seg, guard = 0;
    do { i = (i + 1) % n; fwd.push(ring[i]); } while (i !== pb.seg && guard++ <= n);
    fwd.push(b);
  }
  if (pa.seg === pb.seg && pa.t >= pb.t) bwd = [a, b];
  else {
    bwd = [a];
    let i = pa.seg, guard = 0;
    const stop = (pb.seg + 1) % n;
    for (;;) { bwd.push(ring[i]); if (i === stop || guard++ > n) break; i = (i - 1 + n) % n; }
    bwd.push(b);
  }
  return polyLength(fwd) <= polyLength(bwd) ? fwd : bwd;
}

/** Ordonne les sections au plus proche, relie par point de déplacement ou saut. */
function linkSections(sections: Section[], p: FillParams, satin: boolean, maxLen: number, rotContours: Poly[], start: Pt | null): Stitch[] {
  const remaining = sections.slice();
  const out: Stitch[] = [];
  let cur = start;
  while (remaining.length) {
    let best = 0, bestVar = 0, bd = Infinity;
    remaining.forEach((sec, i) => {
      const f = sec.rows[0], l = sec.rows[sec.rows.length - 1];
      const n = sec.rows.length;
      const cands: [Pt, number][] = [
        [{ x: f.a, y: f.y }, 0], [{ x: f.b, y: f.y }, 1],
        [{ x: n % 2 ? l.a : l.b, y: l.y }, 2], [{ x: n % 2 ? l.b : l.a, y: l.y }, 3],
      ];
      for (const [pt, v] of cands) {
        const d = cur ? dist(cur, pt) : f.y * 1e-6 + v;
        if (d < bd) { bd = d; best = i; bestVar = v; }
      }
    });
    const sec = remaining.splice(best, 1)[0];
    const path = sectionPath(sec, bestVar >= 2, bestVar === 1 || bestVar === 3, p, satin, maxLen);
    if (!path.length) continue;
    if (cur) {
      const s0 = path[0];
      const d = dist(cur, s0);
      if (d > 0.05) {
        const walk = d < 1.2 ? null : edgeWalk(cur, s0, rotContours);
        if (d < 1.2) out.push(S(s0));
        else if (walk && polyLength(walk) < Math.max(25, d * 2.5)) out.push(...subdivide(walk, 2.5).slice(1).map(S));
        else if (d < 4 && segmentInside(cur, s0, rotContours, 0.3)) out.push(...subdivide([cur, s0], 2.5).slice(1).map(S));
        else out.push(J(s0));
      }
      out.push(...path.slice(d > 0.05 ? 1 : 0).map(S));
    } else {
      out.push(J(path[0]), ...path.slice(1).map(S));
    }
    cur = path[path.length - 1];
  }
  return out;
}

export function scanFill(contours: Poly[], p: FillParams, angleDeg: number, start: Pt | null, satin = false, maxLen = 7): Stitch[] {
  const ang = rad(angleDeg);
  const rot = rotateContours(contours, -ang);
  const sections = buildSections(rot, Math.max(0.15, p.spacing));
  const startR = start ? rotatePt(start, -ang) : null;
  const st = linkSections(sections, p, satin, maxLen, rot, startR);
  return st.map((s) => ({ ...rotatePt(s, ang), cmd: s.cmd }));
}

function contourFill(contours: Poly[], p: FillParams, start: Pt | null): Stitch[] {
  const out: Stitch[] = [];
  let rings: Poly[] = contours;
  let cur = start;
  let guard = 0;
  while (rings.length && guard++ < 400) {
    for (const ring of rings) {
      const pts = subdivide(ring, p.length, true);
      // commencer au point le plus proche
      let k = 0;
      if (cur) { let bd = Infinity; pts.forEach((q, i) => { const d = dist(cur!, q); if (d < bd) { bd = d; k = i; } }); }
      const ordered = [...pts.slice(k), ...pts.slice(0, k + 1)];
      if (cur && dist(cur, ordered[0]) > p.spacing * 2.5) out.push(J(ordered[0])); else out.push(S(ordered[0]));
      out.push(...ordered.slice(1).map(S));
      cur = ordered[ordered.length - 1];
    }
    rings = offsetContours(rings, -p.spacing);
  }
  return out;
}

export function fillRegion(contours: Poly[], p: FillParams, start: Pt | null = null): Stitch[] {
  const base = normalize(contours);
  if (!base.length) return [];
  const out: Stitch[] = [];
  const ul = p.underlay;
  const islands = splitIslands(base);
  let cur = start;
  // îlots ordonnés au plus proche
  const todo = islands.slice();
  while (todo.length) {
    let bi = 0, bd = Infinity;
    todo.forEach((isl, i) => {
      for (const q of isl[0]) { const d = cur ? dist(cur, q) : 0; if (d < bd) { bd = d; bi = i; } }
    });
    const isl = todo.splice(bi, 1)[0];
    const seg: Stitch[] = [];
    const last = () => (seg.length ? seg[seg.length - 1] : cur);
    if (ul.includes('edge')) {
      const inset = offsetContours(isl, -0.5);
      for (const ring of inset) {
        const pts = subdivide(ring, 2.5, true);
        const l = last();
        let k = 0;
        if (l) { let md = Infinity; pts.forEach((q, i) => { const d = dist(l, q); if (d < md) { md = d; k = i; } }); }
        const ord = [...pts.slice(k), ...pts.slice(0, k + 1)];
        seg.push(J(ord[0]), ...ord.slice(1).map(S));
      }
    }
    if (ul.includes('tatami') || ul === 'zigzag') {
      const inset = offsetContours(isl, -0.7);
      if (inset.length) {
        const up: FillParams = { ...p, spacing: 2.2, length: 3.5, offset: 0.5 };
        seg.push(...scanFill(inset, up, p.angle + 90, last(), false));
      }
    }
    if (ul === 'center') {
      const inset = offsetContours(isl, -0.7);
      if (inset.length) seg.push(...scanFill(inset, { ...p, spacing: 3.5, length: 3.5 }, p.angle + 90, last(), false));
    }
    const top = p.pullComp ? offsetContours(isl, p.pullComp) : isl;
    if (p.pattern === 'contour') seg.push(...contourFill(top, p, last()));
    else seg.push(...scanFill(top, p, p.angle, last(), p.pattern === 'satin', 7));
    if (p.edgeRun) {
      for (const ring of isl) {
        const pts = subdivide(ring, 2.2, true);
        const l = last();
        let k = 0;
        if (l) { let md = Infinity; pts.forEach((q, i) => { const d = dist(l, q); if (d < md) { md = d; k = i; } }); }
        const ord = [...pts.slice(k), ...pts.slice(0, k + 1)];
        seg.push(J(ord[0]), ...ord.slice(1).map(S));
      }
    }
    out.push(...seg);
    if (seg.length) cur = seg[seg.length - 1];
  }
  return out;
}

// ------------------------------------------------------------------ Appliqué

export function appliqueStitches(contours: Poly[], borderWidth: number, satin: SatinParams): Stitch[] {
  const out: Stitch[] = [];
  const rings = normalize(contours);
  // 1. ligne de placement
  for (const r of rings) {
    const pts = subdivide(r, 2.5, true);
    out.push(J(pts[0]), ...pts.slice(1).map(S));
  }
  out.push({ ...out[out.length - 1], cmd: Cmd.STOP });
  // 2. fixation (point avant légèrement à l'intérieur + zigzag lâche)
  const inner = offsetContours(rings, -0.4);
  for (const r of inner) {
    const pts = subdivide(r, 2.5, true);
    out.push(J(pts[0]), ...pts.slice(1).map(S));
  }
  out.push({ ...out[out.length - 1], cmd: Cmd.STOP });
  // 3. bordure satin (côté intérieur décalé pour couvrir le bord découpé)
  for (const r of rings) {
    const ccw = signedArea(r) > 0;
    const ring = ccw ? r : [...r].reverse();
    const col = satinColumn(ring, borderWidth, true, satin);
    if (col.length) out.push(J(col[0]), ...col.slice(1).map(S));
  }
  return out;
}

// ------------------------------------------------------------------ Points d'arrêt

export function tieIn(pts: Stitch[]): Stitch[] {
  const i = pts.findIndex((s) => s.cmd === Cmd.STITCH);
  if (i < 0 || i + 1 >= pts.length) return pts;
  const a = pts[i], b = pts[i + 1];
  const L = dist(a, b);
  if (L < 0.01) return pts;
  const t = Math.min(0.5, L / 2) / L;
  const m = lerp(a, b, t);
  const lock: Stitch[] = [S(m), S(a), S(m), S(a)];
  return [...pts.slice(0, i + 1), ...lock, ...pts.slice(i + 1)];
}

export function tieOff(pts: Stitch[]): Stitch[] {
  let i = pts.length - 1;
  while (i >= 0 && pts[i].cmd !== Cmd.STITCH) i--;
  if (i < 1) return pts;
  const a = pts[i], b = pts[i - 1];
  const L = dist(a, b);
  if (L < 0.01) return pts;
  const m = lerp(a, b, Math.min(0.5, L / 2) / L);
  return [...pts.slice(0, i + 1), S(m), S(a), S(m), S(a), ...pts.slice(i + 1)];
}
