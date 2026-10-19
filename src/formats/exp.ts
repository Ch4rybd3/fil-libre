// Format EXP (Melco) — simple, sans en-tête.
import { Cmd, type Stitch } from '../core/types';
import type { Plan } from '../core/plan';
import { ByteReader, ByteWriter, encodePlan, type Imported } from './encode';
import { JANOME } from '../core/threads';

export function writeEXP(plan: Plan): Uint8Array {
  const enc = encodePlan(plan, 127);
  const w = new ByteWriter();
  let px = 0, py = 0;
  for (const r of enc.recs) {
    const dx = r.x - px, dy = r.y - py;
    switch (r.cmd) {
      case Cmd.STITCH: w.i8(dx); w.i8(-dy); break;
      case Cmd.JUMP: w.bytes([0x80, 0x04]); w.i8(dx); w.i8(-dy); break;
      case Cmd.TRIM: w.bytes([0x80, 0x80, 0x07, 0x00]); break;
      case Cmd.COLOR: case Cmd.STOP: w.bytes([0x80, 0x01, 0x00, 0x00]); break;
    }
    px = r.x; py = r.y;
  }
  return w.result();
}

export function readEXP(buf: Uint8Array): Imported {
  const r = new ByteReader(buf);
  const st: Stitch[] = [];
  let x = 0, y = 0;
  while (r.left >= 2) {
    const b0 = r.u8(), b1 = r.u8();
    if (b0 !== 0x80) { x += b0 > 127 ? b0 - 256 : b0; y -= b1 > 127 ? b1 - 256 : b1; st.push({ x: x / 10, y: y / 10, cmd: Cmd.STITCH }); continue; }
    if (r.left < 2) break;
    const dx = r.i8(), dy = r.i8();
    if (b1 === 0x80) { st.push({ x: x / 10, y: y / 10, cmd: Cmd.TRIM }); continue; }
    if (b1 === 0x01) { st.push({ x: x / 10, y: y / 10, cmd: Cmd.COLOR }); x += dx; y -= dy; if (dx || dy) st.push({ x: x / 10, y: y / 10, cmd: Cmd.JUMP }); continue; }
    x += dx; y -= dy;
    if (b1 === 0x04) st.push({ x: x / 10, y: y / 10, cmd: Cmd.JUMP });
    else if (b1 === 0x02) st.push({ x: x / 10, y: y / 10, cmd: Cmd.STITCH });
    else break;
  }
  const n = st.filter((s) => s.cmd === Cmd.COLOR).length + 1;
  const pal = [1, 12, 10, 6, 3, 8, 4, 30, 11, 2];
  return { stitches: st, threads: Array.from({ length: n }, (_, i) => ({ ...JANOME[pal[i % pal.length]] })) };
}
