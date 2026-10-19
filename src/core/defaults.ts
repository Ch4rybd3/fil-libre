import type { AppliqueObj, Design, FillObj, FillParams, Hoop, Poly, Pt, RunObj, RunParams, SatinObj, SatinParams, TextObj } from './types';
import { JANOME } from './threads';

let counter = 0;
export const uid = () => Date.now().toString(36) + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);

/** Cercles de l'Elna eXpressive 830 (+ cercles courants). Dimensions en mm. */
export const HOOPS: Hoop[] = [
  { id: 'RE28b', name: 'RE28b — 200 × 280 mm', w: 200, h: 280 },
  { id: 'SQ20b', name: 'SQ20b — 200 × 200 mm', w: 200, h: 200 },
  { id: 'RE20b', name: 'RE20b — 140 × 200 mm', w: 140, h: 200 },
  { id: 'SQ14b', name: 'SQ14b — 140 × 140 mm', w: 140, h: 140 },
  { id: 'SQ10', name: '100 × 100 mm', w: 100, h: 100 },
  { id: 'FA10', name: 'Bras libre — 100 × 40 mm', w: 100, h: 40 },
];
export const hoopOf = (id: string): Hoop => HOOPS.find((h) => h.id === id) ?? HOOPS[0];

export const defRun = (): RunParams => ({ length: 2.5, repeats: 1 });
export const defSatin = (): SatinParams => ({ density: 0.4, pullComp: 0.15, underlay: 'center', maxLength: 8 });
export const defFill = (): FillParams => ({
  pattern: 'tatami', angle: 45, spacing: 0.4, length: 3.5, offset: 0.33, pullComp: 0.2, underlay: 'edge+tatami', edgeRun: false,
});

const base = (name: string, color: number) => ({ id: uid(), name, color, visible: true, locked: false, tie: true });

export const makeRun = (points: Pt[], closed: boolean, color: number): RunObj =>
  ({ ...base('Point avant', color), kind: 'run', points, closed, run: defRun() });
export const makeSatin = (points: Pt[], width: number, closed: boolean, color: number): SatinObj =>
  ({ ...base('Satin', color), kind: 'satin', points, width, closed, satin: defSatin() });
export const makeFill = (contours: Poly[], color: number, name = 'Remplissage'): FillObj =>
  ({ ...base(name, color), kind: 'fill', contours, fill: defFill() });
export const makeApplique = (contours: Poly[], color: number): AppliqueObj =>
  ({ ...base('Appliqué', color), kind: 'applique', contours, borderWidth: 3, satin: { ...defSatin(), underlay: 'none' }, placementStop: true });
export const makeText = (text: string, x: number, y: number, color: number): TextObj => ({
  ...base('Texte', color), kind: 'text', text, font: 'archivo', size: 15, spacing: 0.6, lineHeight: 1, align: 'center',
  arc: 0, x, y, rotation: 0, scaleX: 1, scaleY: 1, style: 'satin',
  fill: { ...defFill(), angle: 80, spacing: 0.38, underlay: 'center', pullComp: 0.15 }, run: defRun(), outline: false,
});

export function newDesign(): Design {
  return {
    version: 1, name: 'Nouveau motif', hoop: 'SQ14b',
    threads: [JANOME[10], JANOME[12], JANOME[1]].map((t) => ({ ...t })),
    objects: [], fabric: '#f4f1ea',
  };
}

// ---------------------------------------------------------------- Formes prédéfinies
export type ShapeKind = 'rect' | 'ellipse' | 'star' | 'heart' | 'polygon' | 'flower' | 'arrow' | 'drop';

export function shapePoints(kind: ShapeKind, c: Pt, w: number, h: number, opts: { sides?: number; points?: number } = {}): Pt[] {
  const rx = w / 2, ry = h / 2;
  const out: Pt[] = [];
  switch (kind) {
    case 'rect': return [{ x: c.x - rx, y: c.y - ry }, { x: c.x + rx, y: c.y - ry }, { x: c.x + rx, y: c.y + ry }, { x: c.x - rx, y: c.y + ry }];
    case 'ellipse': {
      const n = Math.max(24, Math.round((rx + ry) * 1.5));
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) }); }
      return out;
    }
    case 'polygon': {
      const n = opts.sides ?? 6;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; out.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) }); }
      return out;
    }
    case 'star': {
      const n = opts.points ?? 5;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, k = i % 2 ? 0.45 : 1;
        out.push({ x: c.x + rx * k * Math.cos(a), y: c.y + ry * k * Math.sin(a) });
      }
      return out;
    }
    case 'heart': {
      for (let i = 0; i < 72; i++) {
        const t = (i / 72) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        out.push({ x: c.x + (x / 17) * rx, y: c.y + ((y + 2.5) / 15.5) * ry });
      }
      return out;
    }
    case 'flower': {
      const n = opts.points ?? 6;
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const r = 0.65 + 0.35 * Math.abs(Math.cos((a * n) / 2));
        out.push({ x: c.x + rx * r * Math.cos(a), y: c.y + ry * r * Math.sin(a) });
      }
      return out;
    }
    case 'arrow': {
      const pts = [[-1, -0.3], [0.2, -0.3], [0.2, -0.8], [1, 0], [0.2, 0.8], [0.2, 0.3], [-1, 0.3]];
      return pts.map(([x, y]) => ({ x: c.x + x * rx, y: c.y + y * ry }));
    }
    case 'drop': {
      for (let i = 0; i < 60; i++) {
        const t = (i / 60) * Math.PI * 2;
        const x = Math.sin(t) * Math.sin(t / 2) ** 1.2;
        const y = -Math.cos(t);
        out.push({ x: c.x + x * rx, y: c.y + y * ry });
      }
      return out;
    }
  }
}
