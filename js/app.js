import { LocalDB } from './db-local.js?v=10';
import { SupabaseDB, getSupabaseClient } from './db-supabase.js?v=10';
import { calcPlan, weeklyAnalysis } from './plan.js?v=10';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Comidas según el horario del usuario (los id se mantienen por compatibilidad con la base de datos)
// Comidas conocidas (los id se mantienen por compatibilidad con registros anteriores).
const MEAL_INFO = {
  desayuno: { label: 'Desayuno', time: '10 a 12 am' },
  almuerzo: { label: 'Almuerzo', time: '3 a 5 pm' },
  snack: { label: 'Media tarde', time: '6 a 8 pm' },
  cena: { label: 'Cena', time: 'desde las 10 pm' },
};
// Base: 3 comidas. Cada día se pueden agregar, quitar o renombrar.
const DEFAULT_MEALS = ['desayuno', 'almuerzo', 'cena'];
const MEAL_SUGGESTIONS = ['Desayuno', 'Brunch', 'Almuerzo', 'Media tarde', 'Pre-entreno', 'Post-entreno', 'Cena', 'Snack'];

// Entrenamientos: MET del Compendio de Actividades Físicas (2011/2024).
// Calorías = (MET − 1) × peso × horas  → solo lo que se quema por encima del reposo.
const WORKOUT_TYPES = {
  torso: { label: 'Pesas · torso', met: { ligera: 3.0, moderada: 3.5, intensa: 6.0 } },
  pierna: { label: 'Pesas · pierna', met: { ligera: 3.5, moderada: 5.0, intensa: 6.0 } },
  completo: { label: 'Pesas · cuerpo completo', met: { ligera: 3.5, moderada: 5.0, intensa: 6.0 } },
  cardio: { label: 'Cardio (bici, elíptica…)', met: { ligera: 4.0, moderada: 5.0, intensa: 8.0 } },
};
const INTENSITY_LABEL = { ligera: 'Ligera', moderada: 'Moderada', intensa: 'Intensa' };

// Íconos SVG en línea (trazo heredado del color del texto)
const finePointer = () => window.matchMedia('(pointer: fine)').matches;

const svgIcon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ICON = {
  close: svgIcon('M6 6l12 12M18 6L6 18'),
  dots: svgIcon('M5 12h.01M12 12h.01M19 12h.01'),
  plus: svgIcon('M12 5v14M5 12h14'),
  edit: svgIcon('M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4'),
  trash: svgIcon('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
};

const DEFAULT_GOALS = { kcal: 2100, protein: 180, carbs: 200, fat: 65, fiber: 30, water_ml: 3500, steps: 8000, sleep_h: 7, burn: 450 };
const CONFIG_KEY = 'cc-config';
// Proyecto Supabase por defecto. La clave "publishable" es pública por diseño:
// los datos están protegidos por el inicio de sesión y Row Level Security.
const DEFAULT_SUPABASE = {
  supabaseUrl: 'https://xhylwvmrpdcbplubqoww.supabase.co',
  supabaseKey: 'sb_publishable_Q8iVqrvOtIGJKUNRqB21XA_wK2MlNEY',
};
const ADJUST_KEY = 'cc-last-adjust';

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
const todayISO = () => toISO(new Date());
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
const prettyDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  fromISO(iso).toLocaleDateString('es-CO', opts);
const shortDate = (iso) => prettyDate(iso, { day: 'numeric', month: 'short' }).replace(' de ', ' ');

function defaultMealForNow(meals = dayMeals()) {
  const h = new Date().getHours();
  const night = h >= 21 || h < 5;
  const pref = night ? 'cena' : h < 14 ? 'desayuno' : h < 18 ? 'almuerzo' : 'snack';
  if (meals.some((m) => m.id === pref)) return pref;
  if (night) return meals[meals.length - 1].id;
  if (h < 14) return meals[0].id;
  return meals[Math.min(1, meals.length - 1)].id;
}

// Comidas del día seleccionado: las guardadas para ese día, o las 3 de base.
// Si hay alimentos en una comida que no está en la lista (registros antiguos), se muestra igual.
function dayMeals() {
  const saved = Array.isArray(state.body?.meals) && state.body.meals.length ? state.body.meals : null;
  const meals = saved
    ? saved.map((m) => ({ id: m.id, label: m.label }))
    : DEFAULT_MEALS.map((id) => ({ id, label: MEAL_INFO[id].label }));
  for (const e of state.entries) {
    if (!meals.some((m) => m.id === e.meal)) meals.push({ id: e.meal, label: MEAL_INFO[e.meal]?.label || 'Otra comida' });
  }
  return meals;
}

function unitShort(p) {
  if (p.base_type === 'unit') return p.unit_label || 'porción';
  return p.base_type;
}
function baseLabel(p) {
  if (p.base_type === 'unit') return `por ${fmt(p.base_amount, 2)} ${p.unit_label || 'porción'}`;
  return `por ${fmt(p.base_amount, 2)} ${p.base_type}`;
}
function nutrientsFor(p, amount) {
  const f = amount / p.base_amount;
  return {
    kcal: r1(p.kcal * f),
    protein: r1((p.protein || 0) * f),
    carbs: r1((p.carbs || 0) * f),
    fat: r1((p.fat || 0) * f),
    fiber: r1((p.fiber || 0) * f),
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
    const offline = !navigator.onLine && state.db && state.db.kind === 'supabase';
    toast(offline ? `${errMsg}: no hay conexión a internet. Inténtalo de nuevo cuando vuelva.` : `${errMsg}: ${err.message || err}`, true);
    return FAIL;
  }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const state = {
  db: null,
  localDB: new LocalDB(),
  sb: null,
  user: null,
  products: [],
  goals: { ...DEFAULT_GOALS },
  profile: null,
  date: todayISO(),
  entries: [],
  body: null, // registro corporal del día seleccionado
  range: 7,
  wrange: 30,
  editingEntry: null,
  pickedProduct: null,
};

function readConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch { return {}; }
}
function writeConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}
// Configuración efectiva: la guardada por el usuario, o el proyecto por defecto
// (salvo que el usuario haya quitado la conexión).
function effectiveConfig() {
  const c = readConfig();
  if (c.supabaseUrl && c.supabaseKey) return c;
  if (c.localOnly) return {};
  return { ...DEFAULT_SUPABASE };
}

// ---------------------------------------------------------------------------
// Conexión a la base de datos
// ---------------------------------------------------------------------------
async function initDatabase() {
  const cfg = effectiveConfig();
  state.db = state.localDB;
  state.sb = null;
  state.user = null;

  if (cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      state.sb = await getSupabaseClient(cfg.supabaseUrl, cfg.supabaseKey);
      const { data } = await state.sb.auth.getSession();
      if (data.session) {
        state.user = data.session.user;
        state.db = new SupabaseDB(state.sb, state.user);
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
  const cfg = effectiveConfig();
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey);
  const cloud = state.db && state.db.kind === 'supabase';

  $('#dbBadgeText').textContent = cloud ? 'Nube' : configured ? 'Entrar' : 'Local';
  badge.title = cloud ? `Datos en la nube · ${state.user.email}` : configured ? 'Inicia sesión para guardar en la nube' : 'Datos guardados en este dispositivo';
  badge.classList.toggle('cloud', cloud);
  badge.classList.toggle('local', !cloud && !configured);
  $('#loginBanner').classList.toggle('hidden', cloud || !configured || !state.sb);

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
}

function stripNulls(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = Number(v);
  return out;
}

async function reloadAll() {
  await safe(async () => {
    state.products = await state.db.listProducts();
    state.goals = { ...DEFAULT_GOALS, ...stripNulls((await state.db.getGoals()) || {}) };
    state.profile = await state.db.getProfile();
  }, 'No se pudieron cargar los datos');
  fillGoalsForm();
  fillProfileForm();
  renderPlan();
  renderProducts();
  await loadDay();
  if ($('#view-progreso').classList.contains('active')) await renderProgress();
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
  document.body.dataset.view = name;
  if (name === 'progreso') renderProgress();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Diario
// ---------------------------------------------------------------------------
function renderDateLabel() {
  const today = todayISO();
  const diff = daysBetween(state.date, today);
  const base = fromISO(state.date).toLocaleDateString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(state.date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
  }).replace(/\./g, '').replace(' de ', ' ');
  const prefix = diff === 0 ? 'Hoy · ' : diff === 1 ? 'Ayer · ' : diff === -1 ? 'Mañana · ' : '';
  $('#dateLabel').textContent = prefix + base;
  $('#todayBtn').classList.toggle('hidden', diff === 0);
}

async function loadDay() {
  $('#dateInput').value = state.date;
  renderDateLabel();
  const [entries, body] = await Promise.all([
    safe(() => state.db.listEntries(state.date), 'No se pudo cargar el día'),
    safe(() => state.db.getBody(state.date), 'No se pudo cargar el registro corporal'),
  ]);
  state.entries = entries === FAIL ? [] : entries;
  state.body = body === FAIL || !body ? { date: state.date } : body;
  renderDay();
  await renderHabits();
}

function totals(list) {
  return list.reduce((acc, e) => {
    acc.kcal += num(e.kcal); acc.protein += num(e.protein);
    acc.carbs += num(e.carbs); acc.fat += num(e.fat); acc.fiber += num(e.fiber);
    return acc;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

function renderDay() {
  const t = totals(state.entries);
  const g = state.goals;

  const circ = 2 * Math.PI * 52;
  const pct = g.kcal > 0 ? Math.min(t.kcal / g.kcal, 1) : 0;
  const ring = $('#ringFg');
  ring.style.strokeDasharray = `${circ}`;
  ring.style.strokeDashoffset = `${circ * (1 - pct)}`;
  const over = g.kcal > 0 && t.kcal > g.kcal;
  ring.classList.toggle('over', over);
  $('#kcalConsumed').textContent = fmt(r0(t.kcal));
  $('#kcalGoalLabel').textContent = `Meta ${fmt(g.kcal)} kcal`;
  const rem = $('#kcalRemaining');
  rem.textContent = over
    ? `Te pasaste por ${fmt(r0(t.kcal - g.kcal))} kcal`
    : `Te quedan ${fmt(r0(g.kcal - t.kcal))} kcal`;
  rem.classList.toggle('over', over);

  for (const m of ['protein', 'carbs', 'fat', 'fiber']) {
    const el = $(`.macro[data-macro="${m}"]`);
    const goal = num(g[m]);
    $('.macro-val', el).textContent = `${fmt(t[m], 0)} / ${fmt(goal, 0)} g`;
    $('.bar-fill', el).style.width = `${goal > 0 ? Math.min((t[m] / goal) * 100, 100) : 0}%`;
  }

  const meals = dayMeals();
  const proteinPerMeal = num(g.protein) / meals.length;
  $('#meals').innerHTML = meals.map((meal) => {
    const list = state.entries.filter((e) => e.meal === meal.id);
    const mt = totals(list);
    const pClass = mt.protein >= proteinPerMeal * 0.9 ? 'ok' : list.length ? 'low' : '';
    const time = MEAL_INFO[meal.id] && MEAL_INFO[meal.id].label === meal.label ? MEAL_INFO[meal.id].time : '';
    const items = list.length
      ? list.map((e) => `
        <div class="entry">
          <div class="entry-main" data-edit="${e.id}" role="button" tabindex="0" title="Editar cantidad">
            <div class="entry-name">${esc(e.product_name)}</div>
            <div class="entry-sub">${fmt(e.amount, 2)} ${esc(e.unit)} · <span class="m-p">P ${fmt(e.protein, 1)}</span> · <span class="m-c">C ${fmt(e.carbs, 1)}</span> · <span class="m-f">G ${fmt(e.fat, 1)}</span></div>
          </div>
          <span class="entry-kcal">${fmt(r0(e.kcal))}</span>
          <button class="del-btn" data-del-entry="${e.id}" aria-label="Eliminar ${esc(e.product_name)}">${ICON.close}</button>
        </div>`).join('')
      : '';
    return `
      <div class="card meal">
        <div class="meal-head">
          <div class="meal-name"><h3>${esc(meal.label)}</h3></div>
          <div class="meal-head-right">
            <span class="meal-kcal">${fmt(r0(mt.kcal))} kcal</span>
            <button class="icon-btn small plain" data-edit-meal="${esc(meal.id)}" title="Renombrar o quitar comida" aria-label="Opciones de ${esc(meal.label)}">${ICON.dots}</button>
          </div>
        </div>
        <div class="meal-meta">
          <span class="pchip ${pClass}" title="Meta: ≈ ${fmt(proteinPerMeal)} g de proteína por comida (${fmt(g.protein)} g entre ${meals.length} comidas)">Proteína ${fmt(mt.protein, 0)} / ≈${fmt(proteinPerMeal)} g</span>
          ${time ? `<span class="meal-time">${time}</span>` : ''}
        </div>
        ${items}
        <button class="add-food-btn" type="button" data-add-meal="${esc(meal.id)}">${ICON.plus} Agregar alimento</button>
      </div>`;
  }).join('') + `
    <button class="add-meal-btn" type="button" data-new-meal>+ Agregar comida</button>`;
}

// ---------------------------------------------------------------------------
// Hábitos del día (peso, pasos, sueño, cintura, agua)
// ---------------------------------------------------------------------------
async function renderHabits() {
  const b = state.body || {};
  const g = state.goals;
  const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v ?? ''; };
  setVal('#hWeight', b.weight);
  setVal('#hSteps', b.steps);
  setVal('#hSleep', b.sleep_h);
  setVal('#hWaist', b.waist);

  const steps = num(b.steps);
  const sh = $('#hStepsHint');
  const spk = stepsPerKm();
  const kmDone = steps / spk;
  const kmMissing = (g.steps - steps) / spk;
  sh.textContent = !steps
    ? `meta ${fmt(g.steps)} pasos (≈ ${fmt(g.steps / spk, 1)} km)`
    : steps >= g.steps
      ? `✓ meta cumplida · llevas ≈ ${fmt(kmDone, 1)} km`
      : `llevas ≈ ${fmt(kmDone, 1)} km · faltan ${fmt(g.steps - steps)} pasos (≈ ${fmt(kmMissing, 1)} km)`;
  sh.className = `hint ${steps >= g.steps ? 'ok' : steps ? 'warn' : ''}`;
  renderActivity();

  const sleep = num(b.sleep_h);
  const slh = $('#hSleepHint');
  slh.textContent = sleep ? (sleep >= g.sleep_h ? '✓ bien' : `menos de ${fmt(g.sleep_h, 2)} h`) : `meta ${fmt(g.sleep_h, 2)} h o más`;
  slh.className = `hint ${sleep >= g.sleep_h ? 'ok' : sleep ? 'warn' : ''}`;

  const water = num(b.water_ml);
  $('#waterVal').textContent = `${fmt(water)} / ${fmt(g.water_ml)} ml`;
  $('#waterFill').style.width = `${g.water_ml > 0 ? Math.min((water / g.water_ml) * 100, 100) : 0}%`;

  // Cintura: recordatorio semanal
  const wh = $('#hWaistHint');
  if (num(b.waist)) {
    wh.textContent = '✓ medida hoy';
    wh.className = 'hint ok';
  } else {
    const logs = await safe(() => state.db.listBody(addDays(state.date, -60), addDays(state.date, -1)), 'Error');
    const last = logs === FAIL ? null : logs.filter((l) => num(l.waist)).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (!last) {
      wh.textContent = 'mídela 1 vez por semana';
      wh.className = 'hint';
    } else {
      const days = daysBetween(last.date, state.date);
      wh.textContent = days >= 7 ? `toca medirla (última: ${fmt(last.waist, 1)} cm)` : `última: ${fmt(last.waist, 1)} cm, hace ${days} d`;
      wh.className = `hint ${days >= 7 ? 'warn' : ''}`;
    }
  }
}

// Pasos por kilómetro según la longitud de zancada estimada (≈ 41,5 % de la estatura en hombres, 41,3 % en mujeres).
function stepsPerKm() {
  const p = state.profile;
  const h = p && num(p.height) > 0 ? num(p.height) : 175;
  const stride = h * (p && p.sex === 'f' ? 0.413 : 0.415); // cm por paso
  return 100000 / stride;
}

async function addKm() {
  const input = $('#hKm');
  const km = num(input.value);
  if (km <= 0) {
    toast('Escribe cuántos km caminaste', true);
    input.focus();
    return;
  }
  const added = Math.round(km * stepsPerKm());
  const total = Math.round(num($('#hSteps').value)) + added;
  $('#hSteps').value = total;
  input.value = '';
  clearTimeout(habitsTimer);
  await saveHabits();
  toast(`+${fmt(km, 2)} km = ${fmt(added)} pasos (total ${fmt(total)})`);
}

// ---------------------------------------------------------------------------
// Calorías por quemar: pasos + entrenamientos
// ---------------------------------------------------------------------------
function bodyWeight() {
  return num(state.body?.weight) || num(state.profile?.weight) || 80;
}
// Caminar: ≈ 0,5 kcal por kg y por km por encima del reposo.
function stepsKcal(steps) {
  return Math.round((num(steps) / stepsPerKm()) * bodyWeight() * 0.5);
}
function workoutKcal(type, minutes, intensity) {
  const met = WORKOUT_TYPES[type]?.met[intensity] ?? 3.5;
  return Math.round((met - 1) * bodyWeight() * (num(minutes) / 60));
}
function workoutsOf(log) {
  return Array.isArray(log?.workouts) ? log.workouts : [];
}
function burnedOf(log) {
  const sk = stepsKcal(num(log?.steps));
  const wk = workoutsOf(log).reduce((sum, w) => sum + num(w.kcal), 0);
  return { steps: sk, workouts: wk, total: sk + wk };
}

function renderActivity() {
  const b = state.body || {};
  const goal = num(state.goals.burn);
  const burned = burnedOf(b);
  const left = goal - burned.total;
  $('#burnLeft').textContent = fmt(Math.max(0, left));
  const label = $('#burnLabel');
  label.textContent = goal <= 0
    ? 'Define tu meta en Ajustes'
    : left > 0 ? `kcal por quemar · meta ${fmt(goal)}` : `✓ meta cumplida (+${fmt(-left)} kcal)`;
  label.classList.toggle('ok', goal > 0 && left <= 0);
  $('#burnFill').style.width = `${goal > 0 ? Math.min((burned.total / goal) * 100, 100) : 0}%`;
  $('#burnBreakdown').textContent = `Quemadas ${fmt(burned.total)} kcal · pasos ${fmt(burned.steps)} · entrenamiento ${fmt(burned.workouts)}`;

  const list = workoutsOf(b);
  $('#workoutList').innerHTML = list.map((w) => `
    <div class="entry">
      <div class="entry-main">
        <div class="entry-name">${esc(WORKOUT_TYPES[w.type]?.label || 'Entrenamiento')}</div>
        <div class="entry-sub">${fmt(w.minutes)} min · ${esc(INTENSITY_LABEL[w.intensity] || '')}</div>
      </div>
      <span class="entry-kcal">−${fmt(w.kcal)} kcal</span>
      <button class="del-btn" data-del-workout="${esc(w.id)}" aria-label="Eliminar entrenamiento">${ICON.close}</button>
    </div>`).join('');
}

// Guarda cambios en el registro del día (comidas, entrenamientos) sin tocar los campos que se están escribiendo.
async function saveBodyPatch(patch) {
  const log = { ...state.body, ...patch, date: state.date };
  if (await safe(() => state.db.saveBody(log), 'No se pudo guardar') === FAIL) return false;
  state.body = log;
  return true;
}

function openWorkoutDialog() {
  const f = $('#workoutForm');
  f.reset();
  f.querySelector('input[name="type"][value="torso"]').checked = true;
  f.querySelector('input[name="intensity"][value="moderada"]').checked = true;
  f.minutes.value = 60;
  updateWorkoutPreview();
  $('#workoutDialog').showModal();
}

function updateWorkoutPreview() {
  const f = $('#workoutForm');
  const kcal = workoutKcal(f.type.value, f.minutes.value, f.intensity.value);
  $('#workoutPreview').innerHTML = `<div><strong>≈ ${fmt(kcal)}</strong><span>kcal quemadas (con ${fmt(bodyWeight(), 1)} kg)</span></div>`;
}

async function submitWorkout(ev) {
  ev.preventDefault();
  const f = $('#workoutForm');
  const minutes = Math.round(num(f.minutes.value));
  if (minutes <= 0) return toast('Indica cuántos minutos entrenaste', true);
  const w = {
    id: uuid(),
    type: f.type.value,
    minutes,
    intensity: f.intensity.value,
    kcal: workoutKcal(f.type.value, minutes, f.intensity.value),
  };
  if (!(await saveBodyPatch({ workouts: [...workoutsOf(state.body), w] }))) return;
  $('#workoutDialog').close();
  renderActivity();
  toast(`${WORKOUT_TYPES[w.type].label}: −${fmt(w.kcal)} kcal`);
}

async function deleteWorkout(id) {
  const w = workoutsOf(state.body).find((x) => x.id === id);
  if (!w || !confirm(`¿Eliminar "${WORKOUT_TYPES[w.type]?.label || 'entrenamiento'}" (${fmt(w.minutes)} min)?`)) return;
  if (!(await saveBodyPatch({ workouts: workoutsOf(state.body).filter((x) => x.id !== id) }))) return;
  renderActivity();
}

// ---------------------------------------------------------------------------
// Comidas del día: agregar, renombrar, quitar
// ---------------------------------------------------------------------------
let editingMealId = null;

function openMealDialog(mealId = null) {
  editingMealId = mealId;
  const f = $('#mealForm');
  f.reset();
  const meals = dayMeals();
  const meal = meals.find((m) => m.id === mealId);
  $('#mealDialogTitle').textContent = meal ? `Editar "${meal.label}"` : 'Agregar comida';
  $('#mealSubmit').textContent = meal ? 'Guardar nombre' : 'Agregar';
  f.label.value = meal ? meal.label : '';
  const used = new Set(meals.map((m) => m.label.toLowerCase()));
  $('#mealChips').innerHTML = MEAL_SUGGESTIONS
    .filter((n) => !used.has(n.toLowerCase()) || (meal && meal.label === n))
    .map((n) => `<button type="button" class="chip chip-btn" data-meal-chip="${esc(n)}">${esc(n)}</button>`).join('');

  const box = $('#mealRemoveBox');
  box.classList.toggle('hidden', !meal);
  if (meal) {
    const count = state.entries.filter((e) => e.meal === meal.id).length;
    const others = meals.filter((m) => m.id !== meal.id);
    $('#mealRemoveText').textContent = others.length
      ? count
        ? `Esta comida tiene ${count} alimento${count === 1 ? '' : 's'}. Al quitarla puedes moverlos a otra comida (útil cuando juntas desayuno y almuerzo).`
        : 'Esta comida no tiene alimentos.'
      : 'Es la única comida del día: no se puede quitar.';
    $('#mealMoveField').classList.toggle('hidden', !count || !others.length);
    f.moveTo.innerHTML = others.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')
      + '<option value="__delete">Eliminar sus alimentos</option>';
    $('#mealRemoveBtn').disabled = !others.length;
  }
  $('#mealDialog').showModal();
  if (!meal) f.label.focus();
}

async function submitMeal(ev) {
  ev.preventDefault();
  const label = $('#mealForm').label.value.trim();
  if (!label) return toast('Escribe un nombre para la comida', true);
  const meals = dayMeals();
  let next;
  if (editingMealId) {
    next = meals.map((m) => (m.id === editingMealId ? { ...m, label } : m));
  } else {
    if (meals.length >= 8) return toast('Máximo 8 comidas por día', true);
    // Ubica la comida nueva en orden del día según su nombre (Desayuno → … → Cena → Snack); si es otra, al final.
    const rank = (l) => {
      const i = MEAL_SUGGESTIONS.findIndex((n) => n.toLowerCase() === l.toLowerCase());
      return i === -1 ? Infinity : i;
    };
    const meal = { id: `m-${uuid().slice(0, 8)}`, label };
    const r = rank(label);
    const pos = r === Infinity ? -1 : meals.findIndex((m) => rank(m.label) > r);
    next = pos === -1 ? [...meals, meal] : [...meals.slice(0, pos), meal, ...meals.slice(pos)];
  }
  if (!(await saveBodyPatch({ meals: next }))) return;
  $('#mealDialog').close();
  renderDay();
  toast(editingMealId ? 'Comida renombrada' : `"${label}" agregada`);
}

async function removeMeal() {
  const meals = dayMeals();
  const meal = meals.find((m) => m.id === editingMealId);
  if (!meal || meals.length <= 1) return;
  const list = state.entries.filter((e) => e.meal === meal.id);
  const target = $('#mealForm').moveTo.value;
  const targetMeal = meals.find((m) => m.id === target);
  const msg = !list.length
    ? `¿Quitar "${meal.label}" de este día?`
    : target === '__delete'
      ? `¿Quitar "${meal.label}" y eliminar sus ${list.length} alimentos?`
      : `¿Quitar "${meal.label}" y mover sus ${list.length} alimentos a "${targetMeal.label}"?`;
  if (!confirm(msg)) return;
  for (const e of list) {
    const r = target === '__delete'
      ? await safe(() => state.db.deleteEntry(e.id), 'No se pudo eliminar')
      : await safe(() => state.db.saveEntry({ ...e, meal: target }), 'No se pudo mover');
    if (r === FAIL) return;
  }
  const remaining = meals.filter((m) => m.id !== meal.id);
  if (!(await saveBodyPatch({ meals: remaining }))) return;
  const entries = await safe(() => state.db.listEntries(state.date), 'No se pudo cargar el día');
  if (entries !== FAIL) state.entries = entries;
  $('#mealDialog').close();
  renderDay();
  toast(`"${meal.label}" quitada de este día`);
}

let habitsTimer;
function queueHabitsSave() {
  clearTimeout(habitsTimer);
  $('#habitsStatus').textContent = 'Guardando…';
  habitsTimer = setTimeout(saveHabits, 500);
}

async function saveHabits() {
  const steps = optNum($('#hSteps').value);
  const log = {
    ...state.body,
    date: state.date,
    weight: optNum($('#hWeight').value),
    steps: steps != null ? Math.round(steps) : null,
    sleep_h: optNum($('#hSleep').value),
    waist: optNum($('#hWaist').value),
    water_ml: state.body?.water_ml ?? null,
  };
  if (await safe(() => state.db.saveBody(log), 'No se pudo guardar') === FAIL) {
    $('#habitsStatus').textContent = '';
    return;
  }
  state.body = log;
  await renderHabits();
  $('#habitsStatus').textContent = 'Guardado ✓';
}

async function addWater(delta) {
  const current = num(state.body?.water_ml);
  state.body = { ...state.body, date: state.date, water_ml: Math.max(0, current + delta) };
  await saveHabits();
}

// ---------------------------------------------------------------------------
// Diálogo de registro
// ---------------------------------------------------------------------------
function openEntryDialog({ meal = defaultMealForNow(), entry = null } = {}) {
  const form = $('#entryForm');
  form.reset();
  $('#mealSelect').innerHTML = dayMeals()
    .map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
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
    renderQuickAmounts(entry.unit === 'g' || entry.unit === 'ml' ? entry.unit : 'unit');
  } else {
    $('#entryDialogTitle').textContent = 'Agregar alimento';
    $('#entrySubmit').textContent = 'Agregar';
    form.meal.value = meal;
    $('#productPicker').classList.remove('hidden');
    $('#selectedProduct').classList.add('hidden');
    $('#pickerSearch').value = '';
    $('#amountUnit').textContent = 'g';
    $('#quickAmounts').innerHTML = '';
    renderPicker();
  }
  updateEntryPreview();
  $('#entryDialog').showModal();
  $('#entryDialog .sheet-body').scrollTop = 0;
  if (!entry && finePointer()) $('#pickerSearch').focus();
}

// Botones de cantidad rápida según la unidad del producto
function renderQuickAmounts(unit) {
  const mass = unit === 'g' || unit === 'ml';
  const values = mass ? [50, 100, 150, 200, 250, 300] : [0.5, 1, 2, 3, 4];
  const current = num($('#entryForm').amount.value);
  $('#quickAmounts').innerHTML = values.map((v) =>
    `<button type="button" class="chip chip-btn${v === current ? ' on' : ''}" data-quick-amount="${v}">${fmt(v, 1)}${mass ? ` ${unit}` : ''}</button>`).join('');
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
        <span class="pi-name">${esc(p.name)}${p.brand ? ` <small>· ${esc(p.brand)}</small>` : ''}</span>
        <span class="pi-sub">${fmt(p.kcal, 1)} kcal · <span class="m-p">P ${fmt(p.protein, 1)}</span> · <span class="m-c">C ${fmt(p.carbs, 1)}</span> · <span class="m-f">G ${fmt(p.fat, 1)}</span> · ${esc(baseLabel(p))}</span>
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
  renderQuickAmounts(p.base_type === 'unit' ? 'unit' : p.base_type);
  updateEntryPreview();
  if (finePointer()) { amount.focus(); amount.select(); }
}

function computeEntryNutrients() {
  const amount = num($('#entryForm').amount.value);
  if (amount <= 0) return null;
  if (state.editingEntry) {
    const e = state.editingEntry;
    const f = amount / num(e.amount);
    return {
      kcal: r1(num(e.kcal) * f), protein: r1(num(e.protein) * f), carbs: r1(num(e.carbs) * f),
      fat: r1(num(e.fat) * f), fiber: r1(num(e.fiber) * f),
    };
  }
  if (!state.pickedProduct) return null;
  return nutrientsFor(state.pickedProduct, amount);
}

function updateEntryPreview() {
  const n = computeEntryNutrients() || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  $('#entryPreview').innerHTML = `
    <div><strong>${fmt(r0(n.kcal))}</strong><span>kcal</span></div>
    <div><strong>${fmt(n.protein, 1)}</strong><span>Prot. g</span></div>
    <div><strong>${fmt(n.carbs, 1)}</strong><span>Carb. g</span></div>
    <div><strong>${fmt(n.fat, 1)}</strong><span>Grasa g</span></div>`;
  const current = num($('#entryForm').amount.value);
  $$('#quickAmounts [data-quick-amount]').forEach((b) => b.classList.toggle('on', num(b.dataset.quickAmount) === current));
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
  const editing = !!state.editingEntry;
  let entry;
  if (editing) {
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
  toast(editing ? 'Registro actualizado' : `${entry.product_name} agregado`);
  const entries = await safe(() => state.db.listEntries(state.date), 'No se pudo cargar el día');
  if (entries !== FAIL) state.entries = entries;
  renderDay();
}

async function deleteEntry(id) {
  const e = state.entries.find((x) => x.id === id);
  if (!e || !confirm(`¿Eliminar "${e.product_name}" de este día?`)) return;
  if (await safe(() => state.db.deleteEntry(id), 'No se pudo eliminar') === FAIL) return;
  state.entries = state.entries.filter((x) => x.id !== id);
  renderDay();
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
        <strong>Todavía no has creado productos</strong>
        <p class="small">Crea tus alimentos con los valores de la etiqueta (huevos, pollo, atún, lentejas…) y luego regístralos en tu diario.</p>
        <button class="btn primary" type="button" data-goto-new-product>+ Crear mi primer producto</button>
      </div>`;
    return;
  }
  el.innerHTML = list.length
    ? list.map((p) => `
      <article class="product">
        <div class="product-top">
          <div class="product-info" data-edit-product="${p.id}" role="button" tabindex="0" title="Editar">
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-brand">${p.brand ? `${esc(p.brand)} · ` : ''}${esc(baseLabel(p))}</div>
          </div>
          <div class="product-kcal">${fmt(p.kcal, 1)} <small>kcal</small></div>
        </div>
        <div class="product-bottom">
          <div class="chips">
            <span class="chip p">P ${fmt(p.protein, 1)}</span>
            <span class="chip c">C ${fmt(p.carbs, 1)}</span>
            <span class="chip f">G ${fmt(p.fat, 1)}</span>
            ${p.fiber != null ? `<span class="chip">Fib ${fmt(p.fiber, 1)}</span>` : ''}
          </div>
          <div class="product-actions">
            <button class="icon-btn small plain" data-edit-product="${p.id}" aria-label="Editar ${esc(p.name)}">${ICON.edit}</button>
            <button class="icon-btn small plain danger" data-del-product="${p.id}" aria-label="Eliminar ${esc(p.name)}">${ICON.trash}</button>
          </div>
        </div>
      </article>`).join('')
    : '<p class="empty">Ningún producto coincide con la búsqueda.</p>';
}

function syncUnitField() {
  const isUnit = $('#productForm').base_type.value === 'unit';
  $('.unit-label-field').classList.toggle('hidden', !isUnit);
}

function updateMacroHint() {
  const f = $('#productForm');
  const est = num(f.protein.value) * 4 + num(f.carbs.value) * 4 + num(f.fat.value) * 9;
  $('#macroHint').textContent = est > 0 ? `Estimación por macros (4/4/9): ≈ ${fmt(r0(est))} kcal.` : '';
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
  form.name.focus();
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
// Progreso
// ---------------------------------------------------------------------------
async function renderProgress() {
  const today = todayISO();
  const from = addDays(today, -(Math.max(56, state.wrange + 6) - 1));
  const [logsR, entriesR] = await Promise.all([
    safe(() => state.db.listBody(from, today), 'No se pudo cargar el progreso'),
    safe(() => state.db.listEntries(addDays(today, -55), today), 'No se pudo cargar el historial'),
  ]);
  const logs = logsR === FAIL ? [] : logsR;
  const entries = entriesR === FAIL ? [] : entriesR;

  const analysis = weeklyAnalysis(logs, today, addDays, 8);
  renderRecommendation(analysis.rec);
  renderWeightChart(logs, today);
  renderWeeksTable(analysis.blocks, entries, logs);
  renderCalorieHistory(entries, today);
}

function renderRecommendation(rec) {
  const card = $('#recCard');
  const last = localStorage.getItem(ADJUST_KEY);
  const recentlyAdjusted = last && daysBetween(last, todayISO()) < 14;
  const icon = { ok: '✅', down: '⬇️', up: '⬆️', info: 'ℹ️' }[rec.type];
  let action = '';
  if (rec.delta) {
    action = recentlyAdjusted
      ? `<p class="muted small">Ya ajustaste tus metas el ${esc(shortDate(last))}. Espera 2 semanas desde ese cambio antes de volver a ajustar.</p>`
      : `<div class="row"><button class="btn primary small" type="button" data-apply-adjust="${rec.delta}">
          ${rec.delta > 0 ? 'Sumar' : 'Restar'} 150 kcal (${fmt(state.goals.kcal)} → ${fmt(state.goals.kcal + rec.delta)})</button></div>`;
  }
  card.className = `card rec ${rec.type}`;
  card.innerHTML = `
    <span class="rec-icon" aria-hidden="true">${icon}</span>
    <div class="rec-body">
      <h2>Recomendación</h2>
      <p>${esc(rec.text)}</p>
      ${action}
    </div>`;
}

async function applyAdjust(delta) {
  const goals = {
    ...state.goals,
    kcal: state.goals.kcal + delta,
    carbs: Math.max(0, r1(state.goals.carbs + delta / 4)),
  };
  if (!confirm(`¿Cambiar tus metas a ${fmt(goals.kcal)} kcal y ${fmt(goals.carbs, 1)} g de carbohidratos?`)) return;
  if (await safe(() => state.db.saveGoals(goals), 'No se pudieron guardar las metas') === FAIL) return;
  state.goals = goals;
  localStorage.setItem(ADJUST_KEY, todayISO());
  fillGoalsForm();
  renderDay();
  renderPlan();
  await renderProgress();
  toast('Metas ajustadas');
}

// Tamaño real del gráfico: el SVG se dibuja al ancho del contenedor para que el texto se lea a 11 px reales.
function chartSize(el, h = 200) {
  const w = Math.round(el.clientWidth || el.parentElement?.clientWidth || 320);
  return { W: Math.max(260, w), H: h };
}
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const shortDM = (iso) => {
  const d = fromISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

function renderWeightChart(logs, today) {
  const days = state.wrange;
  const start = addDays(today, -(days - 1));
  const byDate = new Map(logs.filter((l) => num(l.weight) > 0).map((l) => [l.date, num(l.weight)]));
  const pts = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const win = [];
    for (let k = 0; k < 7; k++) {
      const v = byDate.get(addDays(d, -k));
      if (v) win.push(v);
    }
    pts.push({ date: d, w: byDate.get(d) || null, avg: win.length ? win.reduce((s2, x) => s2 + x, 0) / win.length : null });
  }
  const values = pts.flatMap((p) => [p.w, p.avg]).filter(Boolean);
  const el = $('#weightChart');
  if (!values.length) {
    el.innerHTML = '<p class="empty">Aún no hay pesos registrados. Anótalo cada mañana en <em>Hábitos del día</em>.</p>';
    return;
  }
  const { W, H } = chartSize(el, 190);
  const padL = 34, padB = 22, padT = 10, padR = 8;
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 2) { min -= 1; max += 1; }
  min = Math.floor(min - 0.5); max = Math.ceil(max + 0.5);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (days === 1 ? innerW / 2 : (i / (days - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const ticks = [min, (min + max) / 2, max];
  const nLabels = Math.max(3, Math.floor(innerW / 60));
  const labelEvery = Math.ceil(days / nLabels);

  let path = '';
  pts.forEach((p, i) => {
    if (p.avg == null) return;
    path += `${path ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`;
  });

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Peso diario y promedio de 7 días">
      ${ticks.map((t) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>
        <text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, 1)}</text>`).join('')}
      ${pts.map((p, i) => (p.w ? `<circle class="w-dot" cx="${x(i)}" cy="${y(p.w)}" r="3"><title>${esc(prettyDate(p.date))}: ${fmt(p.w, 1)} kg</title></circle>` : '')).join('')}
      <path class="w-avg" d="${path}"/>
      ${pts.map((p, i) => ((days - 1 - i) % labelEvery === 0
        ? `<text x="${x(i)}" y="${H - 5}" text-anchor="${i === days - 1 ? 'end' : 'middle'}">${shortDM(p.date)}</text>` : '')).join('')}
    </svg>`;
}

function weekRange(start, end) {
  const a = fromISO(start), b = fromISO(end);
  const mon = (d) => d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${mon(b)}`
    : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
}

function renderWeeksTable(blocks, entries, logs = []) {
  const rows = blocks.map((b, i) => {
    const prev = blocks[i + 1];
    let change = b.weight != null && prev && prev.weight != null ? b.weight - prev.weight : null;
    if (change != null && Math.abs(change) < 0.05) change = 0;
    const dayTotals = {};
    for (const e of entries) if (e.date >= b.start && e.date <= b.end) dayTotals[e.date] = (dayTotals[e.date] || 0) + num(e.kcal);
    const kcalDays = Object.values(dayTotals);
    const kcalAvg = kcalDays.length ? kcalDays.reduce((s2, x) => s2 + x, 0) / kcalDays.length : null;
    const burnDays = logs.filter((l) => l.date >= b.start && l.date <= b.end)
      .map((l) => burnedOf(l).total).filter((x) => x > 0);
    const burnAvg = burnDays.length ? burnDays.reduce((s2, x) => s2 + x, 0) / burnDays.length : null;
    if (b.weight == null && kcalAvg == null && b.waist == null && b.steps == null && b.sleep == null && burnAvg == null) return '';
    const stats = [
      b.waist != null ? `Cintura <b>${fmt(b.waist, 1)} cm</b>` : '',
      kcalAvg != null ? `Comidas <b>${fmt(r0(kcalAvg))} kcal</b>` : '',
      b.steps != null ? `Pasos <b>${fmt(r0(b.steps))}</b>` : '',
      burnAvg != null ? `Quemadas <b>${fmt(r0(burnAvg))} kcal</b>` : '',
      b.sleep != null ? `Sueño <b>${fmt(b.sleep, 1)} h</b>` : '',
    ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
    const chgClass = change == null ? '' : change < 0 ? 'chg-down' : change > 0 ? 'chg-up' : '';
    return `
      <div class="week">
        <div class="week-top">
          <span class="week-range">${i === 0 ? 'Esta semana' : esc(weekRange(b.start, b.end))}</span>
          <span class="week-weight">${b.weight != null ? `${fmt(b.weight, 1)} kg` : '—'}</span>
          <span class="chg ${chgClass}">${change == null ? '' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${fmt(Math.abs(change), 1)} kg`}</span>
        </div>
        ${stats ? `<div class="week-stats">${stats}</div>` : ''}
      </div>`;
  }).join('');
  $('#weeksList').innerHTML = rows || '<p class="empty">Todavía no hay datos semanales.</p>';
}

function renderCalorieHistory(allEntries, today) {
  const from = addDays(today, -(state.range - 1));
  const entries = allEntries.filter((e) => e.date >= from && e.date <= today);
  const days = [];
  for (let i = 0; i < state.range; i++) {
    const iso = addDays(from, i);
    days.push({ date: iso, ...totals(entries.filter((e) => e.date === iso)) });
  }
  const logged = days.filter((d) => d.kcal > 0);
  const avgK = logged.length ? logged.reduce((s2, d) => s2 + d.kcal, 0) / logged.length : 0;
  const avgP = logged.length ? logged.reduce((s2, d) => s2 + d.protein, 0) / logged.length : 0;
  const goal = num(state.goals.kcal);
  const withinGoal = logged.filter((d) => d.kcal <= goal).length;

  $('#historyStats').innerHTML = `
    <div class="stat"><span>Promedio</span><strong>${fmt(r0(avgK))} <small>kcal</small></strong></div>
    <div class="stat"><span>Proteína</span><strong>${fmt(r0(avgP))} <small>g</small></strong></div>
    <div class="stat"><span>En meta</span><strong>${withinGoal}/${logged.length} <small>días</small></strong></div>`;

  const el = $('#chart');
  const { W, H } = chartSize(el, 170);
  const padL = 38, padB = 22, padT = 14, padR = 6;
  const max = Math.max(goal, ...days.map((d) => d.kcal), 100) * 1.12;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = innerW / days.length;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = [0, Math.round(max / 2 / 100) * 100];
  const nLabels = Math.max(3, Math.floor(innerW / 44));
  const labelEvery = Math.ceil(days.length / nLabels);

  const bars = days.map((d, i) => {
    const h = (d.kcal / max) * innerH;
    const barW = Math.min(36, Math.max(2, bw * 0.64));
    const xx = padL + i * bw + (bw - barW) / 2;
    const over = goal > 0 && d.kcal > goal;
    const label = (days.length - 1 - i) % labelEvery === 0
      ? `<text x="${padL + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${shortDM(d.date)}</text>` : '';
    return `<rect class="bar-rect${over ? ' over' : ''}" x="${xx}" y="${padT + innerH - h}" width="${barW}" height="${h}" rx="3">
        <title>${esc(prettyDate(d.date))}: ${fmt(r0(d.kcal))} kcal</title></rect>${label}`;
  }).join('');

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Calorías por día">
      ${ticks.map((t) => `<text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${bars}
      ${goal > 0 ? `<line class="goal-line" x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}"><title>Meta: ${fmt(goal)} kcal</title></line>
        <text x="${padL + 4}" y="${y(goal) - 5}" text-anchor="start">Meta ${fmt(goal)}</text>` : ''}
    </svg>`;

  $('#historyList').innerHTML = [...days].reverse().map((d) => {
    const over = goal > 0 && d.kcal > goal;
    return `
      <button class="day" type="button" data-goto-date="${d.date}" title="Abrir este día">
        <span class="day-date">
          <strong>${esc(capitalize(prettyDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(' de ', ' ')))}</strong>
          ${d.kcal ? `<span class="day-macros"><span class="m-p">P ${fmt(d.protein, 0)}</span> · <span class="m-c">C ${fmt(d.carbs, 0)}</span> · <span class="m-f">G ${fmt(d.fat, 0)}</span> · Fib ${fmt(d.fiber, 0)}</span>` : '<span class="day-macros">Sin registros</span>'}
        </span>
        <span class="day-kcal ${d.kcal ? (over ? 'over' : '') : 'none'}">${d.kcal ? `${fmt(r0(d.kcal))} kcal` : '—'}</span>
      </button>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Mi plan
// ---------------------------------------------------------------------------
const PROFILE_FIELDS = ['sex', 'age', 'height', 'weight', 'waist', 'gym_days', 'session_h', 'walk_km'];

function fillProfileForm() {
  const f = $('#profileForm');
  const p = state.profile || { sex: 'm', gym_days: 4.5, session_h: 1, walk_km: 4.6 };
  for (const k of PROFILE_FIELDS) f[k].value = p[k] ?? '';
  const complete = state.profile && state.profile.weight && state.profile.height && state.profile.age;
  $('#profileSummary').textContent = complete
    ? `${fmt(p.age)} años · ${fmt(p.height)} cm · ${fmt(p.weight, 1)} kg${p.waist ? ` · cintura ${fmt(p.waist, 1)} cm` : ''}`
    : 'Complétalo para calcular tu plan';
  $('#profileBox').open = !complete;
}

async function submitProfile(ev) {
  ev.preventDefault();
  const f = $('#profileForm');
  const profile = { sex: f.sex.value };
  for (const k of PROFILE_FIELDS.slice(1)) profile[k] = optNum(f[k].value);
  if (await safe(() => state.db.saveProfile(profile), 'No se pudo guardar el perfil') === FAIL) return;
  state.profile = profile;
  fillProfileForm();
  renderPlan();
  toast('Perfil guardado. Plan recalculado.');
  $('#planResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function useLastWeight() {
  const logs = await safe(() => state.db.listBody(addDays(todayISO(), -30), todayISO()), 'Error');
  if (logs === FAIL) return;
  const last = logs.filter((l) => num(l.weight) > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return toast('No hay pesos registrados en los últimos 30 días', true);
  $('#profileForm').weight.value = last.weight;
  toast(`Peso del ${shortDate(last.date)}: ${fmt(last.weight, 1)} kg. Pulsa "Guardar y recalcular".`);
}

function renderPlan() {
  const el = $('#planResult');
  const p = state.profile;
  if (!p || !p.weight || !p.height || !p.age) {
    el.innerHTML = `<div class="card"><p class="muted small">Completa tu perfil y pulsa <strong>Guardar y recalcular</strong> para ver tus calorías y macros.</p></div>`;
    return;
  }
  const r = calcPlan(p);
  const g = r.goals;
  const cur = state.goals;
  const same = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'water_ml', 'burn'].every((k) => num(cur[k]) === num(g[k]));
  const tdee50 = r0(r.tdee / 50) * 50;
  const deficit50 = r0(r.deficit / 50) * 50;

  el.innerHTML = `
    <div class="card">
      <h2>Tus metas diarias</h2>
      <div class="plan-goals">
        <div class="stat main"><span>Calorías</span><strong>${fmt(g.kcal)} kcal</strong></div>
        <div class="stat"><span>Proteína</span><strong>${fmt(g.protein)} g</strong></div>
        <div class="stat"><span>Carbohidratos</span><strong>${fmt(g.carbs)} g</strong></div>
        <div class="stat"><span>Grasa</span><strong>${fmt(g.fat)} g</strong></div>
        <div class="stat"><span>Fibra</span><strong>${fmt(g.fiber)}+ g</strong></div>
        <div class="stat"><span>Agua</span><strong>${fmt(Math.max(2, g.water_ml / 1000 - 0.5), 1)}–${fmt(g.water_ml / 1000, 1)} L</strong></div>
        <div class="stat"><span>Pasos</span><strong>8–10 mil</strong></div>
        <div class="stat"><span>Sueño</span><strong>7+ h</strong></div>
        <div class="stat"><span>Por quemar</span><strong>${fmt(g.burn)} kcal</strong></div>
      </div>
      <div class="stack">
        <p class="muted small">Las calorías por quemar (pasos + entrenamiento) ya están contadas en tus ${fmt(g.kcal)} kcal: no las vuelvas a comer, son las que hacen que el déficit se cumpla.</p>
        ${same
          ? '<p class="muted small">✓ Estas son tus metas actuales en la app.</p>'
          : `<p class="muted small goals-diff">Tus metas actuales en la app: ${fmt(cur.kcal)} kcal · P ${fmt(cur.protein, 1)} g · C ${fmt(cur.carbs, 1)} g · G ${fmt(cur.fat, 1)} g.</p>
             <button class="btn primary block" type="button" id="applyPlanBtn">Usar estas metas en la app</button>`}
      </div>
    </div>

    <details class="card prose collapsible">
      <summary><span class="sum-title">Cómo llegué a esos números</span></summary>
      <ul class="calc-list">
        <li><strong>Gasto en reposo:</strong> unas ${fmt(r0(r.bmr))} kcal (fórmula Mifflin-St Jeor).</li>
        ${r.rfm != null ? `<li><strong>Grasa corporal estimada:</strong> alrededor del ${fmt(r0(r.rfm))}%, calculada con tu estatura y tu cintura (fórmula RFM). Es una estimación y la uso solo como referencia.</li>` : ''}
        <li><strong>Gasto total diario:</strong> unas ${fmt(tdee50)} kcal. Sumé tus pesas y los ${fmt(p.walk_km, 1)} km que caminas los días de gym (${fmt(p.gym_days, 1)} por semana) y lo promedié con las horas que pasas sentado.</li>
        <li><strong>Déficit:</strong> ${fmt(deficit50)} kcal por día (${fmt(r0(r.deficitPct * 100))}%). ${r.deficitPct >= 0.24 ? 'Con tu porcentaje de grasa es un déficit agresivo pero saludable.' : 'Es un déficit moderado para tu porcentaje de grasa.'} Te permite bajar más o menos ${fmt(r.weeklyLossKg, 1)} a ${fmt(r.weeklyLossKg + 0.3, 1)} kg por semana sin perder músculo, y hasta ganar algo si entrenas pesas. Las primeras 1 o 2 semanas bajarás más rápido porque también pierdes agua.</li>
        <li><strong>Proteína:</strong> 1,8 g por kilo de peso. Es lo que más protege el músculo mientras estás en déficit.</li>
        <li><strong>Grasa:</strong> unos 0,65 g por kilo. <strong>Carbohidratos:</strong> el resto de las calorías.</li>
      </ul>
      <p class="muted small">No te recomiendo bajar de ${fmt(g.kcal)} kcal: rendirás peor en el gym y será más difícil ganar músculo, sobre todo si duermes poco.</p>
    </details>`;
  const btn = $('#applyPlanBtn');
  if (btn) btn.addEventListener('click', () => applyPlanGoals(g));
}

async function applyPlanGoals(g) {
  const goals = { ...state.goals, ...g, steps: state.goals.steps || g.steps, sleep_h: state.goals.sleep_h || 7 };
  if (await safe(() => state.db.saveGoals(goals), 'No se pudieron guardar las metas') === FAIL) return;
  state.goals = goals;
  fillGoalsForm();
  renderDay();
  renderHabits();
  renderPlan();
  toast('Metas del plan aplicadas');
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
const GOAL_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'water_ml', 'steps', 'sleep_h', 'burn'];

function fillGoalsForm() {
  const f = $('#goalsForm');
  for (const k of GOAL_FIELDS) f[k].value = state.goals[k] ?? '';
  updateGoalsCheck();
}

function updateGoalsCheck() {
  const f = $('#goalsForm');
  const fromMacros = num(f.protein.value) * 4 + num(f.carbs.value) * 4 + num(f.fat.value) * 9;
  const diff = fromMacros - num(f.kcal.value);
  $('#goalsCheck').textContent = fromMacros
    ? `Tus macros suman ${fmt(r0(fromMacros))} kcal${Math.abs(diff) > 60 ? ` (${diff > 0 ? '+' : ''}${fmt(r0(diff))} respecto a tu meta de calorías)` : ''}.`
    : '';
}

async function submitGoals(ev) {
  ev.preventDefault();
  const f = $('#goalsForm');
  const goals = {};
  for (const k of GOAL_FIELDS) goals[k] = num(f[k].value);
  if (await safe(() => state.db.saveGoals(goals), 'No se pudieron guardar las metas') === FAIL) return;
  state.goals = goals;
  renderDay();
  renderHabits();
  renderPlan();
  toast('Metas guardadas');
}

async function submitSupabase(ev) {
  ev.preventDefault();
  const f = $('#supabaseForm');
  const url = f.url.value.trim().replace(/\/+$/, '');
  const key = f.key.value.trim();
  if (!/^https:\/\/.+/.test(url)) return toast('La URL debe empezar por https://', true);
  const { localOnly, ...rest } = readConfig();
  writeConfig({ ...rest, supabaseUrl: url, supabaseKey: key });
  await initDatabase();
  if (state.sb) toast('Conexión guardada. Ahora inicia sesión o crea una cuenta.');
}

async function forgetSupabase() {
  if (!confirm('¿Quitar la conexión con Supabase? Tus datos en la nube no se borran; la app volverá a usar la base local.')) return;
  if (state.sb) await state.sb.auth.signOut().catch(() => {});
  const cfg = readConfig();
  delete cfg.supabaseUrl; delete cfg.supabaseKey;
  writeConfig({ ...cfg, localOnly: true });
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
  await offerMigration();
}

async function signup() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPass').value;
  if (!email || password.length < 6) return toast('Correo válido y contraseña de al menos 6 caracteres', true);
  const { data, error } = await state.sb.auth.signUp({
    email, password, options: { emailRedirectTo: location.href.split('#')[0] },
  });
  if (error) {
    const closed = /not allowed|disabled/i.test(error.message);
    return toast(closed ? 'El registro de cuentas nuevas está desactivado. Si ya tienes cuenta, pulsa "Iniciar sesión".' : `No se pudo crear la cuenta: ${error.message}`, true);
  }
  if (data.session) {
    await initDatabase();
    await reloadAll();
    toast('Cuenta creada y sesión iniciada');
    await offerMigration();
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

// Si hay datos en este navegador y la cuenta en la nube está vacía, ofrece copiarlos.
async function offerMigration() {
  if (state.db.kind !== 'supabase') return;
  const local = await state.localDB.exportAll();
  const hasLocal = local.products.length || local.entries.length || local.body.length || local.profile;
  if (!hasLocal || state.products.length) return;
  await migrate();
}

async function migrate() {
  if (state.db.kind !== 'supabase') return;
  const data = await state.localDB.exportAll();
  if (!data.products.length && !data.entries.length && !data.body.length && !data.profile) {
    return toast('No hay datos locales para copiar');
  }
  if (!confirm(`Se copiarán ${data.products.length} productos, ${data.entries.length} registros de comida y ${data.body.length} días de hábitos a la nube. ¿Continuar?`)) return;
  if (await safe(() => state.db.importAll(data), 'Error al copiar') === FAIL) return;
  await reloadAll();
  toast('Datos locales copiados a la nube');
}

async function exportJSON() {
  const data = await safe(() => state.db.exportAll(), 'No se pudo exportar');
  if (data === FAIL) return;
  const blob = new Blob([JSON.stringify({ app: 'contador-calorias', version: 2, exported_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calorias-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJSON(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('El archivo no es un JSON válido', true); }
  const payload = {
    products: Array.isArray(data.products) ? data.products : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
    body: Array.isArray(data.body) ? data.body : [],
    goals: data.goals || null,
    profile: data.profile || null,
  };
  if (!payload.products.length && !payload.entries.length && !payload.body.length && !payload.goals) {
    return toast('El archivo no contiene datos de la app', true);
  }
  if (!confirm(`¿Importar ${payload.products.length} productos, ${payload.entries.length} registros y ${payload.body.length} días de hábitos? Los elementos repetidos se sobrescriben.`)) return;
  if (await safe(() => state.db.importAll(payload), 'Error al importar') === FAIL) return;
  toast('Datos importados');
  await reloadAll();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function bindEvents() {
  $('#fabAdd').addEventListener('click', () => openEntryDialog());
  // Botón flotante: se esconde al bajar y aparece al subir, para no tapar campos
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 6) return;
    $('#fabAdd').classList.toggle('fab-hidden', y > lastY && y > 120);
    lastY = y;
  }, { passive: true });
  const dateInput = $('#dateInput');
  dateInput.addEventListener('click', () => { try { dateInput.showPicker(); } catch { /* el navegador abre su selector */ } });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (document.body.dataset.view === 'progreso') renderProgress(); }, 250);
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#dbBadge').addEventListener('click', () => showView('ajustes'));
  $('#loginBannerBtn').addEventListener('click', () => { showView('ajustes'); $('#supabaseDetails').open = true; setTimeout(() => $('#authEmail').focus(), 100); });
  $('#tipsBtn').addEventListener('click', () => $('#tipsDialog').showModal());

  // Fecha
  $('#prevDay').addEventListener('click', () => { state.date = addDays(state.date, -1); loadDay(); });
  $('#nextDay').addEventListener('click', () => { state.date = addDays(state.date, 1); loadDay(); });
  $('#todayBtn').addEventListener('click', () => { state.date = todayISO(); loadDay(); });
  $('#dateInput').addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; loadDay(); } });

  // Hábitos
  ['#hWeight', '#hSteps', '#hSleep', '#hWaist'].forEach((id) => $(id).addEventListener('input', queueHabitsSave));
  $('#addKmBtn').addEventListener('click', addKm);
  $('#addWorkoutBtn').addEventListener('click', openWorkoutDialog);
  $('#workoutForm').addEventListener('submit', submitWorkout);
  $('#workoutForm').addEventListener('input', updateWorkoutPreview);
  $('#workoutForm').addEventListener('change', updateWorkoutPreview);
  $('#mealForm').addEventListener('submit', submitMeal);
  $('#mealRemoveBtn').addEventListener('click', removeMeal);
  $('#hKm').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addKm(); } });

  // Delegación global de clics
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-add-meal],[data-del-entry],[data-edit],[data-pick],[data-change-product],[data-goto-new-product],[data-edit-product],[data-del-product],[data-goto-date],[data-close],[data-water],[data-apply-adjust],[data-goto-plan],[data-edit-meal],[data-new-meal],[data-meal-chip],[data-del-workout],[data-quick-amount],[data-quick-min]');
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
    else if (d.water) addWater(Number(d.water));
    else if (d.applyAdjust) applyAdjust(Number(d.applyAdjust));
    else if ('gotoPlan' in d) { $('#tipsDialog').close(); showView('plan'); }
    else if (d.editMeal) openMealDialog(d.editMeal);
    else if ('newMeal' in d) openMealDialog();
    else if (d.mealChip) $('#mealForm').label.value = d.mealChip;
    else if (d.delWorkout) deleteWorkout(d.delWorkout);
    else if (d.quickAmount) { $('#entryForm').amount.value = d.quickAmount; updateEntryPreview(); }
    else if (d.quickMin) { $('#workoutForm').minutes.value = d.quickMin; updateWorkoutPreview(); }
    else if ('close' in d) t.closest('dialog').close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.entry-main, .product-info')) e.target.click();
  });
  // Tocar fuera de la hoja (en el fondo oscuro) la cierra
  $$('dialog.sheet').forEach((dlg) => dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }));

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

  // Progreso
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-range]').forEach((x) => x.classList.toggle('active', x === b));
    state.range = Number(b.dataset.range);
    renderProgress();
  }));
  $$('[data-wrange]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-wrange]').forEach((x) => x.classList.toggle('active', x === b));
    state.wrange = Number(b.dataset.wrange);
    renderProgress();
  }));

  // Plan
  $('#profileForm').addEventListener('submit', submitProfile);
  $('#useLastWeight').addEventListener('click', useLastWeight);

  // Ajustes
  $('#goalsForm').addEventListener('submit', submitGoals);
  $('#goalsForm').addEventListener('input', updateGoalsCheck);
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
// App móvil (PWA): service worker, instalación, accesos directos, sin conexión
// ---------------------------------------------------------------------------
let installPrompt = null;
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function renderInstallState() {
  const can = !!installPrompt && !isStandalone();
  $('#installBtn').classList.toggle('hidden', !can);
  $('#installRow').classList.toggle('hidden', !can);
  $('#installSteps').classList.toggle('hidden', isStandalone() || can);
  $('#appStatus').textContent = isStandalone()
    ? '✓ Estás usando la app instalada.'
    : can
      ? 'Instala la app para abrirla desde tu pantalla de inicio, a pantalla completa y sin conexión.'
      : 'Puedes instalar esta página como app en tu teléfono:';
}

async function promptInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  renderInstallState();
  if (outcome === 'accepted') toast('Instalando la app…');
}

function renderOnline() {
  const bar = $('#offlineBar');
  bar.classList.toggle('hidden', navigator.onLine);
  bar.textContent = state.db && state.db.kind === 'supabase'
    ? 'Sin conexión a internet. Tus datos están en la nube: no se pueden cargar ni guardar hasta que vuelva la conexión.'
    : 'Sin conexión a internet. La app sigue funcionando con los datos guardados en este teléfono.';
}

function setupPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW no registrado', err));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    renderInstallState();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstallState();
    toast('App instalada. Búscala en tu pantalla de inicio.');
  });
  $('#installBtn').addEventListener('click', promptInstall);
  $('#installBtn2').addEventListener('click', promptInstall);
  window.addEventListener('online', async () => {
    renderOnline();
    toast('Conexión recuperada');
    if (state.db && state.db.kind === 'supabase') await reloadAll();
  });
  window.addEventListener('offline', renderOnline);
  renderOnline();
  renderInstallState();
}

// Accesos directos del ícono (?action=...): se ejecutan al cerrar los tips.
function runShortcutAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  if (!action) return;
  history.replaceState(null, '', location.pathname);
  if (action === 'comida') {
    showView('hoy');
    openEntryDialog();
  } else if (action === 'habitos') {
    showView('hoy');
    $('#habitsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#hWeight').focus({ preventScroll: true });
  } else if (action === 'progreso') {
    showView('progreso');
  }
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
(async function start() {
  bindEvents();
  setupPWA();
  // Tips cada vez que se entra a la página; al cerrarlos se ejecuta el acceso directo (si lo hay)
  let dataReady;
  const ready = new Promise((r) => { dataReady = r; });
  $('#tipsDialog').addEventListener('close', () => ready.then(runShortcutAction), { once: true });
  $('#tipsDialog').showModal();
  await initDatabase();
  await reloadAll();
  renderOnline();
  dataReady();
  if (state.sb) {
    state.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && state.db.kind !== 'supabase') initDatabase().then(reloadAll).then(offerMigration);
    });
  }
})();
