// Rendu du plan de travail : cercle, tissu, points (réalistes ou filaires), sélection.
import { app } from './state';
import { Cmd, type EmbObject, type Pt } from '../core/types';
import type { Plan } from '../core/plan';
import { objectBBox, textContours } from '../core/plan';

export interface Overlay { draw(ctx: CanvasRenderingContext2D, z: number): void }

interface Block { color: number; path: Path2D; from: number; to: number }

const bgImages = new Map<string, HTMLImageElement>();
export function bgImage(url: string): HTMLImageElement {
  let im = bgImages.get(url);
  if (!im) {
    im = new Image(); im.src = url; im.onload = () => app.emit('redraw');
    bgImages.clear(); bgImages.set(url, im);
  }
  return im;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  dpr = window.devicePixelRatio || 1;
  w = 0; h = 0;
  overlay: Overlay | null = null;
  private cachePlan: Plan | null = null;
  private blocks: Block[] = [];
  private jumps = new Path2D();
  private raf = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.request();
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  toScreen(p: Pt): Pt { const v = app.view; return { x: p.x * v.zoom + this.w / 2 + v.ox, y: p.y * v.zoom + this.h / 2 + v.oy }; }
  toMm(x: number, y: number): Pt { const v = app.view; return { x: (x - this.w / 2 - v.ox) / v.zoom, y: (y - this.h / 2 - v.oy) / v.zoom }; }

  fit(bbox?: { minX: number; minY: number; maxX: number; maxY: number } | null) {
    const hp = app.hoop;
    const b = bbox ?? { minX: -hp.w / 2 - 8, minY: -hp.h / 2 - 8, maxX: hp.w / 2 + 8, maxY: hp.h / 2 + 8 };
    const bw = Math.max(10, b.maxX - b.minX), bh = Math.max(10, b.maxY - b.minY);
    const z = Math.min(this.w / bw, this.h / bh) * 0.92;
    app.view.zoom = z;
    app.view.ox = -((b.minX + b.maxX) / 2) * z;
    app.view.oy = -((b.minY + b.maxY) / 2) * z;
    app.emit('view');
    this.request();
  }

  private rebuild(plan: Plan) {
    this.cachePlan = plan;
    this.blocks = [];
    this.jumps = new Path2D();
    const st = plan.stitches;
    let cur: Block | null = null;
    let prev: Pt | null = null;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (s.cmd === Cmd.STITCH && prev) {
        if (!cur || cur.color !== s.color) {
          cur = { color: s.color, path: new Path2D(), from: i, to: i };
          cur.path.moveTo(prev.x, prev.y);
          this.blocks.push(cur);
        }
        cur.path.lineTo(s.x, s.y);
        cur.to = i;
      } else if (s.cmd === Cmd.JUMP) {
        if (prev) { this.jumps.moveTo(prev.x, prev.y); this.jumps.lineTo(s.x, s.y); }
        if (cur) cur.path.moveTo(s.x, s.y);
      }
      if (s.cmd === Cmd.STITCH || s.cmd === Cmd.JUMP) prev = s;
    }
  }

  draw() {
    const { ctx, dpr } = this;
    const v = app.view, z = v.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--workspace').trim() || '#2b2d31';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 + v.ox), dpr * (this.h / 2 + v.oy));
    this.drawHoop(z);
    const d = app.design;
    if (d.background?.visible) {
      const im = bgImage(d.background.dataUrl);
      if (im.complete && im.naturalWidth) {
        ctx.globalAlpha = d.background.opacity;
        ctx.drawImage(im, d.background.x, d.background.y, d.background.w, d.background.h);
        ctx.globalAlpha = 1;
      }
    }
    if (this.cachePlan !== app.plan) this.rebuild(app.plan);
    if (!app.sim.active && this.drawCached(z)) { /* points servis depuis le cache */ }
    else this.drawStitches(z);
    this.drawSelection(z);
    this.overlay?.draw(ctx, z);
  }

  private drawHoop(z: number) {
    const ctx = this.ctx;
    const hp = app.hoop;
    const w = hp.w, hh = hp.h, r = Math.min(w, hh) * 0.12;
    const rr = (x: number, y: number, W: number, H: number, R: number) => { ctx.beginPath(); ctx.roundRect(x, y, W, H, R); };
    // tissu
    rr(-w / 2 - 14, -hh / 2 - 14, w + 28, hh + 28, r + 12);
    ctx.fillStyle = app.design.fabric; ctx.fill();
    // cercle (anneau)
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(70,70,78,0.85)';
    rr(-w / 2 - 6, -hh / 2 - 6, w + 12, hh + 12, r + 4); ctx.stroke();
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.setLineDash([4 / z, 3 / z]);
    rr(-w / 2, -hh / 2, w, hh, Math.max(2, r - 4)); ctx.stroke();
    ctx.setLineDash([]);
    if (app.settings.showGrid) {
      const step = z > 6 ? 5 : 10;
      ctx.beginPath();
      for (let x = -Math.floor(w / 2 / step) * step; x <= w / 2; x += step) { ctx.moveTo(x, -hh / 2); ctx.lineTo(x, hh / 2); }
      for (let y = -Math.floor(hh / 2 / step) * step; y <= hh / 2; y += step) { ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); }
      ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1 / z; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
    }
    // repères de centrage du cercle
    ctx.fillStyle = 'rgba(70,70,78,0.85)';
    for (const [x, y] of [[0, -hh / 2 - 6], [0, hh / 2 + 6], [-w / 2 - 6, 0], [w / 2 + 6, 0]]) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }

  private bmp: { key: string; canvas: HTMLCanvasElement; x: number; y: number } | null = null;

  /** Le rendu des points est mis en cache tant que zoom, plan et couleurs ne changent pas (déplacement de vue fluide). */
  private drawCached(z: number): boolean {
    const bb = app.plan.bbox;
    if (!bb) return true;
    const pad = 2;
    const k = z * this.dpr;
    const W = Math.ceil((bb.maxX - bb.minX + pad * 2) * k), H = Math.ceil((bb.maxY - bb.minY + pad * 2) * k);
    if (W * H > 4096 * 4096 || W > 8192 || H > 8192) return false;
    const key = [z, this.dpr, app.settings.realistic, app.settings.showJumps, JSON.stringify(app.design.threads)].join('|');
    if (!this.bmp || this.bmp.key !== key || this.bmpPlan !== app.plan) {
      const c = this.bmp?.canvas ?? document.createElement('canvas');
      c.width = W; c.height = H;
      const main = this.ctx;
      const octx = c.getContext('2d')!;
      octx.setTransform(k, 0, 0, k, (pad - bb.minX) * k, (pad - bb.minY) * k);
      this.ctx = octx;
      try { this.drawStitches(z); } finally { this.ctx = main; }
      this.bmp = { key, canvas: c, x: bb.minX - pad, y: bb.minY - pad };
      this.bmpPlan = app.plan;
    }
    this.ctx.drawImage(this.bmp.canvas, this.bmp.x, this.bmp.y, W / k, H / k);
    return true;
  }
  private bmpPlan: Plan | null = null;

  private drawStitches(z: number) {
    const ctx = this.ctx;
    const threads = app.design.threads;
    const sim = app.sim;
    const limit = sim.active ? sim.index : Infinity;
    const realistic = app.settings.realistic;
    const tw = Math.max(0.38, 1.1 / z);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const st = app.plan.stitches;
    const strokeBlock = (path: Path2D, color: number) => {
      const t = threads[color] ?? { r: 0, g: 0, b: 0 };
      if (realistic && z > 1.2) {
        ctx.lineWidth = tw * 1.25; ctx.strokeStyle = `rgba(${t.r * 0.45 | 0},${t.g * 0.45 | 0},${t.b * 0.45 | 0},0.9)`; ctx.stroke(path);
        ctx.lineWidth = tw * 0.85; ctx.strokeStyle = `rgb(${t.r},${t.g},${t.b})`; ctx.stroke(path);
        ctx.lineWidth = tw * 0.28; ctx.strokeStyle = `rgba(${Math.min(255, t.r + 90)},${Math.min(255, t.g + 90)},${Math.min(255, t.b + 90)},0.55)`; ctx.stroke(path);
      } else {
        ctx.lineWidth = realistic ? tw : 1 / z; ctx.strokeStyle = `rgb(${t.r},${t.g},${t.b})`; ctx.stroke(path);
      }
    };
    for (const b of this.blocks) {
      if (b.from >= limit) break;
      if (b.to < limit) { strokeBlock(b.path, b.color); continue; }
      // bloc partiellement brodé (simulation)
      const p = new Path2D();
      let prev: Pt | null = null;
      for (let i = b.from - 1; i < limit && i <= b.to; i++) {
        const s = st[i];
        if (!s) continue;
        if (s.cmd === Cmd.STITCH && prev) p.lineTo(s.x, s.y); else p.moveTo(s.x, s.y);
        if (s.cmd === Cmd.STITCH || s.cmd === Cmd.JUMP) prev = s;
      }
      strokeBlock(p, b.color);
    }
    if (app.settings.showJumps && !sim.active) {
      ctx.setLineDash([1.2, 1]);
      ctx.lineWidth = 0.6 / z * 1.5; ctx.strokeStyle = 'rgba(220,40,40,0.7)';
      ctx.stroke(this.jumps);
      ctx.setLineDash([]);
    }
    if (sim.active && limit < st.length) {
      const s = st[Math.max(0, limit - 1)];
      if (s) {
        ctx.beginPath(); ctx.arc(s.x, s.y, 6 / z, 0, Math.PI * 2);
        ctx.strokeStyle = '#e0245e'; ctx.lineWidth = 2 / z; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x - 10 / z, s.y); ctx.lineTo(s.x + 10 / z, s.y); ctx.moveTo(s.x, s.y - 10 / z); ctx.lineTo(s.x, s.y + 10 / z); ctx.stroke();
      }
    }
  }

  drawObjectOutline(o: EmbObject, z: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 1.2 / z;
    const poly = (pts: Pt[], closed: boolean) => {
      if (!pts.length) return;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      if (closed) ctx.closePath();
      ctx.stroke();
    };
    switch (o.kind) {
      case 'run': case 'satin': poly(o.points, o.closed); break;
      case 'fill': case 'applique': o.contours.forEach((c) => poly(c, true)); break;
      case 'text': textContours(o)?.forEach((g) => g.forEach((c) => poly(c, true))); break;
      default: break;
    }
  }

  private drawSelection(z: number) {
    const ctx = this.ctx;
    if (app.sim.active) return;
    const sel = app.selected();
    if (app.tool !== 'nodes') for (const o of sel) this.drawObjectOutline(o, z, 'rgba(30,120,255,0.9)');
    if (app.tool !== 'select' || !sel.length) return;
    const bb = app.selectionBBox();
    if (!bb) return;
    const pad = 4 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.strokeStyle = '#1e78ff'; ctx.lineWidth = 1 / z;
    ctx.strokeRect(bb.minX - pad, bb.minY - pad, bb.maxX - bb.minX + 2 * pad, bb.maxY - bb.minY + 2 * pad);
    ctx.setLineDash([]);
    for (const hd of selectionHandles(bb, z)) {
      ctx.beginPath();
      if (hd.kind === 'rot') ctx.arc(hd.x, hd.y, 5 / z, 0, Math.PI * 2);
      else ctx.rect(hd.x - 4 / z, hd.y - 4 / z, 8 / z, 8 / z);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    }
    const top = { x: (bb.minX + bb.maxX) / 2, y: bb.minY - pad };
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 18 / z); ctx.stroke();
  }
}

export interface Handle { kind: 'scale' | 'rot'; x: number; y: number; ax: number; ay: number } // ax/ay : -1,0,1

export function selectionHandles(bb: { minX: number; minY: number; maxX: number; maxY: number }, z: number): Handle[] {
  const pad = 4 / z;
  const x0 = bb.minX - pad, x1 = bb.maxX + pad, y0 = bb.minY - pad, y1 = bb.maxY + pad, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  return [
    { kind: 'scale', x: x0, y: y0, ax: -1, ay: -1 }, { kind: 'scale', x: xm, y: y0, ax: 0, ay: -1 }, { kind: 'scale', x: x1, y: y0, ax: 1, ay: -1 },
    { kind: 'scale', x: x1, y: ym, ax: 1, ay: 0 }, { kind: 'scale', x: x1, y: y1, ax: 1, ay: 1 }, { kind: 'scale', x: xm, y: y1, ax: 0, ay: 1 },
    { kind: 'scale', x: x0, y: y1, ax: -1, ay: 1 }, { kind: 'scale', x: x0, y: ym, ax: -1, ay: 0 },
    { kind: 'rot', x: xm, y: y0 - 18 / z, ax: 0, ay: 0 },
  ];
}

export { objectBBox };
