type Attrs = Record<string, any>;
type Child = Node | string | number | null | undefined | false | Child[];

/** Petit utilitaire de création d'éléments. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Ajoute des enfants en ignorant les valeurs nulles. */
export function add(el: HTMLElement, ...children: Child[]) { append(el, children); }

export function clear(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); }

/** Champ numérique avec libellé et unité. */
export function numField(label: string, value: number, onChange: (v: number) => void, o: { min?: number; max?: number; step?: number; unit?: string; title?: string } = {}) {
  const input = h('input', { type: 'number', value: String(+value.toFixed(3)), min: o.min, max: o.max, step: o.step ?? 0.1 });
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (isNaN(v)) return;
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    onChange(v);
  });
  return h('label', { class: 'field', title: o.title }, h('span', {}, label), h('span', { class: 'inp' }, input, o.unit ? h('em', {}, o.unit) : null));
}

export function selectField<T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void, title?: string) {
  const sel = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  sel.addEventListener('change', () => onChange(sel.value as T));
  return h('label', { class: 'field', title }, h('span', {}, label), sel);
}

export function checkField(label: string, value: boolean, onChange: (v: boolean) => void, title?: string) {
  const cb = h('input', { type: 'checkbox', checked: value });
  cb.addEventListener('change', () => onChange(cb.checked));
  return h('label', { class: 'field check', title }, cb, h('span', {}, label));
}

export function rangeField(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void, fmt = (v: number) => String(v)) {
  const out = h('em', {}, fmt(value));
  const r = h('input', { type: 'range', min, max, step, value: String(value) });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); onInput(+r.value); });
  return h('label', { class: 'field range' }, h('span', {}, label), h('span', { class: 'inp' }, r, out));
}

export function download(name: string, data: BlobPart | Uint8Array, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept });
    i.addEventListener('change', () => res(i.files?.[0] ?? null));
    i.click();
  });
}

export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

/** Boîte de dialogue modale. Retourne une fonction de fermeture. */
export function modal(title: string, body: HTMLElement, actions: { label: string; primary?: boolean; onClick: () => void | boolean }[] = [], wide = false) {
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const bg = h('div', { class: 'modal-bg' },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('header', {}, h('h2', {}, title), h('button', { class: 'icon', onclick: close, title: 'Fermer' }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('footer', {}, actions.map((a) => h('button', { class: a.primary ? 'primary' : '', onclick: () => { if (a.onClick() !== false) close(); } }, a.label))) : null,
    ));
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  return close;
}
