// Boîtes de dialogue : nuancier, assistants image, export, impression, monogramme, aide.
import { app } from './state';
import { checkField, clear, download, h, modal, numField, pickFile, rangeField, selectField, toast } from './dom';
import { CHARTS, hexOf, rgbOf, threadFromHex } from '../core/threads';
import type { Design, EmbObject, Thread } from '../core/types';
import { Cmd } from '../core/types';
import { autoDigitize, crossStitch, defaultAuto, imageToData, photoStitch, quantize, type AutoOptions } from '../digitize/autodigitize';
import { exportDesign, importedToObjects, readMachineFile, type ExportFormat } from '../formats';
import { estimateMinutes } from '../core/plan';
import { HOOPS, makeSatin, makeText, shapePoints, uid, type ShapeKind } from '../core/defaults';
import { allFonts } from '../core/text';
import { designName } from '../formats/encode';

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
  const o: AutoOptions = { ...defaultAuto, widthMm: Math.round(Math.min(app.hoop.w, app.hoop.h) * 0.7) };
  const ratio = img.height / img.width;
  const preview = h('canvas', { class: 'preview' });
  const info = h('div', { class: 'hint' });
  const swatches = h('div', { class: 'swatches' });
  let keepBg = false;
  let timer = 0;
  const work = () => imageToData(img, Math.min(700, Math.max(150, Math.round(o.widthMm / 0.25))));
  const update = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const data = work();
      const q = quantize(data, o);
      preview.width = q.w; preview.height = q.h;
      const ctx = preview.getContext('2d')!;
      const out = ctx.createImageData(q.w, q.h);
      for (let i = 0; i < q.w * q.h; i++) {
        const l = q.labels[i];
        const c = l >= 0 ? q.palette[l] : ((i % q.w) >> 3) % 2 === (((i / q.w) | 0) >> 3) % 2 ? { r: 235, g: 235, b: 235 } : { r: 250, g: 250, b: 250 };
        out.data[i * 4] = c.r; out.data[i * 4 + 1] = c.g; out.data[i * 4 + 2] = c.b; out.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      clear(swatches);
      const used = new Set(Array.from(q.labels).filter((l) => l >= 0));
      for (const l of used) swatches.appendChild(h('i', { style: { background: rgbOf({ ...q.palette[l], name: '', code: '', chart: '' }) } }));
      info.textContent = `${o.widthMm} × ${Math.round(o.widthMm * ratio)} mm — ${used.size} couleur(s) brodée(s)`;
    }, 150);
  };
  const controls = h('div', { class: 'controls' },
    numField('Largeur', o.widthMm, (v) => { o.widthMm = v; update(); }, { min: 10, max: 300, step: 1, unit: 'mm' }),
    rangeField('Couleurs', o.colors, 1, 16, 1, (v) => { o.colors = v; update(); }),
    checkField('Retirer le fond', o.removeBg, (v) => { o.removeBg = v; update(); }, 'La couleur dominante sur les bords de l\'image n\'est pas brodée'),
    checkField('Réduire le bruit', o.denoise, (v) => { o.denoise = v; update(); }),
    rangeField('Lissage des contours', o.smooth, 0, 3, 1, (v) => { o.smooth = v; }),
    numField('Ignorer les zones <', o.minAreaMm2, (v) => { o.minAreaMm2 = v; update(); }, { min: 0, max: 50, step: 0.5, unit: 'mm²' }),
    numField('Satin si plus fin que', o.satinWidth, (v) => { o.satinWidth = v; }, { min: 0, max: 10, step: 0.5, unit: 'mm', title: 'Les zones étroites sont brodées en satin, les larges en tatami' }),
    checkField('Contour en point triple (couleur foncée)', o.outline, (v) => { o.outline = v; }),
    selectField('Fils', o.threadChart, [['Janome/Elna', 'Nuancier Janome/Elna'], ['Brother', 'Nuancier Brother'], ['exact', 'Couleurs exactes de l\'image']], (v) => { o.threadChart = v; }),
    checkField('Garder l\'image en fond (pour retoucher)', keepBg, (v) => { keepBg = v; }),
    h('p', { class: 'hint' }, 'Conseil : les logos et dessins aux aplats francs donnent les meilleurs résultats. Pour une photo, essayez PhotoStitch.'),
  );
  update();
  modal('Image → Broderie (numérisation automatique)', h('div', { class: 'wizard' }, controls, h('div', { class: 'pv' }, preview, swatches, info)), [
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
