/* Datenhaltung: JSON-Container (data/werkstoffdb.json) + Arbeitskopie im localStorage.
   Funktioniert per Doppelklick (file://): Startdaten kommen aus data/werkstoffdb.js,
   geschrieben wird ueber die File System Access API (Chrome/Edge) in den verbundenen
   Ordner data/ - sonst Download. */
(function (global) {
  const LS_KEY = 'werkstoffdb.v1';
  const IDB_NAME = 'werkstoffdb';
  const FILES = ['werkstoffdb.json', 'werkstoffdb.js'];

  let db = null;
  let dirHandle = null;
  let fileStand = null; // meta.stand der zuletzt in Datei geschriebenen / geladenen Daten

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const now = () => new Date().toISOString().slice(0, 19);

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    try {
      const d = await idb();
      return await new Promise((res) => {
        const r = d.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(undefined);
      });
    } catch { return undefined; }
  }
  async function idbSet(key, val) {
    try {
      const d = await idb();
      await new Promise((res) => {
        const tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch { /* ignorieren */ }
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
  }

  function serializeJson() { return JSON.stringify(db, null, 1); }
  function serializeJs() { return 'window.WDB_DATA = ' + serializeJson() + ';\n'; }

  async function writeToDir() {
    if (!dirHandle) return false;
    if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
        (await dirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const content = { 'werkstoffdb.json': serializeJson(), 'werkstoffdb.js': serializeJs() };
    for (const name of FILES) {
      const fh = await dirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(content[name]);
      await w.close();
    }
    return true;
  }

  async function readFromDir() {
    try {
      const fh = await dirHandle.getFileHandle('werkstoffdb.json');
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  const Store = {
    get db() { return db; },
    get connected() { return !!dirHandle; },
    get canConnect() { return typeof global.showDirectoryPicker === 'function'; },
    /** 'datei' = in data/ geschrieben, 'lokal' = nur Browser-Arbeitskopie, 'neu' = unveraendert */
    get status() {
      if (db.meta.stand === fileStand) return 'datei';
      return 'lokal';
    },

    async init() {
      const boot = global.WDB_DATA ? clone(global.WDB_DATA) : null;
      const local = readLocal();
      db = boot;
      fileStand = boot ? boot.meta.stand : null;
      if (local && (!boot || local.meta.stand > boot.meta.stand)) db = local;
      if (!db) throw new Error('Keine Daten gefunden (data/werkstoffdb.js fehlt).');
      return db;
    },

    /** Gemerkten Datenordner laden (nicht-blockierend, IndexedDB kann unter file:// haengen). */
    async restoreDir() {
      const h = await Promise.race([idbGet('dir'), new Promise((r) => setTimeout(r, 2000))]);
      dirHandle = h || null;
      return !!dirHandle;
    },

    async connect() {
      dirHandle = await global.showDirectoryPicker({ mode: 'readwrite', id: 'werkstoffdb-data' });
      await idbSet('dir', dirHandle);
      const fromFile = await readFromDir();
      let loaded = false;
      if (fromFile && fromFile.meta.stand > db.meta.stand) { db = fromFile; loaded = true; }
      fileStand = fromFile ? fromFile.meta.stand : null;
      return loaded;
    },

    /** Speichert nach jeder Aenderung. Gibt zurueck, wo gespeichert wurde. */
    async save() {
      db.meta.stand = now();
      try { localStorage.setItem(LS_KEY, serializeJson()); } catch { /* voll/gesperrt */ }
      try {
        if (await writeToDir()) { fileStand = db.meta.stand; return 'datei'; }
      } catch (e) { console.warn('Schreiben in Datenordner fehlgeschlagen', e); }
      return 'lokal';
    },

    download() {
      const blob = new Blob([serializeJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'werkstoffdb.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    // --- Abfragen -------------------------------------------------------
    wert(wid, eid) {
      const v = db.werte.find((x) => x.werkstoffId === wid && x.eigenschaftId === eid);
      return v ? v.wert : null;
    },
    werteVon(wid) {
      const m = {};
      db.werte.forEach((v) => { if (v.werkstoffId === wid) m[v.eigenschaftId] = v.wert; });
      return m;
    },
    nextId() {
      const max = db.werkstoffe.reduce((m, w) => Math.max(m, parseInt(w.id.slice(2), 10) || 0), 0);
      return 'W-' + String(max + 1).padStart(3, '0');
    },
  };

  global.Store = Store;
})(window);
