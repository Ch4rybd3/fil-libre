// Interaction souris / stylet sur le plan de travail.
import { app, cloneObj, hitTest, transformObject, type Tool } from './state';
import { Renderer, selectionHandles, type Handle } from './renderer';
import type { EmbObject, Pt } from '../core/types';
import { makeApplique, makeFill, makeRun, makeSatin, makeText, shapePoints, type ShapeKind } from '../core/defaults';
import { catmullRom, dist, distToSegment, douglasPeucker, matAround, matMul, matRotate, matScale, matTranslate, type Mat, bboxOf } from '../core/geometry';
import { objectBBox } from '../core/plan';

export const toolOpts = { curve: false, satinWidth: 3.5, snap: false };

type Drag =
  | { kind: 'move'; start: Pt; orig: EmbObject[]; m: Mat; dup: boolean }
  | { kind: 'scale'; h: Handle; anchor: Pt; start: Pt; orig: EmbObject[]; bb: { minX: number; minY: number; maxX: number; maxY: number }; m: Mat; sx: number; sy: number }
  | { kind: 'rotate'; c: Pt; a0: number; orig: EmbObject[]; m: Mat; rot: number }
  | { kind: 'band'; start: Pt; cur: Pt }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'node'; obj: EmbObject; ci: number; pi: number; before: string }
  | { kind: 'shape'; start: Pt; cur: Pt }
  | { kind: 'measure'; start: Pt; cur: Pt }
  | { kind: 'free'; pts: Pt[] };

export class Tools {
  private drag: Drag | null = null;
  private pts: Pt[] = [];          // points en cours de tracé
  private hover: Pt | null = null;
  private spaceDown = false;
  private downAt: { x: number; y: number; t: number } | null = null;
  private hoverNode: { ci: number; pi: number } | null = null;

  constructor(private r: Renderer, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('dblclick', (e) => this.dbl(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.pts.length) this.finish(); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping()) { this.spaceDown = true; canvas.style.cursor = 'grab'; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); } });
    app.on('tool', () => { this.cancel(); this.updateCursor(); });
    r.overlay = { draw: (ctx, z) => this.drawOverlay(ctx, z) };
  }

  get drawing() { return this.pts.length > 0; }

  updateCursor() {
    const t = app.tool;
    this.canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  }

  private mm(e: PointerEvent | MouseEvent): Pt {
    const rc = this.canvas.getBoundingClientRect();
    const p = this.r.toMm(e.clientX - rc.left, e.clientY - rc.top);
    if (toolOpts.snap && !['select', 'pan'].includes(app.tool)) return { x: Math.round(p.x), y: Math.round(p.y) };
    return p;
  }
  private tol() { return 5 / app.view.zoom; }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const rc = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rc.left, sy = e.clientY - rc.top;
    const before = this.r.toMm(sx, sy);
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    app.view.zoom = Math.min(80, Math.max(0.3, app.view.zoom * k));
    const after = this.r.toScreen(before);
    app.view.ox += sx - after.x; app.view.oy += sy - after.y;
    app.emit('view');
    this.r.request();
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.mm(e);
    this.downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (e.button === 1 || this.spaceDown || app.tool === 'pan') {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: app.view.ox, oy: app.view.oy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (app.sim.active) return;
    switch (app.tool) {
      case 'select': return this.selectDown(e, p);
      case 'nodes': return this.nodesDown(e, p);
      case 'run': case 'satin': case 'fill': case 'applique':
        if (!this.pts.length) this.drag = { kind: 'free', pts: [p] };
        else this.addPoint(p, e.shiftKey);
        return;
      case 'shape': this.drag = { kind: 'shape', start: p, cur: p }; return;
      case 'measure': this.drag = { kind: 'measure', start: p, cur: p }; return;
      case 'text': {
        const t = makeText('Texte', p.x, p.y, app.currentColor);
        app.addObjects([t]);
        app.setTool('select');
        app.emit('focus-text');
        return;
      }
    }
  }

  private selectDown(e: PointerEvent, p: Pt) {
    const bb = app.selectionBBox();
    if (bb && app.sel.size) {
      const hd = selectionHandles(bb, app.view.zoom).find((h) => dist(h, p) < 7 / app.view.zoom);
      if (hd) {
        const orig = app.selected().filter((o) => !o.locked).map((o) => JSON.parse(JSON.stringify(o)));
        if (hd.kind === 'rot') {
          const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
          this.drag = { kind: 'rotate', c, a0: Math.atan2(p.y - c.y, p.x - c.x), orig, m: [1, 0, 0, 1, 0, 0], rot: 0 };
        } else {
          const anchor = { x: hd.ax < 0 ? bb.maxX : hd.ax > 0 ? bb.minX : (bb.minX + bb.maxX) / 2, y: hd.ay < 0 ? bb.maxY : hd.ay > 0 ? bb.minY : (bb.minY + bb.maxY) / 2 };
          this.drag = { kind: 'scale', h: hd, anchor, start: p, orig, bb, m: [1, 0, 0, 1, 0, 0], sx: 1, sy: 1 };
        }
        return;
      }
    }
    const hit = hitTest(p, this.tol());
    if (hit) {
      if (e.shiftKey || e.ctrlKey) {
        if (app.sel.has(hit.id)) { app.sel.delete(hit.id); app.select([...app.sel]); return; }
        app.select([hit.id], true);
      } else if (!app.sel.has(hit.id)) app.select([hit.id]);
      const orig = app.selected().filter((o) => !o.locked).map((o) => JSON.parse(JSON.stringify(o)));
      this.drag = { kind: 'move', start: p, orig, m: [1, 0, 0, 1, 0, 0], dup: e.altKey };
    } else {
      if (!e.shiftKey) app.select([]);
      this.drag = { kind: 'band', start: p, cur: p };
    }
  }

  private nodesDown(e: PointerEvent, p: Pt) {
    const o = app.selected()[0];
    if (o) {
      const n = this.findNode(o, p);
      if (n) {
        this.drag = { kind: 'node', obj: o, ci: n.ci, pi: n.pi, before: app.snapshot() };
        return;
      }
    }
    const hit = hitTest(p, this.tol());
    app.select(hit ? [hit.id] : [], e.shiftKey);
  }

  private move(e: PointerEvent) {
    const p = this.mm(e);
    this.hover = p;
    app.cursor = p;
    app.emit('cursor');
    const d = this.drag;
    if (!d) {
      if (app.tool === 'nodes') {
        const o = app.selected()[0];
        const n = o ? this.findNode(o, p) : null;
        this.hoverNode = n;
        this.canvas.style.cursor = n ? 'move' : 'default';
      } else if (app.tool === 'select') {
        const bb = app.selectionBBox();
        const hd = bb && selectionHandles(bb, app.view.zoom).find((h) => dist(h, p) < 7 / app.view.zoom);
        this.canvas.style.cursor = hd ? (hd.kind === 'rot' ? 'alias' : hd.ax * hd.ay > 0 ? 'nwse-resize' : hd.ax * hd.ay < 0 ? 'nesw-resize' : hd.ax ? 'ew-resize' : 'ns-resize') : hitTest(p, this.tol()) ? 'move' : 'default';
      }
      if (this.pts.length) this.r.request();
      return;
    }
    switch (d.kind) {
      case 'pan':
        app.view.ox = d.ox + e.clientX - d.sx; app.view.oy = d.oy + e.clientY - d.sy;
        app.emit('view'); break;
      case 'move': {
        let dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        d.m = matTranslate(dx, dy);
        break;
      }
      case 'scale': {
        const { anchor, bb, h } = d;
        const w0 = bb.maxX - bb.minX || 1, h0 = bb.maxY - bb.minY || 1;
        let sx = h.ax ? ((p.x - anchor.x) * h.ax) / w0 : 1;
        let sy = h.ay ? ((p.y - anchor.y) * h.ay) / h0 : 1;
        if (h.ax && h.ay && !e.shiftKey) { const s = Math.max(sx, sy); sx = sy = s; }
        sx = Math.max(0.02, sx); sy = Math.max(0.02, sy);
        d.sx = sx; d.sy = sy;
        d.m = matAround(matScale(sx, sy), anchor);
        break;
      }
      case 'rotate': {
        let a = Math.atan2(p.y - d.c.y, p.x - d.c.x) - d.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        d.rot = a;
        d.m = matAround(matRotate(a), d.c);
        break;
      }
      case 'band': case 'shape': case 'measure': d.cur = p; break;
      case 'node': this.setNode(d.obj, d.ci, d.pi, p); app.changed(false); break;
      case 'free': {
        const moved = this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
        if (moved && dist(d.pts[d.pts.length - 1], p) > 0.6) d.pts.push(p);
        break;
      }
    }
    this.r.request();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    switch (d.kind) {
      case 'pan': this.updateCursor(); break;
      case 'move': case 'scale': case 'rotate': {
        const isId = d.m.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-9);
        if (isId) break;
        const info = { sx: d.kind === 'scale' ? d.sx : 1, sy: d.kind === 'scale' ? d.sy : 1, rot: d.kind === 'rotate' ? d.rot : 0 };
        app.checkpoint();
        if (d.kind === 'move' && d.dup) {
          const copies = d.orig.map((o) => { const c = cloneObj(o); transformObject(c, d.m, info); return c; });
          app.design.objects.push(...copies);
          app.changed();
          app.select(copies.map((c) => c.id));
          break;
        }
        for (const o of d.orig) {
          const idx = app.design.objects.findIndex((x) => x.id === o.id);
          if (idx < 0) continue;
          const c = JSON.parse(JSON.stringify(o));
          transformObject(c, d.m, info);
          app.design.objects[idx] = c;
        }
        app.changed();
        break;
      }
      case 'band': {
        const x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x), y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
        if (x1 - x0 < 0.5 && y1 - y0 < 0.5) break;
        const ids = app.design.objects.filter((o) => {
          if (!o.visible) return false;
          const b = objectBBox(o);
          return b && b.minX >= x0 && b.maxX <= x1 && b.minY >= y0 && b.maxY <= y1;
        }).map((o) => o.id);
        app.select(ids, e.shiftKey);
        break;
      }
      case 'node': {
        // historique : on remet l'état « avant » dans la pile
        const after = JSON.stringify(app.design.objects);
        const before = JSON.parse(d.before);
        app.design = { ...before, background: app.design.background };
        app.checkpoint();
        app.design.objects = JSON.parse(after);
        app.changed();
        app.select([d.obj.id]);
        break;
      }
      case 'shape': {
        const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
        if (w < 1 && h < 1) break;
        let W = w, H = h;
        if (e.shiftKey) W = H = Math.max(w, h);
        const c = e.altKey ? d.start : { x: d.start.x + Math.sign(d.cur.x - d.start.x) * W / 2, y: d.start.y + Math.sign(d.cur.y - d.start.y) * H / 2 };
        if (e.altKey) { W *= 2; H *= 2; }
        const pts = shapePoints(app.settings.shapeKind as ShapeKind, c, W, H);
        this.createFromPoints(app.settings.shapeAs, pts, true);
        break;
      }
      case 'measure': break;
      case 'free': {
        if (d.pts.length > 3) {
          // tracé à main levée : simplifier puis lisser
          const simp = douglasPeucker(d.pts, 0.25);
          const closed = dist(simp[0], simp[simp.length - 1]) < 3;
          const tool = app.tool;
          if (tool === 'run' || tool === 'satin') {
            this.createFromPoints(tool, closed ? simp.slice(0, -1) : simp, closed && tool === 'run' ? true : closed);
          } else this.createFromPoints(tool as 'fill' | 'applique', simp, true);
        } else this.addPoint(d.pts[0], e.shiftKey);
        break;
      }
    }
    this.r.request();
  }

  private dbl(e: MouseEvent) {
    if (app.tool === 'nodes') {
      const o = app.selected()[0];
      if (!o) return;
      const p = this.mm(e);
      this.insertNode(o, p);
      return;
    }
    if (app.tool === 'select') {
      const hit = hitTest(this.mm(e), this.tol());
      if (hit && hit.kind !== 'text' && hit.kind !== 'stitches') { app.select([hit.id]); app.setTool('nodes'); }
      return;
    }
    if (this.pts.length) {
      // le double-clic a ajouté 2 points identiques : on les retire
      while (this.pts.length > 1 && dist(this.pts[this.pts.length - 1], this.pts[this.pts.length - 2]) < 0.3) this.pts.pop();
      this.finish();
    }
  }

  private addPoint(p: Pt, shift: boolean) {
    if (this.pts.length && shift) {
      const a = this.pts[this.pts.length - 1];
      const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const L = dist(a, p);
      p = { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L };
    }
    // clic sur le premier point : fermer
    if (this.pts.length > 2 && dist(p, this.pts[0]) < 6 / app.view.zoom) { this.finish(true); return; }
    this.pts.push(p);
    this.r.request();
    app.emit('drawing');
  }

  finish(closed?: boolean) {
    const tool = app.tool;
    const pts = this.pts;
    this.pts = [];
    app.emit('drawing');
    if (tool === 'run' || tool === 'satin') {
      if (pts.length < 2) return;
      this.createFromPoints(tool, pts, !!closed);
    } else if (tool === 'fill' || tool === 'applique') {
      if (pts.length < 3) return;
      this.createFromPoints(tool, pts, true);
    }
    this.r.request();
  }

  private createFromPoints(kind: 'run' | 'satin' | 'fill' | 'applique', raw: Pt[], closed: boolean) {
    const pts = toolOpts.curve ? douglasPeucker(catmullRom(raw, closed, 8), 0.05) : raw;
    const c = app.currentColor;
    let o: EmbObject;
    if (kind === 'run') o = makeRun(pts, closed, c);
    else if (kind === 'satin') o = makeSatin(pts, toolOpts.satinWidth, closed, c);
    else if (kind === 'fill') o = makeFill([pts], c);
    else o = makeApplique([pts], c);
    app.addObjects([o]);
  }

  cancel() { this.pts = []; this.drag = null; this.r.request(); app.emit('drawing'); }
  backspace() { if (this.pts.length) { this.pts.pop(); this.r.request(); return true; } return false; }

  // ------------------------------------------------------------ Nœuds

  private nodeLists(o: EmbObject): { list: Pt[]; closed: boolean }[] {
    switch (o.kind) {
      case 'run': case 'satin': return [{ list: o.points, closed: o.closed }];
      case 'fill': case 'applique': return o.contours.map((c) => ({ list: c, closed: true }));
      default: return [];
    }
  }

  private findNode(o: EmbObject, p: Pt) {
    const tol = 6 / app.view.zoom;
    const lists = this.nodeLists(o);
    for (let ci = 0; ci < lists.length; ci++) {
      const l = lists[ci].list;
      for (let pi = 0; pi < l.length; pi++) if (dist(l[pi], p) < tol) return { ci, pi };
    }
    return null;
  }

  private setNode(o: EmbObject, ci: number, pi: number, p: Pt) {
    const l = this.nodeLists(o)[ci]?.list;
    if (l) l[pi] = p;
  }

  private insertNode(o: EmbObject, p: Pt) {
    const lists = this.nodeLists(o);
    let best = { d: Infinity, ci: -1, si: -1 };
    lists.forEach(({ list, closed }, ci) => {
      const n = closed ? list.length : list.length - 1;
      for (let i = 0; i < n; i++) {
        const d = distToSegment(p, list[i], list[(i + 1) % list.length]);
        if (d < best.d) best = { d, ci, si: i };
      }
    });
    if (best.ci < 0 || best.d > 8 / app.view.zoom) return;
    app.commit(() => { lists[best.ci].list.splice(best.si + 1, 0, p); });
  }

  deleteHoverNode(): boolean {
    if (app.tool !== 'nodes' || !this.hoverNode) return false;
    const o = app.selected()[0];
    if (!o) return false;
    const l = this.nodeLists(o)[this.hoverNode.ci];
    const min = o.kind === 'run' || o.kind === 'satin' ? 2 : 3;
    if (!l || l.list.length <= min) return true;
    app.commit(() => { l.list.splice(this.hoverNode!.pi, 1); });
    this.hoverNode = null;
    return true;
  }

  // ------------------------------------------------------------ Aperçu

  private drawOverlay(ctx: CanvasRenderingContext2D, z: number) {
    const d = this.drag;
    const blue = '#1e78ff';
    ctx.lineWidth = 1.2 / z;
    // fantômes pendant déplacement / transformation
    if (d && (d.kind === 'move' || d.kind === 'scale' || d.kind === 'rotate')) {
      for (const o of d.orig) {
        const c = JSON.parse(JSON.stringify(o));
        transformObject(c, d.m, { sx: d.kind === 'scale' ? d.sx : 1, sy: d.kind === 'scale' ? d.sy : 1, rot: d.kind === 'rotate' ? d.rot : 0 });
        this.r.drawObjectOutline(c, z, 'rgba(255,90,30,0.95)');
        if (c.kind === 'stitches') {
          const bb = bboxOf(c.stitches);
          ctx.strokeStyle = 'rgba(255,90,30,0.95)'; ctx.strokeRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
        }
      }
    }
    if (d?.kind === 'band') {
      ctx.fillStyle = 'rgba(30,120,255,0.08)'; ctx.strokeStyle = blue; ctx.setLineDash([4 / z, 3 / z]);
      ctx.fillRect(d.start.x, d.start.y, d.cur.x - d.start.x, d.cur.y - d.start.y);
      ctx.strokeRect(d.start.x, d.start.y, d.cur.x - d.start.x, d.cur.y - d.start.y);
      ctx.setLineDash([]);
    }
    if (d?.kind === 'shape') {
      const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      const c = { x: (d.start.x + d.cur.x) / 2, y: (d.start.y + d.cur.y) / 2 };
      const pts = shapePoints(app.settings.shapeKind as ShapeKind, c, w, h);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.strokeStyle = blue; ctx.stroke();
      this.label(ctx, z, d.cur, `${w.toFixed(1)} × ${h.toFixed(1)} mm`);
    }
    if (d?.kind === 'measure') {
      ctx.beginPath(); ctx.moveTo(d.start.x, d.start.y); ctx.lineTo(d.cur.x, d.cur.y); ctx.strokeStyle = '#e0245e'; ctx.stroke();
      const ang = (Math.atan2(-(d.cur.y - d.start.y), d.cur.x - d.start.x) * 180) / Math.PI;
      this.label(ctx, z, d.cur, `${dist(d.start, d.cur).toFixed(1)} mm · ${ang.toFixed(0)}°`);
    }
    if (d?.kind === 'free') {
      ctx.beginPath(); d.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = blue; ctx.stroke();
    }
    // tracé point par point
    if (this.pts.length) {
      const pts = [...this.pts, ...(this.hover ? [this.hover] : [])];
      const tool = app.tool;
      const shown = toolOpts.curve && pts.length > 2 ? catmullRom(pts, tool === 'fill' || tool === 'applique', 8) : pts;
      ctx.beginPath(); shown.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (tool === 'fill' || tool === 'applique') { ctx.closePath(); ctx.fillStyle = 'rgba(30,120,255,0.1)'; ctx.fill(); }
      if (tool === 'satin') {
        ctx.save(); ctx.lineWidth = toolOpts.satinWidth; ctx.strokeStyle = 'rgba(30,120,255,0.18)'; ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = blue; ctx.lineWidth = 1.2 / z; ctx.stroke();
      for (const p of this.pts) { ctx.beginPath(); ctx.rect(p.x - 3 / z, p.y - 3 / z, 6 / z, 6 / z); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    }
    // nœuds de l'objet sélectionné
    if (app.tool === 'nodes') {
      const o = app.selected()[0];
      if (o) {
        this.r.drawObjectOutline(o, z, blue);
        this.nodeLists(o).forEach(({ list }, ci) => list.forEach((p, pi) => {
          const hov = this.hoverNode && this.hoverNode.ci === ci && this.hoverNode.pi === pi;
          ctx.beginPath(); ctx.rect(p.x - 3.5 / z, p.y - 3.5 / z, 7 / z, 7 / z);
          ctx.fillStyle = hov ? '#ff5a1e' : pi === 0 ? '#2ecc71' : '#fff'; ctx.fill(); ctx.strokeStyle = blue; ctx.stroke();
        }));
      }
    }
  }

  private label(ctx: CanvasRenderingContext2D, z: number, p: Pt, text: string) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const s = this.r.toScreen(p);
    const dpr = this.r.dpr;
    ctx.scale(dpr, dpr);
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(20,20,24,0.85)';
    ctx.fillRect(s.x + 12, s.y + 12, w + 10, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, s.x + 17, s.y + 26);
    ctx.restore();
    void z;
  }
}

export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a as HTMLElement).isContentEditable);
}

export type { Tool };
export { matMul };
