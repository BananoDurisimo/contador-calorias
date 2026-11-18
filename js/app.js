import { LocalDB } from './db-local.js';
import { SupabaseDB, getSupabaseClient } from './db-supabase.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MEALS = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Almuerzo' },
  { id: 'cena', label: 'Cena' },
  { id: 'snack', label: 'Snacks' },
];
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };
const CONFIG_KEY = 'cc-config';

const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const optNum = (v) => (v === '' || v == null ? null : num(v));
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: d });

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const prettyDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  fromISO(iso).toLocaleDateString('es-CO', opts);

function unitShort(p) {
  if (p.base_type === 'unit') return p.unit_label || 'porción';
  return p.base_type;
}
function baseLabel(p) {
  if (p.base_type === 'unit') {
    const lbl = p.unit_label || 'porción';
    return `por ${fmt(p.base_amount, 2)} ${lbl}`;
  }
  return `por ${fmt(p.base_amount, 2)} ${p.base_type}`;
}
function nutrientsFor(p, amount) {
  const f = amount / p.base_amount;
  return {
    kcal: r1(p.kcal * f),
    protein: r1((p.protein || 0) * f),
    carbs: r1((p.carbs || 0) * f),
    fat: r1((p.fat || 0) * f),
  };
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 4500 : 2200);
}

const FAIL = Symbol('fail');
async function safe(fn, errMsg = 'Ocurrió un error') {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    toast(`${errMsg}: ${err.message || err}`, true);
    return FAIL;
  }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const state = {
  db: null,
  localDB: new LocalDB(),
  sb: null, // cliente Supabase (si está configurado)
  user: null,
  products: [],
  goals: { ...DEFAULT_GOALS },
  date: toISO(new Date()),
  entries: [],
  range: 7,
  editingEntry: null,
  pickedProduct: null,
};

function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}
function writeConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ---------------------------------------------------------------------------
// Conexión a la base de datos
// ---------------------------------------------------------------------------
async function initDatabase() {
  const cfg = readConfig();
  state.db = state.localDB;
  state.sb = null;
  state.user = null;

  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      state.sb = await getSupabaseClient(cfg.supabaseUrl, cfg.supabaseKey);
      const { data } = await state.sb.auth.getSession();
      if (data.session) {
        state.user = data.session.user;
        state.db = new SupabaseDB(state.sb);
      }
    } catch (err) {
      console.error(err);
      toast('No se pudo conectar con Supabase. Usando la base local.', true);
    }
  }
  renderDbStatus();
}

function renderDbStatus() {
  const badge = $('#dbBadge');
  const cfg = readConfig();
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey);
  const cloud = state.db && state.db.kind === 'supabase';

  badge.textContent = cloud ? `Nube · ${state.user.email}` : 'Local (este navegador)';
  badge.classList.toggle('cloud', cloud);

  $('#dbStatusText').textContent = cloud
    ? `Tus datos se guardan en Supabase (PostgreSQL) con la cuenta ${state.user.email}. Están disponibles en cualquier dispositivo.`
    : configured
      ? 'Supabase está configurado pero no has iniciado sesión. Mientras tanto se usa la base de datos local (IndexedDB) de este navegador.'
      : 'Tus datos se guardan en IndexedDB, la base de datos integrada en este navegador. Persisten entre visitas, pero solo en este dispositivo. Conecta Supabase para sincronizarlos en la nube.';

  const form = $('#supabaseForm');
  form.url.value = cfg.supabaseUrl || '';
  form.key.value = cfg.supabaseKey || '';
  $('#authBox').classList.toggle('hidden', !configured || !state.sb);
  $('#authLoggedOut').classList.toggle('hidden', !!state.user);
  $('#authLoggedIn').classList.toggle('hidden', !state.user);
  $('#authUser').textContent = state.user ? state.user.email : '';
  if (configured) $('#supabaseDetails').open = true;
}

async function reloadAll() {
  await safe(async () => {
    state.products = await state.db.listProducts();
    state.goals = { ...DEFAULT_GOALS, ...((await state.db.getGoals()) || {}) };
  }, 'No se pudieron cargar los datos');
  fillGoalsForm();
  renderProducts();
  await loadDay();
  if ($('#view-historial').classList.contains('active')) await renderHistory();
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------
function showView(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'historial') renderHistory();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Diario
// ---------------------------------------------------------------------------
async function loadDay() {
  $('#dateInput').value = state.date;
  const entries = await safe(() => state.db.listEntries(state.date), 'No se pudo cargar el día');
  state.entries = entries === FAIL ? [] : entries;
  renderDay();
}

function totals(list) {
  return list.reduce((acc, e) => {
    acc.kcal += num(e.kcal); acc.protein += num(e.protein);
    acc.carbs += num(e.carbs); acc.fat += num(e.fat);
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

function renderDay() {
  const t = totals(state.entries);
  const g = state.goals;

  // Anillo
  const circ = 2 * Math.PI * 52;
  const pct = g.kcal > 0 ? Math.min(t.kcal / g.kcal, 1) : 0;
  const ring = $('#ringFg');
  ring.style.strokeDasharray = `${circ}`;
  ring.style.strokeDashoffset = `${circ * (1 - pct)}`;
  const over = g.kcal > 0 && t.kcal > g.kcal;
  ring.classList.toggle('over', over);
  $('#kcalConsumed').textContent = fmt(r0(t.kcal));
  $('#kcalGoalLabel').textContent = `de ${fmt(g.kcal)} kcal`;
  const rem = $('#kcalRemaining');
  rem.textContent = over
    ? `Te pasaste por ${fmt(r0(t.kcal - g.kcal))} kcal`
    : `Te quedan ${fmt(r0(g.kcal - t.kcal))} kcal`;
  rem.classList.toggle('over', over);

  // Macros
  for (const m of ['protein', 'carbs', 'fat']) {
    const el = $(`.macro[data-macro="${m}"]`);
    const goal = num(g[m]);
    $('.macro-val', el).textContent = `${fmt(t[m], 1)} / ${fmt(goal)} g`;
    $('.bar-fill', el).style.width = `${goal > 0 ? Math.min((t[m] / goal) * 100, 100) : 0}%`;
  }

  // Comidas
  $('#meals').innerHTML = MEALS.map((meal) => {
    const list = state.entries.filter((e) => e.meal === meal.id);
    const mt = totals(list);
    const items = list.length
      ? list.map((e) => `
        <div class="entry">
          <div class="entry-main" data-edit="${e.id}" role="button" tabindex="0" title="Editar cantidad">
            <div class="entry-name">${esc(e.product_name)}</div>
            <div class="entry-sub">${fmt(e.amount, 2)} ${esc(e.unit)} · P ${fmt(e.protein, 1)} · C ${fmt(e.carbs, 1)} · G ${fmt(e.fat, 1)}</div>
          </div>
          <span class="entry-kcal">${fmt(r0(e.kcal))} kcal</span>
          <button class="del-btn" data-del-entry="${e.id}" aria-label="Eliminar ${esc(e.product_name)}">✕</button>
        </div>`).join('')
      : '<p class="empty">Sin alimentos registrados.</p>';
    return `
      <div class="card meal">
        <div class="meal-head">
          <h3>${meal.label} <small>${fmt(r0(mt.kcal))} kcal</small></h3>
          <button class="link-btn" data-add-meal="${meal.id}">+ Agregar</button>
        </div>
        ${items}
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Diálogo de registro
// ---------------------------------------------------------------------------
function openEntryDialog({ meal = 'desayuno', entry = null } = {}) {
  const dlg = $('#entryDialog');
  const form = $('#entryForm');
  form.reset();
  state.editingEntry = entry;
  state.pickedProduct = null;

  if (entry) {
    $('#entryDialogTitle').textContent = 'Editar registro';
    $('#entrySubmit').textContent = 'Guardar cambios';
    form.id.value = entry.id;
    form.meal.value = entry.meal;
    form.amount.value = entry.amount;
    $('#productPicker').classList.add('hidden');
    const sel = $('#selectedProduct');
    sel.classList.remove('hidden');
    sel.innerHTML = `<div><strong>${esc(entry.product_name)}</strong><small>Registrado: ${fmt(entry.amount, 2)} ${esc(entry.unit)}</small></div>`;
    $('#amountUnit').textContent = entry.unit;
  } else {
    $('#entryDialogTitle').textContent = 'Agregar alimento';
    $('#entrySubmit').textContent = 'Agregar';
    form.meal.value = meal;
    $('#productPicker').classList.remove('hidden');
    $('#selectedProduct').classList.add('hidden');
    $('#pickerSearch').value = '';
    $('#amountUnit').textContent = 'g';
    renderPicker();
  }
  updateEntryPreview();
  dlg.showModal();
  if (!entry) setTimeout(() => $('#pickerSearch').focus(), 30);
}

function renderPicker() {
  const q = $('#pickerSearch').value.trim().toLowerCase();
  const list = state.products.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q));
  const el = $('#pickerList');
  if (!state.products.length) {
    el.innerHTML = `<div class="picker-empty">Aún no tienes productos. <button type="button" class="link-btn" data-goto-new-product>Crear uno</button></div>`;
    return;
  }
  el.innerHTML = list.length
    ? list.map((p) => `
      <button type="button" class="picker-item" data-pick="${p.id}" role="option">
        <span>${esc(p.name)}${p.brand ? ` <small>· ${esc(p.brand)}</small>` : ''}</span>
        <small>${fmt(p.kcal, 1)} kcal ${esc(baseLabel(p))}</small>
      </button>`).join('')
    : '<div class="picker-empty">Ningún producto coincide.</div>';
}

function pickProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  state.pickedProduct = p;
  $('#productPicker').classList.add('hidden');
  const sel = $('#selectedProduct');
  sel.classList.remove('hidden');
  sel.innerHTML = `
    <div><strong>${esc(p.name)}</strong><small>${fmt(p.kcal, 1)} kcal ${esc(baseLabel(p))}</small></div>
    <button type="button" class="link-btn" data-change-product>Cambiar</button>`;
  $('#amountUnit').textContent = unitShort(p);
  const amount = $('#entryForm').amount;
  amount.value = p.base_amount;
  updateEntryPreview();
  amount.focus();
  amount.select();
}

function computeEntryNutrients() {
  const form = $('#entryForm');
  const amount = num(form.amount.value);
  if (amount <= 0) return null;
  if (state.editingEntry) {
    const e = state.editingEntry;
    const f = amount / num(e.amount);
    return { kcal: r1(e.kcal * f), protein: r1(e.protein * f), carbs: r1(e.carbs * f), fat: r1(e.fat * f) };
  }
  if (!state.pickedProduct) return null;
  return nutrientsFor(state.pickedProduct, amount);
}

function updateEntryPreview() {
  const n = computeEntryNutrients() || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  $('#entryPreview').innerHTML = `
    <div><strong>${fmt(r0(n.kcal))}</strong><span>kcal</span></div>
    <div><strong>${fmt(n.protein, 1)}</strong><span>Proteína g</span></div>
    <div><strong>${fmt(n.carbs, 1)}</strong><span>Carbos g</span></div>
    <div><strong>${fmt(n.fat, 1)}</strong><span>Grasa g</span></div>`;
}

async function submitEntry(ev) {
  ev.preventDefault();
  const form = $('#entryForm');
  const amount = num(form.amount.value);
  const n = computeEntryNutrients();
  if (!n || amount <= 0) {
    toast(state.editingEntry || state.pickedProduct ? 'Indica una cantidad válida' : 'Elige un producto', true);
    return;
  }
  let entry;
  if (state.editingEntry) {
    entry = { ...state.editingEntry, amount, meal: form.meal.value, ...n };
  } else {
    const p = state.pickedProduct;
    entry = {
      id: uuid(),
      date: state.date,
      meal: form.meal.value,
      product_id: p.id,
      product_name: p.name,
      amount,
      unit: unitShort(p),
      ...n,
      created_at: new Date().toISOString(),
    };
  }
  if (await safe(() => state.db.saveEntry(entry), 'No se pudo guardar') === FAIL) return;
  $('#entryDialog').close();
  toast(state.editingEntry ? 'Registro actualizado' : `${entry.product_name} agregado`);
  await loadDay();
}

async function deleteEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e || !confirm(`¿Eliminar "${e.product_name}" de este día?`)) return;
  await safe(() => state.db.deleteEntry(id), 'No se pudo eliminar');
  await loadDay();
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------
function renderProducts() {
  const q = $('#productSearch').value.trim().toLowerCase();
  const list = state.products.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q));
  const el = $('#productList');
  if (!state.products.length) {
    el.innerHTML = `
      <div class="card empty-state">
        <p><strong>Todavía no has creado productos.</strong></p>
        <p>Crea tus alimentos con sus valores nutricionales (por ejemplo, de la etiqueta) y luego regístralos en tu diario.</p>
        <button class="btn primary" type="button" data-goto-new-product>+ Crear mi primer producto</button>
      </div>`;
    return;
  }
  el.innerHTML = list.length
    ? list.map((p) => `
      <article class="product">
        <div class="product-top">
          <div>
            <div class="product-name">${esc(p.name)}</div>
            ${p.brand ? `<div class="product-brand">${esc(p.brand)}</div>` : ''}
          </div>
          <div class="product-kcal">${fmt(p.kcal, 1)} <small>kcal</small></div>
        </div>
        <div class="chips">
          <span class="chip">${esc(baseLabel(p))}</span>
          <span class="chip p">P ${fmt(p.protein, 1)} g</span>
          <span class="chip c">C ${fmt(p.carbs, 1)} g</span>
          <span class="chip f">G ${fmt(p.fat, 1)} g</span>
          ${p.fiber != null ? `<span class="chip">Fibra ${fmt(p.fiber, 1)} g</span>` : ''}
          ${p.sugar != null ? `<span class="chip">Azúcar ${fmt(p.sugar, 1)} g</span>` : ''}
        </div>
        <div class="product-actions">
          <button class="btn ghost small" data-edit-product="${p.id}">Editar</button>
          <button class="btn danger small" data-del-product="${p.id}">Eliminar</button>
        </div>
      </article>`).join('')
    : '<p class="empty">Ningún producto coincide con la búsqueda.</p>';
}

function syncUnitField() {
  const form = $('#productForm');
  const isUnit = form.base_type.value === 'unit';
  $('.unit-label-field').classList.toggle('hidden', !isUnit);
}

function updateMacroHint() {
  const f = $('#productForm');
  const est = num(f.protein.value) * 4 + num(f.carbs.value) * 4 + num(f.fat.value) * 9;
  $('#macroHint').textContent = est > 0
    ? `Estimación por macros (4/4/9): ≈ ${fmt(r0(est))} kcal.`
    : '';
}

function openProductDialog(product = null) {
  const form = $('#productForm');
  form.reset();
  $('#productDialogTitle').textContent = product ? 'Editar producto' : 'Nuevo producto';
  form.id.value = product ? product.id : '';
  if (product) {
    for (const k of ['name', 'brand', 'base_type', 'base_amount', 'unit_label', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar']) {
      form[k].value = product[k] ?? '';
    }
  }
  syncUnitField();
  updateMacroHint();
  $('#productDialog').showModal();
  setTimeout(() => form.name.focus(), 30);
}

async function submitProduct(ev) {
  ev.preventDefault();
  const f = $('#productForm');
  const name = f.name.value.trim();
  const base_amount = num(f.base_amount.value);
  if (!name) return toast('El nombre es obligatorio', true);
  if (base_amount <= 0) return toast('La cantidad base debe ser mayor que 0', true);
  if (f.kcal.value === '') return toast('Indica las calorías', true);

  const existing = state.products.find((p) => p.id === f.id.value);
  const now = new Date().toISOString();
  const product = {
    id: existing ? existing.id : uuid(),
    name,
    brand: f.brand.value.trim() || null,
    base_type: f.base_type.value,
    base_amount,
    unit_label: f.base_type.value === 'unit' ? (f.unit_label.value.trim() || null) : null,
    kcal: num(f.kcal.value),
    protein: num(f.protein.value),
    carbs: num(f.carbs.value),
    fat: num(f.fat.value),
    fiber: optNum(f.fiber.value),
    sugar: optNum(f.sugar.value),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  if (await safe(() => state.db.saveProduct(product), 'No se pudo guardar el producto') === FAIL) return;
  $('#productDialog').close();
  toast(existing ? 'Producto actualizado' : 'Producto creado');
  state.products = await state.db.listProducts();
  renderProducts();
  if ($('#entryDialog').open) { renderPicker(); pickProduct(product.id); }
}

async function deleteProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p || !confirm(`¿Eliminar el producto "${p.name}"? Los registros ya guardados en el diario se conservan.`)) return;
  if (await safe(() => state.db.deleteProduct(id), 'No se pudo eliminar') === FAIL) return;
  state.products = await state.db.listProducts();
  renderProducts();
  toast('Producto eliminado');
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------
async function renderHistory() {
  const to = toISO(new Date());
  const from = addDays(to, -(state.range - 1));
  let entries = await safe(() => state.db.listEntries(from, to), 'No se pudo cargar el historial');
  if (entries === FAIL) entries = [];

  const days = [];
  for (let i = 0; i < state.range; i++) {
    const iso = addDays(from, i);
    days.push({ date: iso, ...totals(entries.filter((e) => e.date === iso)) });
  }
  const logged = days.filter((d) => d.kcal > 0);
  const avg = logged.length ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;
  const goal = num(state.goals.kcal);
  const withinGoal = logged.filter((d) => d.kcal <= goal).length;

  $('#historyStats').innerHTML = `
    <div class="stat"><span>Promedio diario</span><strong>${fmt(r0(avg))} kcal</strong></div>
    <div class="stat"><span>Días registrados</span><strong>${logged.length} / ${state.range}</strong></div>
    <div class="stat"><span>Días dentro de la meta</span><strong>${withinGoal}</strong></div>`;

  // Gráfico SVG
  const W = 640, H = 240, padL = 44, padB = 26, padT = 12, padR = 8;
  const max = Math.max(goal, ...days.map((d) => d.kcal), 100) * 1.1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = innerW / days.length;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 100) * 100);
  const labelEvery = state.range > 10 ? 6 : 1;

  const bars = days.map((d, i) => {
    const h = (d.kcal / max) * innerH;
    const x = padL + i * bw + bw * 0.15;
    const over = goal > 0 && d.kcal > goal;
    const label = i % labelEvery === 0 || i === days.length - 1
      ? `<text x="${padL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(prettyDate(d.date, { day: 'numeric', month: 'numeric' }))}</text>`
      : '';
    return `<rect class="bar-rect${over ? ' over' : ''}" x="${x}" y="${padT + innerH - h}" width="${bw * 0.7}" height="${h}" rx="3">
        <title>${esc(prettyDate(d.date))}: ${fmt(r0(d.kcal))} kcal</title></rect>${label}`;
  }).join('');

  $('#chart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calorías por día">
      ${ticks.map((t) => `<text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${bars}
      ${goal > 0 ? `<line class="goal-line" x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}"><title>Meta: ${fmt(goal)} kcal</title></line>
        <text x="${padL + 4}" y="${y(goal) - 5}" text-anchor="start">Meta ${fmt(goal)}</text>` : ''}
    </svg>`;

  $('#historyTable tbody').innerHTML = [...days].reverse().map((d) => `
    <tr class="clickable" data-goto-date="${d.date}" title="Abrir este día">
      <td>${esc(prettyDate(d.date))}</td>
      <td>${d.kcal ? fmt(r0(d.kcal)) : '—'}</td>
      <td>${d.kcal ? fmt(d.protein, 1) : '—'}</td>
      <td>${d.kcal ? fmt(d.carbs, 1) : '—'}</td>
      <td>${d.kcal ? fmt(d.fat, 1) : '—'}</td>
    </tr>`).join('');
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
function fillGoalsForm() {
  const f = $('#goalsForm');
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) f[k].value = state.goals[k] ?? '';
}

async function submitGoals(ev) {
  ev.preventDefault();
  const f = $('#goalsForm');
  const goals = { kcal: num(f.kcal.value), protein: num(f.protein.value), carbs: num(f.carbs.value), fat: num(f.fat.value) };
  if (await safe(() => state.db.saveGoals(goals), 'No se pudieron guardar las metas') === FAIL) return;
  state.goals = goals;
  renderDay();
  toast('Metas guardadas');
}

async function submitSupabase(ev) {
  ev.preventDefault();
  const f = $('#supabaseForm');
  const url = f.url.value.trim().replace(/\/+$/, '');
  const key = f.key.value.trim();
  if (!/^https:\/\/.+/.test(url)) return toast('La URL debe empezar por https://', true);
  writeConfig({ ...readConfig(), supabaseUrl: url, supabaseKey: key });
  await initDatabase();
  if (state.sb) toast('Conexión guardada. Ahora inicia sesión o crea una cuenta.');
}

async function forgetSupabase() {
  if (!confirm('¿Quitar la conexión con Supabase? Tus datos en la nube no se borran; la app volverá a usar la base local.')) return;
  if (state.sb) await state.sb.auth.signOut().catch(() => {});
  const cfg = readConfig();
  delete cfg.supabaseUrl; delete cfg.supabaseKey;
  writeConfig(cfg);
  await initDatabase();
  await reloadAll();
  toast('Conexión eliminada');
}

async function login() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPass').value;
  if (!email || !password) return toast('Escribe correo y contraseña', true);
  const { error } = await state.sb.auth.signInWithPassword({ email, password });
  if (error) return toast(`No se pudo iniciar sesión: ${error.message}`, true);
  await initDatabase();
  await reloadAll();
  toast('Sesión iniciada. Datos en la nube.');
}

async function signup() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPass').value;
  if (!email || password.length < 6) return toast('Correo válido y contraseña de al menos 6 caracteres', true);
  const { data, error } = await state.sb.auth.signUp({
    email, password, options: { emailRedirectTo: location.href.split('#')[0] },
  });
  if (error) return toast(`No se pudo crear la cuenta: ${error.message}`, true);
  if (data.session) {
    await initDatabase();
    await reloadAll();
    toast('Cuenta creada y sesión iniciada');
  } else {
    toast('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.');
  }
}

async function logout() {
  await state.sb.auth.signOut();
  await initDatabase();
  await reloadAll();
  toast('Sesión cerrada. Usando la base local.');
}

async function migrate() {
  if (state.db.kind !== 'supabase') return;
  const data = await state.localDB.exportAll();
  if (!data.products.length && !data.entries.length) return toast('No hay datos locales para copiar');
  if (!confirm(`Se copiarán ${data.products.length} productos y ${data.entries.length} registros a la nube. ¿Continuar?`)) return;
  if (await safe(() => state.db.importAll(data), 'Error al copiar') === FAIL) return;
  await reloadAll();
  toast('Datos locales copiados a la nube');
}

async function exportJSON() {
  const data = await safe(() => state.db.exportAll(), 'No se pudo exportar');
  if (data === FAIL) return;
  const blob = new Blob([JSON.stringify({ app: 'contador-calorias', version: 1, exported_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calorias-${toISO(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJSON(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return toast('El archivo no es un JSON válido', true); }
  const products = Array.isArray(data.products) ? data.products : [];
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!products.length && !entries.length && !data.goals) return toast('El archivo no contiene datos de la app', true);
  if (!confirm(`Importar ${products.length} productos y ${entries.length} registros? Los elementos con el mismo id se sobrescriben.`)) return;
  await safe(async () => {
    if (state.db.importAll) {
      await state.db.importAll({ products, entries, goals: data.goals });
    } else {
      for (const p of products) await state.db.saveProduct(p);
      for (const e of entries) await state.db.saveEntry(e);
      if (data.goals) await state.db.saveGoals(data.goals);
    }
    toast('Datos importados');
  }, 'Error al importar');
  await reloadAll();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#dbBadge').addEventListener('click', () => showView('ajustes'));

  // Fecha
  $('#prevDay').addEventListener('click', () => { state.date = addDays(state.date, -1); loadDay(); });
  $('#nextDay').addEventListener('click', () => { state.date = addDays(state.date, 1); loadDay(); });
  $('#todayBtn').addEventListener('click', () => { state.date = toISO(new Date()); loadDay(); });
  $('#dateInput').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; loadDay(); } });

  // Delegación global de clics
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-add-meal],[data-del-entry],[data-edit],[data-pick],[data-change-product],[data-goto-new-product],[data-edit-product],[data-del-product],[data-goto-date],[data-close]');
    if (!t) return;
    const d = t.dataset;
    if (d.addMeal) openEntryDialog({ meal: d.addMeal });
    else if (d.delEntry) deleteEntry(d.delEntry);
    else if (d.edit) openEntryDialog({ entry: state.entries.find((x) => x.id === d.edit) });
    else if (d.pick) pickProduct(d.pick);
    else if ('changeProduct' in d) {
      state.pickedProduct = null;
      $('#selectedProduct').classList.add('hidden');
      $('#productPicker').classList.remove('hidden');
      updateEntryPreview();
      $('#pickerSearch').focus();
    } else if ('gotoNewProduct' in d) openProductDialog();
    else if (d.editProduct) openProductDialog(state.products.find((x) => x.id === d.editProduct));
    else if (d.delProduct) deleteProduct(d.delProduct);
    else if (d.gotoDate) { state.date = d.gotoDate; showView('hoy'); loadDay(); }
    else if ('close' in d) t.closest('dialog').close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.entry-main')) e.target.click();
  });

  // Registro
  $('#entryForm').addEventListener('submit', submitEntry);
  $('#entryForm').amount.addEventListener('input', updateEntryPreview);
  $('#pickerSearch').addEventListener('input', renderPicker);
  $('#pickerSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = $('#pickerList [data-pick]');
      if (first) pickProduct(first.dataset.pick);
    }
  });

  // Productos
  $('#newProductBtn').addEventListener('click', () => openProductDialog());
  $('#productSearch').addEventListener('input', renderProducts);
  $('#productForm').addEventListener('submit', submitProduct);
  $('#productForm').base_type.addEventListener('change', (e) => {
    const f = $('#productForm');
    if (e.target.value === 'unit' && num(f.base_amount.value) === 100) f.base_amount.value = 1;
    else if (e.target.value !== 'unit' && num(f.base_amount.value) === 1) f.base_amount.value = 100;
    syncUnitField();
  });
  ['protein', 'carbs', 'fat'].forEach((k) => $('#productForm')[k].addEventListener('input', updateMacroHint));

  // Historial
  $$('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    state.range = Number(b.dataset.range);
    renderHistory();
  }));

  // Ajustes
  $('#goalsForm').addEventListener('submit', submitGoals);
  $('#supabaseForm').addEventListener('submit', submitSupabase);
  $('#supabaseForget').addEventListener('click', forgetSupabase);
  $('#loginBtn').addEventListener('click', () => safe(login, 'Error'));
  $('#signupBtn').addEventListener('click', () => safe(signup, 'Error'));
  $('#logoutBtn').addEventListener('click', () => safe(logout, 'Error'));
  $('#migrateBtn').addEventListener('click', migrate);
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJSON(file);
    e.target.value = '';
  });
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
(async function start() {
  bindEvents();
  await initDatabase();
  await reloadAll();
  // Si la sesión de Supabase cambia (p. ej., al confirmar el correo), recargar.
  if (state.sb) {
    state.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && state.db.kind !== 'supabase') {
        initDatabase().then(reloadAll);
      }
    });
  }
})();
