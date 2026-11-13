// Boîtes de dialogue : nuancier, assistants image, export, impression, monogramme, aide.
import { app } from './state';
import { add, checkField, clear, download, h, modal, numField, pickFile, rangeField, selectField, toast } from './dom';
import { CHARTS, hexOf, rgbOf, threadFromHex } from '../core/threads';
import type { Design, EmbObject, Thread } from '../core/types';
import { Cmd } from '../core/types';
import { autoDigitize, crossStitch, defaultAuto, imageToData, labToRgb, photoStitch, quantize, threadsOf, unifyThreads, workSize, type AutoOptions, type Quantized } from '../digitize/autodigitize';
import { exportDesign, importedToObjects, readMachineFile, type ExportFormat } from '../formats';
import { buildPlan, estimateMinutes, forgetObjects } from '../core/plan';
import { HOOPS, makeSatin, makeText, shapePoints, uid, type ShapeKind } from '../core/defaults';
import { allFonts, fontInfo, fontUrl, SCRIPT_NAMES, type FontInfo, type Script } from '../core/text';
import { designName } from '../formats/encode';
import { addOutlines, outlinable, type OutlineOptions } from './actions';

// ------------------------------------------------------------------ Nuancier

export function threadPicker(onPick: (t: Thread) => void, title = 'Choisir un fil') {
  let chart = 'Janome/Elna';
  let q = '';
  const grid = h('div', { class: 'thread-grid' });
  const render = () => {
    clear(grid);
    for (const t of CHARTS[chart]) {
      if (q && !(t.name.toLowerCase().includes(q) || t.code.includes(q))) continue;
      grid.appendChild(h('button', { class: 'thread', title: `${t.name} (${t.code})`, onclick: () => { onPick({ ...t }); close(); } },
        h('i', { style: { background: rgbOf(t) } }), h('span', {}, t.code), h('small', {}, t.name)));
    }
  };
  const custom = h('input', { type: 'color', value: '#3366cc' });
  const body = h('div', { class: 'picker' },
    h('div', { class: 'row' },
      selectField('Nuancier', chart, Object.keys(CHARTS).map((k) => [k, k] as [string, string]), (v) => { chart = v; render(); }),
      h('label', { class: 'field' }, h('span', {}, 'Rechercher'), h('input', { type: 'search', placeholder: 'nom ou code', oninput: (e: Event) => { q = (e.target as HTMLInputElement).value.toLowerCase(); render(); } })),
      h('label', { class: 'field' }, h('span', {}, 'Couleur libre'), h('span', { class: 'inp' }, custom, h('button', { onclick: () => { onPick(threadFromHex(custom.value)); close(); } }, 'Utiliser'))),
    ),
    grid);
  render();
  const close = modal(title, body, [], true);
}

// ------------------------------------------------------------------ Choix de police

const SAMPLES: Partial<Record<Script, string>> = {
  cyrillic: 'Привет', greek: 'Γειά σου', hebrew: 'שלום', arabic: 'مرحبا', kana: 'こんにちは', han: '你好 刺繡',
  hangul: '안녕하세요', thai: 'สวัสดี', georgian: 'გამარჯობა', armenian: 'Բարեւ',
};
const previewFaces = new Map<string, Promise<string>>();

/** Charge une police dans le navigateur (FontFace) pour l'aperçu. Retourne le nom CSS. */
function cssFont(f: FontInfo): Promise<string> {
  let p = previewFaces.get(f.id);
  if (!p) {
    const name = 'fl-' + f.id.replace(/[^a-z0-9]/gi, '');
    p = new FontFace(name, `url(${fontUrl(f)})`).load().then((ff) => { document.fonts.add(ff); return name; }).catch(() => 'system-ui');
    previewFaces.set(f.id, p);
  }
  return p;
}

/** Catalogue des polices avec aperçu, recherche et filtres par style et par alphabet. */
export function fontPicker(current: string, sample: string, onPick: (id: string) => void) {
  const fonts = allFonts();
  const cats = ['Toutes', ...new Set(fonts.map((f) => f.category))];
  let cat = 'Toutes', script: Script | '' = '', q = '';
  let text = sample.split('\n')[0].trim().slice(0, 40) || 'Fil Libre';
  const grid = h('div', { class: 'font-grid' });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      io.unobserve(el);
      const f = fonts.find((x) => x.id === el.dataset.id);
      if (f?.file) cssFont(f).then((n) => { el.style.fontFamily = `"${n}", system-ui`; el.classList.remove('loading'); });
    }
  }, { root: grid, rootMargin: '200px' });
  const render = () => {
    clear(grid);
    io.disconnect();
    const list = fonts.filter((f) => (cat === 'Toutes' || f.category === cat) && (!script || f.scripts?.includes(script)) && (!q || f.name.toLowerCase().includes(q)));
    if (!list.length) grid.appendChild(h('p', { class: 'hint' }, 'Aucune police ne correspond.'));
    for (const f of list) {
      const big = (f.kb ?? 0) > 1500;
      const pv = h('div', { class: 'fp-sample loading', 'data-id': f.id }, text);
      const card = h('button', { class: 'font-card' + (f.id === current ? ' on' : ''), title: f.name, onclick: () => { onPick(f.id); close(); } },
        pv,
        h('div', { class: 'fp-meta' }, h('b', {}, f.name), h('small', {}, f.category + (big ? ` · ${Math.round((f.kb ?? 0) / 1024)} Mo` : ''))),
        h('div', { class: 'fp-scripts' }, (f.scripts ?? []).filter((s) => s !== 'latin').map((s) => h('span', {}, SCRIPT_NAMES[s]))));
      grid.appendChild(card);
      if (f.file && !big) io.observe(pv);
      else if (big) { pv.classList.remove('loading'); pv.classList.add('big'); }
      else pv.classList.remove('loading');
    }
  };
  const chips = h('div', { class: 'chips' }, cats.map((c) => h('button', { class: c === cat ? 'on' : '', onclick: (e: Event) => { cat = c; chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); render(); } }, c)));
  const scripts = Object.keys(SCRIPT_NAMES) as Script[];
  const sampleIn = h('input', { value: text, oninput: () => { text = sampleIn.value || 'Fil Libre'; grid.querySelectorAll('.fp-sample').forEach((el) => (el.textContent = text)); } });
  const body = h('div', { class: 'fontpicker' },
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Rechercher'), h('input', { type: 'search', placeholder: 'nom de police', oninput: (e: Event) => { q = (e.target as HTMLInputElement).value.toLowerCase(); render(); } })),
      selectField<Script | ''>('Alphabet', '', [['', 'Tous'], ...scripts.map((s) => [s, SCRIPT_NAMES[s]] as [Script, string])], (v) => {
        script = v;
        if (v && SAMPLES[v] && !/[^\u0000-ɏ]/.test(text)) { text = SAMPLES[v]!; sampleIn.value = text; }
        render();
      }),
      h('label', { class: 'field' }, h('span', {}, 'Texte d\'aperçu'), sampleIn),
    ),
    chips,
    h('p', { class: 'hint' }, 'Les caractères absents d\'une police (cyrillique, japonais, arabe…) sont automatiquement pris dans une police Noto adaptée. Les polices chinoises, japonaises et coréennes pèsent plusieurs Mo : elles se chargent au premier usage.'),
    grid);
  render();
  const close = modal('Choisir une police', body, [], true);
}

export const fontLabel = (id: string) => fontInfo(id)?.name ?? id;

// ------------------------------------------------------------------ Lecture d'image

function loadImageFile(f: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Image illisible'));
    im.src = url;
  });
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
}

function addResult(objects: EmbObject[], threads: Thread[]) {
  app.checkpoint();
  const base = app.design.threads.length;
  // réutiliser les fils déjà présents dans le motif
  const map = threads.map((t) => {
    const i = app.design.threads.findIndex((x) => x.code === t.code && x.chart === t.chart && x.r === t.r && x.g === t.g && x.b === t.b);
    if (i >= 0) return i;
    app.design.threads.push(t);
    return app.design.threads.length - 1;
  });
  for (const o of objects) o.color = map[o.color - base] ?? o.color;
  app.design.objects.push(...objects);
  app.changed();
  app.select(objects.map((o) => o.id));
}

// ------------------------------------------------------------------ Numérisation automatique

export async function autoDigitizeDialog(file?: File) {
  const f = file ?? (await pickFile('image/*'));
  if (!f) return;
  const img = await loadImageFile(f);
  const dataUrl = await fileToDataUrl(f);
  const o: AutoOptions = { ...defaultAuto, groups: [], excluded: [], widthMm: Math.round(Math.min(app.hoop.w, app.hoop.h) * 0.7) };
  const ratio = img.height / img.width;
  const preview = h('canvas', { class: 'preview clickable', title: 'Cliquez sur une couleur pour la sélectionner' });
  const original = h('img', { class: 'preview', src: dataUrl, style: { display: 'none' } });
  const info = h('div', { class: 'hint' });
  const swatches = h('div', { class: 'palette' });
  const excludedBox = h('div', { class: 'palette excluded' });
  const selected = new Set<number>();
  let keepBg = false;
  let timer = 0;
  let view: 'zones' | 'real' = 'zones';
  let bgAuto = true, bgInside: HTMLElement | null = null;
  let cur: { q: Quantized; shown: Quantized; threads: (Thread | null)[]; shownOf: Map<number, number> } | null = null;
  let data: ImageData | null = null, dataKey = '';
  const work = () => {
    const key = `${workSize(o)}`;
    if (!data || key !== dataKey) { data = imageToData(img, workSize(o), 3); dataKey = key; }
    return data;
  };
  /** Nuances d'origine (Lab) regroupées sous une pastille affichée. */
  const labsUnder = (l: number) => {
    const out: number[][] = [];
    if (!cur) return out;
    const { q, shownOf } = cur;
    q.fate.forEach((f, ql) => { if (f >= 0 && shownOf.get(f) === l) out.push(q.lab[ql]); });
    return out;
  };
  const mergeBtn = h('button', { disabled: true, onclick: () => {
    if (!cur || selected.size < 2) return;
    // mémoriser toutes les nuances d'origine réunies sous chaque pastille
    o.groups.push([...selected].flatMap(labsUnder));
    selected.clear(); update();
  } }, 'Fusionner la sélection');
  const excludeBtn = h('button', { disabled: true, onclick: () => {
    if (!cur || !selected.size) return;
    for (const l of selected) o.excluded.push(...labsUnder(l));
    selected.clear(); update();
  } }, 'Ne pas broder');
  const resetBtn = h('button', { class: 'linkbtn', onclick: () => { o.groups = []; o.excluded = []; selected.clear(); update(); } }, 'Annuler les regroupements');
  const syncButtons = () => {
    mergeBtn.disabled = selected.size < 2;
    excludeBtn.disabled = selected.size < 1;
    mergeBtn.textContent = selected.size >= 2 ? `Fusionner (${selected.size})` : 'Fusionner la sélection';
    swatches.querySelectorAll<HTMLElement>('.sw').forEach((b) => b.classList.toggle('on', selected.has(+b.dataset.l!)));
  };
  const toggleSel = (l: number) => { if (selected.has(l)) selected.delete(l); else selected.add(l); syncButtons(); };
  preview.addEventListener('click', (e) => {
    if (!cur) return;
    const r = preview.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * cur.shown.w), y = Math.floor(((e.clientY - r.top) / r.height) * cur.shown.h);
    const l = cur.shown.labels[y * cur.shown.w + x];
    if (l >= 0) toggleSel(l);
  });
  const draw = () => {
    if (!cur) return;
    const { shown: q, threads } = cur;
    const zones = view === 'zones';
    const ctx = preview.getContext('2d')!;
    if (zones) { preview.width = q.w; preview.height = q.h; }
    const out = zones ? ctx.createImageData(q.w, q.h) : null;
    const colOf = (l: number) => threads[l] ?? q.palette[l];
    const lum = (c: { r: number; g: number; b: number }) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    const used = [...new Set(Array.from(q.labels).filter((l) => l >= 0))];
    const darkest = used.length ? used.reduce((a, b) => (lum(colOf(a)) < lum(colOf(b)) ? a : b)) : -1;
    const W = q.w;
    if (out) for (let i = 0; i < q.w * q.h; i++) {
      const l = q.labels[i];
      const checker = ((i % W) >> 3) % 2 === (((i / W) | 0) >> 3) % 2 ? { r: 235, g: 235, b: 235 } : { r: 250, g: 250, b: 250 };
      let c = l >= 0 ? colOf(l) : checker;
      if (o.render === 'outline' || o.contour === 'all') {
        const x = i % W;
        const edge = (x < W - 1 && q.labels[i + 1] !== l) || (i + W < q.labels.length && q.labels[i + W] !== l) || (x > 0 && q.labels[i - 1] !== l) || (i >= W && q.labels[i - W] !== l);
        if (o.render === 'outline') {
          const paper = { r: 252, g: 252, b: 250 };
          if (o.outlineColor === 'lines') {
            const nbDark = (x < W - 1 && q.labels[i + 1] === darkest) || (i + W < q.labels.length && q.labels[i + W] === darkest) || (x > 0 && q.labels[i - 1] === darkest) || (i >= W && q.labels[i - W] === darkest);
            c = l === darkest ? colOf(darkest) : edge && l >= 0 && !nbDark ? colOf(darkest) : paper;
          } else c = edge && l >= 0 ? colOf(o.outlineColor === 'darkest' ? darkest : l) : paper;
        }
        else if (edge) c = colOf(darkest);
      }
      if (o.outer && l >= 0) {
        const x = i % W;
        const border = x === 0 || x === W - 1 || i < W || i + W >= q.labels.length || q.labels[i - 1] < 0 || q.labels[i + 1] < 0 || q.labels[i - W] < 0 || q.labels[i + W] < 0;
        if (border) c = o.outerThread ?? colOf(darkest);
      }
      out.data[i * 4] = c.r; out.data[i * 4 + 1] = c.g; out.data[i * 4 + 2] = c.b; out.data[i * 4 + 3] = 255;
    }
    if (out) ctx.putImageData(out, 0, 0);
    else scheduleReal();
    // palette : une pastille par bobine
    clear(swatches);
    const total = used.reduce((s, l) => s + q.counts[l], 0) || 1;
    used.sort((a, b) => q.counts[b] - q.counts[a]);
    for (const l of used) {
      const c = colOf(l), t = threads[l];
      const pct = (100 * q.counts[l]) / total;
      swatches.appendChild(h('button', {
        class: 'sw' + (selected.has(l) ? ' on' : ''), 'data-l': String(l),
        title: (t ? `${t.code} ${t.name}` : rgbOf({ ...c, name: '', code: '', chart: '' })) + ` — ${pct.toFixed(1)} % de la surface`,
        onclick: () => toggleSel(l),
      }, h('i', { style: { background: `rgb(${c.r},${c.g},${c.b})` } }), h('span', {}, pct < 1 ? '<1 %' : Math.round(pct) + ' %')));
    }
    for (const l of [...selected]) if (!used.includes(l)) selected.delete(l);
    syncButtons();
    clear(excludedBox);
    o.excluded.forEach((c, i) => {
      const rgb = labToRgb(c);
      excludedBox.appendChild(h('button', { class: 'sw off', title: 'Couleur non brodée — cliquez pour la rebroder', onclick: () => { o.excluded.splice(i, 1); update(); } },
        h('i', { style: { background: `rgb(${rgb.r},${rgb.g},${rgb.b})` } }), h('span', {}, '✕')));
    });
    excludedBox.style.display = o.excluded.length ? '' : 'none';
    const raw = new Set(Array.from(cur.q.labels).filter((l) => l >= 0)).size;
    info.textContent = `${o.widthMm} × ${Math.round(o.widthMm * ratio)} mm — ${used.length} bobine(s)` +
      (raw > used.length ? ` (${raw} nuances, réunies quand elles tombent sur le même fil)` : '') + (o.groups.length ? ` — ${o.groups.length} regroupement(s) manuel(s)` : '');
    baseInfo = info.textContent;
    if (!zones) info.textContent = baseInfo + ' — calcul du rendu brodé…';
  };
  /** Aperçu réel : génère la broderie avec les réglages actuels et dessine les points. */
  let realTimer = 0, baseInfo = '';
  const scheduleReal = () => {
    clearTimeout(realTimer);
    realTimer = window.setTimeout(() => {
      if (!cur || view !== 'real') return;
      const q2 = { ...cur.q, labels: cur.q.labels.slice() };
      const res = autoDigitize(q2, o, 0);
      const d: Design = { ...app.design, threads: res.threads, objects: res.objects };
      const plan = buildPlan(d);
      forgetObjects(res.objects.map((x) => x.id));
      const Wmm = o.widthMm, Hmm = cur.q.h * cur.q.mmPerPx;
      const k = Math.min(10, 1100 / Math.max(Wmm, Hmm));
      preview.width = Math.round(Wmm * k); preview.height = Math.round(Hmm * k);
      const ctx = preview.getContext('2d')!;
      ctx.fillStyle = app.design.fabric; ctx.fillRect(0, 0, preview.width, preview.height);
      ctx.setTransform(k, 0, 0, k, (Wmm / 2) * k, (Hmm / 2) * k);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let prev: { x: number; y: number } | null = null;
      for (const st of plan.stitches) {
        if (st.cmd === Cmd.STITCH && prev) {
          const t = res.threads[st.color] ?? res.threads[0];
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(st.x, st.y);
          ctx.lineWidth = 0.42; ctx.strokeStyle = `rgb(${t.r * 0.55 | 0},${t.g * 0.55 | 0},${t.b * 0.55 | 0})`; ctx.stroke();
          ctx.lineWidth = 0.3; ctx.strokeStyle = `rgb(${t.r},${t.g},${t.b})`; ctx.stroke();
        }
        if (st.cmd === Cmd.STITCH || st.cmd === Cmd.JUMP) prev = st;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      info.textContent = `${baseInfo} — ${plan.stitchCount.toLocaleString('fr-FR')} points, ${plan.colorChanges} changement(s) de fil, ≈ ${Math.ceil(estimateMinutes(plan))} min`;
    }, 350);
  };
  const update = () => {
    clearTimeout(timer);
    info.textContent = 'Calcul…';
    timer = window.setTimeout(() => {
      const q = quantize(work(), o);
      const shown = unifyThreads(q, o.threadChart);
      shown.counts = new Int32Array(q.counts.length);
      for (const l of shown.labels) if (l >= 0) shown.counts[l]++;
      const shownOf = new Map<number, number>();
      for (let i = 0; i < q.labels.length; i++) if (q.labels[i] >= 0 && !shownOf.has(q.labels[i])) shownOf.set(q.labels[i], shown.labels[i]);
      // logo sur fond foncé : les intérieurs de lettres et de boucles sont du fond, pas des détails à broder
      if (bgAuto && o.bgOutsideOnly && q.bgLabel >= 0 && q.lab[q.bgLabel][0] < 30) {
        bgAuto = false; o.bgOutsideOnly = false;
        const cb = bgInside?.querySelector('input'); if (cb) cb.checked = false;
        update(); return;
      }
      bgAuto = false;
      cur = { q, shown, threads: threadsOf(q, o.threadChart), shownOf };
      draw();
    }, 180);
  };
  const extra = h('div', {});
  const renderExtra = () => {
    clear(extra);
    if (o.render === 'fill') {
      add(extra,
        numField('Satin si plus fin que', o.satinWidth, (v) => { o.satinWidth = v; draw(); }, { min: 0, max: 10, step: 0.5, unit: 'mm', title: 'Les zones étroites sont brodées en satin, les larges en tatami' }),
        checkField('Traits fins en satin qui suit le trait', o.lineSatin, (v) => { o.lineSatin = v; draw(); }, 'Les zones longues et étroites (contours, liserés) deviennent une colonne satin le long de leur ligne centrale au lieu d’un remplissage'),
        checkField('Traits foncés en dernier (finition)', o.linesLast, (v) => { o.linesLast = v; draw(); }, 'Les traits de la couleur la plus foncée sont brodés à la fin, par-dessus les couleurs, pour un contour net'),
        selectField('Densité du remplissage', String(o.fillSpacing ?? 0.4), [['0.5', 'Légère (0,5 mm)'], ['0.4', 'Normale (0,4 mm)'], ['0.33', 'Dense (0,33 mm)'], ['0.28', 'Très dense (0,28 mm)']], (v) => { o.fillSpacing = Number(v); draw(); },
          'Écart entre les rangs du remplissage. Plus dense couvre mieux le tissu, mais rigidifie et fronce davantage : utilisez un entoilage. En dessous de 0,28 mm, risque de casse d’aiguille et de tissu percé.'),
        numField('Recouvrement sous les traits', o.overlap ?? 0.6, (v) => { o.overlap = v; draw(); }, { min: 0, max: 1.5, step: 0.1, unit: 'mm', title: 'Les couleurs se prolongent sous les traits foncés brodés après elles : si le tissu bouge, le trait recouvre la jonction au lieu de laisser un jour' }),
        selectField('Contour par-dessus', o.contour === 'silhouette' ? 'none' : o.contour, [['none', 'Aucun'], ['all', 'Toutes les limites entre couleurs']], (v) => { o.contour = v; renderExtra(); draw(); }, 'Contour brodé dans la couleur la plus foncée'),
      );
    } else {
      add(extra, selectField('Contours', o.outlineColor, [
        ['lines', 'Suivre les traits foncés du dessin'], ['darkest', 'Limites entre couleurs (une couleur)'], ['each', 'Chaque zone dans sa couleur']], (v) => { o.outlineColor = v; draw(); },
        '« Suivre les traits » : pour un dessin déjà cerné de noir, brode le milieu de chaque trait (une seule ligne). « Limites » : brode une fois chaque frontière entre deux couleurs. « Chaque zone » : entoure chaque zone dans sa propre couleur.'));
    }
    if (o.render === 'outline' || o.contour !== 'none') {
      add(extra, selectField('Point du contour', o.outlineStitch, [['triple', 'Point triple'], ['simple', 'Point avant simple'], ['satin', 'Satin']], (v) => { o.outlineStitch = v; renderExtra(); draw(); }));
      if (o.outlineStitch === 'satin') add(extra, numField('Largeur du satin', o.outlineWidth, (v) => { o.outlineWidth = v; draw(); }, { min: 0.8, max: 6, step: 0.1, unit: 'mm' }));
    }
  };
  renderExtra();
  const outerBox = h('div', {});
  const renderOuter = () => {
    clear(outerBox);
    add(outerBox, checkField('Fermer le motif par un contour complet', o.outer, (v) => { o.outer = v; renderOuter(); draw(); }, 'Brode tout le tour du motif (et des trous) en dernier, pour une finition nette'));
    if (!o.outer) return;
    const t = o.outerThread;
    const colorBtn = h('button', { class: 'colorpick', onclick: () => threadPicker((th) => { o.outerThread = th; renderOuter(); draw(); }, 'Couleur du contour extérieur') },
      h('i', { style: { background: t ? rgbOf(t) : 'repeating-linear-gradient(45deg,#222 0 4px,#555 4px 8px)' } }), t ? `${t.code} ${t.name}` : 'La plus foncée du motif');
    add(outerBox,
      h('label', { class: 'field' }, h('span', {}, 'Couleur'), h('span', { class: 'inp' }, colorBtn, t ? h('button', { class: 'linkbtn', onclick: () => { o.outerThread = null; renderOuter(); draw(); } }, 'auto') : null)),
      selectField('Point', o.outerStitch, [['satin', 'Satin'], ['triple', 'Point triple'], ['simple', 'Point avant simple']], (v) => { o.outerStitch = v; renderOuter(); draw(); }),
      o.outerStitch === 'satin' ? numField('Épaisseur', o.outerWidth, (v) => { o.outerWidth = v; draw(); }, { min: 0.6, max: 8, step: 0.1, unit: 'mm', title: 'Fin : 0,8–1,2 mm ; bordure marquée : 2–4 mm' }) : null,
    );
  };
  renderOuter();
  const sec = (t: string) => h('h4', { class: 'sec' }, t);
  const controls = h('div', { class: 'controls' },
    sec('Taille'),
    numField('Largeur', o.widthMm, (v) => { o.widthMm = v; update(); }, { min: 10, max: 300, step: 1, unit: 'mm' }),
    selectField('Précision', String(o.precision), [['0.3', 'Rapide'], ['0.2', 'Normale'], ['0.14', 'Fine'], ['0.1', 'Très fine (lent)']], (v) => { o.precision = +v; update(); },
      'Résolution de l\'analyse : plus fine = contours plus fidèles et petits détails conservés'),
    sec('Couleurs'),
    rangeField('Couleurs à détecter', o.colors, 1, 16, 1, (v) => { o.colors = v; update(); }),
    rangeField('Fusionner les nuances proches', o.mergeDE, 0, 40, 1, (v) => { o.mergeDE = v; update(); }, (v) => (v ? (v < 10 ? 'léger' : v < 20 ? 'moyen' : 'fort') + ` (${v})` : 'non')),
    selectField('Fils', o.threadChart, [['Janome/Elna', 'Nuancier Janome/Elna'], ['Brother', 'Nuancier Brother'], ['exact', 'Couleurs exactes de l\'image']], (v) => { o.threadChart = v; update(); }),
    checkField('Retirer le fond', o.removeBg, (v) => { o.removeBg = v; update(); }, 'La couleur dominante sur les bords de l\'image n\'est pas brodée'),
    bgInside = checkField('…seulement à l\'extérieur du motif', o.bgOutsideOnly, (v) => { o.bgOutsideOnly = v; bgAuto = false; update(); }, 'Garde les zones de la couleur du fond entourées par le dessin (yeux, griffes, reflets blancs…)'),
    checkField('Préserver les traits fins', o.keepLines, (v) => { o.keepLines = v; update(); }, 'Repère les traits sombres très fins (adoucis par l’anticrénelage) et les garde dans la couleur des traits'),
    checkField('Réduire le bruit', o.denoise, (v) => { o.denoise = v; update(); }, 'Lisse les dégradés et artefacts JPEG sans baver sur les contours'),
    sec('Rendu'),
    selectField('Type', o.render, [['fill', 'Remplissage (zones pleines)'], ['outline', 'Contours seulement (sans remplissage)']], (v) => { o.render = v; renderExtra(); draw(); }),
    extra,
    rangeField('Lissage des contours', o.smooth, 0, 3, 1, (v) => { o.smooth = v; draw(); }),
    numField('Ignorer les zones <', o.minAreaMm2, (v) => { o.minAreaMm2 = v; update(); }, { min: 0, max: 50, step: 0.5, unit: 'mm²' }),
    sec('Contour extérieur'),
    outerBox,
    checkField('Garder l\'image en fond (pour retoucher)', keepBg, (v) => { keepBg = v; }),
  );
  const toggleOrig = h('button', { class: 'linkbtn', onclick: () => {
    const show = original.style.display === 'none';
    original.style.display = show ? '' : 'none';
    preview.style.display = show ? 'none' : '';
    toggleOrig.textContent = show ? 'Voir le résultat' : 'Voir l\'image d\'origine';
  } }, 'Voir l\'image d\'origine');
  const viewBtns = h('div', { class: 'seg' },
    (['zones', 'real'] as const).map((v) => h('button', {
      class: v === view ? 'on' : '', title: v === 'real' ? 'Génère les points avec les réglages actuels : exactement ce que brodera la machine' : 'Zones de couleur détectées (rapide)',
      onclick: (e: Event) => { view = v; viewBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); draw(); },
    }, v === 'zones' ? 'Zones de couleur' : 'Rendu brodé (réel)')));
  const side = h('div', { class: 'pv' },
    viewBtns,
    h('div', { class: 'pv-img' }, preview, original), toggleOrig, info,
    h('div', { class: 'pal-box' },
      h('div', { class: 'pal-head' }, h('b', {}, 'Bobines'), h('small', {}, 'Cliquez sur des pastilles (ou dans l\'image) pour les sélectionner')),
      swatches,
      h('div', { class: 'pal-actions' }, mergeBtn, excludeBtn, resetBtn),
      excludedBox,
    ),
  );
  update();
  modal('Image → Broderie (numérisation automatique)', h('div', { class: 'wizard' }, controls, side), [
    { label: 'Annuler', onClick: () => {} },
    {
      label: 'Générer la broderie', primary: true, onClick: () => {
        const q = quantize(work(), o);
        const res = autoDigitize(q, o, app.design.threads.length);
        if (!res.objects.length) { toast('Aucune zone à broder trouvée', 'error'); return false; }
        if (keepBg) app.design.background = { dataUrl, x: -o.widthMm / 2, y: (-o.widthMm * ratio) / 2, w: o.widthMm, h: o.widthMm * ratio, opacity: 0.35, visible: true };
        addResult(res.objects, res.threads);
        toast(`${res.objects.length} objets créés`);
      },
    },
  ], true);
}

export async function crossStitchDialog() {
  const f = await pickFile('image/*');
  if (!f) return;
  const img = await loadImageFile(f);
  const o = { cellMm: 2.5, colors: 6, removeBg: true, widthMm: Math.round(Math.min(app.hoop.w, app.hoop.h) * 0.6), threadChart: 'Janome/Elna' };
  const pv = h('canvas', { class: 'preview pixel' });
  const update = () => {
    const cols = Math.round(o.widthMm / o.cellMm);
    const rows = Math.round((cols * img.height) / img.width);
    pv.width = cols; pv.height = rows;
    const ctx = pv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, cols, rows);
  };
  update();
  modal('Point de croix', h('div', { class: 'wizard' }, h('div', { class: 'controls' },
    numField('Largeur', o.widthMm, (v) => { o.widthMm = v; update(); }, { min: 10, max: 280, step: 1, unit: 'mm' }),
    numField('Taille d\'une croix', o.cellMm, (v) => { o.cellMm = v; update(); }, { min: 1.5, max: 6, step: 0.5, unit: 'mm' }),
    rangeField('Couleurs', o.colors, 1, 12, 1, (v) => { o.colors = v; }),
    checkField('Retirer le fond', o.removeBg, (v) => { o.removeBg = v; }),
    selectField('Fils', o.threadChart, [['Janome/Elna', 'Janome/Elna'], ['Brother', 'Brother'], ['exact', 'Couleurs exactes']], (v) => { o.threadChart = v; }),
  ), h('div', { class: 'pv' }, pv)), [
    { label: 'Annuler', onClick: () => {} },
    { label: 'Créer', primary: true, onClick: () => { const r = crossStitch(imageToData(img, 1200), o, app.design.threads.length); addResult(r.objects, r.threads); } },
  ], true);
}

export async function photoStitchDialog() {
  const f = await pickFile('image/*');
  if (!f) return;
  const img = await loadImageFile(f);
  const o = { widthMm: Math.round(Math.min(app.hoop.w, app.hoop.h) * 0.7), rowMm: 1.4, maxAmp: 1.6, invert: false, contrast: 1.3 };
  const pv = h('canvas', { class: 'preview' });
  let thread: Thread = { ...CHARTS['Janome/Elna'][0] };
  const draw = () => {
    const data = imageToData(img, 600);
    const st = photoStitch(data, o);
    const H = (o.widthMm * img.height) / img.width;
    const k = 4;
    pv.width = o.widthMm * k; pv.height = H * k;
    const ctx = pv.getContext('2d')!;
    ctx.fillStyle = app.design.fabric; ctx.fillRect(0, 0, pv.width, pv.height);
    ctx.strokeStyle = rgbOf(thread); ctx.lineWidth = 0.35 * k;
    ctx.beginPath();
    st.forEach((s, i) => { const x = (s.x + o.widthMm / 2) * k, y = (s.y + H / 2) * k; if (i === 0 || s.cmd === Cmd.JUMP) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    return st;
  };
  let t = 0;
  const upd = () => { clearTimeout(t); t = window.setTimeout(draw, 120); };
  draw();
  const colorBtn = h('button', { onclick: () => threadPicker((th) => { thread = th; colorBtn.style.background = rgbOf(th); upd(); }) }, 'Couleur du fil');
  colorBtn.style.background = rgbOf(thread); colorBtn.style.color = '#fff';
  modal('PhotoStitch (photo en lignes ondulées)', h('div', { class: 'wizard' }, h('div', { class: 'controls' },
    numField('Largeur', o.widthMm, (v) => { o.widthMm = v; upd(); }, { min: 20, max: 280, step: 1, unit: 'mm' }),
    rangeField('Écart entre lignes', o.rowMm, 0.8, 3, 0.1, (v) => { o.rowMm = v; upd(); }, (v) => v.toFixed(1) + ' mm'),
    rangeField('Amplitude max', o.maxAmp, 0.5, 3, 0.1, (v) => { o.maxAmp = v; upd(); }, (v) => v.toFixed(1) + ' mm'),
    rangeField('Contraste', o.contrast, 0.5, 3, 0.1, (v) => { o.contrast = v; upd(); }, (v) => v.toFixed(1)),
    checkField('Inverser (fil clair sur tissu foncé)', o.invert, (v) => { o.invert = v; upd(); }),
    colorBtn,
  ), h('div', { class: 'pv' }, pv)), [
    { label: 'Annuler', onClick: () => {} },
    {
      label: 'Créer', primary: true, onClick: () => {
        const st = draw();
        addResult([{ id: uid(), kind: 'stitches', name: 'PhotoStitch', color: app.design.threads.length, visible: true, locked: false, tie: true, stitches: st }], [thread]);
      },
    },
  ], true);
}

// ------------------------------------------------------------------ Image de fond

export async function backgroundDialog() {
  const f = await pickFile('image/*');
  if (!f) return;
  const img = await loadImageFile(f);
  const dataUrl = await fileToDataUrl(f);
  const w = Math.min(app.hoop.w, (app.hoop.h * img.width) / img.height) * 0.9;
  const hh = (w * img.height) / img.width;
  app.design.background = { dataUrl, x: -w / 2, y: -hh / 2, w, h: hh, opacity: 0.5, visible: true };
  app.changed();
  toast('Image de fond ajoutée — tracez par-dessus avec les outils');
}

// ------------------------------------------------------------------ Import machine

export async function importEmbroidery() {
  const f = await pickFile('.jef,.dst,.exp');
  if (!f) return;
  try {
    const imp = readMachineFile(f.name, new Uint8Array(await f.arrayBuffer()));
    imp.name ??= f.name.replace(/\.\w+$/, '');
    const base = app.design.threads.length;
    const objs = importedToObjects(imp, base);
    app.checkpoint();
    app.design.threads.push(...imp.threads);
    app.design.objects.push(...objs);
    app.changed();
    app.select(objs.map((o) => o.id));
    toast(`${f.name} importé (${objs.length} couleur(s))`);
  } catch (e) {
    toast('Import impossible : ' + (e as Error).message, 'error');
  }
}

// ------------------------------------------------------------------ Export

export function exportDialog() {
  const plan = app.plan;
  if (!plan.stitchCount) { toast('Le motif est vide', 'error'); return; }
  let fmt: ExportFormat = 'jef';
  let name = designName(app.design);
  const bb = plan.bbox!;
  const W = bb.maxX - bb.minX, H = bb.maxY - bb.minY;
  const hoop = app.hoop;
  const fits = W <= hoop.w && H <= hoop.h;
  const fitsRot = H <= hoop.w && W <= hoop.h;
  const best = HOOPS.filter((hp) => hp.id !== 'FA10' && W <= hp.w && H <= hp.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  const body = h('div', { class: 'export' },
    selectField('Format', fmt, [['jef', 'JEF — Janome / Elna (recommandé pour l\'eXpressive 830)'], ['dst', 'DST — Tajima (universel)'], ['exp', 'EXP — Melco']], (v) => { fmt = v; }),
    h('label', { class: 'field' }, h('span', {}, 'Nom du fichier'), h('input', { value: name, oninput: (e: Event) => { name = (e.target as HTMLInputElement).value; } })),
    checkField('Coupes de fil automatiques (JEF)', app.settings.jefTrims, (v) => { app.settings.jefTrims = v; }, 'Insère les commandes de coupe entre les éléments éloignés'),
    h('table', { class: 'stats' },
      h('tr', {}, h('th', {}, 'Dimensions'), h('td', {}, `${W.toFixed(1)} × ${H.toFixed(1)} mm`)),
      h('tr', {}, h('th', {}, 'Points'), h('td', {}, plan.stitchCount.toLocaleString('fr-FR'))),
      h('tr', {}, h('th', {}, 'Couleurs'), h('td', {}, String(plan.colorSeq.length))),
      h('tr', {}, h('th', {}, 'Durée estimée'), h('td', {}, `${Math.ceil(estimateMinutes(plan))} min`)),
    ),
    !fits ? h('p', { class: 'warn' }, fitsRot ? `Le motif dépasse le cercle ${hoop.name} : tournez-le de 90°.` : `Le motif dépasse le cercle ${hoop.name}${best ? ` — utilisez plutôt ${best.name}` : ' et tous les cercles de la 830'}.`) : null,
    h('p', { class: 'hint' }, 'Copiez le fichier .JEF sur une clé USB, insérez-la dans la brodeuse puis ouvrez-le depuis le menu « Clé USB » de l\'écran. Le motif est centré sur le cercle.'),
  );
  modal('Exporter pour la brodeuse', body, [
    { label: 'Annuler', onClick: () => {} },
    {
      label: 'Télécharger', primary: true, onClick: () => {
        try {
          const data = exportDesign(fmt, app.design, app.plan, { trims: app.settings.jefTrims, hoopW: hoop.w, hoopH: hoop.h });
          download(`${name || 'motif'}.${fmt}`, data);
        } catch (e) { toast('Export impossible : ' + (e as Error).message, 'error'); return false; }
      },
    },
  ]);
}

// ------------------------------------------------------------------ Rendu image (PNG / impression)

export function renderPNG(scale = 8, transparent = false): HTMLCanvasElement {
  const plan = app.plan;
  const bb = plan.bbox ?? { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  const pad = 3;
  const c = h('canvas');
  c.width = Math.ceil((bb.maxX - bb.minX + pad * 2) * scale);
  c.height = Math.ceil((bb.maxY - bb.minY + pad * 2) * scale);
  const ctx = c.getContext('2d')!;
  if (!transparent) { ctx.fillStyle = app.design.fabric; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.setTransform(scale, 0, 0, scale, (pad - bb.minX) * scale, (pad - bb.minY) * scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let prev: { x: number; y: number } | null = null;
  for (const s of plan.stitches) {
    if (s.cmd === Cmd.STITCH && prev) {
      const t = app.design.threads[s.color];
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(s.x, s.y);
      ctx.lineWidth = 0.45; ctx.strokeStyle = `rgb(${t.r * 0.5 | 0},${t.g * 0.5 | 0},${t.b * 0.5 | 0})`; ctx.stroke();
      ctx.lineWidth = 0.32; ctx.strokeStyle = `rgb(${t.r},${t.g},${t.b})`; ctx.stroke();
    }
    if (s.cmd === Cmd.STITCH || s.cmd === Cmd.JUMP) prev = s;
  }
  return c;
}

export function exportPNG() {
  renderPNG(10, true).toBlob((b) => b && download(designName(app.design) + '.png', b, 'image/png'));
}

export function printSheet() {
  const plan = app.plan;
  if (!plan.stitchCount) { toast('Le motif est vide', 'error'); return; }
  const img = renderPNG(6).toDataURL('image/png');
  const bb = plan.bbox!;
  const d: Design = app.design;
  // séquence des couleurs avec nombre de points
  const seq: { color: number; count: number }[] = [];
  for (const s of plan.stitches) {
    if (s.cmd !== Cmd.STITCH) continue;
    if (!seq.length || seq[seq.length - 1].color !== s.color) seq.push({ color: s.color, count: 0 });
    seq[seq.length - 1].count++;
  }
  const rows = seq.map((s, i) => {
    const t = d.threads[s.color];
    return `<tr><td>${i + 1}</td><td><i style="background:${hexOf(t)}"></i></td><td>${t.code}</td><td>${t.name}</td><td>${t.chart}</td><td>${s.count.toLocaleString('fr-FR')}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${d.name} — fiche de broderie</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#222}h1{margin:0 0 4px}img{max-width:100%;max-height:60vh;border:1px solid #ddd;display:block;margin:16px auto}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}i{display:inline-block;width:28px;height:16px;border:1px solid #888;border-radius:3px}
.meta{display:flex;gap:24px;flex-wrap:wrap;color:#555}</style></head><body>
<h1>${d.name}</h1><div class="meta"><span>Dimensions : ${(bb.maxX - bb.minX).toFixed(1)} × ${(bb.maxY - bb.minY).toFixed(1)} mm</span>
<span>Points : ${plan.stitchCount.toLocaleString('fr-FR')}</span><span>Changements de fil : ${plan.colorChanges}</span><span>Arrêts : ${plan.stops}</span>
<span>Cercle : ${app.hoop.name}</span><span>Durée estimée : ${Math.ceil(estimateMinutes(plan))} min</span></div>
<img src="${img}"><table><tr><th>#</th><th></th><th>Code</th><th>Fil</th><th>Nuancier</th><th>Points</th></tr>${rows}</table>
<script>setTimeout(()=>print(),300)</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { download(designName(d) + '-fiche.html', html, 'text/html'); return; }
  w.document.write(html);
  w.document.close();
}

// ------------------------------------------------------------------ Contour des formes

export function outlineDialog() {
  const selCount = app.selected().filter(outlinable).length;
  const lum = (t: Thread) => 0.299 * t.r + 0.587 * t.g + 0.114 * t.b;
  const threads = app.design.threads;
  const darkest = threads.reduce((a, t, i) => (lum(t) < lum(threads[a]) ? i : a), 0);
  const op: OutlineOptions = { scope: selCount ? 'selection' : 'all', mode: 'each', color: darkest, stitch: 'satin', width: 1, offset: 0, placement: 'end' };
  let newThread: Thread | null = null;
  const sw = h('div', { class: 'mini-swatches' });
  const renderSw = () => {
    clear(sw);
    threads.forEach((t, i) => sw.appendChild(h('button', { class: !newThread && op.color === i ? 'on' : '', title: `${t.code} ${t.name}`, style: { background: rgbOf(t) }, onclick: () => { op.color = i; newThread = null; renderSw(); } })));
    if (newThread) sw.appendChild(h('button', { class: 'on', title: `${newThread.code} ${newThread.name}`, style: { background: rgbOf(newThread) } }));
    sw.appendChild(h('button', { title: 'Autre fil…', onclick: () => threadPicker((t) => { newThread = t; renderSw(); }) }, '+'));
  };
  renderSw();
  const widthBox = h('div', {});
  const renderW = () => {
    clear(widthBox);
    if (op.stitch === 'satin') widthBox.appendChild(numField('Épaisseur', op.width, (v) => { op.width = v; }, { min: 0.6, max: 8, step: 0.1, unit: 'mm', title: 'Fin : 0,8–1,2 mm ; bordure marquée : 2–4 mm' }));
  };
  renderW();
  modal('Ajouter un contour', h('div', { class: 'controls' },
    selectField('Formes', op.scope, [['selection', `La sélection (${selCount} forme${selCount > 1 ? 's' : ''})`], ['all', 'Toutes les formes du motif']], (v) => { op.scope = v; }),
    selectField('Contour', op.mode, [['each', 'Autour de chaque forme'], ['union', 'Autour de l’ensemble (silhouette)']], (v) => { op.mode = v; }),
    h('label', { class: 'field' }, h('span', {}, 'Couleur'), sw),
    selectField('Point', op.stitch, [['satin', 'Satin'], ['triple', 'Point triple'], ['simple', 'Point avant simple']], (v) => { op.stitch = v; renderW(); }),
    widthBox,
    numField('Décalage vers l’extérieur', op.offset, (v) => { op.offset = v; }, { min: 0, max: 20, step: 0.5, unit: 'mm', title: '0 = sur le bord de la forme ; plus = effet « écho » autour' }),
    selectField('Ordre de broderie', op.placement, [['end', 'Tous les contours à la fin (finition)'], ['after', 'Juste après chaque forme']], (v) => { op.placement = v; }),
  ), [
    { label: 'Annuler', onClick: () => {} },
    {
      label: 'Ajouter', primary: true, onClick: () => {
        if (op.scope === 'selection' && !selCount) { toast('Sélectionnez au moins une forme', 'error'); return false; }
        if (newThread) {
          const nt = newThread;
          const i = threads.findIndex((t) => t.code === nt.code && t.chart === nt.chart && t.r === nt.r);
          if (i >= 0) op.color = i; else { threads.push(nt); op.color = threads.length - 1; }
        }
        const n = addOutlines(op);
        if (n) toast(`${n} contour(s) ajouté(s)`);
      },
    },
  ]);
}

// ------------------------------------------------------------------ Monogramme

export function monogramDialog() {
  const o = { letters: 'ABC', font: 'cinzel', frame: 'ellipse' as ShapeKind | 'none', size: 60, frameWidth: 2.5 };
  modal('Monogramme', h('div', { class: 'controls' },
    h('label', { class: 'field' }, h('span', {}, 'Initiales'), h('input', { value: o.letters, maxLength: 4, oninput: (e: Event) => { o.letters = (e.target as HTMLInputElement).value; } })),
    selectField('Police', o.font, allFonts().map((f) => [f.id, f.name] as [string, string]), (v) => { o.font = v; }),
    selectField('Cadre', o.frame, [['ellipse', 'Cercle'], ['rect', 'Carré'], ['polygon', 'Hexagone'], ['heart', 'Cœur'], ['flower', 'Fleur'], ['star', 'Étoile'], ['none', 'Aucun']], (v) => { o.frame = v; }),
    numField('Taille du cadre', o.size, (v) => { o.size = v; }, { min: 20, max: 200, step: 1, unit: 'mm' }),
    numField('Largeur du satin', o.frameWidth, (v) => { o.frameWidth = v; }, { min: 1, max: 8, step: 0.5, unit: 'mm' }),
  ), [
    { label: 'Annuler', onClick: () => {} },
    {
      label: 'Créer', primary: true, onClick: () => {
        const objs: EmbObject[] = [];
        const t = makeText(o.letters, 0, 0, app.currentColor);
        t.font = o.font; t.size = o.size * (o.letters.length > 2 ? 0.28 : 0.38); t.spacing = 1;
        objs.push(t);
        if (o.frame !== 'none') {
          const pts = shapePoints(o.frame, { x: 0, y: 0 }, o.size, o.size);
          const s = makeSatin(pts, o.frameWidth, true, app.currentColor);
          s.name = 'Cadre';
          objs.push(s);
        }
        app.addObjects(objs);
      },
    },
  ]);
}

// ------------------------------------------------------------------ Aide

export function helpDialog() {
  const k = (keys: string, what: string) => h('tr', {}, h('td', {}, h('kbd', {}, keys)), h('td', {}, what));
  modal('Aide', h('div', { class: 'help' },
    h('h3', {}, 'Démarrer'),
    h('ol', {},
      h('li', {}, 'Choisissez le cercle (en haut) : SQ14b, RE20b, SQ20b ou RE28b pour l\'eXpressive 830.'),
      h('li', {}, 'Créez des objets : formes, texte, tracés (point avant, satin, remplissage, appliqué), ou importez une image (Assistants → Image → Broderie).'),
      h('li', {}, 'Réglez chaque objet dans le panneau de droite (densité, angle, sous-couche, compensation…).'),
      h('li', {}, 'Vérifiez avec le simulateur, puis Exporter → JEF et copiez le fichier sur une clé USB.'),
    ),
    h('h3', {}, 'Tracer'),
    h('p', {}, 'Cliquez pour poser des points, double-cliquez (ou clic droit / Entrée) pour terminer. Maintenez le bouton enfoncé et glissez pour dessiner à main levée. Maj = angles de 45°. Cliquez sur le premier point pour fermer.'),
    h('h3', {}, 'Raccourcis'),
    h('table', {},
      k('V', 'Sélection'), k('N', 'Édition des nœuds (double-clic sur un segment = ajouter un point, Suppr = retirer)'),
      k('R / S / F / A', 'Point avant / Satin / Remplissage / Appliqué'), k('T', 'Texte'), k('H', 'Formes'), k('M', 'Mesure'),
      k('Espace + glisser', 'Déplacer la vue'), k('Molette', 'Zoom'), k('0', 'Ajuster au cercle'),
      k('Ctrl+Z / Ctrl+Y', 'Annuler / Rétablir'), k('Ctrl+C / X / V / D', 'Copier / Couper / Coller / Dupliquer'),
      k('Flèches', 'Déplacer de 0,5 mm (Maj : 5 mm)'), k('Alt + glisser', 'Dupliquer en déplaçant'), k('Suppr', 'Supprimer'),
      k('Ctrl+S', 'Enregistrer le projet'), k('Ctrl+E', 'Exporter'),
    ),
    h('h3', {}, 'Conseils de broderie'),
    h('ul', {},
      h('li', {}, 'Satin : idéal entre 1,5 et 8 mm de large. Au-delà, utilisez un remplissage tatami.'),
      h('li', {}, 'Densité : 0,4 mm convient à la plupart des tissus ; augmentez l\'espacement (0,45–0,5) pour les tissus fins.'),
      h('li', {}, 'Compensation de traction : 0,15–0,3 mm, davantage sur les tissus extensibles (jersey).'),
      h('li', {}, 'Texte : au moins 5 mm de haut en satin ; en dessous, choisissez « point avant ».'),
      h('li', {}, 'Ordre de broderie : de l\'arrière-plan vers le premier plan ; « Optimiser les couleurs » réduit les changements de fil.'),
    ),
  ), [], true);
}

export { rgbOf };
