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
