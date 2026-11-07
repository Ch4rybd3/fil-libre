// Commandes d'édition applicables à la sélection.
import { app, cloneObj, transformObject } from './state';
import type { EmbObject, Poly, Pt } from '../core/types';
import { makeApplique, makeFill, makeRun, makeSatin } from '../core/defaults';
import { booleanOp, matAround, matRotate, matScale, matTranslate, normalize, offsetContours, splitIslands, strokeToPolygon, rad, signedArea } from '../core/geometry';
import { objectBBox, textContours } from '../core/plan';
import { toast } from './dom';

const editable = () => app.selected().filter((o) => !o.locked);

export function duplicate() {
  const src = editable();
  if (!src.length) return;
  const copies = src.map((o) => { const c = cloneObj(o); transformObject(c, matTranslate(5, 5), { sx: 1, sy: 1, rot: 0 }); return c; });
  app.addObjects(copies);
}

let clipboard: EmbObject[] = [];
export function copy() { clipboard = app.selected().map((o) => JSON.parse(JSON.stringify(o))); }
export function cut() { copy(); app.deleteSelected(); }
export function paste() {
  if (!clipboard.length) return;
  const copies = clipboard.map((o) => { const c = cloneObj(o); transformObject(c, matTranslate(5, 5), { sx: 1, sy: 1, rot: 0 }); return c; });
  clipboard = copies.map((o) => JSON.parse(JSON.stringify(o)));
  app.addObjects(copies);
}

function center() {
  const bb = app.selectionBBox();
  return bb ? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } : { x: 0, y: 0 };
}

export function mirror(axis: 'h' | 'v') {
  const objs = editable();
  if (!objs.length) return;
  const c = center();
  const m = matAround(axis === 'h' ? matScale(-1, 1) : matScale(1, -1), c);
  app.commit(() => objs.forEach((o) => {
    if (o.kind === 'text') {
      // pour le texte, le miroir s'applique via l'échelle
      const p = { x: 2 * c.x - o.x, y: o.y }, q = { x: o.x, y: 2 * c.y - o.y };
      if (axis === 'h') { o.scaleX *= -1; o.x = p.x; o.rotation = -o.rotation; } else { o.scaleY *= -1; o.y = q.y; o.rotation = -o.rotation; }
    } else transformObject(o, m, { sx: 1, sy: 1, rot: 0 });
  }));
}

export function rotate(deg: number) {
  const objs = editable();
  if (!objs.length) return;
  const m = matAround(matRotate(rad(deg)), center());
  app.commit(() => objs.forEach((o) => transformObject(o, m, { sx: 1, sy: 1, rot: rad(deg) })));
}

export function moveBy(dx: number, dy: number) {
  const objs = editable();
  if (!objs.length) return;
  app.commit(() => objs.forEach((o) => transformObject(o, matTranslate(dx, dy), { sx: 1, sy: 1, rot: 0 })));
}

export function resizeTo(w: number, h: number) {
  const bb = app.selectionBBox();
  if (!bb) return;
  const sx = w / Math.max(0.01, bb.maxX - bb.minX), sy = h / Math.max(0.01, bb.maxY - bb.minY);
  const m = matAround(matScale(sx, sy), center());
  app.commit(() => editable().forEach((o) => transformObject(o, m, { sx, sy, rot: 0 })));
}

export function centerOnHoop() {
  const c = center();
  moveBy(-c.x, -c.y);
}

export function align(where: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const objs = editable();
  const bb = app.selectionBBox();
  if (objs.length < 2 || !bb) return;
  app.commit(() => objs.forEach((o) => {
    const b = objectBBox(o);
    if (!b) return;
    let dx = 0, dy = 0;
    if (where === 'left') dx = bb.minX - b.minX;
    if (where === 'right') dx = bb.maxX - b.maxX;
    if (where === 'hcenter') dx = (bb.minX + bb.maxX) / 2 - (b.minX + b.maxX) / 2;
    if (where === 'top') dy = bb.minY - b.minY;
    if (where === 'bottom') dy = bb.maxY - b.maxY;
    if (where === 'vcenter') dy = (bb.minY + bb.maxY) / 2 - (b.minY + b.maxY) / 2;
    transformObject(o, matTranslate(dx, dy), { sx: 1, sy: 1, rot: 0 });
  }));
}

export function order(dir: 'first' | 'up' | 'down' | 'last') {
  const ids = app.sel;
  if (!ids.size) return;
  app.commit(() => {
    const objs = app.design.objects;
    const sel = objs.filter((o) => ids.has(o.id));
    const rest = objs.filter((o) => !ids.has(o.id));
    if (dir === 'first') app.design.objects = [...sel, ...rest];
    else if (dir === 'last') app.design.objects = [...rest, ...sel];
    else {
      const arr = objs.slice();
      const idxs = arr.map((o, i) => (ids.has(o.id) ? i : -1)).filter((i) => i >= 0);
      if (dir === 'up') { for (const i of idxs) if (i > 0 && !ids.has(arr[i - 1].id)) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }
      else for (const i of idxs.reverse()) if (i < arr.length - 1 && !ids.has(arr[i + 1].id)) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      app.design.objects = arr;
    }
  });
}

/** Contours fermés représentant la surface d'un objet. */
export function shapeOf(o: EmbObject): Poly[] {
  switch (o.kind) {
    case 'fill': case 'applique': return normalize(o.contours);
    case 'text': return normalize((textContours(o) ?? []).flat());
    case 'satin': return strokeToPolygon(o.points, o.width, o.closed);
    case 'run': return o.closed ? normalize([o.points]) : strokeToPolygon(o.points, 0.6, false);
    default: return [];
  }
}

export function convert(to: 'run' | 'satin' | 'fill' | 'applique') {
  const objs = editable().filter((o) => o.kind !== 'stitches');
  if (!objs.length) return;
  app.commit(() => {
    const out: EmbObject[] = [];
    for (const o of objs) {
      let n: EmbObject[] = [];
      if (to === 'fill' || to === 'applique') {
        const sh = shapeOf(o);
        if (!sh.length) continue;
        n = [to === 'fill' ? makeFill(sh, o.color) : makeApplique(sh, o.color)];
      } else {
        // contours → lignes
        const lines: { pts: Pt[]; closed: boolean }[] =
          o.kind === 'run' || o.kind === 'satin' ? [{ pts: o.points, closed: o.closed }] : shapeOf(o).map((c) => ({ pts: c, closed: true }));
        n = lines.map((l) => (to === 'run' ? makeRun(l.pts, l.closed, o.color) : makeSatin(l.pts, o.kind === 'satin' ? o.width : 3, l.closed, o.color)));
      }
      const idx = app.design.objects.indexOf(o);
      app.design.objects.splice(idx, 1, ...n);
      out.push(...n);
    }
    app.sel.clear(); out.forEach((o) => app.sel.add(o.id));
  });
  app.emit('select');
}

/** Contour décalé autour de la sélection (bordure, « écho »). */
export function outlineOffset(distance: number, as: 'run' | 'satin' | 'fill', width = 2.5, color = app.currentColor) {
  const objs = app.selected().filter((o) => o.kind !== 'stitches');
  if (!objs.length) { toast('Sélectionnez un ou plusieurs objets'); return; }
  const union = objs.reduce<Poly[]>((acc, o) => booleanOp(acc, shapeOf(o), 'union'), []);
  const rings = offsetContours(union, distance, true);
  if (!rings.length) return;
  let n: EmbObject[];
  if (as === 'fill') n = [makeFill(booleanOp(rings, union, 'difference'), color, 'Bordure')];
  else n = rings.map((r) => {
    const ring = signedArea(r) > 0 ? r : [...r].reverse();
    if (as === 'run') { const o = makeRun(ring, true, color); o.name = 'Contour'; return o; }
    const o = makeSatin(ring, width, true, color); o.name = 'Bordure satin'; return o;
  });
  // la bordure est brodée après les objets d'origine
  app.checkpoint();
  const last = Math.max(...objs.map((o) => app.design.objects.indexOf(o)));
  app.design.objects.splice(last + 1, 0, ...n);
  app.changed();
  app.select(n.map((o) => o.id));
}

export interface OutlineOptions {
  scope: 'selection' | 'all';
  mode: 'each' | 'union';           // un contour par forme, ou la silhouette de l'ensemble
  color: number;                    // index du fil
  stitch: 'satin' | 'triple' | 'simple';
  width: number;                    // largeur du satin (mm)
  offset: number;                   // décalage vers l'extérieur (mm), 0 = sur le bord
  placement: 'after' | 'end';       // juste après chaque forme, ou tous à la fin du motif
}

/** Formes auxquelles on peut ajouter un contour (surfaces : remplissages, appliqués, textes, tracés fermés). */
export const outlinable = (o: EmbObject) => o.kind === 'fill' || o.kind === 'applique' || o.kind === 'text' || ((o.kind === 'satin' || o.kind === 'run') && o.closed);

/** Ajoute un contour (satin ou point avant) autour des formes choisies. Retourne le nombre de contours créés. */
export function addOutlines(op: OutlineOptions): number {
  const src = (op.scope === 'all' ? app.design.objects : app.selected()).filter((o) => outlinable(o) && o.visible);
  if (!src.length) { toast('Aucune forme à contourner', 'error'); return 0; }
  const ringsOf = (sh: Poly[]) => (op.offset > 0 ? offsetContours(sh, op.offset, true) : sh);
  const make = (ring: Pt[]): EmbObject => {
    const r = signedArea(ring) > 0 ? ring : [...ring].reverse();
    if (op.stitch === 'satin') {
      const o = makeSatin(r, op.width, true, op.color);
      o.satin.underlay = op.width > 1.6 ? 'center' : 'none';
      o.name = 'Contour satin';
      return o;
    }
    const o = makeRun(r, true, op.color);
    o.run.repeats = op.stitch === 'triple' ? 3 : 1; o.run.length = 2; o.name = 'Contour';
    return o;
  };
  app.checkpoint();
  const created: EmbObject[] = [];
  if (op.mode === 'union') {
    const union = src.reduce<Poly[]>((acc, o) => booleanOp(acc, shapeOf(o), 'union'), []);
    const n = ringsOf(union).map(make);
    const last = Math.max(...src.map((o) => app.design.objects.indexOf(o)));
    app.design.objects.splice(op.placement === 'end' ? app.design.objects.length : last + 1, 0, ...n);
    created.push(...n);
  } else {
    const tail: EmbObject[] = [];
    for (const o of src) {
      const n = ringsOf(shapeOf(o)).map(make);
      if (op.placement === 'end') tail.push(...n);
      else app.design.objects.splice(app.design.objects.indexOf(o) + 1, 0, ...n);
      created.push(...n);
    }
    app.design.objects.push(...tail);
  }
  app.changed();
  app.select(created.map((o) => o.id));
  return created.length;
}

/** Retire des remplissages les parties recouvertes par les objets brodés après eux. */
export function removeOverlaps() {
  const objs = app.design.objects;
  const targets = editable().filter((o) => o.kind === 'fill');
  if (!targets.length) { toast('Sélectionnez des remplissages'); return; }
  app.commit(() => {
    for (const t of targets) {
      if (t.kind !== 'fill') continue;
      const i = objs.indexOf(t);
      const above = objs.slice(i + 1).filter((o) => o.visible && o.kind !== 'stitches');
      let cover: Poly[] = [];
      for (const a of above) cover = booleanOp(cover, offsetContours(shapeOf(a), -0.4), 'union');
      if (!cover.length) continue;
      const res = booleanOp(t.contours, cover, 'difference');
      if (res.length) t.contours = res;
    }
  });
  toast('Superpositions retirées');
}

export function combine() {
  const objs = editable().filter((o) => o.kind === 'fill');
  if (objs.length < 2) { toast('Sélectionnez au moins 2 remplissages'); return; }
  app.commit(() => {
    const first = objs[0];
    if (first.kind !== 'fill') return;
    first.contours = objs.flatMap((o) => (o.kind === 'fill' ? o.contours : []));
    const ids = new Set(objs.map((o) => o.id));
    app.design.objects = app.design.objects.filter((o) => o.id === first.id || !ids.has(o.id));
    app.sel.clear(); app.sel.add(first.id);
  });
  app.emit('select');
}

export function breakApart() {
  const objs = editable().filter((o) => o.kind === 'fill' || o.kind === 'applique');
  if (!objs.length) return;
  app.commit(() => {
    app.sel.clear();
    for (const o of objs) {
      if (o.kind !== 'fill' && o.kind !== 'applique') continue;
      const islands = splitIslands(o.contours);
      if (islands.length < 2) { app.sel.add(o.id); continue; }
      const parts: EmbObject[] = islands.map((isl) => ({ ...cloneObj(o as EmbObject), contours: isl }) as EmbObject);
      const idx = app.design.objects.indexOf(o);
      app.design.objects.splice(idx, 1, ...parts);
      parts.forEach((p) => app.sel.add(p.id));
    }
  });
  app.emit('select');
}

/** Regroupe les objets de même couleur pour réduire les changements de fil (respecte l'ordre relatif). */
export function optimizeColors() {
  app.commit(() => {
    const firstPos = new Map<number, number>();
    app.design.objects.forEach((o, i) => { if (!firstPos.has(o.color)) firstPos.set(o.color, i); });
    app.design.objects = app.design.objects
      .map((o, i) => ({ o, i }))
      .sort((a, b) => firstPos.get(a.o.color)! - firstPos.get(b.o.color)! || a.i - b.i)
      .map((x) => x.o);
  });
  toast(`Changements de fil : ${app.plan.colorChanges}`);
}

export function setColor(ci: number) {
  const objs = app.selected();
  if (!objs.length) return;
  app.commit(() => objs.forEach((o) => (o.color = ci)));
}
