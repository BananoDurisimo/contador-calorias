// Adaptador de base de datos en la nube: Supabase (PostgreSQL).
// La librería se carga solo si el usuario configura Supabase en Ajustes.
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const PRODUCT_COLS = 'id,name,brand,base_type,base_amount,unit_label,kcal,protein,carbs,fat,fiber,sugar,created_at,updated_at';
const ENTRY_COLS = 'id,date,meal,product_id,product_name,amount,unit,kcal,protein,carbs,fat,created_at';

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
  constructor(client) {
    this.kind = 'supabase';
    this.sb = client;
  }

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

  async getGoals() {
    const rows = check(await this.sb.from('goals').select('kcal,protein,carbs,fat').limit(1));
    return rows && rows[0] ? rows[0] : null;
  }

  async saveGoals(g) {
    const { data: { user } } = await this.sb.auth.getUser();
    check(await this.sb.from('goals').upsert({ user_id: user.id, ...g }, { onConflict: 'user_id' }));
  }

  // Copia masiva desde la base local (para migrar datos).
  async importAll({ products = [], entries = [], goals = null }) {
    if (products.length) check(await this.sb.from('products').upsert(products.map((p) => pick(p, PRODUCT_COLS))));
    if (entries.length) check(await this.sb.from('entries').upsert(entries.map((e) => pick(e, ENTRY_COLS))));
    if (goals) await this.saveGoals(goals);
  }

  async exportAll() {
    const products = await this.listProducts();
    const entries = check(await this.sb.from('entries').select(ENTRY_COLS));
    const goals = await this.getGoals();
    return { products, entries, goals };
  }
}
