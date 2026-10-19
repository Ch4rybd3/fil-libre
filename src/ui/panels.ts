// Panneaux : barre d'outils, options d'outil, propriétés, couleurs, séquence, barre d'état.
import { app, type Tool } from './state';
import { add, checkField, clear, h, numField, rangeField, selectField } from './dom';
import { rgbOf, threadFromHex } from '../core/threads';
import type { EmbObject, FillParams, SatinParams, Underlay } from '../core/types';
import { allFonts, onFontLoaded } from '../core/text';
import * as act from './actions';
import { threadPicker } from './dialogs';
import { toolOpts } from './tools';
import { estimateMinutes } from '../core/plan';

const ICONS: Record<string, string> = {
  select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  nodes: '<path d="M4 18L10 6l10 8" fill="none"/><rect x="2" y="16" width="4" height="4"/><rect x="8" y="4" width="4" height="4"/><rect x="18" y="12" width="4" height="4"/>',
  run: '<path d="M3 17l2-2m2-2l2-2m2-2l2-2m2-2l2-2m2-2l1-1" fill="none" stroke-linecap="round"/>',
  satin: '<path d="M4 18L7 7M7 18l3-11M10 18l3-11M13 18l3-11M16 18l3-11" fill="none"/>',
  fill: '<path d="M3 6h18M3 10h18M3 14h18M3 18h18" fill="none" stroke-dasharray="4 2"/>',
  applique: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke-dasharray="2 2"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  shape: '<circle cx="9" cy="9" r="6" fill="none"/><rect x="11" y="11" width="10" height="10" fill="none"/>',
  text: '<path d="M5 5h14M12 5v15M8 20h8" fill="none"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z" fill="none"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" fill="none"/>',
  pan: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" fill="none"/>',
};
const icon = (k: string) => `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.6" fill="currentColor">${ICONS[k]}</svg>`;

export function toolbar(el: HTMLElement) {
  const tools: [Tool, string, string][] = [
    ['select', 'Sélection (V)', 'V'], ['nodes', 'Éditer les nœuds (N)', 'N'], ['pan', 'Main (Espace)', ''],
    ['run', 'Point avant / triple (R)', 'R'], ['satin', 'Colonne satin (S)', 'S'], ['fill', 'Remplissage (F)', 'F'],
    ['applique', 'Appliqué (A)', 'A'], ['shape', 'Formes (H)', 'H'], ['text', 'Texte (T)', 'T'], ['measure', 'Mesurer (M)', 'M'],
  ];
  const btns = tools.map(([t, title]) => {
    const b = h('button', { class: 'tool', title, 'data-tool': t, html: icon(t), onclick: () => app.setTool(t) });
    return b;
  });
  const sep = [2, 7];
  btns.forEach((b, i) => { el.appendChild(b); if (sep.includes(i)) el.appendChild(h('hr')); });
  const sync = () => btns.forEach((b) => b.classList.toggle('active', b.dataset.tool === app.tool));
  app.on('tool', sync);
  sync();
}

export function toolOptions(el: HTMLElement) {
  const render = () => {
    clear(el);
    const t = app.tool;
    const color = h('button', { class: 'cur-color', title: 'Couleur des nouveaux objets', onclick: () => document.querySelector<HTMLElement>('.colors')?.scrollIntoView() },
      h('i', { style: { background: app.design.threads[app.currentColor] ? rgbOf(app.design.threads[app.currentColor]) : '#000' } }),
      app.design.threads[app.currentColor]?.name ?? '');
    const hint = (s: string) => h('span', { class: 'hint' }, s);
    if (['run', 'satin', 'fill', 'applique'].includes(t)) {
      add(el, color,
        selectField('Tracé', toolOpts.curve ? 'c' : 'l', [['l', 'Droites'], ['c', 'Courbes']], (v) => { toolOpts.curve = v === 'c'; app.emit('redraw'); }),
        t === 'satin' ? numField('Largeur', toolOpts.satinWidth, (v) => (toolOpts.satinWidth = v), { min: 0.8, max: 12, step: 0.5, unit: 'mm' }) : null,
        checkField('Grille 1 mm', toolOpts.snap, (v) => (toolOpts.snap = v)),
        hint('Clic = point · glisser = main levée · double-clic / Entrée = terminer · Échap = annuler'));
    } else if (t === 'shape') {
      add(el, color,
        selectField('Forme', app.settings.shapeKind, [['ellipse', 'Cercle / ellipse'], ['rect', 'Rectangle'], ['polygon', 'Hexagone'], ['star', 'Étoile'], ['heart', 'Cœur'], ['flower', 'Fleur'], ['drop', 'Goutte'], ['arrow', 'Flèche']], (v) => (app.settings.shapeKind = v)),
        selectField('Broder en', app.settings.shapeAs, [['fill', 'Remplissage'], ['satin', 'Bordure satin'], ['run', 'Point avant'], ['applique', 'Appliqué']], (v) => (app.settings.shapeAs = v)),
        hint('Glisser pour dessiner · Maj = proportions · Alt = depuis le centre'));
    } else if (t === 'text') add(el, color, hint('Cliquez sur le cercle pour placer un texte'));
    else if (t === 'nodes') add(el, hint('Glisser un nœud · double-clic sur un trait = ajouter · Suppr = retirer le nœud survolé'));
    else if (t === 'measure') add(el, hint('Glisser pour mesurer une distance'));
    else add(el, hint('Clic = sélectionner · Maj = ajouter · glisser = déplacer · poignées = taille / rotation · double-clic = nœuds'));
  };
  app.on('tool', render);
  app.on('color', render);
  render();
}

// ------------------------------------------------------------------ Propriétés

const UNDERLAYS: [Underlay, string][] = [
  ['none', 'Aucune'], ['center', 'Ligne centrale'], ['edge', 'Contour'], ['zigzag', 'Zigzag'], ['tatami', 'Tatami'], ['edge+tatami', 'Contour + tatami'], ['edge+zigzag', 'Contour + zigzag'],
];

function edit(fn: () => void) { app.commit(fn); }

function fillFields(p: FillParams, apply: (f: (p: FillParams) => void) => void, withPattern = true) {
  return [
    withPattern ? selectField('Motif', p.pattern, [['tatami', 'Tatami'], ['satin', 'Satin (zones étroites)'], ['contour', 'Contour (concentrique)']], (v) => apply((q) => (q.pattern = v as FillParams['pattern']))) : null,
    rangeField('Angle', p.angle, 0, 179, 1, (v) => apply((q) => (q.angle = v)), (v) => v + '°'),
    numField('Espacement des rangs', p.spacing, (v) => apply((q) => (q.spacing = v)), { min: 0.2, max: 3, step: 0.05, unit: 'mm', title: 'Densité : plus petit = plus dense (0,35–0,45 typique)' }),
    numField('Longueur de point', p.length, (v) => apply((q) => (q.length = v)), { min: 1, max: 7, step: 0.1, unit: 'mm' }),
    rangeField('Décalage du motif', p.offset, 0, 0.9, 0.01, (v) => apply((q) => (q.offset = v)), (v) => Math.round(v * 100) + ' %'),
    numField('Compensation de traction', p.pullComp, (v) => apply((q) => (q.pullComp = v)), { min: 0, max: 1.5, step: 0.05, unit: 'mm' }),
    selectField('Sous-couche', p.underlay, UNDERLAYS, (v) => apply((q) => (q.underlay = v))),
    checkField('Contour en point avant', p.edgeRun, (v) => apply((q) => (q.edgeRun = v))),
  ];
}

function satinFields(p: SatinParams, apply: (f: (p: SatinParams) => void) => void) {
  return [
    numField('Densité (espacement)', p.density, (v) => apply((q) => (q.density = v)), { min: 0.15, max: 2, step: 0.05, unit: 'mm' }),
    numField('Compensation de traction', p.pullComp, (v) => apply((q) => (q.pullComp = v)), { min: 0, max: 1.5, step: 0.05, unit: 'mm' }),
    selectField('Sous-couche', p.underlay, UNDERLAYS.filter(([u]) => u !== 'tatami' && u !== 'edge+tatami'), (v) => apply((q) => (q.underlay = v))),
    numField('Fractionner au-delà de', p.maxLength, (v) => apply((q) => (q.maxLength = v)), { min: 3, max: 12.7, step: 0.5, unit: 'mm', title: 'Les points satin plus longs sont fractionnés (satin divisé)' }),
  ];
}

function colorSelect(o: EmbObject[]) {
  const cur = o[0].color;
  const wrap = h('div', { class: 'field' }, h('span', {}, 'Couleur'));
  const row = h('div', { class: 'mini-swatches' });
  app.design.threads.forEach((t, i) => row.appendChild(h('button', {
    class: i === cur ? 'on' : '', title: `${t.name} (${t.code})`, style: { background: rgbOf(t) },
    onclick: () => { act.setColor(i); },
  })));
  wrap.appendChild(row);
  return wrap;
}

export function properties(el: HTMLElement) {
  let lastKey = '';
  const render = (force = false) => {
    const sel = app.selected();
    const key = sel.map((o) => o.id).join(',') + '|' + app.design.threads.length;
    if (!force && key === lastKey && el.contains(document.activeElement)) return;
    lastKey = key;
    clear(el);
    if (!sel.length) {
      add(el, h('h3', {}, 'Motif'),
        h('label', { class: 'field' }, h('span', {}, 'Nom'), h('input', { value: app.design.name, onchange: (e: Event) => edit(() => (app.design.name = (e.target as HTMLInputElement).value)) })),
        h('label', { class: 'field' }, h('span', {}, 'Couleur du tissu'), h('input', { type: 'color', value: app.design.fabric, oninput: (e: Event) => { app.design.fabric = (e.target as HTMLInputElement).value; app.emit('redraw'); } })),
        numField('Couper les sauts >', app.settings.trimDistance, (v) => { app.settings.trimDistance = v; app.changed(); }, { min: 0.5, max: 20, step: 0.5, unit: 'mm' }),
        bgFields(),
        h('p', { class: 'hint' }, 'Sélectionnez un objet pour régler ses points. Astuce : double-clic sur un objet pour éditer ses nœuds.'));
      return;
    }
    const o = sel[0];
    const all = (f: (x: EmbObject) => void) => edit(() => sel.forEach((x) => !x.locked && f(x)));
    add(el, h('h3', {}, sel.length > 1 ? `${sel.length} objets` : kindName(o)));
    if (sel.length === 1) add(el, h('label', { class: 'field' }, h('span', {}, 'Nom'), h('input', { value: o.name, onchange: (e: Event) => edit(() => (o.name = (e.target as HTMLInputElement).value)) })));
    add(el, colorSelect(sel));
    const bb = app.selectionBBox();
    if (bb) {
      const W = bb.maxX - bb.minX, H = bb.maxY - bb.minY;
      let lock = true;
      add(el, h('div', { class: 'row2' },
        numField('L', W, (v) => act.resizeTo(v, lock ? (H * v) / W : H), { min: 1, step: 0.5, unit: 'mm' }),
        numField('H', H, (v) => act.resizeTo(lock ? (W * v) / H : W, v), { min: 1, step: 0.5, unit: 'mm' })),
        checkField('Conserver les proportions', lock, (v) => (lock = v)));
    }
    if (sel.length === 1) {
      switch (o.kind) {
        case 'run':
          add(el, 
            numField('Longueur de point', o.run.length, (v) => edit(() => (o.run.length = v)), { min: 0.5, max: 7, step: 0.1, unit: 'mm' }),
            selectField('Passages', String(o.run.repeats), [['1', 'Simple'], ['3', 'Triple (point renforcé)'], ['5', 'Quintuple']], (v) => edit(() => (o.run.repeats = +v as 1 | 3 | 5))),
            checkField('Fermé', o.closed, (v) => edit(() => (o.closed = v))));
          break;
        case 'satin':
          add(el, 
            numField('Largeur', o.width, (v) => edit(() => (o.width = v)), { min: 0.5, max: 15, step: 0.25, unit: 'mm' }),
            ...satinFields(o.satin, (f) => edit(() => f(o.satin))),
            checkField('Fermé', o.closed, (v) => edit(() => (o.closed = v))));
          break;
        case 'fill':
          add(el, ...fillFields(o.fill, (f) => all((x) => x.kind === 'fill' && f(x.fill))));
          break;
        case 'applique':
          add(el, 
            h('p', { class: 'hint' }, 'Séquence : ligne de placement → arrêt (posez le tissu) → fixation → arrêt (découpez) → bordure satin.'),
            numField('Largeur de la bordure', o.borderWidth, (v) => edit(() => (o.borderWidth = v)), { min: 1, max: 8, step: 0.25, unit: 'mm' }),
            ...satinFields(o.satin, (f) => edit(() => f(o.satin))));
          break;
        case 'text': add(el, ...textFields(o)); break;
        case 'stitches':
          add(el, h('p', { class: 'hint' }, `${o.stitches.filter((s) => s.cmd === 0).length.toLocaleString('fr-FR')} points (motif importé ou généré). Déplacer, tourner, redimensionner et changer la couleur sont possibles.`));
          break;
      }
    } else if (sel.every((x) => x.kind === 'fill')) {
      add(el, ...fillFields((o as Extract<EmbObject, { kind: 'fill' }>).fill, (f) => all((x) => x.kind === 'fill' && f(x.fill))));
    }
    add(el, 
      checkField('Points d\'arrêt', o.tie, (v) => all((x) => (x.tie = v))),
      h('h4', {}, 'Actions'),
      h('div', { class: 'actions' },
        btn('Dupliquer', act.duplicate), btn('Supprimer', () => app.deleteSelected()),
        btn('Miroir ↔', () => act.mirror('h')), btn('Miroir ↕', () => act.mirror('v')),
        btn('↻ 90°', () => act.rotate(90)), btn('↺ 90°', () => act.rotate(-90)),
        btn('Centrer', act.centerOnHoop),
        btn('Premier', () => act.order('first')), btn('Dernier', () => act.order('last')),
      ),
      h('h4', {}, 'Transformer'),
      h('div', { class: 'actions' },
        btn('→ Remplissage', () => act.convert('fill')), btn('→ Satin', () => act.convert('satin')),
        btn('→ Point avant', () => act.convert('run')), btn('→ Appliqué', () => act.convert('applique')),
        btn('Bordure satin', () => act.outlineOffset(1.5, 'satin', 2.5)), btn('Contour décalé', () => act.outlineOffset(2, 'run')),
        btn('Combiner', act.combine), btn('Séparer', act.breakApart),
        btn('Retirer chevauchements', act.removeOverlaps),
      ),
      sel.length > 1 ? h('div', {}, h('h4', {}, 'Aligner'), h('div', { class: 'actions' },
        btn('Gauche', () => act.align('left')), btn('Centre H', () => act.align('hcenter')), btn('Droite', () => act.align('right')),
        btn('Haut', () => act.align('top')), btn('Milieu V', () => act.align('vcenter')), btn('Bas', () => act.align('bottom')))) : null,
    );
  };
  app.on('select', () => render(true));
  app.on('change', () => render());
  app.on('focus-text', () => { render(true); setTimeout(() => { const ta = el.querySelector('textarea'); ta?.focus(); ta?.select(); }, 30); });
  render(true);
}

function btn(label: string, f: () => void) { return h('button', { onclick: f }, label); }

function kindName(o: EmbObject) {
  return { run: 'Point avant', satin: 'Colonne satin', fill: 'Remplissage', applique: 'Appliqué', text: 'Texte', stitches: 'Points' }[o.kind];
}

function textFields(o: Extract<EmbObject, { kind: 'text' }>) {
  const ta = h('textarea', { rows: 2, value: o.text });
  let t = 0;
  ta.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => edit(() => (o.text = ta.value || ' ')), 250); });
  const fonts = allFonts();
  const cats = [...new Set(fonts.map((f) => f.category))];
  const fsel = h('select', {}, cats.map((c) => h('optgroup', { label: c }, fonts.filter((f) => f.category === c).map((f) => h('option', { value: f.id, selected: f.id === o.font }, f.name)))));
  fsel.addEventListener('change', () => edit(() => (o.font = fsel.value)));
  return [
    h('label', { class: 'field' }, h('span', {}, 'Texte'), ta),
    h('label', { class: 'field' }, h('span', {}, 'Police'), fsel),
    h('button', { class: 'linkbtn', onclick: () => document.dispatchEvent(new CustomEvent('load-font')) }, '+ Charger une police (.ttf / .otf)'),
    numField('Hauteur des majuscules', o.size, (v) => edit(() => (o.size = v)), { min: 3, max: 200, step: 0.5, unit: 'mm' }),
    numField('Interlettrage', o.spacing, (v) => edit(() => (o.spacing = v)), { min: -10, max: 30, step: 0.1, unit: 'mm' }),
    selectField('Alignement', o.align, [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], (v) => edit(() => (o.align = v))),
    numField('Interligne', o.lineHeight, (v) => edit(() => (o.lineHeight = v)), { min: 0.5, max: 3, step: 0.05 }),
    rangeField('Arc', o.arc, -300, 300, 5, (v) => { clearTimeout(t); t = window.setTimeout(() => edit(() => (o.arc = v)), 120); }, (v) => (v ? v + '°' : 'droit')),
    numField('Rotation', o.rotation, (v) => edit(() => (o.rotation = v)), { min: -360, max: 360, step: 1, unit: '°' }),
    selectField('Point', o.style, [['satin', 'Satin'], ['fill', 'Remplissage tatami'], ['run', 'Point avant (petits textes)']], (v) => edit(() => {
      o.style = v;
      if (v === 'fill') { o.fill.spacing = 0.4; o.fill.angle = 45; o.fill.underlay = 'edge+tatami'; }
      if (v === 'satin') { o.fill.spacing = 0.38; o.fill.angle = 80; o.fill.underlay = 'center'; }
    })),
    o.style !== 'run' ? h('div', {},
      rangeField('Angle des points', o.fill.angle, 0, 179, 1, (v) => { clearTimeout(t); t = window.setTimeout(() => edit(() => (o.fill.angle = v)), 120); }, (v) => v + '°'),
      numField('Densité', o.fill.spacing, (v) => edit(() => (o.fill.spacing = v)), { min: 0.2, max: 2, step: 0.02, unit: 'mm' }),
      numField('Compensation', o.fill.pullComp, (v) => edit(() => (o.fill.pullComp = v)), { min: 0, max: 1, step: 0.05, unit: 'mm' }),
      selectField('Sous-couche', o.fill.underlay, UNDERLAYS, (v) => edit(() => (o.fill.underlay = v))),
      checkField('Contour en point avant', o.outline, (v) => edit(() => (o.outline = v))),
    ) : numField('Longueur de point', o.run.length, (v) => edit(() => (o.run.length = v)), { min: 0.8, max: 5, step: 0.1, unit: 'mm' }),
  ];
}

function bgFields() {
  const bg = app.design.background;
  if (!bg) return null;
  return h('div', { class: 'bg' }, h('h4', {}, 'Image de fond'),
    checkField('Visible', bg.visible, (v) => { bg.visible = v; app.emit('redraw'); }),
    rangeField('Opacité', bg.opacity, 0.05, 1, 0.05, (v) => { bg.opacity = v; app.emit('redraw'); }, (v) => Math.round(v * 100) + ' %'),
    numField('Largeur', bg.w, (v) => { const k = v / bg.w; bg.h *= k; bg.x = bg.x * k; bg.y = bg.y * k; bg.w = v; app.emit('redraw'); }, { min: 5, max: 400, step: 1, unit: 'mm' }),
    h('div', { class: 'row2' },
      numField('X', bg.x, (v) => { bg.x = v; app.emit('redraw'); }, { step: 1, unit: 'mm' }),
      numField('Y', bg.y, (v) => { bg.y = v; app.emit('redraw'); }, { step: 1, unit: 'mm' })),
    h('button', { onclick: () => { app.design.background = undefined; app.changed(); } }, 'Retirer l\'image'));
}

// ------------------------------------------------------------------ Couleurs

export function colors(el: HTMLElement) {
  const render = () => {
    clear(el);
    const usage = new Map<number, number>();
    for (const o of app.design.objects) usage.set(o.color, (usage.get(o.color) ?? 0) + 1);
    add(el, h('h3', {}, 'Fils du motif', h('button', { class: 'icon', title: 'Ajouter un fil', onclick: () => threadPicker((t) => { app.commit(() => { app.currentColor = app.addThread(t); }); app.emit('color'); }) }, '+')));
    const list = h('div', { class: 'thread-list' });
    app.design.threads.forEach((t, i) => {
      const n = usage.get(i) ?? 0;
      list.appendChild(h('div', { class: 'thread-row' + (i === app.currentColor ? ' cur' : ''), onclick: () => { app.currentColor = i; if (app.sel.size) act.setColor(i); app.emit('color'); render(); } },
        h('i', { style: { background: rgbOf(t) } }),
        h('span', { class: 'tn' }, h('b', {}, t.code), ' ', t.name, h('small', {}, t.chart)),
        h('em', {}, n ? String(n) : ''),
        h('button', { class: 'icon', title: 'Changer ce fil (tous les objets suivent)', onclick: (e: Event) => { e.stopPropagation(); threadPicker((nt) => app.commit(() => { app.design.threads[i] = nt; })); } }, '✎'),
        !n && app.design.threads.length > 1 ? h('button', { class: 'icon', title: 'Retirer', onclick: (e: Event) => {
          e.stopPropagation();
          app.commit(() => {
            app.design.threads.splice(i, 1);
            for (const o of app.design.objects) if (o.color > i) o.color--;
            if (app.currentColor >= app.design.threads.length) app.currentColor = 0;
          });
        } }, '✕') : null,
      ));
    });
    add(el, list,
      h('div', { class: 'actions' },
        h('button', { onclick: act.optimizeColors, title: 'Regrouper les objets de même couleur' }, 'Optimiser les couleurs'),
        h('label', { class: 'colorbtn', title: 'Ajouter une couleur libre' }, '+ Couleur libre', h('input', { type: 'color', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; app.commit(() => { app.currentColor = app.addThread(threadFromHex(v)); }); app.emit('color'); } }))));
  };
  app.on('change', render);
  app.on('color', render);
  render();
}

// ------------------------------------------------------------------ Séquence

export function sequence(el: HTMLElement) {
  let dragId: string | null = null;
  const render = () => {
    clear(el);
    add(el, h('h3', {}, 'Ordre de broderie', h('small', {}, `${app.design.objects.length} objet(s)`)));
    const list = h('div', { class: 'seq' });
    app.design.objects.forEach((o, i) => {
      const t = app.design.threads[o.color];
      const row = h('div', {
        class: 'seq-row' + (app.sel.has(o.id) ? ' sel' : '') + (o.visible ? '' : ' hidden'), draggable: true,
        onclick: (e: MouseEvent) => {
          if (e.shiftKey && app.sel.size) {
            const idx = app.design.objects.findIndex((x) => app.sel.has(x.id));
            const [a, b] = [Math.min(idx, i), Math.max(idx, i)];
            app.select(app.design.objects.slice(a, b + 1).map((x) => x.id));
          } else app.select([o.id], e.ctrlKey || e.metaKey);
        },
        ondragstart: () => { dragId = o.id; },
        ondragover: (e: DragEvent) => { e.preventDefault(); row.classList.add('over'); },
        ondragleave: () => row.classList.remove('over'),
        ondrop: (e: DragEvent) => {
          e.preventDefault();
          if (!dragId || dragId === o.id) return;
          app.commit(() => {
            const arr = app.design.objects;
            const from = arr.findIndex((x) => x.id === dragId);
            const [m] = arr.splice(from, 1);
            arr.splice(arr.findIndex((x) => x.id === o.id) + (from < i ? 1 : 0), 0, m);
          });
        },
      },
        h('span', { class: 'num' }, String(i + 1)),
        h('i', { style: { background: t ? rgbOf(t) : '#000' } }),
        h('span', { class: 'nm' }, o.name),
        h('button', { class: 'icon', title: o.visible ? 'Masquer' : 'Afficher', onclick: (e: Event) => { e.stopPropagation(); app.commit(() => (o.visible = !o.visible)); } }, o.visible ? '👁' : '◌'),
        h('button', { class: 'icon', title: o.locked ? 'Déverrouiller' : 'Verrouiller', onclick: (e: Event) => { e.stopPropagation(); app.commit(() => (o.locked = !o.locked)); } }, o.locked ? '🔒' : '🔓'),
      );
      list.appendChild(row);
    });
    add(el, list);
    // faire défiler la liste seule (pas tout le panneau latéral)
    const selRow = list.querySelector<HTMLElement>('.seq-row.sel');
    if (selRow) {
      const top = selRow.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + selRow.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 2;
    }
  };
  app.on('change', render);
  app.on('select', render);
  render();
}

// ------------------------------------------------------------------ Barre d'état

export function statusBar(el: HTMLElement) {
  const cur = h('span', {}), size = h('span', {}), pts = h('span', {}), col = h('span', {}), time = h('span', {}), zoom = h('span', {}), warn = h('span', { class: 'warn' });
  add(el, cur, size, pts, col, time, warn, zoom);
  const upd = () => {
    const p = app.plan;
    const bb = p.bbox;
    const W = bb ? bb.maxX - bb.minX : 0, H = bb ? bb.maxY - bb.minY : 0;
    size.textContent = bb ? `${W.toFixed(1)} × ${H.toFixed(1)} mm` : '—';
    pts.textContent = `${p.stitchCount.toLocaleString('fr-FR')} points`;
    col.textContent = `${p.colorSeq.length} couleur(s) · ${p.trims} coupe(s)${p.stops ? ` · ${p.stops} arrêt(s)` : ''}`;
    time.textContent = `≈ ${Math.ceil(estimateMinutes(p))} min`;
    const hp = app.hoop;
    const out = bb && (bb.minX < -hp.w / 2 || bb.maxX > hp.w / 2 || bb.minY < -hp.h / 2 || bb.maxY > hp.h / 2);
    warn.textContent = out ? '⚠ dépasse le cercle' : '';
  };
  app.on('change', upd);
  app.on('redraw', upd);
  app.on('cursor', () => { const c = app.cursor; if (c) cur.textContent = `x ${c.x.toFixed(1)}  y ${c.y.toFixed(1)} mm`; });
  app.on('view', () => (zoom.textContent = `${Math.round((app.view.zoom / 3.78) * 100)} %`));
  upd();
}

export { onFontLoaded };
