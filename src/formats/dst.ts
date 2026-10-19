// Format DST (Tajima) — universel, lu par la plupart des brodeuses dont l'eXpressive 830.
import { Cmd, type Design, type Stitch } from '../core/types';
import type { Plan } from '../core/plan';
import { ByteReader, ByteWriter, designName, encodePlan, type Imported } from './encode';
import { JANOME } from '../core/threads';

const bit = (b: number) => 1 << b;

function record(xIn: number, yIn: number, kind: 'stitch' | 'jump' | 'color' | 'end'): number[] {
  let x = xIn, y = -yIn;
  let b0 = 0, b1 = 0, b2 = 0;
  if (kind === 'color') return [0, 0, 0xc3];
  if (kind === 'end') return [0, 0, 0xf3];
  if (kind === 'jump') b2 |= bit(7);
  b2 |= bit(0) | bit(1);
  if (x > 40) { b2 |= bit(2); x -= 81; } if (x < -40) { b2 |= bit(3); x += 81; }
  if (x > 13) { b1 |= bit(2); x -= 27; } if (x < -13) { b1 |= bit(3); x += 27; }
  if (x > 4) { b0 |= bit(2); x -= 9; } if (x < -4) { b0 |= bit(3); x += 9; }
  if (x > 1) { b1 |= bit(0); x -= 3; } if (x < -1) { b1 |= bit(1); x += 3; }
  if (x > 0) { b0 |= bit(0); x -= 1; } if (x < 0) { b0 |= bit(1); x += 1; }
  if (y > 40) { b2 |= bit(5); y -= 81; } if (y < -40) { b2 |= bit(4); y += 81; }
  if (y > 13) { b1 |= bit(5); y -= 27; } if (y < -13) { b1 |= bit(4); y += 27; }
  if (y > 4) { b0 |= bit(5); y -= 9; } if (y < -4) { b0 |= bit(4); y += 9; }
  if (y > 1) { b1 |= bit(7); y -= 3; } if (y < -1) { b1 |= bit(6); y += 3; }
  if (y > 0) { b0 |= bit(7); y -= 1; } if (y < 0) { b0 |= bit(6); y += 1; }
  if (x !== 0 || y !== 0) throw new Error('Déplacement DST hors limites');
  return [b0, b1, b2];
}

export function writeDST(design: Design, plan: Plan): Uint8Array {
  const enc = encodePlan(plan, 121);
  const w = new ByteWriter();
  const stitches = enc.recs.filter((r) => r.cmd === Cmd.STITCH || r.cmd === Cmd.JUMP).length;
  const colors = enc.recs.filter((r) => r.cmd === Cmd.COLOR || r.cmd === Cmd.STOP).length;
  const pad = (s: string | number, n: number) => String(s).padStart(n, ' ');
  const last = enc.recs.length ? enc.recs[enc.recs.length - 1] : { x: 0, y: 0 };
  const sign = (v: number) => (v >= 0 ? '+' : '-') + pad(Math.abs(v), 5);
  let h = `LA:${designName(design).padEnd(16, ' ')}\r`;
  h += `ST:${pad(stitches, 7)}\r`;
  h += `CO:${pad(colors, 3)}\r`;
  h += `+X:${pad(Math.abs(enc.maxX), 5)}\r-X:${pad(Math.abs(enc.minX), 5)}\r`;
  h += `+Y:${pad(Math.abs(enc.minY), 5)}\r-Y:${pad(Math.abs(enc.maxY), 5)}\r`;
  h += `AX:${sign(last.x)}\rAY:${sign(-last.y)}\rMX:+    0\rMY:+    0\rPD:******\r`;
  w.ascii(h);
  w.u8(0x1a);
  while (w.len < 512) w.u8(0x20);
  let px = 0, py = 0;
  for (const r of enc.recs) {
    const dx = r.x - px, dy = r.y - py;
    switch (r.cmd) {
      case Cmd.STITCH: w.bytes(record(dx, dy, 'stitch')); break;
      case Cmd.JUMP: w.bytes(record(dx, dy, 'jump')); break;
      case Cmd.COLOR: case Cmd.STOP: w.bytes(record(0, 0, 'color')); break;
      case Cmd.TRIM:
        // convention Tajima : 3 sauts courts = coupe
        w.bytes(record(2, 2, 'jump')); w.bytes(record(-4, -4, 'jump')); w.bytes(record(2, 2, 'jump'));
        break;
    }
    px = r.x; py = r.y;
  }
  w.bytes(record(0, 0, 'end'));
  return w.result();
}

const gb = (b: number, p: number) => (b >> p) & 1;

export function readDST(buf: Uint8Array): Imported {
  const r = new ByteReader(buf);
  const header = new TextDecoder('latin1').decode(buf.subarray(0, 512));
  const name = /LA:(.*?)\r/.exec(header)?.[1]?.trim();
  r.pos = 512;
  const st: Stitch[] = [];
  let x = 0, y = 0;
  let jumpRun = 0;
  while (r.left >= 3) {
    const b0 = r.u8(), b1 = r.u8(), b2 = r.u8();
    const dx = gb(b2, 2) * 81 - gb(b2, 3) * 81 + gb(b1, 2) * 27 - gb(b1, 3) * 27 + gb(b0, 2) * 9 - gb(b0, 3) * 9 + gb(b1, 0) * 3 - gb(b1, 1) * 3 + gb(b0, 0) - gb(b0, 1);
    const dyRaw = gb(b2, 5) * 81 - gb(b2, 4) * 81 + gb(b1, 5) * 27 - gb(b1, 4) * 27 + gb(b0, 5) * 9 - gb(b0, 4) * 9 + gb(b1, 7) * 3 - gb(b1, 6) * 3 + gb(b0, 7) - gb(b0, 6);
    if ((b2 & 0xf3) === 0xf3) break;
    x += dx; y -= dyRaw;
    if ((b2 & 0xc3) === 0xc3) { st.push({ x: x / 10, y: y / 10, cmd: Cmd.COLOR }); jumpRun = 0; continue; }
    if ((b2 & 0x83) === 0x83) {
      jumpRun++;
      if (jumpRun === 3) st.push({ x: x / 10, y: y / 10, cmd: Cmd.TRIM });
      st.push({ x: x / 10, y: y / 10, cmd: Cmd.JUMP });
      continue;
    }
    jumpRun = 0;
    st.push({ x: x / 10, y: y / 10, cmd: Cmd.STITCH });
  }
  // DST ne stocke pas les couleurs : palette par défaut
  const n = st.filter((s) => s.cmd === Cmd.COLOR).length + 1;
  const pal = [1, 12, 10, 6, 3, 8, 4, 30, 11, 2];
  const threads = Array.from({ length: n }, (_, i) => ({ ...JANOME[pal[i % pal.length]] }));
  return { stitches: st, threads, name };
}
