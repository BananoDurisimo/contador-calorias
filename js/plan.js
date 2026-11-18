// Cálculos del plan nutricional y del seguimiento semanal (funciones puras).

const round = (n, step = 1) => Math.round(n / step) * step;

/**
 * Calcula calorías y macros a partir del perfil.
 * profile: { sex: 'm'|'f', age, height (cm), weight (kg), waist (cm),
 *            gym_days (por semana), session_h (horas por sesión), walk_km (km caminados por día de gym) }
 */
export function calcPlan(p) {
  const w = +p.weight, h = +p.height, a = +p.age;
  const male = p.sex !== 'f';

  // Gasto en reposo: Mifflin-St Jeor
  const bmr = 10 * w + 6.25 * h - 5 * a + (male ? 5 : -161);

  // Grasa corporal estimada: Relative Fat Mass (RFM)
  const rfm = p.waist > 0 ? (male ? 64 : 76) - 20 * (h / p.waist) : null;
  const lbm = rfm != null ? w * (1 - rfm / 100) : null;

  // Gasto total: base sedentaria + ejercicio promediado en la semana
  const sedentary = bmr * 1.2;
  const walkKcal = (+p.walk_km || 0) * w * 0.5;      // ~0,5 kcal por kg por km (neto)
  const sessionKcal = (+p.session_h || 0) * w * 2.5; // pesas + cardio moderado (neto)
  const exerciseDaily = ((walkKcal + sessionKcal) * (+p.gym_days || 0)) / 7;
  const tdee = sedentary + exerciseDaily;

  // Déficit según grasa corporal: más grasa permite un déficit mayor sin perder músculo
  const deficitPct = rfm == null ? 0.2 : rfm >= 25 ? 0.24 : rfm >= 18 ? 0.2 : 0.15;
  const kcal = round(tdee * (1 - deficitPct), 50);

  const protein = round(1.8 * w, 5);
  const fat = round(0.65 * w, 5);
  const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));
  const fiber = Math.max(25, round((kcal / 1000) * 14, 5));
  const water_ml = round(35 * w, 250);

  const deficit = tdee - kcal;
  const weeklyLossKg = (deficit * 7) / 7700;

  return {
    bmr, rfm, lbm, sedentary, walkKcal, sessionKcal, exerciseDaily, tdee,
    deficitPct, deficit, weeklyLossKg,
    goals: { kcal, protein, carbs, fat, fiber, water_ml, steps: 8000, sleep_h: 7 },
  };
}

const f1 = (n) => n.toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

/**
 * Agrupa los pesos en bloques de 7 días que terminan hoy y genera la recomendación
 * de ajuste (±150 kcal) según las reglas del plan.
 * logs: [{date, weight, waist, steps, sleep_h, water_ml}], addDays: (iso, n) => iso
 */
export function weeklyAnalysis(logs, today, addDays, weeks = 8) {
  const blocks = [];
  for (let i = 0; i < weeks; i++) {
    const end = addDays(today, -7 * i);
    const start = addDays(end, -6);
    const inBlock = logs.filter((l) => l.date >= start && l.date <= end);
    const weights = inBlock.map((l) => +l.weight).filter((x) => x > 0);
    const waists = inBlock.filter((l) => +l.waist > 0).sort((x, y) => x.date.localeCompare(y.date));
    blocks.push({
      start, end,
      weight: avg(weights),
      weighIns: weights.length,
      waist: waists.length ? +waists[waists.length - 1].waist : null,
      steps: avg(inBlock.map((l) => +l.steps).filter((x) => x > 0)),
      sleep: avg(inBlock.map((l) => +l.sleep_h).filter((x) => x > 0)),
      water: avg(inBlock.map((l) => +l.water_ml).filter((x) => x > 0)),
    });
  }

  const valid = (b) => b && b.weighIns >= 3;
  const [w0, w1, w2] = blocks;
  const weighed = logs.filter((l) => +l.weight > 0).map((l) => l.date).sort();
  const firstDate = weighed[0] || null;
  const daysTracked = firstDate ? Math.round((Date.parse(today) - Date.parse(firstDate)) / 86400000) + 1 : 0;

  let rec;
  if (!valid(w0)) {
    rec = { type: 'info', delta: 0, text: 'Pésate al menos 3 mañanas esta semana para calcular tu promedio.' };
  } else if (!valid(w1)) {
    rec = { type: 'info', delta: 0, text: 'Necesitas una semana más de datos para comparar promedios. Sigue pesándote cada mañana.' };
  } else {
    const change1 = w1.weight - w0.weight; // positivo = bajó
    if (change1 > 1.2 && daysTracked > 14) {
      rec = { type: 'up', delta: 150, text: `Bajaste ${f1(change1)} kg en la última semana (más de 1,2 kg). Suma 150 kcal para no perder músculo.` };
    } else if (change1 > 1.2) {
      rec = { type: 'info', delta: 0, text: `Bajaste ${f1(change1)} kg esta semana. En las primeras 2 semanas es normal perder agua; no cambies nada todavía.` };
    } else if (valid(w2) && w2.weight - w0.weight < 0.2) {
      rec = { type: 'down', delta: -150, text: `En 2 semanas tu promedio no ha bajado (${f1(w2.weight - w0.weight)} kg). Resta 150 kcal, quitándolas de carbohidratos o grasa.` };
    } else if (change1 <= 0) {
      rec = { type: 'info', delta: 0, text: 'Tu promedio no bajó esta semana. Si la próxima semana tampoco baja, resta 150 kcal.' };
    } else {
      rec = { type: 'ok', delta: 0, text: `Vas bien: bajaste ${f1(change1)} kg de promedio esta semana. Mantén tus metas actuales.` };
    }
  }

  return { blocks, rec, daysTracked };
}
