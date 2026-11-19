// Adaptador de base de datos en la nube: Supabase (PostgreSQL).
// La librería se carga solo si el usuario configura Supabase en Ajustes.
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const PRODUCT_COLS = 'id,name,brand,base_type,base_amount,unit_label,kcal,protein,carbs,fat,fiber,sugar,created_at,updated_at';
const ENTRY_COLS = 'id,date,meal,product_id,product_name,amount,unit,kcal,protein,carbs,fat,fiber,created_at';
const BODY_COLS = 'date,weight,waist,steps,sleep_h,water_ml,meals,workouts';
const GOAL_COLS = 'kcal,protein,carbs,fat,fiber,water_ml,steps,sleep_h,burn';

let clientCache = null;

export async function getSupabaseClient(url, anonKey) {
  if (clientCache && clientCache.url === url && clientCache.key === anonKey) return clientCache.client;
  const { createClient } = await import(SUPABASE_CDN);
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cc-supabase-auth' },
  });
  clientCache = { url, key: anonKey, client };
  return client;
}

function pick(obj, cols) {
  const out = {};
  for (const c of cols.split(',')) if (obj[c] !== undefined) out[c] = obj[c];
  return out;
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export class SupabaseDB {
  constructor(client, user) {
    this.kind = 'supabase';
    this.sb = client;
    this.userId = user.id;
  }

  // ---------- Productos ----------
  async listProducts() {
    return check(await this.sb.from('products').select(PRODUCT_COLS).order('name'));
  }

  async saveProduct(p) {
    check(await this.sb.from('products').upsert(pick(p, PRODUCT_COLS)));
    return p;
  }

  async deleteProduct(id) {
    check(await this.sb.from('products').delete().eq('id', id));
  }

  // ---------- Registros de comida ----------
  async listEntries(from, to = from) {
    return check(
      await this.sb.from('entries').select(ENTRY_COLS)
        .gte('date', from).lte('date', to).order('created_at')
    );
  }

  async saveEntry(e) {
    check(await this.sb.from('entries').upsert(pick(e, ENTRY_COLS)));
    return e;
  }

  async deleteEntry(id) {
    check(await this.sb.from('entries').delete().eq('id', id));
  }

  // ---------- Registro corporal ----------
  async listBody(from, to) {
    return check(
      await this.sb.from('body_logs').select(BODY_COLS).gte('date', from).lte('date', to).order('date')
    );
  }

  async getBody(date) {
    const rows = check(await this.sb.from('body_logs').select(BODY_COLS).eq('date', date).limit(1));
    return rows && rows[0] ? rows[0] : null;
  }

  async saveBody(log) {
    check(await this.sb.from('body_logs').upsert(
      { user_id: this.userId, ...pick(log, BODY_COLS) }, { onConflict: 'user_id,date' }
    ));
    return log;
  }

  // ---------- Metas y perfil ----------
  async getGoals() {
    const rows = check(await this.sb.from('goals').select(GOAL_COLS).limit(1));
    return rows && rows[0] ? rows[0] : null;
  }

  async saveGoals(g) {
    check(await this.sb.from('goals').upsert(
      { user_id: this.userId, ...pick(g, GOAL_COLS) }, { onConflict: 'user_id' }
    ));
  }

  async getProfile() {
    const rows = check(await this.sb.from('goals').select('profile').limit(1));
    return rows && rows[0] ? rows[0].profile : null;
  }

  async saveProfile(profile) {
    check(await this.sb.from('goals').upsert(
      { user_id: this.userId, profile }, { onConflict: 'user_id' }
    ));
  }

  // ---------- Copia completa ----------
  async importAll({ products = [], entries = [], body = [], goals = null, profile = null }) {
    if (products.length) check(await this.sb.from('products').upsert(products.map((p) => pick(p, PRODUCT_COLS))));
    if (entries.length) check(await this.sb.from('entries').upsert(entries.map((e) => pick(e, ENTRY_COLS))));
    if (body.length) {
      check(await this.sb.from('body_logs').upsert(
        body.map((b) => ({ user_id: this.userId, ...pick(b, BODY_COLS) })), { onConflict: 'user_id,date' }
      ));
    }
    if (goals) await this.saveGoals(goals);
    if (profile) await this.saveProfile(profile);
  }

  async exportAll() {
    const products = await this.listProducts();
    const entries = check(await this.sb.from('entries').select(ENTRY_COLS));
    const body = check(await this.sb.from('body_logs').select(BODY_COLS));
    const goals = await this.getGoals();
    const profile = await this.getProfile();
    return { products, entries, body, goals, profile };
  }
}
