// Format JEF (Janome / Elna) — lu par l'Elna eXpressive 830.
import { Cmd, type Design, type Stitch, type Thread } from '../core/types';
import type { Plan } from '../core/plan';
import { JANOME, jefIndex } from '../core/threads';
import { ByteReader, ByteWriter, encodePlan, type Imported } from './encode';

export interface JefOptions { trims: boolean; hoopW: number; hoopH: number }

function hoopCode(w: number, h: number): number {
  // codes connus : 0 = 110×110, 1 = 50×50, 2 = 140×200, 3 = 126×110, 4 = 200×200
  if (w < 500 && h < 500) return 1;
  if (w < 1260 && h < 1100) return 3;
  if (w < 1400 && h < 2000) return 2;
  return 4;
}

export function writeJEF(design: Design, plan: Plan, opt: JefOptions): Uint8Array {
  const enc = encodePlan(plan, 127);
  // palette : une entrée par bloc de couleur (et par arrêt d'appliqué)
  const palette: number[] = [];
  const first = enc.recs.find((r) => r.cmd === Cmd.STITCH || r.cmd === Cmd.JUMP);
  const idxOf = (c: number) => {
    const t = design.threads[c] ?? design.threads[0];
    return t ? jefIndex(t) : 1;
  };
  let prevJef = first ? idxOf(first.color) : 1;
  if (first) palette.push(prevJef);
  for (const r of enc.recs) {
    if (r.cmd === Cmd.COLOR) {
      const k = idxOf(r.color);
      palette.push(k); prevJef = k;
    } else if (r.cmd === Cmd.STOP) palette.push(prevJef);
  }
  const colorCount = palette.length;
  let points = 1;
  for (const r of enc.recs) {
    if (r.cmd === Cmd.STITCH) points += 1;
    else if (r.cmd === Cmd.JUMP || r.cmd === Cmd.COLOR || r.cmd === Cmd.STOP) points += 2;
    else if (r.cmd === Cmd.TRIM && opt.trims) points += 6;
  }
  const w = new ByteWriter();
  w.i32(0x74 + colorCount * 8);
  w.i32(0x14);
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  w.ascii(`${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`);
  w.u8(0); w.u8(0);
  w.i32(colorCount);
  w.i32(points);
  const dw = enc.maxX - enc.minX, dh = enc.maxY - enc.minY;
  w.i32(hoopCode(dw, dh));
  // étendue depuis le centre : gauche, haut, droite, bas
  w.i32(-enc.minX); w.i32(-enc.minY); w.i32(enc.maxX); w.i32(enc.maxY);
  const edge = (hw: number, hh: number) => {
    const l = hw + enc.minX, t = hh + enc.minY, r = hw - enc.maxX, b = hh - enc.maxY;
    if (Math.min(l, t, r, b) >= 0) { w.i32(l); w.i32(t); w.i32(r); w.i32(b); } else { w.i32(-1); w.i32(-1); w.i32(-1); w.i32(-1); }
  };
  edge(550, 550); edge(250, 250); edge(700, 1000); edge(Math.round(opt.hoopW * 5), Math.round(opt.hoopH * 5));
  for (const k of palette) w.i32(k);
  for (let i = 0; i < colorCount; i++) w.i32(0x0d);
  let px = 0, py = 0;
  for (const r of enc.recs) {
    const dx = r.x - px, dy = r.y - py;
    switch (r.cmd) {
      case Cmd.STITCH: w.i8(dx); w.i8(-dy); break;
      case Cmd.JUMP: w.bytes([0x80, 0x02]); w.i8(dx); w.i8(-dy); break;
      case Cmd.COLOR: case Cmd.STOP: w.bytes([0x80, 0x01]); w.i8(dx); w.i8(-dy); break;
      case Cmd.TRIM: if (opt.trims) for (let i = 0; i < 3; i++) w.bytes([0x80, 0x02, 0, 0]); break;
    }
    px = r.x; py = r.y;
  }
  w.bytes([0x80, 0x10]);
  return w.result();
}

export function readJEF(buf: Uint8Array): Imported {
  const r = new ByteReader(buf);
  const offset = r.i32();
  r.pos += 20;
  const count = r.i32();
  r.pos += 88;
  const threads: Thread[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.abs(r.i32());
    threads.push({ ...(JANOME[idx % JANOME.length] ?? JANOME[1]) });
  }
  r.pos = offset;
  const st: Stitch[] = [];
  let x = 0, y = 0;
  while (r.left >= 2) {
    const b0 = r.u8(), b1 = r.u8();
    if (b0 !== 0x80) { x += b0 > 127 ? b0 - 256 : b0; y -= b1 > 127 ? b1 - 256 : b1; st.push({ x: x / 10, y: y / 10, cmd: Cmd.STITCH }); continue; }
    if (b1 === 0x10 || r.left < 2) break;
    const dx = r.i8(), dy = r.i8();
    x += dx; y -= dy;
    if (b1 === 0x02) {
      if (dx === 0 && dy === 0) { if (st.length && st[st.length - 1].cmd !== Cmd.TRIM) st.push({ x: x / 10, y: y / 10, cmd: Cmd.TRIM }); }
      else st.push({ x: x / 10, y: y / 10, cmd: Cmd.JUMP });
    } else if (b1 === 0x01) st.push({ x: x / 10, y: y / 10, cmd: Cmd.COLOR });
    else break;
  }
  return { stitches: st, threads };
}
