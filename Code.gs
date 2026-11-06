/**
 * =====================================================================
 *  CLIENT PORTAL - SERVER (Google Apps Script + Google Sheet)
 * =====================================================================
 *  Fungsi:
 *   - Menyimpan daftar link klien (kuota, batas waktu, folder Drive)
 *   - Menerima & menyimpan pilihan foto klien secara otomatis
 *   - Mengecek batas waktu memakai JAM SERVER (tidak bisa dibobol klien)
 *
 *  CARA PASANG (sekali saja) - lihat juga PANDUAN_SERVER.md:
 *   1. Buat Google Sheet baru (kosong).
 *   2. Extensions > Apps Script, hapus isi bawaan, tempel seluruh kode ini.
 *   3. Ganti ADMIN_KEY di bawah dengan kunci rahasia buatan Anda sendiri.
 *   4. Jalankan fungsi `setup` sekali (tombol Run) lalu beri izin akses.
 *   5. Deploy > New deployment > Web app
 *        Execute as : Me
 *        Who has access : Anyone
 *      Salin URL Web app -> tempel ke `urlServer` di pengaturan.js
 *   6. Setiap mengubah kode ini: Deploy > Manage deployments > Edit > New version.
 * =====================================================================
 */

// ====== WAJIB DIGANTI ======
const ADMIN_KEY = 'GANTI-DENGAN-KUNCI-RAHASIA';

// ====== PENGATURAN ======
const SHEET_LINKS = 'Links';
const SHEET_PILIHAN = 'Pilihan';
const SHEET_SETTINGS = 'Pengaturan';
const GRACE_MS = 30 * 1000;        // toleransi 30 detik setelah batas (menutup jeda simpan otomatis)
const MAX_ITEMS = 700;             // maksimal foto terpilih per klien
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const LINK_HEADERS = ['Kode', 'Nama Klien', 'Folder ID', 'Kuota', 'Batas Waktu', 'Status', 'Proteksi', 'Watermark', 'Dibuat', 'No. WA'];
const SEL_HEADERS = ['Kode', 'Nama Klien', 'Jumlah', 'Daftar Foto', 'Data (JSON)', 'Diperbarui'];
// Pengaturan studio: kunci -> nilai awal (nama, nomor WA admin, template pesan WA)
const SETTING_KEYS = ['namaVendor', 'whatsappAdmin', 'waTemplate'];
// Kolom Links (1-based)
const L = { CODE: 1, NAME: 2, FOLDER: 3, KUOTA: 4, DEADLINE: 5, STATUS: 6, PROT: 7, WM: 8, CREATED: 9, PHONE: 10 };

// ---------------------------------------------------------------------
// Titik masuk web app
// ---------------------------------------------------------------------
function doGet(e) {
  return handle_((e && e.parameter) || {}, null);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  return handle_((e && e.parameter) || {}, body);
}

function handle_(params, body) {
  try {
    const src = body || params;
    const action = String(src.action || params.action || '');
    switch (action) {
      case 'get':        return json_(actionGet_(src));
      case 'save':       return json_(actionSave_(src));
      case 'createLink': return json_(actionCreateLink_(src));
      case 'updateLink': return json_(actionUpdateLink_(src));
      case 'list':       return json_(actionList_(src));
      case 'settings':     return json_(actionSettings_(src));
      case 'getSettings':  return json_(actionGetSettings_(src));
      case 'saveSettings': return json_(actionSaveSettings_(src));
      case 'ping':       return json_({ ok: true, now: Date.now() });
      default:           return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------
function setup() {
  ensureSheets_();
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let links = ss.getSheetByName(SHEET_LINKS);
  if (!links) {
    links = ss.insertSheet(SHEET_LINKS);
    links.getRange(1, 1, 1, LINK_HEADERS.length).setValues([LINK_HEADERS]);
    links.setFrozenRows(1);
  }
  let sel = ss.getSheetByName(SHEET_PILIHAN);
  if (!sel) {
    sel = ss.insertSheet(SHEET_PILIHAN);
    sel.getRange(1, 1, 1, SEL_HEADERS.length).setValues([SEL_HEADERS]);
    sel.setFrozenRows(1);
  }
  let set = ss.getSheetByName(SHEET_SETTINGS);
  if (!set) {
    set = ss.insertSheet(SHEET_SETTINGS);
    set.getRange(1, 1, 1, 2).setValues([['Kunci', 'Nilai']]);
    set.getRange(2, 1, SETTING_KEYS.length, 2).setValues(SETTING_KEYS.map(function (k) { return [k, '']; }));
    set.setFrozenRows(1);
  }
  return { links: links, sel: sel, set: set };
}

// ---------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------
function clean_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

function truthy_(v) {
  if (v === true) return true;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'ya' || s === '1' || s === 'yes';
}

function toMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) { const t = v.getTime(); return isNaN(t) ? null : t; }
  if (typeof v === 'number') { return v > 1e11 ? v : null; }   // epoch ms; angka kecil (serial sheet) diabaikan
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

function isAdmin_(src) {
  return ADMIN_KEY !== 'GANTI-DENGAN-KUNCI-RAHASIA' && String(src.adminKey || '') === ADMIN_KEY;
}

function adminError_(src) {
  if (ADMIN_KEY === 'GANTI-DENGAN-KUNCI-RAHASIA') return { ok: false, error: 'admin_key_not_set' };
  return { ok: false, error: 'unauthorized' };
}

function readLinks_() {
  const sh = ensureSheets_().links;
  const last = sh.getLastRow();
  if (last < 2) return { sheet: sh, rows: [] };
  const values = sh.getRange(2, 1, last - 1, LINK_HEADERS.length).getValues();
  return { sheet: sh, rows: values.map((v, i) => ({ row: i + 2, v: v })) };
}

function findLink_(code) {
  if (!code) return null;
  const all = readLinks_();
  for (let i = 0; i < all.rows.length; i++) {
    if (clean_(all.rows[i].v[L.CODE - 1]) === code) return { sheet: all.sheet, row: all.rows[i].row, v: all.rows[i].v };
  }
  return null;
}

function linkToObj_(v) {
  return {
    code: clean_(v[L.CODE - 1]),
    name: String(v[L.NAME - 1] || ''),
    folderId: String(v[L.FOLDER - 1] || ''),
    kuota: Number(v[L.KUOTA - 1]) > 0 ? Number(v[L.KUOTA - 1]) : null,
    deadline: toMs_(v[L.DEADLINE - 1]),
    closed: String(v[L.STATUS - 1] || '').trim().toLowerCase() === 'tutup',
    prot: truthy_(v[L.PROT - 1]),
    wm: truthy_(v[L.WM - 1])
  };
}

function lockState_(link, now) {
  if (link.closed) return { locked: true, reason: 'closed' };
  if (link.deadline !== null && now > link.deadline + GRACE_MS) return { locked: true, reason: 'locked' };
  return { locked: false };
}

function findSelectionRow_(code) {
  const sh = ensureSheets_().sel;
  const last = sh.getLastRow();
  if (last < 2) return { sheet: sh, row: null };
  const codes = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (clean_(codes[i][0]) === code) return { sheet: sh, row: i + 2 };
  }
  return { sheet: sh, row: null };
}

function readSelection_(code) {
  const f = findSelectionRow_(code);
  if (!f.row) return null;
  const vals = f.sheet.getRange(f.row, 1, 1, SEL_HEADERS.length).getValues()[0];
  let arr = [];
  try { arr = JSON.parse(vals[4] || '[]'); } catch (e) { arr = []; }
  return {
    items: arr.map(function (a) { return { id: a[0], name: a[1], note: a[2] || '' }; }),
    updatedAt: toMs_(vals[5])
  };
}

// ---------------------------------------------------------------------
// Aksi publik (klien)
// ---------------------------------------------------------------------
function actionGet_(src) {
  const code = clean_(src.c);
  const found = findLink_(code);
  if (!found) return { ok: false, error: 'not_found' };
  const link = linkToObj_(found.v);
  return {
    ok: true,
    now: Date.now(),
    link: link,
    selection: readSelection_(code),
    settings: publicSettings_()
  };
}

function actionSave_(src) {
  const code = clean_(src.c);
  const found = findLink_(code);
  if (!found) return { ok: false, error: 'not_found' };
  const link = linkToObj_(found.v);

  const now = Date.now();
  const st = lockState_(link, now);
  if (st.locked) return { ok: false, error: st.reason, now: now, deadline: link.deadline };

  const raw = Array.isArray(src.selected) ? src.selected : [];
  if (raw.length > MAX_ITEMS) return { ok: false, error: 'too_many', now: now };

  const seen = {};
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] || {};
    const id = String(it.id || '');
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || seen[id]) continue;
    seen[id] = true;
    items.push([id, String(it.name || '').slice(0, 100), String(it.note || '').slice(0, 400)]);
  }
  if (link.kuota !== null && items.length > link.kuota) return { ok: false, error: 'quota', now: now, kuota: link.kuota };

  const json = JSON.stringify(items);
  if (json.length > 48000) return { ok: false, error: 'too_large', now: now };

  const daftar = items.map(function (a, i) { return (i + 1) + '. ' + a[1] + (a[2] ? '  [catatan: ' + a[2] + ']' : ''); }).join('\n').slice(0, 45000);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const f = findSelectionRow_(code);
    const rowValues = [[code, link.name, items.length, daftar, json, new Date()]];
    let row = f.row;
    if (!row) row = f.sheet.getLastRow() + 1;
    f.sheet.getRange(row, 1, 1, SEL_HEADERS.length).setValues(rowValues);
    f.sheet.getRange(row, 6).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  } finally {
    lock.releaseLock();
  }
  return { ok: true, now: Date.now(), updatedAt: Date.now(), count: items.length };
}

// ---------------------------------------------------------------------
// Aksi admin (vendor)
// ---------------------------------------------------------------------
function newCode_() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 8; i++) c += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    if (!findLink_(c)) return c;
  }
  throw new Error('Gagal membuat kode unik');
}

function actionCreateLink_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const folderId = String(src.folderId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(folderId)) return { ok: false, error: 'bad_folder' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureSheets_().links;
    const code = newCode_();
    const deadlineMs = toMs_(src.deadline);
    const kuota = Number(src.kuota) > 0 ? Math.floor(Number(src.kuota)) : '';
    const row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, LINK_HEADERS.length).setValues([[
      code,
      String(src.name || '').slice(0, 100),
      folderId,
      kuota,
      deadlineMs !== null ? new Date(deadlineMs) : '',
      'aktif',
      src.prot ? true : false,
      src.wm ? true : false,
      new Date(),
      String(src.phone || '').replace(/[^0-9]/g, '')
    ]]);
    sh.getRange(row, L.DEADLINE).setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange(row, L.CREATED).setNumberFormat('dd/MM/yyyy HH:mm');
    return { ok: true, code: code };
  } finally {
    lock.releaseLock();
  }
}

function actionUpdateLink_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const code = clean_(src.c);
  const found = findLink_(code);
  if (!found) return { ok: false, error: 'not_found' };
  const sh = found.sheet;

  if (Object.prototype.hasOwnProperty.call(src, 'deadline')) {
    const ms = toMs_(src.deadline);
    sh.getRange(found.row, L.DEADLINE).setValue(ms !== null ? new Date(ms) : '');
    sh.getRange(found.row, L.DEADLINE).setNumberFormat('dd/MM/yyyy HH:mm');
  }
  if (Object.prototype.hasOwnProperty.call(src, 'status')) {
    sh.getRange(found.row, L.STATUS).setValue(String(src.status).toLowerCase() === 'tutup' ? 'tutup' : 'aktif');
  }
  if (Object.prototype.hasOwnProperty.call(src, 'kuota')) {
    const k = Number(src.kuota);
    sh.getRange(found.row, L.KUOTA).setValue(k > 0 ? Math.floor(k) : '');
  }
  return { ok: true };
}

function actionList_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const all = readLinks_();
  const selSheet = ensureSheets_().sel;
  const selLast = selSheet.getLastRow();
  const counts = {};
  if (selLast >= 2) {
    const sv = selSheet.getRange(2, 1, selLast - 1, SEL_HEADERS.length).getValues();
    sv.forEach(function (r) { counts[clean_(r[0])] = { count: Number(r[2]) || 0, updatedAt: toMs_(r[5]) }; });
  }
  const links = all.rows.map(function (r) {
    const o = linkToObj_(r.v);
    const c = counts[o.code] || { count: 0, updatedAt: null };
    o.selectedCount = c.count;
    o.updatedAt = c.updatedAt;
    o.createdAt = toMs_(r.v[L.CREATED - 1]);
    return o;
  }).reverse();
  return { ok: true, now: Date.now(), links: links.slice(0, 200) };
}

// ---------------------------------------------------------------------
// Pengaturan studio (nama, nomor WA admin, template pesan WA)
// ---------------------------------------------------------------------
function readSettings_() {
  const sh = ensureSheets_().set;
  const last = sh.getLastRow();
  const out = {};
  SETTING_KEYS.forEach(function (k) { out[k] = ''; });
  if (last < 2) return out;
  const rows = sh.getRange(2, 1, last - 1, 2).getValues();
  rows.forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (SETTING_KEYS.indexOf(k) !== -1) out[k] = String(r[1] === null || r[1] === undefined ? '' : r[1]);
  });
  return out;
}

// Yang boleh dilihat klien (template pesan WA hanya untuk vendor)
function publicSettings_() {
  const st = readSettings_();
  return { namaVendor: st.namaVendor, whatsappAdmin: st.whatsappAdmin };
}

function normalizePhone_(v) {
  let d = String(v || '').replace(/[^0-9]/g, '');
  if (d.indexOf('0') === 0) d = '62' + d.slice(1);
  else if (d.indexOf('8') === 0) d = '62' + d;
  return d.slice(0, 20);
}

function actionSettings_(src) {
  return { ok: true, now: Date.now(), settings: publicSettings_() };
}

function actionGetSettings_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  return { ok: true, settings: readSettings_() };
}

function actionSaveSettings_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const incoming = src.settings || {};
  const clean = {};
  if (Object.prototype.hasOwnProperty.call(incoming, 'namaVendor')) clean.namaVendor = String(incoming.namaVendor || '').trim().slice(0, 80);
  if (Object.prototype.hasOwnProperty.call(incoming, 'whatsappAdmin')) clean.whatsappAdmin = normalizePhone_(incoming.whatsappAdmin);
  if (Object.prototype.hasOwnProperty.call(incoming, 'waTemplate')) clean.waTemplate = String(incoming.waTemplate || '').slice(0, 2000);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureSheets_().set;
    const last = sh.getLastRow();
    const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
    Object.keys(clean).forEach(function (k) {
      let rowIdx = -1;
      for (let i = 0; i < rows.length; i++) { if (String(rows[i][0]).trim() === k) { rowIdx = i + 2; break; } }
      if (rowIdx === -1) { rowIdx = sh.getLastRow() + 1; sh.getRange(rowIdx, 1).setValue(k); rows.push([k, '']); }
      // format teks (@) mencegah Sheet mengubah nomor WA menjadi angka (angka 0 di depan hilang)
      sh.getRange(rowIdx, 2).setNumberFormat('@');
      sh.getRange(rowIdx, 2).setValue(clean[k]);
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, settings: readSettings_() };
}
