import { describe, it, expect } from 'vitest';
import { buildPlan } from '../src/core/plan';
import { newDesign, makeFill, makeSatin, makeRun, makeApplique, shapePoints } from '../src/core/defaults';
import { writeJEF, readJEF } from '../src/formats/jef';
import { writeDST, readDST } from '../src/formats/dst';
import { writeEXP, readEXP } from '../src/formats/exp';
import { Cmd } from '../src/core/types';
import { pointInContours, offsetContours } from '../src/core/geometry';

function sample() {
  const d = newDesign();
  const star = shapePoints('star', { x: 0, y: 0 }, 60, 60);
  const ring = [shapePoints('ellipse', { x: 0, y: 0 }, 50, 50), shapePoints('ellipse', { x: 0, y: 0 }, 20, 20)];
  d.objects.push(makeFill([star], 0), makeFill(ring, 1), makeSatin([{ x: -30, y: 40 }, { x: 0, y: 30 }, { x: 30, y: 40 }], 4, false, 2), makeRun([{ x: -30, y: -40 }, { x: 30, y: -40 }], false, 2));
  return d;
}

describe('génération', () => {
  it('le remplissage reste dans la forme', () => {
    const d = sample();
    const plan = buildPlan(d);
    expect(plan.stitchCount).toBeGreaterThan(1000);
    const ring = (d.objects[1] as any).contours;
    const grown = offsetContours(ring, 0.8);
    const pts = plan.stitches.filter((s) => s.obj === 1 && s.cmd === Cmd.STITCH);
    const outside = pts.filter((p) => !pointInContours(p, grown));
    expect(outside.length / pts.length).toBeLessThan(0.01);
  });
  it('pas de point de plus de 12 mm sauf sauts', () => {
    const plan = buildPlan(sample());
    let prev: any = null; let long = 0;
    for (const s of plan.stitches) { if (prev && s.cmd === Cmd.STITCH && Math.hypot(s.x - prev.x, s.y - prev.y) > 12) long++; prev = s; }
    expect(long).toBe(0);
  });
  it('appliqué contient 2 arrêts', () => {
    const d = newDesign();
    d.objects.push(makeApplique([shapePoints('heart', { x: 0, y: 0 }, 50, 50)], 0));
    const plan = buildPlan(d);
    expect(plan.stops).toBe(2);
  });
});

describe('formats', () => {
  const d = sample();
  const plan = buildPlan(d);
  const n = plan.stitchCount;
  it('JEF aller-retour', () => {
    const buf = writeJEF(d, plan, { trims: true, hoopW: 140, hoopH: 140 });
    const r = readJEF(buf);
    expect(r.threads.length).toBe(3);
    const st = r.stitches.filter((s) => s.cmd === Cmd.STITCH).length;
    expect(st).toBeGreaterThanOrEqual(n);
    expect(st).toBeLessThan(n * 1.05);
    expect(r.stitches.filter((s) => s.cmd === Cmd.COLOR).length).toBe(2);
  });
  it('DST aller-retour', () => {
    const r = readDST(writeDST(d, plan));
    const st = r.stitches.filter((s) => s.cmd === Cmd.STITCH).length;
    expect(st).toBeGreaterThanOrEqual(n);
    expect(r.stitches.filter((s) => s.cmd === Cmd.COLOR).length).toBe(2);
  });
  it('EXP aller-retour', () => {
    const r = readEXP(writeEXP(plan));
    expect(r.stitches.filter((s) => s.cmd === Cmd.STITCH).length).toBeGreaterThanOrEqual(n);
  });
  it('positions JEF conservées (centrées)', () => {
    const r = readJEF(writeJEF(d, plan, { trims: true, hoopW: 140, hoopH: 140 }));
    const xs = r.stitches.filter((s) => s.cmd === Cmd.STITCH).map((s) => s.x);
    const bb = plan.bbox!;
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(bb.maxX - bb.minX, 0);
  });
});

// ---------------------------------------------------------------- numérisation et lettrage
import { boundaryPaths, centerlines, quantize, defaultAuto } from '../src/digitize/autodigitize';
import { scriptOf } from '../src/core/text';

/** Image synthétique : bandes verticales de couleurs données. */
function stripes(cols: [number, number, number][], bw = 12, hgt = 24): ImageData {
  const w = cols.length * bw;
  const data = new Uint8ClampedArray(w * hgt * 4);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const c = cols[Math.floor(x / bw)], i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { width: w, height: hgt, data, colorSpace: 'srgb' } as ImageData;
}
const usedLabels = (l: Int16Array) => new Set(Array.from(l).filter((v) => v >= 0)).size;

describe('numérisation', () => {
  const opts = { ...defaultAuto, removeBg: false, denoise: false, minAreaMm2: 0, widthMm: 50 };
  it('fusionne automatiquement les nuances proches', () => {
    const img = stripes([[200, 30, 30], [210, 40, 35], [30, 30, 200]]);
    expect(usedLabels(quantize(img, { ...opts, colors: 3 }).labels)).toBe(3);
    expect(usedLabels(quantize(img, { ...opts, colors: 3, mergeDE: 8 }).labels)).toBe(2);
  });
  it('regroupe et exclut des couleurs à la main', () => {
    const img = stripes([[200, 30, 30], [30, 160, 40], [30, 30, 200]]);
    const q = quantize(img, { ...opts, colors: 3 });
    const red = q.lab[q.labels[0]], green = q.lab[q.labels[15]];
    expect(usedLabels(quantize(img, { ...opts, colors: 3, groups: [[red, green]] }).labels)).toBe(2);
    const ex = quantize(img, { ...opts, colors: 3, excluded: [green] });
    expect(usedLabels(ex.labels)).toBe(2);
    expect(ex.labels[15]).toBe(-1);
  });
  it('garde les zones claires intérieures quand le fond est retiré', () => {
    // fond blanc, carré noir, point blanc au centre
    const w = 40, data = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) {
      const inner = x >= 16 && x < 24 && y >= 16 && y < 24, i = (y * w + x) * 4;
      if (!inner) data[i] = data[i + 1] = data[i + 2] = 0;
    }
    const img = { width: w, height: w, data, colorSpace: 'srgb' } as ImageData;
    const q = quantize(img, { ...opts, colors: 1, removeBg: true });
    expect(q.labels[0]).toBe(-1);
    expect(q.labels[20 * w + 20]).toBeGreaterThanOrEqual(0);
    expect(quantize(img, { ...opts, colors: 1, removeBg: true, bgOutsideOnly: false }).labels[20 * w + 20]).toBe(-1);
  });
  it('trace chaque limite entre couleurs une seule fois', () => {
    const labels = new Int16Array([0, 0, 1, 1, 0, 0, 1, 1]); // 4 × 2
    const len = boundaryPaths(labels, 4, 2).reduce((s, p) => s + p.pts.length - 1, 0);
    expect(len).toBe(4 + 4 + 2 + 2 + 2); // pourtour (12) + séparation (2)
  });
  it('réduit un trait épais à sa ligne centrale', () => {
    const w = 60, h = 20, m = new Uint8Array(w * h);
    for (let y = 7; y < 13; y++) for (let x = 5; x < 55; x++) m[y * w + x] = 1;
    const cl = centerlines(m, w, h);
    expect(cl.length).toBe(1);
    const xs = cl[0].pts.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
    expect(cl[0].width).toBeGreaterThan(4);
  });
});

describe('alphabets', () => {
  it('reconnaît les écritures', () => {
    const s = (c: string) => scriptOf(c.codePointAt(0)!);
    expect([s('a'), s('Ж'), s('λ'), s('ש'), s('ع'), s('あ'), s('字'), s('한'), s('ก'), s(' '), s('5')])
      .toEqual(['latin', 'cyrillic', 'greek', 'hebrew', 'arabic', 'kana', 'han', 'hangul', 'thai', null, null]);
  });
});
