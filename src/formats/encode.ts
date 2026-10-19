// Préparation commune aux formats machine : unités 0,1 mm, centrage, découpe des déplacements longs.
import { Cmd, type Design, type Stitch, type Thread } from '../core/types';
import type { Plan } from '../core/plan';

export interface Rec { x: number; y: number; cmd: Cmd; color: number }

export interface Encoded {
  recs: Rec[];               // coordonnées absolues entières (0,1 mm), centrées
  colors: number[];          // index de fil (design.threads) pour chaque bloc, dans l'ordre
  minX: number; minY: number; maxX: number; maxY: number;
}

export function encodePlan(plan: Plan, maxStep: number, center = true): Encoded {
  const bb = plan.bbox;
  const cx = center && bb ? (bb.minX + bb.maxX) / 2 : 0;
  const cy = center && bb ? (bb.minY + bb.maxY) / 2 : 0;
  const recs: Rec[] = [];
  const colors: number[] = [];
  let px = 0, py = 0;
  let curColor = -1;
  const push = (x: number, y: number, cmd: Cmd, color: number) => {
    if (cmd === Cmd.STITCH || cmd === Cmd.JUMP) {
      const dx = x - px, dy = y - py;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
      let lx = px, ly = py;
      for (let k = 1; k <= n; k++) {
        const nx = Math.round(px + (dx * k) / n), ny = Math.round(py + (dy * k) / n);
        if (nx === lx && ny === ly && k < n) continue;
        recs.push({ x: nx, y: ny, cmd, color });
        lx = nx; ly = ny;
      }
      px = x; py = y;
    } else recs.push({ x: px, y: py, cmd, color });
  };
  for (const s of plan.stitches) {
    if (curColor < 0) { curColor = s.color; colors.push(s.color); }
    const x = Math.round((s.x - cx) * 10), y = Math.round((s.y - cy) * 10);
    if (s.cmd === Cmd.COLOR) { push(x, y, Cmd.COLOR, s.color); colors.push(s.color); curColor = s.color; continue; }
    push(x, y, s.cmd, s.color);
  }
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const r of recs) if (r.cmd === Cmd.STITCH) {
    minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x); minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
  }
  return { recs, colors, minX, minY, maxX, maxY };
}

export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.len + n) s *= 2;
    const nb = new Uint8Array(s); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  u8(v: number) { this.grow(1); this.buf[this.len++] = v & 255; }
  i8(v: number) { this.u8(v < 0 ? v + 256 : v); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  i32(v: number) { this.grow(4); new DataView(this.buf.buffer).setInt32(this.len, v, true); this.len += 4; }
  ascii(s: string) { for (const ch of s) this.u8(ch.charCodeAt(0) & 0x7f); }
  bytes(a: number[]) { for (const b of a) this.u8(b); }
  result(): Uint8Array { return this.buf.slice(0, this.len); }
}

export class ByteReader {
  pos = 0;
  private dv: DataView;
  constructor(public buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  get left() { return this.buf.length - this.pos; }
  u8() { return this.buf[this.pos++]; }
  i8() { const v = this.buf[this.pos++]; return v > 127 ? v - 256 : v; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
}

/** Résultat d'une lecture de fichier machine. */
export interface Imported { stitches: Stitch[]; threads: Thread[]; name?: string }

export const designName = (d: Design) => (d.name || 'motif').replace(/[^\w\- ]+/g, '').slice(0, 16) || 'motif';
