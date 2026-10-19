// Nuanciers de fils. Ordre du nuancier Janome/Elna = index utilisé dans le format JEF.
import type { Thread } from './types';

const mk = (chart: string) => (hex: number, name: string, code: string): Thread =>
  ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255, name, code, chart });

const j = mk('Janome/Elna');
/** Index 0 = réservé (arrêt). Les index suivants correspondent aux codes couleur JEF. */
export const JANOME: Thread[] = [
  j(0x000000, "Arrêt", "000"),
  j(0x000000, "Black", "002"),
  j(0xFFFFFF, "White", "001"),
  j(0xFFFF17, "Yellow", "204"),
  j(0xFF6600, "Orange", "203"),
  j(0x2F5933, "Olive Green", "219"),
  j(0x237336, "Green", "226"),
  j(0x65C2C8, "Sky", "217"),
  j(0xAB5A96, "Purple", "208"),
  j(0xF669A0, "Pink", "201"),
  j(0xFF0000, "Red", "225"),
  j(0xB1704E, "Brown", "214"),
  j(0x0B2F84, "Blue", "207"),
  j(0xE4C35D, "Gold", "003"),
  j(0x481A05, "Dark Brown", "205"),
  j(0xAC9CC7, "Pale Violet", "209"),
  j(0xFCF294, "Pale Yellow", "210"),
  j(0xF999B7, "Pale Pink", "211"),
  j(0xFAB381, "Peach", "212"),
  j(0xC9A480, "Beige", "213"),
  j(0x970533, "Wine Red", "215"),
  j(0xA0B8CC, "Pale Sky", "216"),
  j(0x7FC21C, "Yellow Green", "218"),
  j(0xE5E5E5, "Silver Gray", "220"),
  j(0x889B9B, "Gray", "221"),
  j(0x98D6BD, "Pale Aqua", "227"),
  j(0xB2E1E3, "Baby Blue", "228"),
  j(0x368BA0, "Powder Blue", "229"),
  j(0x4F83AB, "Bright Blue", "230"),
  j(0x386A91, "Slate Blue", "231"),
  j(0x071650, "Navy Blue", "232"),
  j(0xF999A2, "Salmon Pink", "233"),
  j(0xF9676B, "Coral", "234"),
  j(0xE3311F, "Burnt Orange", "235"),
  j(0xE2A188, "Cinnamon", "236"),
  j(0xB59474, "Umber", "237"),
  j(0xE4CF99, "Blond", "238"),
  j(0xFFCB00, "Sunflower", "239"),
  j(0xE1ADD4, "Orchid Pink", "240"),
  j(0xC3007E, "Peony Purple", "241"),
  j(0x80004B, "Burgundy", "242"),
  j(0x540571, "Royal Purple", "243"),
  j(0xB10525, "Cardinal Red", "244"),
  j(0xCAE0C0, "Opal Green", "245"),
  j(0x899856, "Moss Green", "246"),
  j(0x5C941A, "Meadow Green", "247"),
  j(0x003114, "Dark Green", "248"),
  j(0x5DAE94, "Aquamarine", "249"),
  j(0x4CBF8F, "Emerald Green", "250"),
  j(0x007772, "Peacock Green", "251"),
  j(0x595B61, "Dark Gray", "252"),
  j(0xFFFFF2, "Ivory White", "253"),
  j(0xB15818, "Hazel", "254"),
  j(0xCB8A07, "Toast", "255"),
  j(0x986C80, "Salmon", "256"),
  j(0x98692D, "Cocoa Brown", "257"),
  j(0x4D3419, "Sienna", "258"),
  j(0x4C330B, "Sepia", "259"),
  j(0x33200A, "Dark Sepia", "260"),
  j(0x523A97, "Violet Blue", "261"),
  j(0x0D217E, "Blue Ink", "262"),
  j(0x1E77AC, "Sola Blue", "263"),
  j(0xB2DD53, "Green Dust", "264"),
  j(0xF33689, "Crimson", "265"),
  j(0xDE649E, "Floral Pink", "266"),
  j(0x984161, "Wine", "267"),
  j(0x4C5612, "Olive Drab", "268"),
  j(0x4C881F, "Meadow", "269"),
  j(0xE4DE79, "Mustard", "270"),
  j(0xCB8A1A, "Yellow Ocher", "271"),
  j(0xCBA21C, "Old Gold", "272"),
  j(0xFF9805, "Honey Dew", "273"),
  j(0xFCB257, "Tangerine", "274"),
  j(0xFFE505, "Canary Yellow", "275"),
  j(0xF0331F, "Vermilion", "202"),
  j(0x1A842D, "Bright Green", "206"),
  j(0x386CAE, "Ocean Blue", "222"),
  j(0xE3C4B4, "Beige Gray", "223"),
  j(0xE3AC81, "Bamboo", "224"),
];

const b = mk('Brother');
export const BROTHER: Thread[] = [
  b(0x000000, "Unknown", "0"),
  b(0x0E1F7C, "Prussian Blue", "1"),
  b(0x0A55A3, "Blue", "2"),
  b(0x008777, "Teal Green", "3"),
  b(0x4B6BAF, "Cornflower Blue", "4"),
  b(0xED171F, "Red", "5"),
  b(0xD15C00, "Reddish Brown", "6"),
  b(0x913697, "Magenta", "7"),
  b(0xE49ACB, "Light Lilac", "8"),
  b(0x915FAC, "Lilac", "9"),
  b(0x9ED67D, "Mint Green", "10"),
  b(0xE8A900, "Deep Gold", "11"),
  b(0xFEBA35, "Orange", "12"),
  b(0xFFFF00, "Yellow", "13"),
  b(0x70BC1F, "Lime Green", "14"),
  b(0xBA9800, "Brass", "15"),
  b(0xA8A8A8, "Silver", "16"),
  b(0x7D6F00, "Russet Brown", "17"),
  b(0xFFFFB3, "Cream Brown", "18"),
  b(0x4F5556, "Pewter", "19"),
  b(0x000000, "Black", "20"),
  b(0x0B3D91, "Ultramarine", "21"),
  b(0x770176, "Royal Purple", "22"),
  b(0x293133, "Dark Gray", "23"),
  b(0x2A1301, "Dark Brown", "24"),
  b(0xF64A8A, "Deep Rose", "25"),
  b(0xB27624, "Light Brown", "26"),
  b(0xFCBBC5, "Salmon Pink", "27"),
  b(0xFE370F, "Vermilion", "28"),
  b(0xF0F0F0, "White", "29"),
  b(0x6A1C8A, "Violet", "30"),
  b(0xA8DDC4, "Seacrest", "31"),
  b(0x2584BB, "Sky Blue", "32"),
  b(0xFEB343, "Pumpkin", "33"),
  b(0xFFF36B, "Cream Yellow", "34"),
  b(0xD0A660, "Khaki", "35"),
  b(0xD15400, "Clay Brown", "36"),
  b(0x66BA49, "Leaf Green", "37"),
  b(0x134A46, "Peacock Blue", "38"),
  b(0x878787, "Gray", "39"),
  b(0xD8CCC6, "Warm Gray", "40"),
  b(0x435607, "Dark Olive", "41"),
  b(0xFDD9DE, "Flesh Pink", "42"),
  b(0xF993BC, "Pink", "43"),
  b(0x003822, "Deep Green", "44"),
  b(0xB2AFD4, "Lavender", "45"),
  b(0x686AB0, "Wisteria Violet", "46"),
  b(0xEFE3B9, "Beige", "47"),
  b(0xF73866, "Carmine", "48"),
  b(0xB54B64, "Amber Red", "49"),
  b(0x132B1A, "Olive Green", "50"),
  b(0xC70156, "Dark Fuchsia", "51"),
  b(0xFE9E32, "Tangerine", "52"),
  b(0xA8DEEB, "Light Blue", "53"),
  b(0x00673E, "Emerald Green", "54"),
  b(0x4E2990, "Purple", "55"),
  b(0x2F7E20, "Moss Green", "56"),
  b(0xFFCCCC, "Flesh Pink", "57"),
  b(0xFFD911, "Harvest Gold", "58"),
  b(0x095BA6, "Electric Blue", "59"),
  b(0xF0F970, "Lemon Yellow", "60"),
  b(0xE3F35B, "Fresh Green", "61"),
  b(0xFF9900, "Orange", "62"),
  b(0xFFF08D, "Cream Yellow", "63"),
  b(0xFFC8C8, "Applique", "64"),
];

export const CHARTS: Record<string, Thread[]> = {
  'Janome/Elna': JANOME.slice(1),
  'Brother': BROTHER,
};

export function rgbOf(t: Thread): string { return `rgb(${t.r},${t.g},${t.b})`; }
export function hexOf(t: Thread): string {
  return '#' + [t.r, t.g, t.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function threadFromHex(hex: string, name = 'Personnalisé'): Thread {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, name, code: hex.toUpperCase(), chart: 'Personnalisé' };
}

// Distance perceptuelle (CIE76 sur Lab) : bonne pour retrouver le fil le plus proche.
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g3(x); y = g3(y); z = g3(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function colorDist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const la = rgbToLab(a.r, a.g, a.b), lb = rgbToLab(b.r, b.g, b.b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export function nearestIndex(c: { r: number; g: number; b: number }, list: Thread[], exclude?: Set<number>): number {
  let best = -1, bd = Infinity;
  list.forEach((t, i) => {
    if (exclude?.has(i)) return;
    const d = colorDist(c, t);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Index JEF (1..78) du fil Janome le plus proche. */
export function jefIndex(c: Thread): number {
  if (c.chart === 'Janome/Elna') {
    const i = JANOME.findIndex((t, k) => k > 0 && t.code === c.code);
    if (i > 0) return i;
  }
  return nearestIndex(c, JANOME, new Set([0]));
}

export function nearestThread(c: { r: number; g: number; b: number }, chart = 'Janome/Elna'): Thread {
  const list = CHARTS[chart] ?? CHARTS['Janome/Elna'];
  return { ...list[nearestIndex(c, list)] };
}
