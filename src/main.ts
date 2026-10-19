import './style.css';
import { app, restoreAutosave } from './ui/state';
import { Renderer } from './ui/renderer';
import { Tools, isTyping } from './ui/tools';
import { h, download, pickFile, toast, modal } from './ui/dom';
import { colors, properties, sequence, statusBar, toolOptions, toolbar } from './ui/panels';
import * as act from './ui/actions';
import * as dlg from './ui/dialogs';
import { HOOPS, newDesign } from './core/defaults';
import { onFontLoaded, registerUserFont } from './core/text';
import { Cmd, type Design } from './core/types';
import { designName } from './formats/encode';
import { importedToObjects, readMachineFile } from './formats';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

// ------------------------------------------------------------------ Mise en page
const root = $('#app');
const canvas = h('canvas');
const stage = h('div', { class: 'stage' }, canvas);
const simBar = h('div', { class: 'simbar hidden' });
root.append(
  h('header', { class: 'topbar' }),
  h('div', { class: 'main' },
    h('nav', { class: 'toolbar' }),
    h('section', { class: 'center' }, h('div', { class: 'tool-options' }), h('div', { class: 'stage-wrap' }, stage, simBar)),
    h('aside', { class: 'side' },
      h('div', { class: 'tabs' }),
      h('div', { class: 'panel props' }),
      h('div', { class: 'panel colors' }),
      h('div', { class: 'panel seqp' })),
  ),
  h('footer', { class: 'status' }),
);

const r = new Renderer(canvas);
const tools = new Tools(r, canvas);
app.on('redraw', () => r.request());
app.on('view', () => r.request());
onFontLoaded(() => { app.changed(); });

toolbar($('.toolbar'));
toolOptions($('.tool-options'));
properties($('.props'));
colors($('.colors'));
sequence($('.seqp'));
statusBar($('.status'));

// ------------------------------------------------------------------ Barre du haut

function menu(label: string, items: ([string, () => void, string?] | null)[]) {
  const list = h('div', { class: 'menu-list' }, items.map((it) => it ? h('button', { onclick: () => { close(); it[1](); } }, h('span', {}, it[0]), it[2] ? h('kbd', {}, it[2]) : null) : h('hr')));
  const wrap = h('div', { class: 'menu' }, h('button', { class: 'menu-btn', onclick: (e: Event) => { e.stopPropagation(); const open = wrap.classList.contains('open'); document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); if (!open) wrap.classList.add('open'); } }, label), list);
  const close = () => wrap.classList.remove('open');
  return wrap;
}
document.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')));

const hoopSel = h('select', { title: 'Cercle de broderie' }, HOOPS.map((hp) => h('option', { value: hp.id }, hp.name)));
hoopSel.addEventListener('change', () => { app.commit(() => (app.design.hoop = hoopSel.value)); r.fit(); });
app.on('change', () => (hoopSel.value = app.design.hoop));

const toggle = (label: string, key: 'realistic' | 'showJumps' | 'showGrid', title: string) => {
  const b = h('button', { class: 'toggle' + (app.settings[key] ? ' on' : ''), title, onclick: () => { app.settings[key] = !app.settings[key]; b.classList.toggle('on', app.settings[key]); r.request(); } }, label);
  return b;
};

$('.topbar').append(
  h('div', { class: 'brand' }, h('b', {}, 'Fil'), 'Libre'),
  menu('Fichier', [
    ['Nouveau', newFile, 'Ctrl+N'], ['Ouvrir un projet…', openProject, 'Ctrl+O'], ['Enregistrer le projet', saveProject, 'Ctrl+S'], null,
    ['Importer JEF / DST / EXP…', dlg.importEmbroidery], ['Image de fond (calque)…', dlg.backgroundDialog], null,
    ['Exporter pour la brodeuse…', dlg.exportDialog, 'Ctrl+E'], ['Exporter en image PNG', dlg.exportPNG], ['Imprimer la fiche', dlg.printSheet, 'Ctrl+P'],
  ]),
  menu('Édition', [
    ['Annuler', () => app.doUndo(), 'Ctrl+Z'], ['Rétablir', () => app.doRedo(), 'Ctrl+Y'], null,
    ['Couper', act.cut, 'Ctrl+X'], ['Copier', act.copy, 'Ctrl+C'], ['Coller', act.paste, 'Ctrl+V'], ['Dupliquer', act.duplicate, 'Ctrl+D'], ['Supprimer', () => app.deleteSelected(), 'Suppr'], null,
    ['Tout sélectionner', () => app.select(app.design.objects.map((o) => o.id)), 'Ctrl+A'],
    ['Miroir horizontal', () => act.mirror('h')], ['Miroir vertical', () => act.mirror('v')], ['Centrer sur le cercle', act.centerOnHoop],
    null, ['Optimiser l\'ordre des couleurs', act.optimizeColors], ['Retirer les chevauchements', act.removeOverlaps],
  ]),
  menu('Assistants', [
    ['Image → Broderie (automatique)…', () => dlg.autoDigitizeDialog()], ['Point de croix depuis une image…', dlg.crossStitchDialog], ['PhotoStitch…', dlg.photoStitchDialog], null,
    ['Monogramme…', dlg.monogramDialog], ['Charger une police…', loadFont],
  ]),
  h('div', { class: 'sep' }),
  h('button', { class: 'icon', title: 'Annuler (Ctrl+Z)', onclick: () => app.doUndo() }, '↶'),
  h('button', { class: 'icon', title: 'Rétablir (Ctrl+Y)', onclick: () => app.doRedo() }, '↷'),
  h('div', { class: 'sep' }),
  hoopSel,
  toggle('Réaliste', 'realistic', 'Rendu 3D des fils'), toggle('Sauts', 'showJumps', 'Afficher les sauts de fil'), toggle('Grille', 'showGrid', 'Grille 10 mm'),
  h('button', { title: 'Ajuster la vue (0)', onclick: () => r.fit() }, 'Ajuster'),
  h('div', { class: 'grow' }),
  h('button', { class: 'accent', onclick: () => dlg.autoDigitizeDialog() }, 'Image → Broderie'),
  h('button', { onclick: startSim }, '▶ Simuler'),
  h('button', { class: 'primary', onclick: dlg.exportDialog }, 'Exporter JEF'),
  h('button', { class: 'icon', title: 'Aide', onclick: dlg.helpDialog }, '?'),
);

// onglets du panneau latéral (écrans étroits)
const tabs = $('.tabs');
const side = $('.side');
(['props', 'colors', 'seqp'] as const).forEach((k, i) => tabs.append(h('button', { class: i === 0 ? 'on' : '', onclick: (e: Event) => {
  side.dataset.tab = k; tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
} }, ['Propriétés', 'Fils', 'Ordre'][i])));
side.dataset.tab = 'props';

// ------------------------------------------------------------------ Fichiers

function newFile() {
  if (app.design.objects.length && !confirm('Abandonner le motif actuel ?')) return;
  app.load(newDesign());
  r.fit();
}

function saveProject() {
  download(`${designName(app.design)}.fillibre`, JSON.stringify(app.design), 'application/json');
  app.dirty = false;
}

async function openProject() {
  const f = await pickFile('.fillibre,.json,.jef,.dst,.exp');
  if (!f) return;
  if (/\.(jef|dst|exp)$/i.test(f.name)) {
    app.load({ ...newDesign(), threads: [], name: f.name.replace(/\.\w+$/, '') });
    await importFile(f);
    return;
  }
  try {
    const d = JSON.parse(await f.text()) as Design;
    if (!Array.isArray(d.objects) || !Array.isArray(d.threads)) throw new Error('fichier invalide');
    app.load(d);
    r.fit();
  } catch (e) { toast('Ouverture impossible : ' + (e as Error).message, 'error'); }
}

async function importFile(f: File) {
  const imp = readMachineFile(f.name, new Uint8Array(await f.arrayBuffer()));
  const objs = importedToObjects(imp, app.design.threads.length);
  app.design.threads.push(...imp.threads);
  app.addObjects(objs);
  r.fit(app.plan.bbox);
}

async function loadFont() {
  const f = await pickFile('.ttf,.otf,.woff');
  if (!f) return;
  try { registerUserFont(f.name, await f.arrayBuffer()); toast('Police ajoutée : ' + f.name); app.emit('select'); }
  catch (e) { toast('Police illisible : ' + (e as Error).message, 'error'); }
}
document.addEventListener('load-font', loadFont);

// glisser-déposer de fichiers
stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault(); stage.classList.remove('drop');
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  if (f.type.startsWith('image/')) dlg.autoDigitizeDialog(f);
  else if (/\.(jef|dst|exp)$/i.test(f.name)) importFile(f).catch((er) => toast(String(er), 'error'));
  else if (/\.(fillibre|json)$/i.test(f.name)) { app.load(JSON.parse(await f.text())); r.fit(); }
  else if (/\.(ttf|otf)$/i.test(f.name)) { registerUserFont(f.name, await f.arrayBuffer()); toast('Police ajoutée'); }
});

// ------------------------------------------------------------------ Simulateur

let simRaf = 0, simLast = 0;
function startSim() {
  if (!app.plan.stitchCount) { toast('Rien à simuler'); return; }
  app.sim.active = true; app.sim.index = 0; app.sim.playing = true;
  simBar.classList.remove('hidden');
  renderSimBar();
  simLast = performance.now();
  loop();
}
function stopSim() {
  app.sim.active = false; app.sim.playing = false;
  cancelAnimationFrame(simRaf);
  simBar.classList.add('hidden');
  r.request();
}
function loop() {
  cancelAnimationFrame(simRaf);
  simRaf = requestAnimationFrame((t) => {
    const dt = Math.min(0.1, (t - simLast) / 1000);
    simLast = t;
    if (app.sim.playing) {
      app.sim.index = Math.min(app.plan.stitches.length, app.sim.index + Math.max(1, app.sim.speed * app.sim.speed * dt * 0.6));
      if (app.sim.index >= app.plan.stitches.length) app.sim.playing = false;
      updSimBar();
      r.request();
    }
    if (app.sim.active) loop();
  });
}
const simRange = h('input', { type: 'range', min: 0, max: 1, step: 1, value: '0' });
const simInfo = h('span', { class: 'siminfo' });
const playBtn = h('button', { class: 'icon' });
function updSimBar() {
  const st = app.plan.stitches;
  const i = Math.floor(app.sim.index);
  simRange.max = String(st.length);
  simRange.value = String(i);
  playBtn.textContent = app.sim.playing ? '❚❚' : '▶';
  const cur = st[Math.min(st.length - 1, Math.max(0, i - 1))];
  const t = cur ? app.design.threads[cur.color] : null;
  let n = 0;
  for (let k = 0; k < i && k < st.length; k++) if (st[k].cmd === Cmd.STITCH) n++;
  simInfo.innerHTML = '';
  if (t) simInfo.append(h('i', { style: { background: `rgb(${t.r},${t.g},${t.b})` } }), `${t.code} ${t.name} · point ${n.toLocaleString('fr-FR')} / ${app.plan.stitchCount.toLocaleString('fr-FR')}`);
}
function jumpColor(dir: 1 | -1) {
  const st = app.plan.stitches;
  let i = Math.floor(app.sim.index);
  if (dir > 0) { while (i < st.length && st[i].cmd !== Cmd.COLOR && st[i].cmd !== Cmd.STOP) i++; i = Math.min(st.length, i + 1); }
  else { i = Math.max(0, i - 2); while (i > 0 && st[i].cmd !== Cmd.COLOR && st[i].cmd !== Cmd.STOP) i--; }
  app.sim.index = i; app.sim.playing = false; updSimBar(); r.request();
}
function renderSimBar() {
  simBar.innerHTML = '';
  simRange.oninput = () => { app.sim.index = +simRange.value; app.sim.playing = false; updSimBar(); r.request(); };
  playBtn.onclick = () => { if (app.sim.index >= app.plan.stitches.length) app.sim.index = 0; app.sim.playing = !app.sim.playing; simLast = performance.now(); updSimBar(); };
  const speed = h('input', { type: 'range', min: 3, max: 120, step: 1, value: String(app.sim.speed), title: 'Vitesse' });
  speed.oninput = () => (app.sim.speed = +speed.value);
  simBar.append(
    h('button', { class: 'icon', title: 'Couleur précédente', onclick: () => jumpColor(-1) }, '⏮'), playBtn,
    h('button', { class: 'icon', title: 'Couleur suivante', onclick: () => jumpColor(1) }, '⏭'),
    simRange, h('label', {}, 'Vitesse ', speed), simInfo,
    h('button', { class: 'icon', title: 'Fermer', onclick: stopSim }, '✕'));
  updSimBar();
}

// ------------------------------------------------------------------ Clavier

window.addEventListener('keydown', (e) => {
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  if (isTyping()) {
    if (k === 'Escape') (document.activeElement as HTMLElement).blur();
    // les commandes fichier restent actives pendant la saisie
    const fileCmd: Record<string, () => void> = { s: saveProject, e: dlg.exportDialog, p: dlg.printSheet };
    if (ctrl && fileCmd[k.toLowerCase()]) { e.preventDefault(); (document.activeElement as HTMLElement).blur(); fileCmd[k.toLowerCase()](); }
    return;
  }
  if (ctrl) {
    const map: Record<string, () => void> = {
      z: () => (e.shiftKey ? app.doRedo() : app.doUndo()), y: () => app.doRedo(), c: act.copy, x: act.cut, v: act.paste, d: act.duplicate,
      a: () => app.select(app.design.objects.map((o) => o.id)), s: saveProject, o: openProject, e: dlg.exportDialog, p: dlg.printSheet, n: newFile,
    };
    const f = map[k.toLowerCase()];
    if (f) { e.preventDefault(); f(); }
    return;
  }
  if (k === 'Escape') {
    if (app.sim.active) return stopSim();
    if (tools.drawing) return tools.cancel();
    if (app.tool !== 'select') return app.setTool('select');
    return app.select([]);
  }
  if (k === 'Enter' && tools.drawing) { tools.finish(); return; }
  if (k === 'Backspace' && tools.backspace()) { e.preventDefault(); return; }
  if (k === 'Delete' || k === 'Backspace') { if (!tools.deleteHoverNode()) app.deleteSelected(); e.preventDefault(); return; }
  const step = e.shiftKey ? 5 : 0.5;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[k] && app.sel.size) { e.preventDefault(); act.moveBy(...arrows[k]); return; }
  const toolKeys: Record<string, Parameters<typeof app.setTool>[0]> = { v: 'select', n: 'nodes', r: 'run', s: 'satin', f: 'fill', a: 'applique', h: 'shape', t: 'text', m: 'measure' };
  if (toolKeys[k.toLowerCase()]) { app.setTool(toolKeys[k.toLowerCase()]); return; }
  if (k === '0') r.fit();
  if (k === '+' || k === '=') { app.view.zoom *= 1.25; r.request(); app.emit('view'); }
  if (k === '-') { app.view.zoom /= 1.25; r.request(); app.emit('view'); }
});

window.addEventListener('beforeunload', (e) => { if (app.dirty && app.design.objects.length) e.preventDefault(); });

// ------------------------------------------------------------------ Démarrage
const saved = restoreAutosave();
if (saved) {
  app.load(saved);
  toast('Motif précédent restauré');
} else {
  app.changed();
}
requestAnimationFrame(() => r.fit());
if (!saved && !localStorage.getItem('fil-libre:welcome')) {
  try { localStorage.setItem('fil-libre:welcome', '1'); } catch { /* ignore */ }
  modal('Bienvenue dans Fil Libre', h('div', { class: 'help' },
    h('p', {}, 'Créez vos propres motifs pour votre brodeuse Elna eXpressive 830 (format JEF), ou toute brodeuse acceptant DST / EXP.'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Image → Broderie'), ' : importez un logo ou un dessin, il est converti automatiquement.'),
      h('li', {}, h('b', {}, 'Outils de gauche'), ' : point avant, satin, remplissage, appliqué, formes et texte.'),
      h('li', {}, h('b', {}, 'Exporter JEF'), ' : copiez le fichier sur une clé USB pour la brodeuse.'),
    ),
  ), [{ label: 'Commencer', primary: true, onClick: () => {} }]);
}

// accès de débogage (développement uniquement)
if (import.meta.env.DEV) Object.assign(window, { __app: app, __dlg: dlg, __act: act, __r: r });
