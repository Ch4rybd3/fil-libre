// Lettrage : polices TrueType/OpenType converties en contours (mm).
import opentype from 'opentype.js';
import type { Poly, Pt, TextObj } from './types';
import { bboxOf, matAround, matMul, matRotate, matScale, applyMat, rad, normalize } from './geometry';

export interface FontInfo { id: string; name: string; file?: string; category: string }

export const BUILTIN_FONTS: FontInfo[] = [
  { id: 'archivo', name: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', category: 'Bâton' },
  { id: 'montserrat', name: 'Montserrat', file: 'Montserrat.ttf', category: 'Bâton' },
  { id: 'oswald', name: 'Oswald', file: 'Oswald.ttf', category: 'Bâton' },
  { id: 'anton', name: 'Anton', file: 'Anton-Regular.ttf', category: 'Bâton' },
  { id: 'bebas', name: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', category: 'Bâton' },
  { id: 'luckiest', name: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', category: 'Fantaisie' },
  { id: 'alfa', name: 'Alfa Slab One', file: 'AlfaSlabOne-Regular.ttf', category: 'Empattement' },
  { id: 'abril', name: 'Abril Fatface', file: 'AbrilFatface-Regular.ttf', category: 'Empattement' },
  { id: 'playfair', name: 'Playfair Display', file: 'PlayfairDisplay.ttf', category: 'Empattement' },
  { id: 'cinzel', name: 'Cinzel Decorative', file: 'CinzelDecorative-Bold.ttf', category: 'Monogramme' },
  { id: 'pacifico', name: 'Pacifico', file: 'Pacifico-Regular.ttf', category: 'Script' },
  { id: 'lobster', name: 'Lobster', file: 'Lobster-Regular.ttf', category: 'Script' },
  { id: 'courgette', name: 'Courgette', file: 'Courgette-Regular.ttf', category: 'Script' },
  { id: 'dancing', name: 'Dancing Script', file: 'DancingScript.ttf', category: 'Script' },
  { id: 'kaushan', name: 'Kaushan Script', file: 'KaushanScript-Regular.ttf', category: 'Script' },
  { id: 'satisfy', name: 'Satisfy', file: 'Satisfy-Regular.ttf', category: 'Script' },
  { id: 'greatvibes', name: 'Great Vibes', file: 'GreatVibes-Regular.ttf', category: 'Script' },
];

const fonts = new Map<string, opentype.Font>();
const loading = new Map<string, Promise<opentype.Font | null>>();
export const userFonts: FontInfo[] = [];
const listeners: (() => void)[] = [];
export const onFontLoaded = (f: () => void) => listeners.push(f);

export function getFont(id: string): opentype.Font | null {
  const f = fonts.get(id);
  if (f) return f;
  if (!loading.has(id)) {
    const info = BUILTIN_FONTS.find((x) => x.id === id);
    if (!info?.file) return null;
    const p = fetch(`${import.meta.env.BASE_URL}fonts/${info.file}`)
      .then((r) => r.arrayBuffer())
      .then((buf) => { const font = opentype.parse(buf); fonts.set(id, font); listeners.forEach((l) => l()); return font; })
      .catch((e) => { console.error('Police', id, e); return null; });
    loading.set(id, p);
  }
  return null;
}

export function loadFont(id: string): Promise<opentype.Font | null> {
  getFont(id);
  return loading.get(id) ?? Promise.resolve(fonts.get(id) ?? null);
}

export function registerUserFont(name: string, buf: ArrayBuffer): FontInfo {
  const font = opentype.parse(buf);
  const id = 'user:' + name;
  fonts.set(id, font);
  const info = { id, name: name.replace(/\.(ttf|otf|woff)$/i, ''), category: 'Mes polices' };
  if (!userFonts.some((f) => f.id === id)) userFonts.push(info);
  listeners.forEach((l) => l());
  return info;
}

export const allFonts = () => [...BUILTIN_FONTS, ...userFonts];

/** Aplatit un chemin opentype en polygones (unités police, Y vers le bas). */
function pathToPolys(path: opentype.Path, tol: number): Poly[] {
  const polys: Poly[] = [];
  let cur: Pt[] = [];
  let last: Pt = { x: 0, y: 0 };
  const close = () => { if (cur.length >= 3) polys.push(cur); cur = []; };
  for (const c of path.commands as any[]) {
    switch (c.type) {
      case 'M': close(); last = { x: c.x, y: c.y }; cur.push(last); break;
      case 'L': last = { x: c.x, y: c.y }; cur.push(last); break;
      case 'Q': {
        const p0 = last, n = Math.max(2, Math.ceil(Math.hypot(c.x - p0.x, c.y - p0.y) / tol));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          cur.push({ x: u * u * p0.x + 2 * u * t * c.x1 + t * t * c.x, y: u * u * p0.y + 2 * u * t * c.y1 + t * t * c.y });
        }
        last = { x: c.x, y: c.y }; break;
      }
      case 'C': {
        const p0 = last, n = Math.max(3, Math.ceil(Math.hypot(c.x - p0.x, c.y - p0.y) / tol));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          cur.push({
            x: u * u * u * p0.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            y: u * u * u * p0.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          });
        }
        last = { x: c.x, y: c.y }; break;
      }
      case 'Z': close(); break;
    }
  }
  close();
  return polys;
}

export interface GlyphShape { contours: Poly[] }

/** Contours de chaque lettre, en mm, positionnés selon l'objet texte. null si la police n'est pas encore chargée. */
export function textGlyphs(t: TextObj): GlyphShape[] | null {
  const font = getFont(t.font);
  if (!font) return null;
  const upm = font.unitsPerEm;
  const os2 = (font.tables as any).os2;
  const cap = (os2?.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : upm * 0.7);
  const k = t.size / cap; // mm par unité
  const lines = t.text.split('\n');
  const lineH = t.size * 1.45 * t.lineHeight;
  // passe 1: positions par ligne (repère : ligne de base, x croissant)
  type G = { polys: Poly[]; x0: number; x1: number };
  const laid: { glyphs: G[]; width: number }[] = [];
  for (const line of lines) {
    const glyphs: G[] = [];
    let x = 0;
    const gl = font.stringToGlyphs(line);
    gl.forEach((g, i) => {
      const path = g.getPath(x / k, 0, upm);
      const polys = pathToPolys(path, upm / 60).map((p) => p.map((q) => ({ x: q.x * k, y: q.y * k })));
      const adv = (g.advanceWidth ?? upm * 0.5) * k;
      glyphs.push({ polys, x0: x, x1: x + adv });
      x += adv + t.spacing;
      if (i + 1 < gl.length) x += font.getKerningValue(g, gl[i + 1]) * k;
    });
    laid.push({ glyphs, width: Math.max(0, x - t.spacing) });
  }
  const maxW = Math.max(...laid.map((l) => l.width), 0);
  const out: GlyphShape[] = [];
  laid.forEach((line, li) => {
    const dx = t.align === 'left' ? -maxW / 2 : t.align === 'right' ? maxW / 2 - line.width : -line.width / 2;
    const baseY = li * lineH;
    for (const g of line.glyphs) {
      if (!g.polys.length) continue;
      let polys = g.polys.map((p) => p.map((q) => ({ x: q.x + dx, y: q.y + baseY })));
      if (t.arc && lines.length === 1) {
        // texte en arc : chaque lettre tourne autour du centre d'un cercle
        const W = Math.max(line.width, 1);
        const R = W / rad(Math.abs(t.arc));
        const sign = Math.sign(t.arc);
        const cx = (g.x0 + g.x1) / 2 + dx;
        const phi = cx / R;
        // arc > 0 : centre sous le texte (arc-en-ciel) ; arc < 0 : centre au-dessus (sourire)
        const cyC = sign * R;
        const a = sign * phi;
        const ca = Math.cos(a), sa = Math.sin(a);
        polys = polys.map((p) => p.map((q) => {
          const vx = q.x - cx, vy = q.y - cyC;
          return { x: vx * ca - vy * sa, y: cyC + vx * sa + vy * ca };
        }));
      }
      out.push({ contours: polys });
    }
  });
  // centrer, puis appliquer échelle / rotation / position
  const all = out.flatMap((g) => g.contours.flat());
  if (!all.length) return out;
  const bb = bboxOf(all);
  const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const m = matMul([1, 0, 0, 1, t.x - c.x, t.y - c.y], matAround(matMul(matRotate(rad(t.rotation)), matScale(t.scaleX, t.scaleY)), c));
  return out.map((g) => ({ contours: normalize(g.contours.map((p) => p.map((q) => applyMat(m, q)))) }));
}
