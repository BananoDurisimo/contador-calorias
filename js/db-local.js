// Adaptador de base de datos local: IndexedDB (base de datos integrada en el navegador).
const DB_NAME = 'contador-calorias';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      // v2: registro corporal diario (peso, cintura, pasos, sueño, agua)
      if (!db.objectStoreNames.contains('body')) {
        db.createObjectStore('body', { keyPath: 'date' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class LocalDB {
  constructor() {
    this.kind = 'local';
    this.dbPromise = openDB();
  }

  // ---------- Productos ----------
  async listProducts() {
    const db = await this.dbPromise;
    const all = await tx(db, 'products', 'readonly', (s) => reqP(s.getAll()));
    return all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async saveProduct(p) {
    const db = await this.dbPromise;
    await tx(db, 'products', 'readwrite', (s) => reqP(s.put(p)));
    return p;
  }

  async deleteProduct(id) {
    const db = await this.dbPromise;
    await tx(db, 'products', 'readwrite', (s) => reqP(s.delete(id)));
  }

  // ---------- Registros de comida ----------
  async listEntries(from, to = from) {
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound(from, to);
    const all = await tx(db, 'entries', 'readonly', (s) => reqP(s.index('date').getAll(range)));
    return all.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }

  async saveEntry(e) {
    const db = await this.dbPromise;
    await tx(db, 'entries', 'readwrite', (s) => reqP(s.put(e)));
    return e;
  }

  async deleteEntry(id) {
    const db = await this.dbPromise;
    await tx(db, 'entries', 'readwrite', (s) => reqP(s.delete(id)));
  }

  // ---------- Registro corporal ----------
  async listBody(from, to) {
    const db = await this.dbPromise;
    const range = IDBKeyRange.bound(from, to);
    return tx(db, 'body', 'readonly', (s) => reqP(s.getAll(range)));
  }

  async getBody(date) {
    const db = await this.dbPromise;
    return (await tx(db, 'body', 'readonly', (s) => reqP(s.get(date)))) || null;
  }

  async saveBody(log) {
    const db = await this.dbPromise;
    await tx(db, 'body', 'readwrite', (s) => reqP(s.put(log)));
    return log;
  }

  // ---------- Metas y perfil ----------
  async getKV(key) {
    const db = await this.dbPromise;
    const row = await tx(db, 'kv', 'readonly', (s) => reqP(s.get(key)));
    return row ? row.value : null;
  }

  async setKV(key, value) {
    const db = await this.dbPromise;
    await tx(db, 'kv', 'readwrite', (s) => reqP(s.put({ key, value })));
  }

  getGoals() { return this.getKV('goals'); }
  saveGoals(goals) { return this.setKV('goals', goals); }
  getProfile() { return this.getKV('profile'); }
  saveProfile(profile) { return this.setKV('profile', profile); }

  // ---------- Copia completa ----------
  async exportAll() {
    const db = await this.dbPromise;
    const products = await tx(db, 'products', 'readonly', (s) => reqP(s.getAll()));
    const entries = await tx(db, 'entries', 'readonly', (s) => reqP(s.getAll()));
    const body = await tx(db, 'body', 'readonly', (s) => reqP(s.getAll()));
    const goals = await this.getGoals();
    const profile = await this.getProfile();
    return { products, entries, body, goals, profile };
  }

  async importAll({ products = [], entries = [], body = [], goals = null, profile = null }) {
    for (const p of products) await this.saveProduct(p);
    for (const e of entries) await this.saveEntry(e);
    for (const b of body) await this.saveBody(b);
    if (goals) await this.saveGoals(goals);
    if (profile) await this.saveProfile(profile);
  }
}
