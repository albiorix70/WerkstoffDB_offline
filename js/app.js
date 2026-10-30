(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 3) => (n === null || n === undefined ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d }));
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '');

  // Tabellenspalten: key = Feld im Werkstoff oder 'w:<eigenschaftId>' fuer Werte.
  // Kennwert-Spalten kommen aus db.eigenschaften, damit neue Stammdaten sofort waehlbar sind.
  const COL_KEY = 'werkstoffdb.cols.v1';
  const SHORT = { dichte: 'Dichte', e_modul: 'E-Modul', streckspannung: 'Streckgr.', zugfestigkeit: 'Zugfestigk.', waermeleitfaehigkeit: 'λ' };
  const DEFAULT_COLS = ['kategorieId', 'name', 'werkstoffNummer', 'kurzname', 'typId', 'w:dichte', 'w:e_modul', 'w:streckspannung', 'w:zugfestigkeit', 'w:waermeleitfaehigkeit', 'revision', 'revisionsdatum'];

  function allCols() {
    const db = Store.db;
    return [
      { key: 'id', label: 'ID' }, { key: 'kategorieId', label: 'Kat.' }, { key: 'name', label: 'Name' },
      { key: 'werkstoffNummer', label: 'Werkstoff-Nr.' }, { key: 'kurzname', label: 'Kurzname' },
      { key: 'veraltet', label: 'Veraltet' }, { key: 'typId', label: 'Typ' },
      ...db.eigenschaften.slice().sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((e) => ({ key: 'w:' + e.id, label: SHORT[e.id] || e.name, unit: e.einheit, num: true, title: e.name })),
      { key: 'revision', label: 'Rev.', num: true }, { key: 'revisionsdatum', label: 'Datum' },
    ];
  }
  function visibleKeys() {
    try { const v = JSON.parse(localStorage.getItem(COL_KEY)); if (Array.isArray(v)) return v; } catch { /* default */ }
    return DEFAULT_COLS;
  }
  const cols = () => { const k = visibleKeys(); return allCols().filter((c) => k.includes(c.key)); };

  // Textfelder im Popup (Feld, Label, Typ)
  const TEXT_FIELDS = [
    ['name', 'Name', 'text'], ['werkstoffNummer', 'Werkstoff-Nummer', 'text'],
    ['kurzname', 'Kurzname', 'text'], ['veraltet', 'Veraltete Angaben', 'text'],
    ['schluesselwoerter', 'Schlüsselwörter (Komma-getrennt)', 'text'],
    ['beschreibung', 'Beschreibung', 'area'], ['zeichnungsangabe', 'Angabe auf Zeichnung', 'text'],
    ['norm', 'Norm', 'area'], ['quellen', 'Datenblatt / Quellen', 'area'], ['bemerkung', 'Bemerkung', 'area'],
  ];

  const state = { sort: { key: 'id', dir: 1 }, rows: [] };
  let editing = null; // Werkstoff-ID oder 'NEU'

  // ---------- Hilfen -------------------------------------------------------
  const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name || id;
  const cellValue = (w, key) => (key.startsWith('w:') ? Store.wert(w.id, key.slice(2)) : w[key]);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function renderStatus() {
    const s = $('#status');
    const ok = Store.status === 'datei';
    s.className = 'status ' + (ok ? 'ok' : 'warn');
    s.textContent = ok ? 'In Datei gespeichert'
      : Store.connected ? 'Nur im Browser gespeichert' : 'Nur im Browser gespeichert – Datenordner verbinden oder exportieren';
    $('#btn-connect').textContent = Store.connected ? 'Datenordner wechseln' : 'Datenordner verbinden';
    $('#btn-connect').hidden = !Store.canConnect;
  }

  // ---------- Filter & Tabelle --------------------------------------------
  function fillSelect(sel, items, allLabel) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + items.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
    sel.value = cur;
  }

  function haystack(w) {
    return [w.id, w.name, w.werkstoffNummer, w.kurzname, w.veraltet, w.beschreibung, w.norm, w.bemerkung, w.zeichnungsangabe,
      (w.schluesselwoerter || []).join(' '), nameOf(Store.db.typen, w.typId), w.kategorieId].join(' ').toLowerCase();
  }

  function inRange(v, min, max) {
    if (min === '' && max === '') return true;
    if (v === null || v === undefined) return false;
    return (min === '' || v >= Number(min)) && (max === '' || v <= Number(max));
  }

  function applyFilter() {
    const text = $('#f-text').value.trim().toLowerCase();
    const kat = $('#f-kat').value, typ = $('#f-typ').value;
    const dMin = $('#f-dichte-min').value, dMax = $('#f-dichte-max').value;
    const rMin = $('#f-rm-min').value, rMax = $('#f-rm-max').value;
    const terms = text.split(/\s+/).filter(Boolean);

    let rows = Store.db.werkstoffe.filter((w) => {
      if (kat && w.kategorieId !== kat) return false;
      if (typ && w.typId !== typ) return false;
      if (!inRange(Store.wert(w.id, 'dichte'), dMin, dMax)) return false;
      if (!inRange(Store.wert(w.id, 'zugfestigkeit'), rMin, rMax)) return false;
      if (terms.length) { const h = haystack(w); return terms.every((t) => h.includes(t)); }
      return true;
    });

    const { key, dir } = state.sort;
    rows = rows.slice().sort((a, b) => {
      let x = key === 'id' ? a.id : cellValue(a, key), y = key === 'id' ? b.id : cellValue(b, key);
      if (x === null || x === undefined || x === '') return 1;   // Leere immer ans Ende
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true })) * dir;
    });
    state.rows = rows;
    renderTable();
    $('#count').textContent = `${rows.length} von ${Store.db.werkstoffe.length} Werkstoffen`;
    $('#btn-pdf').textContent = `PDF (${rows.length})`;
  }

  function renderHead() {
    $('#tbl thead').innerHTML = '<tr>' + cols().map((c) => {
      const arrow = state.sort.key === c.key ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return `<th data-key="${c.key}" class="${c.num ? 'num' : ''}" ${c.title ? `title="${esc(c.title)}"` : ''}>${esc(c.label)}${arrow}${c.unit ? `<small>${esc(c.unit)}</small>` : ''}</th>`;
    }).join('') + '</tr>';
  }

  function renderTable() {
    renderHead();
    $('#tbl tbody').innerHTML = state.rows.map((w) => '<tr data-id="' + w.id + '">' + cols().map((c) => {
      let v = cellValue(w, c.key);
      if (c.key === 'typId') v = nameOf(Store.db.typen, v);
      else if (c.key === 'revisionsdatum') v = fmtDate(v);
      else if (c.num && c.key !== 'revision') v = fmt(v);
      const swatch = c.key === 'name' && w.farbe ? `<i class="sw" style="background:${w.farbe}"></i>` : '';
      return `<td class="${c.num ? 'num' : ''}">${swatch}${esc(v)}</td>`;
    }).join('') + '</tr>').join('') || `<tr><td colspan="${cols().length}" class="empty">Keine Treffer</td></tr>`;
  }

  // ---------- Popup --------------------------------------------------------
  function field(id, label, value, kind, extra = '') {
    const v = esc(value);
    const input = kind === 'area' ? `<textarea name="${id}" rows="3">${v}</textarea>`
      : `<input name="${id}" type="${kind === 'number' ? 'number' : kind === 'color' ? 'color' : 'text'}" value="${v}" ${kind === 'number' ? 'step="any"' : ''} />`;
    return `<label class="fld ${kind === 'area' ? 'wide' : ''}"><span>${esc(label)}</span>${input}${extra}</label>`;
  }

  function openDialog(id) {
    const db = Store.db;
    const isNew = id === 'NEU';
    editing = id;
    const w = isNew
      ? { id: Store.nextId(), kategorieId: db.kategorien[0].id, typId: db.typen[0].id, name: '', schluesselwoerter: [], farbe: '#e6e6e6', bildFade: 100, glanz: 50, verhalten: 'Isotrop', revision: 0, revisionsdatum: today() }
      : db.werkstoffe.find((x) => x.id === id);
    const vals = isNew ? {} : Store.werteVon(w.id);
    const hist = db.revisionen.filter((r) => r.werkstoffId === w.id).sort((a, b) => b.revision - a.revision);
    const opts = (list, sel) => list.map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('');

    $('#form').innerHTML = `
      <header class="dlg-head">
        <h2>${isNew ? 'Neuer Werkstoff' : esc(w.name)} <small>${esc(w.id)}</small></h2>
        <span class="rev">Revision ${w.revision || '–'} · ${fmtDate(w.revisionsdatum)}</span>
        <button type="button" class="x" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="dlg-body">
        <fieldset class="grid">
          <legend>Identität</legend>
          <label class="fld"><span>Kategorie</span><select name="kategorieId">${opts(db.kategorien, w.kategorieId)}</select></label>
          <label class="fld"><span>Typ</span><select name="typId">${opts(db.typen, w.typId)}</select></label>
          ${TEXT_FIELDS.map(([k, l, t]) => field(k, l, k === 'schluesselwoerter' ? (w[k] || []).join(', ') : w[k] ?? '', t)).join('')}
        </fieldset>
        <fieldset class="grid">
          <legend>Aussehen</legend>
          ${field('farbe', 'Farbe', w.farbe || '#e6e6e6', 'color')}
          ${field('bildFade', 'Bild-Fade', w.bildFade ?? '', 'number')}
          ${field('glanz', 'Glanz', w.glanz ?? '', 'number')}
          ${field('verhalten', 'Verhalten', w.verhalten ?? '', 'text')}
        </fieldset>
        <fieldset class="grid">
          <legend>Kennwerte</legend>
          ${db.eigenschaften.slice().sort((a, b) => a.reihenfolge - b.reihenfolge).map((e) =>
            field('w:' + e.id, e.name + (e.einheit ? ` [${e.einheit}]` : ''), vals[e.id] ?? '', 'number')).join('')}
        </fieldset>
        <fieldset>
          <legend>Änderung</legend>
          ${field('kommentar', 'Änderungskommentar (kommt in die Revisionshistorie)', '', 'text')}
        </fieldset>
        ${hist.length ? `<details class="hist"><summary>Revisionshistorie (${hist.length})</summary><ol reversed>${hist.map((r) => `
          <li><b>Rev. ${r.revision}</b> · ${fmtDate(r.datum)} ${r.kommentar ? '– ' + esc(r.kommentar) : ''}
          ${(r.aenderungen || []).length ? '<ul>' + r.aenderungen.map((a) => `<li>${esc(a.feld)}: <del>${esc(a.alt)}</del> → <ins>${esc(a.neu)}</ins></li>`).join('') + '</ul>' : ''}</li>`).join('')}</ol></details>` : ''}
      </div>
      <footer class="dlg-foot">
        ${isNew ? '' : '<button type="button" class="danger" data-delete>Löschen</button>'}
        <span class="spacer"></span>
        ${isNew ? '' : '<button type="button" data-pdf>PDF</button>'}
        <button type="button" data-close>Abbrechen</button>
        <button type="submit" class="primary">Speichern</button>
      </footer>`;
    $('#dlg').showModal();
  }

  const BASE_FIELDS = ['kategorieId', 'typId', ...TEXT_FIELDS.map((f) => f[0]), 'farbe', 'bildFade', 'glanz', 'verhalten'];
  const NUM_FIELDS = ['bildFade', 'glanz'];
  const str = (v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v));

  function readForm() {
    const fd = new FormData($('#form'));
    const base = {};
    BASE_FIELDS.forEach((k) => {
      let v = String(fd.get(k) ?? '').trim();
      if (NUM_FIELDS.includes(k)) base[k] = v === '' ? null : Number(v);
      else if (k === 'schluesselwoerter') base[k] = v.split(',').map((x) => x.trim()).filter(Boolean);
      else base[k] = v;
    });
    const werte = {};
    Store.db.eigenschaften.forEach((e) => {
      const v = String(fd.get('w:' + e.id) ?? '').trim().replace(',', '.');
      werte[e.id] = v === '' || isNaN(Number(v)) ? null : Number(v);
    });
    return { base, werte, kommentar: String(fd.get('kommentar') || '').trim() };
  }

  async function saveForm() {
    const db = Store.db;
    const { base, werte, kommentar } = readForm();
    if (!base.name) { toast('Name darf nicht leer sein.'); return; }
    const isNew = editing === 'NEU';
    const old = isNew ? null : db.werkstoffe.find((x) => x.id === editing);
    const oldVals = isNew ? {} : Store.werteVon(editing);

    // Aenderungen ermitteln (Feld, alt, neu)
    const changes = [];
    BASE_FIELDS.forEach((k) => {
      const a = str(old ? old[k] : ''), b = str(base[k]);
      if (a !== b) changes.push({ feld: k, alt: a, neu: b });
    });
    db.eigenschaften.forEach((e) => {
      const a = str(oldVals[e.id]), b = str(werte[e.id]);
      if (a !== b) changes.push({ feld: e.name, alt: a, neu: b });
    });
    if (!isNew && !changes.length) { $('#dlg').close(); toast('Keine Änderungen.'); return; }

    const w = isNew ? { id: Store.nextId() } : old;
    Object.assign(w, base);
    w.revision = (old ? old.revision : 0) + 1;
    w.revisionsdatum = today();
    if (isNew) db.werkstoffe.push(w);

    db.werte = db.werte.filter((v) => v.werkstoffId !== w.id);
    db.eigenschaften.forEach((e) => { if (werte[e.id] !== null) db.werte.push({ werkstoffId: w.id, eigenschaftId: e.id, wert: werte[e.id] }); });
    db.revisionen.push({ werkstoffId: w.id, revision: w.revision, datum: w.revisionsdatum, kommentar: isNew ? kommentar || 'Neu angelegt' : kommentar, aenderungen: isNew ? [] : changes });

    $('#dlg').close();
    await persist(`${w.name}: Revision ${w.revision} gespeichert`);
  }

  async function deleteCurrent() {
    const w = Store.db.werkstoffe.find((x) => x.id === editing);
    if (!w || !confirm(`„${w.name}“ wirklich löschen? Die Revisionshistorie bleibt in der Datei erhalten.`)) return;
    Store.db.werkstoffe = Store.db.werkstoffe.filter((x) => x.id !== w.id);
    Store.db.werte = Store.db.werte.filter((v) => v.werkstoffId !== w.id);
    Store.db.revisionen.push({ werkstoffId: w.id, revision: w.revision + 1, datum: today(), kommentar: 'Gelöscht', aenderungen: [] });
    $('#dlg').close();
    await persist(`${w.name} gelöscht`);
  }

  async function persist(msg) {
    const where = await Store.save();
    applyFilter();
    renderStatus();
    toast(where === 'datei' ? msg + ' (data/ aktualisiert)' : msg + ' – nur im Browser, bitte Datenordner verbinden oder JSON exportieren');
  }

  // ---------- Stammdaten (normalisierte Tabellen) --------------------------
  const MD = [
    { key: 'kategorien', title: 'Kategorien', idLabel: 'Kürzel', cols: [['name', 'Bezeichnung', 'text']],
      used: (id) => Store.db.werkstoffe.filter((w) => w.kategorieId === id).length },
    { key: 'typen', title: 'Typen', cols: [['name', 'Bezeichnung', 'text']],
      used: (id) => Store.db.werkstoffe.filter((w) => w.typId === id).length },
    { key: 'eigenschaften', title: 'Kennwerte', cols: [['name', 'Bezeichnung', 'text'], ['einheit', 'Einheit', 'text']],
      used: (id) => Store.db.werte.filter((v) => v.eigenschaftId === id).length },
  ];
  const slug = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/\W+/g, '_').replace(/^_|_$/g, '');

  function mdRow(t, item, isNew) {
    const n = isNew ? 0 : t.used(item.id);
    return `<tr data-id="${esc(item.id || '')}" ${isNew ? 'data-new' : ''}>
      ${t.idLabel ? `<td><input data-f="id" value="${esc(item.id || '')}" ${isNew ? '' : 'readonly'} placeholder="${t.idLabel}" /></td>` : ''}
      ${t.cols.map(([f, l]) => `<td><input data-f="${f}" value="${esc(item[f] ?? '')}" placeholder="${l}" /></td>`).join('')}
      <td class="md-n">${isNew ? '' : n + ' verw.'}</td>
      <td><button type="button" data-del ${n ? 'disabled title="Wird noch verwendet"' : ''}>✕</button></td></tr>`;
  }

  function openStammdaten() {
    $('#form-md').innerHTML = `
      <header class="dlg-head"><h2>Stammdaten</h2>
        <span class="rev">Auswahllisten &amp; Kennwert-Definitionen</span>
        <button type="button" class="x" data-close aria-label="Schließen">✕</button></header>
      <div class="dlg-body">${MD.map((t) => `
        <fieldset data-t="${t.key}"><legend>${t.title}</legend>
          <table class="md"><thead><tr>${t.idLabel ? `<th>${t.idLabel}</th>` : ''}${t.cols.map((c) => `<th>${c[1]}</th>`).join('')}<th></th><th></th></tr></thead>
          <tbody>${Store.db[t.key].map((i) => mdRow(t, i, false)).join('')}</tbody></table>
          <button type="button" data-add="${t.key}">+ Hinzufügen</button>
        </fieldset>`).join('')}
      </div>
      <footer class="dlg-foot"><span class="spacer"></span>
        <button type="button" data-close>Abbrechen</button><button type="submit" class="primary">Speichern</button></footer>`;
    $('#dlg-md').showModal();
  }

  async function saveStammdaten() {
    const next = {};
    for (const t of MD) {
      const ids = new Set();
      const rows = [...document.querySelectorAll(`#form-md fieldset[data-t="${t.key}"] tbody tr`)];
      const list = [];
      for (const tr of rows) {
        const val = (f) => (tr.querySelector(`[data-f="${f}"]`)?.value ?? '').trim();
        const item = {};
        t.cols.forEach(([f]) => { item[f] = val(f); });
        if (!item.name) { toast(`${t.title}: Bezeichnung darf nicht leer sein.`); return; }
        let id = tr.dataset.id || (t.idLabel ? val('id') : slug(item.name));
        if (!id) { toast(`${t.title}: Kürzel fehlt.`); return; }
        if (tr.hasAttribute('data-new') && !t.idLabel) { let b = id, i = 2; while (ids.has(id) || Store.db[t.key].some((x) => x.id === id)) id = b + '_' + i++; }
        if (ids.has(id) || (tr.hasAttribute('data-new') && Store.db[t.key].some((x) => x.id === id))) { toast(`${t.title}: „${id}“ existiert doppelt.`); return; }
        ids.add(id);
        const old = Store.db[t.key].find((x) => x.id === id);
        list.push({ ...(old || {}), id, ...item, ...(t.key === 'eigenschaften' ? { reihenfolge: list.length + 1 } : {}) });
      }
      next[t.key] = list;
    }
    Object.assign(Store.db, next);
    $('#dlg-md').close();
    fillSelect($('#f-kat'), Store.db.kategorien, 'Alle');
    fillSelect($('#f-typ'), Store.db.typen, 'Alle');
    await persist('Stammdaten gespeichert');
  }

  // ---------- Spaltenauswahl -----------------------------------------------
  function renderColMenu() {
    const k = visibleKeys();
    $('#col-menu').innerHTML = allCols().map((c) =>
      `<label><input type="checkbox" value="${esc(c.key)}" ${k.includes(c.key) ? 'checked' : ''} /> ${esc(c.title || c.label)}${c.unit ? ` <small>[${esc(c.unit)}]</small>` : ''}</label>`).join('');
  }

  // ---------- PDF / Druck --------------------------------------------------
  // Vorlage: <template id="tpl-materialblatt"> in index.html, Layout in css/print.css.
  // Platzhalter {{feld}}; Schleifen <!--each:kennwerte-->...<!--/each-->.
  const fill = (s, d) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(d[k] ?? ''));
  const renderTpl = (tpl, d) => fill(tpl.replace(/<!--each:(\w+)-->([\s\S]*?)<!--\/each-->/g, (_, k, inner) => (d[k] || []).map((r) => fill(inner, r)).join('')), d);

  function blattData(w) {
    const db = Store.db, vals = Store.werteVon(w.id);
    return {
      ...w, kategorie: nameOf(db.kategorien, w.kategorieId), typ: nameOf(db.typen, w.typId),
      schluesselwoerter: (w.schluesselwoerter || []).join(', '), datum: fmtDate(w.revisionsdatum), heute: fmtDate(today()),
      farbe: w.farbe || '#ffffff',
      kennwerte: db.eigenschaften.slice().sort((a, b) => a.reihenfolge - b.reihenfolge)
        .filter((e) => vals[e.id] !== undefined).map((e) => ({ name: e.name, wert: fmt(vals[e.id]), einheit: e.einheit })),
    };
  }

  function buildPrint(list) {
    const tpl = $('#tpl-materialblatt').innerHTML;
    $('#print-root').innerHTML = list.map((w) => renderTpl(tpl, blattData(w))).join('');

  }

  function printList(list) {
    if (!list.length) { toast('Keine Werkstoffe zum Drucken.'); return; }
    buildPrint(list);
    toast('Im Druckdialog „Als PDF speichern“ wählen.');
    setTimeout(() => window.print(), 50);
  }
  window.addEventListener('afterprint', () => { $('#print-root').innerHTML = ''; });
  window.WDBApp = { buildPrint };

  // ---------- Start --------------------------------------------------------
  function init() {
    $('#btn-pdf').addEventListener('click', () => printList(state.rows));
    $('#col-menu').addEventListener('change', () => {
      const keys = [...document.querySelectorAll('#col-menu input:checked')].map((i) => i.value);
      try { localStorage.setItem(COL_KEY, JSON.stringify(keys)); } catch { /* ignorieren */ }
      renderTable();
    });
    $('#col-details').addEventListener('toggle', () => { if ($('#col-details').open) renderColMenu(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#col-details')) $('#col-details').open = false; });
    const mdlg = $('#dlg-md');
    $('#btn-md').addEventListener('click', openStammdaten);
    mdlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === mdlg) mdlg.close();
      const del = e.target.closest('[data-del]');
      if (del && !del.disabled) del.closest('tr').remove();
      const add = e.target.closest('[data-add]');
      if (add) {
        const t = MD.find((x) => x.key === add.dataset.add);
        const body = mdlg.querySelector(`fieldset[data-t="${t.key}"] tbody`);
        body.insertAdjacentHTML('beforeend', mdRow(t, {}, true));
        body.lastElementChild.querySelector('input:not([readonly])').focus();
      }
    });
    $('#form-md').addEventListener('submit', (e) => { e.preventDefault(); saveStammdaten(); });

    const db = Store.db;
    fillSelect($('#f-kat'), db.kategorien, 'Alle');
    fillSelect($('#f-typ'), db.typen, 'Alle');
    renderStatus();
    applyFilter();

    ['#f-text', '#f-kat', '#f-typ', '#f-dichte-min', '#f-dichte-max', '#f-rm-min', '#f-rm-max'].forEach((s) => $(s).addEventListener('input', applyFilter));
    $('#f-reset').addEventListener('click', () => {
      document.querySelectorAll('.filters input, .filters select').forEach((e) => { e.value = ''; });
      applyFilter();
    });

    $('#tbl thead').addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const key = th.dataset.key;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      applyFilter();
    });
    $('#tbl tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) openDialog(tr.dataset.id);
    });

    $('#btn-new').addEventListener('click', () => openDialog('NEU'));
    $('#btn-export').addEventListener('click', () => Store.download());
    $('#btn-connect').addEventListener('click', async () => {
      try {
        const loaded = await Store.connect();
        const where = loaded ? 'datei' : await Store.save();
        fillSelect($('#f-kat'), Store.db.kategorien, 'Alle');
        fillSelect($('#f-typ'), Store.db.typen, 'Alle');
        applyFilter(); renderStatus();
        toast(loaded ? 'Neuere Daten aus dem Ordner geladen.' : where === 'datei' ? 'Ordner verbunden, Daten geschrieben.' : 'Ordner verbunden.');
      } catch (err) { if (err.name !== 'AbortError') toast('Verbinden fehlgeschlagen: ' + err.message); }
    });

    const dlg = $('#dlg');
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
      else if (e.target.closest('[data-delete]')) deleteCurrent();
      else if (e.target.closest('[data-pdf]')) { const w = Store.db.werkstoffe.find((x) => x.id === editing); dlg.close(); printList([w]); }
    });
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); saveForm(); });
  }

  Store.init().then(() => { init(); Store.restoreDir().then(renderStatus); }).catch((err) => {
    document.body.insertAdjacentHTML('afterbegin', `<p class="fatal">${esc(err.message)}</p>`);
  });
})();
