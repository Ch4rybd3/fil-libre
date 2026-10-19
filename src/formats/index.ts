import { Cmd, type Design, type StitchesObj, type Stitch } from '../core/types';
import type { Plan } from '../core/plan';
import { readJEF, writeJEF, type JefOptions } from './jef';
import { readDST, writeDST } from './dst';
import { readEXP, writeEXP } from './exp';
import type { Imported } from './encode';
import { uid } from '../core/defaults';
import { bboxOf } from '../core/geometry';

export type ExportFormat = 'jef' | 'dst' | 'exp';

export function exportDesign(fmt: ExportFormat, design: Design, plan: Plan, jef: JefOptions): Uint8Array {
  switch (fmt) {
    case 'jef': return writeJEF(design, plan, jef);
    case 'dst': return writeDST(design, plan);
    case 'exp': return writeEXP(plan);
  }
}

export function readMachineFile(name: string, buf: Uint8Array): Imported {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'jef') return readJEF(buf);
  if (ext === 'dst') return readDST(buf);
  if (ext === 'exp') return readEXP(buf);
  throw new Error('Format non pris en charge : ' + ext);
}

/** Convertit un fichier importé en objets « points » (un par couleur), centrés. */
export function importedToObjects(imp: Imported, colorOffset: number): StitchesObj[] {
  const blocks: Stitch[][] = [[]];
  for (const s of imp.stitches) {
    if (s.cmd === Cmd.COLOR) { blocks.push([]); continue; }
    blocks[blocks.length - 1].push(s);
  }
  const all = imp.stitches.filter((s) => s.cmd === Cmd.STITCH);
  let cx = 0, cy = 0;
  if (all.length) {
    const bb = bboxOf(all);
    cx = (bb.minX + bb.maxX) / 2; cy = (bb.minY + bb.maxY) / 2;
  }
  return blocks.map((b, i) => ({
    id: uid(), kind: 'stitches' as const, name: `${imp.name ?? 'Import'} — couleur ${i + 1}`,
    color: colorOffset + Math.min(i, imp.threads.length - 1), visible: true, locked: false, tie: false,
    stitches: b.map((s) => ({ x: s.x - cx, y: s.y - cy, cmd: s.cmd })),
  })).filter((o) => o.stitches.some((s) => s.cmd === Cmd.STITCH));
}
