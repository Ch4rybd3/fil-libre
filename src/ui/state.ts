// État global de l'application, historique et opérations sur les objets.
import type { Design, EmbObject, Pt, Thread } from '../core/types';
import { Cmd } from '../core/types';
import { newDesign, uid, hoopOf } from '../core/defaults';
import { buildPlan, objectBBox, type Plan, textContours } from '../core/plan';
import { applyMat, bboxUnion, distToPolyline, pointInContours, type BBox, type Mat } from '../core/geometry';

export type Tool = 'select' | 'nodes' | 'run' | 'satin' | 'fill' | 'applique' | 'shape' | 'text' | 'measure' | 'pan';

export interface View { zoom: number; ox: number; oy: number }

export interface Settings {
  realistic: boolean;
  showJumps: boolean;
  showGrid: boolean;
  showOutlines: boolean;
  trimDistance: number;
  jefTrims: boolean;
  shapeKind: string;
  shapeAs: 'fill' | 'run' | 'satin' | 'applique';
}

type Listener = () => void;

class App {
  design: Design = newDesign();
  sel = new Set<string>();
  tool: Tool = 'select';
  view: View = { zoom: 3, ox: 0, oy: 0 };
  plan: Plan = buildPlan(this.design);
  sim: { active: boolean; index: number; playing: boolean; speed: number } = { active: false, index: 0, playing: false, speed: 40 };
  settings: Settings = {
    realistic: true, showJumps: false, showGrid: true, showOutlines: true, trimDistance: 3, jefTrims: true,
    shapeKind: 'ellipse', shapeAs: 'fill',
  };
  currentColor = 0;
  cursor: Pt | null = null;
  private undo: string[] = [];
  private redo: string[] = [];
  private listeners: Record<string, Listener[]> = {};
  dirty = false;

  on(ev: string, f: Listener) { (this.listeners[ev] ??= []).push(f); }
  emit(ev: string) { for (const f of this.listeners[ev] ?? []) f(); }

  get hoop() { return hoopOf(this.design.hoop); }

  snapshot(): string {
    const { background, ...rest } = this.design;
    return JSON.stringify(rest);
  }

  /** À appeler AVANT une modification, pour l'annulation. */
  checkpoint() {
    this.undo.push(this.snapshot());
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  }

  /** Après une modification : recalcul du plan et rafraîchissement. */
  changed(structural = true) {
    this.plan = buildPlan(this.design, { trimDistance: this.settings.trimDistance });
    this.dirty = true;
    if (this.sim.active) this.sim.index = Math.min(this.sim.index, this.plan.stitches.length);
    this.emit(structural ? 'change' : 'redraw');
    this.emit('redraw');
    autosave();
  }

  commit(fn: () => void) { this.checkpoint(); fn(); this.changed(); }

  doUndo() { this.restoreFrom(this.undo, this.redo); }
  doRedo() { this.restoreFrom(this.redo, this.undo); }
  private restoreFrom(src: string[], dst: string[]) {
    const s = src.pop();
    if (!s) return;
    dst.push(this.snapshot());
    const bg = this.design.background;
    this.design = { ...JSON.parse(s), background: bg };
    for (const id of [...this.sel]) if (!this.byId(id)) this.sel.delete(id);
    this.changed();
    this.emit('select');
  }

  load(d: Design) {
    this.design = d;
    this.sel.clear();
    this.undo = []; this.redo = [];
    this.currentColor = 0;
    this.changed();
    this.emit('select');
    this.dirty = false;
  }

  byId(id: string) { return this.design.objects.find((o) => o.id === id); }
  selected(): EmbObject[] { return this.design.objects.filter((o) => this.sel.has(o.id)); }
  select(ids: string[], add = false) {
    if (!add) this.sel.clear();
    for (const id of ids) this.sel.add(id);
    this.emit('select'); this.emit('redraw');
  }

  setTool(t: Tool) { this.tool = t; this.emit('tool'); this.emit('redraw'); }

  addThread(t: Thread): number {
    this.design.threads.push({ ...t });
    return this.design.threads.length - 1;
  }

  addObjects(objs: EmbObject[], select = true) {
    this.commit(() => { this.design.objects.push(...objs); });
    if (select) this.select(objs.map((o) => o.id));
  }

  deleteSelected() {
    if (!this.sel.size) return;
    this.commit(() => { this.design.objects = this.design.objects.filter((o) => !this.sel.has(o.id) || o.locked); });
    this.sel.clear(); this.emit('select');
  }

  selectionBBox(): BBox | null {
    let bb: BBox | null = null;
    for (const o of this.selected()) { const b = objectBBox(o); if (b) bb = bboxUnion(bb, b); }
    return bb;
  }
}

export const app = new App();

// ---------------------------------------------------------------- Opérations sur objets

export function cloneObj<T extends EmbObject>(o: T): T {
  return { ...JSON.parse(JSON.stringify(o)), id: uid() };
}

/** Applique une matrice à un objet. `scale`/`rot` servent aux objets paramétriques (texte, largeur satin). */
export function transformObject(o: EmbObject, m: Mat, info: { sx: number; sy: number; rot: number }) {
  const tp = (p: Pt) => applyMat(m, p);
  switch (o.kind) {
    case 'run': o.points = o.points.map(tp); break;
    case 'satin':
      o.points = o.points.map(tp);
      o.width = Math.max(0.5, o.width * Math.sqrt(Math.abs(info.sx * info.sy)));
      break;
    case 'fill': case 'applique': o.contours = o.contours.map((c) => c.map(tp)); break;
    case 'stitches': o.stitches = o.stitches.map((s) => ({ ...tp(s), cmd: s.cmd })); break;
    case 'text': {
      const c = tp({ x: o.x, y: o.y });
      o.x = c.x; o.y = c.y;
      o.scaleX *= info.sx; o.scaleY *= info.sy;
      o.rotation = (o.rotation + (info.rot * 180) / Math.PI) % 360;
      break;
    }
  }
}

export function hitTest(p: Pt, tol: number): EmbObject | null {
  const objs = app.design.objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (!o.visible) continue;
    if (hitObject(o, p, tol)) return o;
  }
  return null;
}

export function hitObject(o: EmbObject, p: Pt, tol: number): boolean {
  const bb = objectBBox(o);
  if (!bb || p.x < bb.minX - tol || p.x > bb.maxX + tol || p.y < bb.minY - tol || p.y > bb.maxY + tol) return false;
  switch (o.kind) {
    case 'run': return distToPolyline(p, o.points, o.closed).d < tol + 0.5;
    case 'satin': return distToPolyline(p, o.points, o.closed).d < o.width / 2 + tol;
    case 'fill': case 'applique':
      if (pointInContours(p, o.contours)) return true;
      return o.contours.some((c) => distToPolyline(p, c, true).d < tol);
    case 'text': {
      const g = textContours(o);
      if (!g) return true;
      return g.some((c) => pointInContours(p, c) || c.some((r) => distToPolyline(p, r, true).d < tol));
    }
    case 'stitches': {
      const st = o.stitches;
      for (let i = 1; i < st.length; i++) {
        if (st[i].cmd !== Cmd.STITCH) continue;
        const a = st[i - 1], b = st[i];
        if (distToPolyline(p, [a, b], false).d < tol + 0.3) return true;
      }
      return false;
    }
  }
}

// ---------------------------------------------------------------- Sauvegarde auto

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem('fil-libre:autosave', JSON.stringify(app.design)); } catch { /* quota ou mode privé */ }
  }, 800);
}

export function restoreAutosave(): Design | null {
  try {
    const s = localStorage.getItem('fil-libre:autosave');
    if (!s) return null;
    const d = JSON.parse(s) as Design;
    return d.objects?.length ? d : null;
  } catch { return null; }
}
