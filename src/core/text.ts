// Lettrage : polices TrueType/OpenType converties en contours (mm).
// Gère plusieurs alphabets : si la police choisie n'a pas un caractère, une police de secours
// adaptée à son alphabet (Noto, Cairo…) est utilisée. L'hébreu et l'arabe s'écrivent de droite à gauche.
import opentype from 'opentype.js';
import type { Poly, Pt, TextObj } from './types';
import { bboxOf, matAround, matMul, matRotate, matScale, applyMat, rad, normalize } from './geometry';

export type Script = 'latin' | 'cyrillic' | 'greek' | 'hebrew' | 'arabic' | 'kana' | 'han' | 'hangul' | 'thai' | 'georgian' | 'armenian';
export interface FontInfo { id: string; name: string; file?: string; category: string; scripts?: Script[]; kb?: number }

export const SCRIPT_NAMES: Record<Script, string> = {
  latin: 'Latin', cyrillic: 'Cyrillique', greek: 'Grec', hebrew: 'Hébreu', arabic: 'Arabe', kana: 'Japonais',
  han: 'Chinois / kanji', hangul: 'Coréen', thai: 'Thaï', georgian: 'Géorgien', armenian: 'Arménien',
};

/** Polices intégrées (Google Fonts, licences OFL / Apache / UFL). Chargées à la demande. */
export const BUILTIN_FONTS: FontInfo[] = [
  { id: 'archivo', name: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', category: 'Bâton', scripts: ['latin'], kb: 88 },
  { id: 'montserrat', name: 'Montserrat', file: 'Montserrat.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 727 },
  { id: 'oswald', name: 'Oswald', file: 'Oswald.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 168 },
  { id: 'anton', name: 'Anton', file: 'Anton-Regular.ttf', category: 'Bâton', scripts: ['latin'], kb: 166 },
  { id: 'bebas', name: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', category: 'Bâton', scripts: ['latin'], kb: 59 },
  { id: 'luckiest', name: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 71 },
  { id: 'alfa', name: 'Alfa Slab One', file: 'AlfaSlabOne-Regular.ttf', category: 'Empattement', scripts: ['latin'], kb: 95 },
  { id: 'abril', name: 'Abril Fatface', file: 'AbrilFatface-Regular.ttf', category: 'Empattement', scripts: ['latin'], kb: 65 },
  { id: 'playfair', name: 'Playfair Display', file: 'PlayfairDisplay.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic'], kb: 293 },
  { id: 'cinzel', name: 'Cinzel Decorative', file: 'CinzelDecorative-Bold.ttf', category: 'Monogramme', scripts: ['latin'], kb: 60 },
  { id: 'pacifico', name: 'Pacifico', file: 'Pacifico-Regular.ttf', category: 'Script', scripts: ['latin', 'cyrillic'], kb: 321 },
  { id: 'lobster', name: 'Lobster', file: 'Lobster-Regular.ttf', category: 'Script', scripts: ['latin', 'cyrillic'], kb: 396 },
  { id: 'courgette', name: 'Courgette', file: 'Courgette-Regular.ttf', category: 'Script', scripts: ['latin'], kb: 119 },
  { id: 'dancing', name: 'Dancing Script', file: 'DancingScript.ttf', category: 'Script', scripts: ['latin'], kb: 130 },
  { id: 'kaushan', name: 'Kaushan Script', file: 'KaushanScript-Regular.ttf', category: 'Script', scripts: ['latin'], kb: 205 },
  { id: 'satisfy', name: 'Satisfy', file: 'Satisfy-Regular.ttf', category: 'Script', scripts: ['latin'], kb: 46 },
  { id: 'greatvibes', name: 'Great Vibes', file: 'GreatVibes-Regular.ttf', category: 'Script', scripts: ['latin', 'cyrillic', 'greek'], kb: 446 },
  { id: 'roboto', name: 'Roboto', file: 'roboto.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 126 },
  { id: 'opensans', name: 'Open Sans', file: 'opensans.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek', 'hebrew'], kb: 92 },
  { id: 'lato', name: 'Lato', file: 'lato.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 423 },
  { id: 'poppins', name: 'Poppins', file: 'poppins.ttf', category: 'Bâton', scripts: ['latin'], kb: 142 },
  { id: 'nunito', name: 'Nunito', file: 'nunito.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 118 },
  { id: 'raleway', name: 'Raleway', file: 'raleway.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 128 },
  { id: 'rubik', name: 'Rubik', file: 'rubik.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'hebrew', 'arabic'], kb: 192 },
  { id: 'fredoka', name: 'Fredoka', file: 'fredoka.ttf', category: 'Bâton', scripts: ['latin', 'hebrew'], kb: 46 },
  { id: 'comfortaa', name: 'Comfortaa', file: 'comfortaa.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 101 },
  { id: 'ubuntu', name: 'Ubuntu', file: 'ubuntu.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 157 },
  { id: 'russo', name: 'Russo One', file: 'russo.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 33 },
  { id: 'exo2', name: 'Exo 2', file: 'exo2.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 138 },
  { id: 'ptsans', name: 'PT Sans', file: 'ptsans.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic'], kb: 71 },
  { id: 'firasans', name: 'Fira Sans', file: 'firasans.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 315 },
  { id: 'barlowc', name: 'Barlow Condensed', file: 'barlowc.ttf', category: 'Bâton', scripts: ['latin'], kb: 68 },
  { id: 'teko', name: 'Teko', file: 'teko.ttf', category: 'Bâton', scripts: ['latin'], kb: 142 },
  { id: 'righteous', name: 'Righteous', file: 'righteous.ttf', category: 'Bâton', scripts: ['latin'], kb: 36 },
  { id: 'varela', name: 'Varela Round', file: 'varela.ttf', category: 'Bâton', scripts: ['latin', 'hebrew'], kb: 91 },
  { id: 'quicksand', name: 'Quicksand', file: 'quicksand.ttf', category: 'Bâton', scripts: ['latin'], kb: 69 },
  { id: 'notosans', name: 'Noto Sans', file: 'notosans.ttf', category: 'Bâton', scripts: ['latin', 'cyrillic', 'greek'], kb: 579 },
  { id: 'merriweather', name: 'Merriweather', file: 'merriweather.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic', 'greek'], kb: 1017 },
  { id: 'lora', name: 'Lora', file: 'lora.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic'], kb: 123 },
  { id: 'ptserif', name: 'PT Serif', file: 'ptserif.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic'], kb: 85 },
  { id: 'garamond', name: 'EB Garamond', file: 'garamond.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic', 'greek'], kb: 449 },
  { id: 'cormorant', name: 'Cormorant Garamond', file: 'cormorant.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic'], kb: 612 },
  { id: 'baskerville', name: 'Libre Baskerville', file: 'baskerville.ttf', category: 'Empattement', scripts: ['latin'], kb: 101 },
  { id: 'notoserif', name: 'Noto Serif', file: 'notoserif.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic', 'greek'], kb: 456 },
  { id: 'robotoslab', name: 'Roboto Slab', file: 'robotoslab.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic', 'greek'], kb: 113 },
  { id: 'oldstandard', name: 'Old Standard TT', file: 'oldstandard.ttf', category: 'Empattement', scripts: ['latin', 'cyrillic'], kb: 133 },
  { id: 'caveat', name: 'Caveat', file: 'caveat.ttf', category: 'Script', scripts: ['latin', 'cyrillic'], kb: 242 },
  { id: 'marck', name: 'Marck Script', file: 'marck.ttf', category: 'Script', scripts: ['latin', 'cyrillic'], kb: 77 },
  { id: 'badscript', name: 'Bad Script', file: 'badscript.ttf', category: 'Script', scripts: ['latin', 'cyrillic'], kb: 116 },
  { id: 'amatic', name: 'Amatic SC', file: 'amatic.ttf', category: 'Script', scripts: ['latin', 'cyrillic', 'hebrew'], kb: 93 },
  { id: 'sacramento', name: 'Sacramento', file: 'sacramento.ttf', category: 'Script', scripts: ['latin'], kb: 60 },
  { id: 'allura', name: 'Allura', file: 'allura.ttf', category: 'Script', scripts: ['latin'], kb: 218 },
  { id: 'parisienne', name: 'Parisienne', file: 'parisienne.ttf', category: 'Script', scripts: ['latin'], kb: 54 },
  { id: 'alexbrush', name: 'Alex Brush', file: 'alexbrush.ttf', category: 'Script', scripts: ['latin'], kb: 72 },
  { id: 'yellowtail', name: 'Yellowtail', file: 'yellowtail.ttf', category: 'Script', scripts: ['latin'], kb: 57 },
  { id: 'cookie', name: 'Cookie', file: 'cookie.ttf', category: 'Script', scripts: ['latin'], kb: 40 },
  { id: 'tangerine', name: 'Tangerine', file: 'tangerine.ttf', category: 'Script', scripts: ['latin'], kb: 37 },
  { id: 'pinyon', name: 'Pinyon Script', file: 'pinyon.ttf', category: 'Script', scripts: ['latin'], kb: 102 },
  { id: 'mrdafoe', name: 'Mr Dafoe', file: 'mrdafoe.ttf', category: 'Script', scripts: ['latin'], kb: 45 },
  { id: 'shadows', name: 'Shadows Into Light', file: 'shadows.ttf', category: 'Manuscrite', scripts: ['latin'], kb: 45 },
  { id: 'indie', name: 'Indie Flower', file: 'indie.ttf', category: 'Manuscrite', scripts: ['latin'], kb: 63 },
  { id: 'marker', name: 'Permanent Marker', file: 'marker.ttf', category: 'Manuscrite', scripts: ['latin'], kb: 71 },
  { id: 'kalam', name: 'Kalam', file: 'kalam.ttf', category: 'Manuscrite', scripts: ['latin'], kb: 217 },
  { id: 'homemade', name: 'Homemade Apple', file: 'homemade.ttf', category: 'Manuscrite', scripts: ['latin'], kb: 105 },
  { id: 'patrick', name: 'Patrick Hand', file: 'patrick.ttf', category: 'Manuscrite', scripts: ['latin', 'greek'], kb: 109 },
  { id: 'bangers', name: 'Bangers', file: 'bangers.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 61 },
  { id: 'pressstart', name: 'Press Start 2P', file: 'pressstart.ttf', category: 'Fantaisie', scripts: ['latin', 'cyrillic', 'greek'], kb: 49 },
  { id: 'blackops', name: 'Black Ops One', file: 'blackops.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 123 },
  { id: 'bungee', name: 'Bungee', file: 'bungee.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 104 },
  { id: 'creepster', name: 'Creepster', file: 'creepster.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 59 },
  { id: 'specialelite', name: 'Special Elite', file: 'specialelite.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 145 },
  { id: 'rye', name: 'Rye', file: 'rye.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 79 },
  { id: 'chewy', name: 'Chewy', file: 'chewy.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 33 },
  { id: 'titan', name: 'Titan One', file: 'titan.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 49 },
  { id: 'ultra', name: 'Ultra', file: 'ultra.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 47 },
  { id: 'sigmar', name: 'Sigmar One', file: 'sigmar.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 98 },
  { id: 'bowlby', name: 'Bowlby One', file: 'bowlby.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 55 },
  { id: 'lilita', name: 'Lilita One', file: 'lilita.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 25 },
  { id: 'baloo', name: 'Baloo 2', file: 'baloo.ttf', category: 'Fantaisie', scripts: ['latin'], kb: 393 },
  { id: 'cinzel-classic', name: 'Cinzel', file: 'cinzel.ttf', category: 'Monogramme', scripts: ['latin'], kb: 70 },
  { id: 'fraktur', name: 'UnifrakturMaguntia', file: 'fraktur.ttf', category: 'Gothique', scripts: ['latin'], kb: 63 },
  { id: 'pirata', name: 'Pirata One', file: 'pirata.ttf', category: 'Gothique', scripts: ['latin'], kb: 50 },
  { id: 'grenze', name: 'Grenze Gotisch', file: 'grenze.ttf', category: 'Gothique', scripts: ['latin'], kb: 81 },
  { id: 'medieval', name: 'MedievalSharp', file: 'medieval.ttf', category: 'Gothique', scripts: ['latin'], kb: 45 },
  { id: 'noto-jp', name: 'Noto Sans JP', file: 'noto-jp.ttf', category: 'Japonais', scripts: ['latin', 'cyrillic', 'greek', 'kana'], kb: 5314 },
  { id: 'kosugi', name: 'Kosugi Maru', file: 'kosugi.ttf', category: 'Japonais', scripts: ['latin', 'cyrillic', 'greek', 'kana'], kb: 3408 },
  { id: 'yusei', name: 'Yusei Magic', file: 'yusei.ttf', category: 'Japonais', scripts: ['latin', 'kana'], kb: 2981 },
  { id: 'noto-sc', name: 'Noto Sans SC (simplifié)', file: 'noto-sc.ttf', category: 'Chinois', scripts: ['latin', 'cyrillic', 'greek', 'kana', 'han'], kb: 10300 },
  { id: 'noto-tc', name: 'Noto Sans TC (traditionnel)', file: 'noto-tc.ttf', category: 'Chinois', scripts: ['latin', 'cyrillic', 'greek', 'kana', 'han'], kb: 6934 },
  { id: 'zcool', name: 'ZCOOL KuaiLe', file: 'zcool.ttf', category: 'Chinois', scripts: ['latin', 'han'], kb: 1411 },
  { id: 'mashan', name: 'Ma Shan Zheng (calligraphie)', file: 'mashan.ttf', category: 'Chinois', scripts: ['latin', 'han'], kb: 5653 },
  { id: 'noto-kr', name: 'Noto Sans KR', file: 'noto-kr.ttf', category: 'Coréen', scripts: ['latin', 'cyrillic', 'greek', 'kana', 'hangul'], kb: 6034 },
  { id: 'blackhan', name: 'Black Han Sans', file: 'blackhan.ttf', category: 'Coréen', scripts: ['latin', 'hangul'], kb: 348 },
  { id: 'jua', name: 'Jua', file: 'jua.ttf', category: 'Coréen', scripts: ['latin', 'hangul'], kb: 1310 },
  { id: 'nanumpen', name: 'Nanum Pen Script', file: 'nanumpen.ttf', category: 'Coréen', scripts: ['latin', 'hangul'], kb: 2112 },
  { id: 'cairo', name: 'Cairo', file: 'cairo.ttf', category: 'Arabe', scripts: ['latin', 'arabic'], kb: 83 },
  { id: 'noto-he', name: 'Noto Sans Hebrew', file: 'noto-he.ttf', category: 'Hébreu', scripts: ['latin', 'hebrew'], kb: 43 },
  { id: 'noto-th', name: 'Noto Sans Thai', file: 'noto-th.ttf', category: 'Thaï', scripts: ['latin', 'thai'], kb: 42 },
  { id: 'kanit', name: 'Kanit', file: 'kanit.ttf', category: 'Thaï', scripts: ['latin', 'thai'], kb: 80 },
  { id: 'noto-ka', name: 'Noto Sans Georgian', file: 'noto-ka.ttf', category: 'Géorgien', scripts: ['latin', 'georgian'], kb: 56 },
  { id: 'noto-sym', name: 'Noto Sans Symbols 2', file: 'noto-sym.ttf', category: 'Symboles', scripts: ['latin'], kb: 661 },
  { id: 'noto-emoji', name: 'Noto Emoji (contours)', file: 'noto-emoji.ttf', category: 'Symboles', scripts: [], kb: 842 },
  { id: 'noto-hy', name: 'Noto Sans Armenian', file: 'noto-hy.ttf', category: 'Arménien', scripts: ['latin', 'armenian'], kb: 45 },
  { id: 'changa', name: 'Changa', file: 'changa.ttf', category: 'Arabe', scripts: ['latin', 'arabic'], kb: 60 },
  { id: 'lalezar', name: 'Lalezar', file: 'lalezar.ttf', category: 'Arabe', scripts: ['latin', 'arabic'], kb: 146 },
  { id: 'messiri', name: 'El Messiri', file: 'messiri.ttf', category: 'Arabe', scripts: ['latin', 'cyrillic', 'arabic'], kb: 79 },
  { id: 'tajawal', name: 'Tajawal', file: 'tajawal.ttf', category: 'Arabe', scripts: ['latin', 'arabic'], kb: 52 },
];

/** Police de secours par alphabet, pour les caractères absents de la police choisie. */
const FALLBACK: Record<Script, string> = {
  latin: 'notosans', cyrillic: 'notosans', greek: 'notosans', hebrew: 'noto-he', arabic: 'cairo', kana: 'noto-jp',
  han: 'noto-sc', hangul: 'noto-kr', thai: 'noto-th', georgian: 'noto-ka', armenian: 'noto-hy',
};

const inR = (cp: number, a: number, b: number) => cp >= a && cp <= b;

/** Alphabet d'un caractère (null pour espaces, chiffres, ponctuation…). */
export function scriptOf(cp: number): Script | null {
  if (inR(cp, 0x41, 0x5a) || inR(cp, 0x61, 0x7a) || (inR(cp, 0xc0, 0x24f) && cp !== 0xd7 && cp !== 0xf7) || inR(cp, 0x1e00, 0x1eff)) return 'latin';
  if (inR(cp, 0x370, 0x3ff) || inR(cp, 0x1f00, 0x1fff)) return 'greek';
  if (inR(cp, 0x400, 0x52f) || inR(cp, 0x2de0, 0x2dff) || inR(cp, 0xa640, 0xa69f)) return 'cyrillic';
  if (inR(cp, 0x530, 0x58f)) return 'armenian';
  if (inR(cp, 0x590, 0x5ff) || inR(cp, 0xfb1d, 0xfb4f)) return 'hebrew';
  if (inR(cp, 0x600, 0x6ff) || inR(cp, 0x750, 0x77f) || inR(cp, 0x8a0, 0x8ff) || inR(cp, 0xfb50, 0xfdff) || inR(cp, 0xfe70, 0xfeff)) return 'arabic';
  if (inR(cp, 0xe00, 0xe7f)) return 'thai';
  if (inR(cp, 0x10a0, 0x10ff) || inR(cp, 0x2d00, 0x2d2f)) return 'georgian';
  if (inR(cp, 0x1100, 0x11ff) || inR(cp, 0x3130, 0x318f) || inR(cp, 0xac00, 0xd7af)) return 'hangul';
  if (inR(cp, 0x3040, 0x30ff) || inR(cp, 0x31f0, 0x31ff) || inR(cp, 0xff66, 0xff9f)) return 'kana';
  if (inR(cp, 0x3400, 0x4dbf) || inR(cp, 0x4e00, 0x9fff) || inR(cp, 0xf900, 0xfaff) || inR(cp, 0x20000, 0x2ffff) || inR(cp, 0x3000, 0x303f) || inR(cp, 0xff00, 0xff65)) return 'han';
  return null;
}
const isRTL = (s: Script | null) => s === 'hebrew' || s === 'arabic';

/** Polices à essayer, dans l'ordre, pour un caractère absent de la police choisie. */
function fallbacksFor(cp: number, sc: Script | null, hasKana: boolean): string[] {
  if (sc) return [sc === 'han' && hasKana ? 'noto-jp' : FALLBACK[sc]];
  if (cp >= 0x1f000 || inR(cp, 0x2600, 0x27bf) || inR(cp, 0x2b00, 0x2bff)) return ['noto-emoji', 'noto-sym'];
  return ['notosans', 'noto-sym', 'noto-emoji'];
}

const fonts = new Map<string, opentype.Font>();
const loading = new Map<string, Promise<opentype.Font | null>>();
const failed = new Set<string>();
export const userFonts: FontInfo[] = [];
const listeners: (() => void)[] = [];
const startListeners: ((f: FontInfo) => void)[] = [];
export const onFontLoaded = (f: () => void) => listeners.push(f);
/** Appelé quand le téléchargement d'une police intégrée commence (utile pour les grosses polices CJK). */
export const onFontLoadStart = (f: (info: FontInfo) => void) => startListeners.push(f);

export const fontUrl = (info: FontInfo) => `${import.meta.env.BASE_URL}fonts/${info.file}`;

export function getFont(id: string): opentype.Font | null {
  const f = fonts.get(id);
  if (f) return f;
  if (!loading.has(id)) {
    const info = BUILTIN_FONTS.find((x) => x.id === id);
    if (!info?.file) { failed.add(id); return null; }
    startListeners.forEach((l) => l(info));
    const p = fetch(fontUrl(info))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((buf) => { const font = opentype.parse(buf); fonts.set(id, font); listeners.forEach((l) => l()); return font; })
      .catch((e) => { console.error('Police', id, e); failed.add(id); listeners.forEach((l) => l()); return null; });
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
  const sc = (Object.keys(SCRIPT_NAMES) as Script[]).filter((s) => {
    const probe: Record<Script, string> = { latin: 'A', cyrillic: 'Ж', greek: 'Ω', hebrew: 'א', arabic: 'ع', kana: 'あ', han: '字', hangul: '한', thai: 'ก', georgian: 'ა', armenian: 'Ա' };
    return font.charToGlyphIndex(probe[s]) > 0;
  });
  const info: FontInfo = { id, name: name.replace(/\.(ttf|otf|woff)$/i, ''), category: 'Mes polices', scripts: sc };
  if (!userFonts.some((f) => f.id === id)) userFonts.push(info);
  listeners.forEach((l) => l());
  return info;
}

export const allFonts = () => [...BUILTIN_FONTS, ...userFonts];
export const fontInfo = (id: string) => allFonts().find((f) => f.id === id);

/**
 * Mise en forme (ligatures, formes contextuelles arabes). opentype.js ne gère pas certaines
 * tables GSUB : on désactive alors « ccmp », puis à défaut on prend les glyphes un par un.
 */
function shape(font: opentype.Font, s: string): opentype.Glyph[] {
  try { return font.stringToGlyphs(s); } catch { /* table non gérée */ }
  for (const f of (font.tables as any).gsub?.features ?? []) if (f.tag === 'ccmp') f.tag = 'xcmp';
  try { return font.stringToGlyphs(s); } catch { /* idem */ }
  return [...s].map((c) => font.charToGlyph(c));
}

interface Run { fontId: string; text: string; rtl: boolean }

/**
 * Découpe une ligne en segments d'une même police et d'un même sens, dans l'ordre visuel (gauche → droite).
 * Retourne null si une police nécessaire est encore en cours de chargement.
 */
function splitRuns(line: string, primary: string): Run[] | null {
  const main = getFont(primary);
  if (!main) return failed.has(primary) ? [] : null;
  const chars = [...line.replace(/[​-‍︎️]/g, '')];
  const hasKana = chars.some((c) => scriptOf(c.codePointAt(0)!) === 'kana');
  let pending = false;
  const info = chars.map((c) => {
    const cp = c.codePointAt(0)!;
    const sc = scriptOf(cp);
    let fontId = primary;
    if (cp > 0x20 && main.charToGlyphIndex(c) === 0) {
      for (const fb of fallbacksFor(cp, sc, hasKana)) {
        if (fb === primary || failed.has(fb)) continue;
        const f = getFont(fb);
        if (!f) { pending = true; break; }
        if (f.charToGlyphIndex(c) > 0) { fontId = fb; break; }
      }
    }
    return { c, sc, fontId };
  });
  if (pending) return null;
  // sens : les caractères neutres prennent le sens de leurs voisins s'ils sont d'accord, sinon celui du paragraphe
  const strong: number[] = info.map((x) => (x.sc ? (isRTL(x.sc) ? 1 : 0) : -1));
  const first = strong.find((v) => v >= 0) ?? 0;
  const dir = strong.slice();
  for (let i = 0; i < dir.length; i++) {
    if (dir[i] >= 0) continue;
    let a = -1, b = -1;
    for (let j = i - 1; j >= 0; j--) if (strong[j] >= 0) { a = strong[j]; break; }
    for (let j = i + 1; j < dir.length; j++) if (strong[j] >= 0) { b = strong[j]; break; }
    dir[i] = a >= 0 && a === b ? a : a < 0 && b >= 0 && b === first ? b : b < 0 && a >= 0 && a === first ? a : first;
  }
  // segments de même sens, puis de même police
  const dirRuns: { rtl: boolean; runs: Run[] }[] = [];
  info.forEach((x, i) => {
    const rtl = dir[i] === 1;
    let d = dirRuns[dirRuns.length - 1];
    if (!d || d.rtl !== rtl) { d = { rtl, runs: [] }; dirRuns.push(d); }
    const r = d.runs[d.runs.length - 1];
    if (r && r.fontId === x.fontId) r.text += x.c;
    else d.runs.push({ fontId: x.fontId, text: x.c, rtl });
  });
  if (first === 1) dirRuns.reverse();
  return dirRuns.flatMap((d) => (d.rtl ? d.runs.reverse() : d.runs));
}

/** Glyphes d'un segment dans l'ordre visuel. opentype.js retourne déjà l'arabe à l'envers ; l'hébreu non. */
function runGlyphs(font: opentype.Font, r: Run): opentype.Glyph[] {
  if (!r.rtl) return shape(font, r.text);
  const hasArabic = [...r.text].some((c) => scriptOf(c.codePointAt(0)!) === 'arabic');
  if (hasArabic) return shape(font, r.text);
  return shape(font, [...r.text].reverse().join(''));
}

const capOf = (font: opentype.Font) => {
  const os2 = (font.tables as any).os2;
  return os2?.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : font.unitsPerEm * 0.7;
};

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

/** Contours de chaque lettre, en mm, positionnés selon l'objet texte. null si une police n'est pas encore chargée. */
export function textGlyphs(t: TextObj): GlyphShape[] | null {
  const main = getFont(t.font);
  if (!main) return failed.has(t.font) ? [] : null;
  const lines = t.text.split('\n');
  const lineH = t.size * 1.45 * t.lineHeight;
  // passe 1: positions par ligne (repère : ligne de base, x croissant)
  type G = { polys: Poly[]; x0: number; x1: number };
  const laid: { glyphs: G[]; width: number }[] = [];
  for (const line of lines) {
    const runs = splitRuns(line, t.font);
    if (!runs) return null;
    const glyphs: G[] = [];
    let x = 0;
    for (const r of runs) {
      const font = getFont(r.fontId)!;
      const upm = font.unitsPerEm;
      const k = t.size / capOf(font); // mm par unité
      const gl = runGlyphs(font, r);
      const joined = [...r.text].some((c) => scriptOf(c.codePointAt(0)!) === 'arabic');
      gl.forEach((g, i) => {
        const path = g.getPath(x / k, 0, upm);
        // glyphe introuvable dans toutes les polices : on laisse un blanc plutôt qu'un rectangle
        const polys = g.index === 0 ? [] : pathToPolys(path, upm / 60).map((p) => p.map((q) => ({ x: q.x * k, y: q.y * k })));
        const adv = (g.advanceWidth ?? upm * 0.5) * k;
        glyphs.push({ polys, x0: x, x1: x + adv });
        // pas d'interlettrage sur les signes diacritiques (largeur nulle) ni entre lettres arabes liées
        if (adv > 0) x += adv + (joined ? 0 : t.spacing);
        if (!r.rtl && i + 1 < gl.length) x += font.getKerningValue(g, gl[i + 1]) * k;
      });
    }
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
