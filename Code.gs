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
 *   3. Ganti ADMIN_KEY di bawah dengan password admin buatan Anda sendiri
 *      (dipakai untuk login di generatorLink & pengaturanStudio; bisa diganti
 *      dari halaman Pengaturan Studio setelah login).
 *   4. Jalankan fungsi `setup` sekali (tombol Run) lalu beri izin akses.
 *   5. Deploy > New deployment > Web app
 *        Execute as : Me
 *        Who has access : Anyone
 *      Salin URL Web app -> tempel di halaman login admin (pengaturanStudio.html)
 *   6. Setiap mengubah kode ini: Deploy > Manage deployments > Edit > New version.
 * =====================================================================
 */

// ====== WAJIB DIGANTI ======
const ADMIN_KEY = 'GANTI-DENGAN-KUNCI-RAHASIA';
const DEFAULT_ADMIN_KEY = 'GANTI-DENGAN-KUNCI-RAHASIA';   // jangan diubah (penanda nilai bawaan)

// ====== VERSI SERVER ======
// Naik hanya jika rilis baru membutuhkan perubahan di Code.gs. Website (adminAuth.js,
// REQUIRED_SERVER_VERSION) membandingkan angka ini dan menampilkan peringatan update.
const SERVER_VERSION = 1;

// ====== PENGATURAN ======
const SHEET_LINKS = 'Links';
const SHEET_PILIHAN = 'Pilihan';
const SHEET_SETTINGS = 'Pengaturan';
const GRACE_MS = 30 * 1000;        // toleransi 30 detik setelah batas (menutup jeda simpan otomatis)
const MAX_ITEMS = 700;             // maksimal foto terpilih per klien
const SESSION_MS = 12 * 3600 * 1000;          // login biasa: 12 jam
const REMEMBER_MS = 30 * 24 * 3600 * 1000;    // "tetap masuk": 30 hari
const MAX_FAILS = 5;                          // salah password berturut-turut sebelum dikunci
const LOCK_MS = 5 * 60 * 1000;                // lama penguncian
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const LINK_HEADERS = ['Kode', 'Nama Klien', 'Folder ID', 'Kuota', 'Batas Waktu', 'Status', 'Proteksi', 'Watermark', 'Dibuat', 'No. WA'];
const SEL_HEADERS = ['Kode', 'Nama Klien', 'Jumlah', 'Daftar Foto', 'Data (JSON)', 'Diperbarui'];
// Pengaturan studio: kunci -> nilai awal (nama, nomor WA admin, template pesan WA)
const SETTING_KEYS = ['namaVendor', 'whatsappAdmin', 'waTemplate', 'googleApiKey', 'logoVersion', 'logoWmWhite', 'tema'];
// Logo vendor disimpan sebagai data URI, dipecah ke beberapa baris (batas 1 sel Sheet = 50.000 karakter)
const LOGO_KEYS = ['logo0', 'logo1', 'logo2'];
const LOGO_CHUNK = 45000;
const LOGO_MAX = LOGO_CHUNK * LOGO_KEYS.length;
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
      case 'presence':   return json_(actionPresence_(src));
      case 'createLink': return json_(actionCreateLink_(src));
      case 'updateLink': return json_(actionUpdateLink_(src));
      case 'list':       return json_(actionList_(src));
      case 'settings':     return json_(actionSettings_(src));
      case 'logo':         return json_(actionLogo_(src));
      case 'getSettings':  return json_(actionGetSettings_(src));
      case 'saveSettings': return json_(actionSaveSettings_(src));
      case 'login':          return json_(actionLogin_(src));
      case 'changePassword': return json_(actionChangePassword_(src));
      case 'ping':       return json_({ ok: true, now: Date.now(), configured: passwordConfigured_(), version: SERVER_VERSION });
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

// ---------------------------------------------------------------------
// Login admin: password -> token bertanda tangan (HMAC) yang kedaluwarsa.
// Password awal = ADMIN_KEY. Setelah diganti dari halaman Pengaturan Studio,
// yang dipakai adalah hash tersimpan di Script Properties (ADMIN_KEY diabaikan).
// ---------------------------------------------------------------------
function props_() { return PropertiesService.getScriptProperties(); }

function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes); }

function sha_(text) {
  return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function tokenSecret_() {
  const p = props_();
  let s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}

function signToken_(exp) {
  return b64_(Utilities.computeHmacSha256Signature('adm.' + exp, tokenSecret_()));
}

function makeToken_(ms) {
  const exp = Date.now() + ms;
  return { token: exp + '.' + signToken_(exp), expires: exp };
}

function tokenOk_(t) {
  const m = /^(\d{10,16})\.([A-Za-z0-9_=-]{20,80})$/.exec(String(t || ''));
  if (!m) return false;
  if (Number(m[1]) <= Date.now()) return false;
  return safeEq_(m[2], signToken_(m[1]));
}

function passwordConfigured_() {
  return !!props_().getProperty('PW_HASH') || ADMIN_KEY !== DEFAULT_ADMIN_KEY;
}

function passwordMatches_(pw) {
  pw = String(pw === undefined || pw === null ? '' : pw);
  const p = props_();
  const h = p.getProperty('PW_HASH');
  if (h) return safeEq_(sha_(p.getProperty('PW_SALT') + ':' + pw), h);
  return ADMIN_KEY !== DEFAULT_ADMIN_KEY && safeEq_(pw, ADMIN_KEY);
}

function lockedUntil_() {
  const u = Number(props_().getProperty('FAIL_UNTIL') || 0);
  return u > Date.now() ? u : 0;
}

// Memeriksa password dengan pembatasan percobaan (anti tebak-tebakan)
function checkPassword_(pw) {
  if (lockedUntil_()) return false;
  const p = props_();
  if (passwordMatches_(pw)) { p.setProperty('FAIL_COUNT', '0'); return true; }
  let n = Number(p.getProperty('FAIL_COUNT') || 0) + 1;
  if (n >= MAX_FAILS) { p.setProperty('FAIL_UNTIL', String(Date.now() + LOCK_MS)); n = 0; }
  p.setProperty('FAIL_COUNT', String(n));
  return false;
}

function isAdmin_(src) {
  if (!passwordConfigured_()) return false;
  if (tokenOk_(src.token)) return true;
  if (src.adminKey !== undefined) return checkPassword_(src.adminKey);   // kompatibilitas: password dikirim langsung
  return false;
}

function adminError_(src) {
  if (!passwordConfigured_()) return { ok: false, error: 'admin_key_not_set' };
  const u = lockedUntil_();
  if (u) return { ok: false, error: 'locked', retryAfter: Math.ceil((u - Date.now()) / 1000) };
  return { ok: false, error: 'unauthorized' };
}

function actionLogin_(src) {
  if (!passwordConfigured_()) return { ok: false, error: 'admin_key_not_set' };
  if (!checkPassword_(src.password)) return adminError_(src);
  const t = makeToken_(src.remember ? REMEMBER_MS : SESSION_MS);
  return { ok: true, token: t.token, expires: t.expires };
}

function actionChangePassword_(src) {
  if (!passwordConfigured_()) return { ok: false, error: 'admin_key_not_set' };
  if (!tokenOk_(src.token)) return { ok: false, error: 'unauthorized' };
  if (!checkPassword_(src.currentPassword)) {
    const e = adminError_(src);
    return e.error === 'locked' ? e : { ok: false, error: 'wrong_password' };
  }
  const np = String(src.newPassword || '');
  if (np.length < 8 || np.length > 100) return { ok: false, error: 'weak_password' };
  const p = props_();
  const salt = Utilities.getUuid();
  p.setProperty('PW_SALT', salt);
  p.setProperty('PW_HASH', sha_(salt + ':' + np));
  p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());   // semua sesi lama otomatis tidak berlaku
  const t = makeToken_(SESSION_MS);
  return { ok: true, token: t.token, expires: t.expires };
}

// Lupa password? Jalankan fungsi ini dari editor Apps Script (tombol Run).
// Password kembali menjadi nilai ADMIN_KEY di atas dan semua sesi login dicabut.
function resetPassword() {
  const p = props_();
  ['PW_HASH', 'PW_SALT', 'FAIL_COUNT', 'FAIL_UNTIL'].forEach(function (k) { p.deleteProperty(k); });
  p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
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

// Penanda isi pilihan (berubah jika isinya berubah). Dipakai membandingkan tanpa bergantung pada jam.
function revOf_(json) { return sha_(json).slice(0, 12); }

function readSelection_(code) {
  const f = findSelectionRow_(code);
  if (!f.row) return null;
  const vals = f.sheet.getRange(f.row, 1, 1, SEL_HEADERS.length).getValues()[0];
  let arr = [];
  try { arr = JSON.parse(vals[4] || '[]'); } catch (e) { arr = []; }
  return {
    items: arr.map(function (a) { return { id: a[0], name: a[1], note: a[2] || '' }; }),
    updatedAt: toMs_(vals[5]),
    rev: revOf_(String(vals[4] || '[]'))
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

// Menggabungkan perubahan satu perangkat ke pilihan yang sudah ada di server (3 arah):
//   current = pilihan di server sekarang, incoming = pilihan di perangkat, base = pilihan terakhir yang
//   diketahui perangkat itu ([[id, catatan], ...]). Yang ditambah/dihapus perangkat ini diterapkan ke
//   current, sehingga pilihan pasangan (perangkat lain) tidak tertimpa.
function mergeSelection_(current, incoming, base) {
  const baseMap = {};
  base.forEach(function (b) { baseMap[String(b[0])] = String(b[1] || ''); });
  const inMap = {};
  incoming.forEach(function (i) { inMap[i[0]] = i; });
  const out = [];
  const seen = {};
  current.forEach(function (c) {
    const known = Object.prototype.hasOwnProperty.call(baseMap, c[0]);
    const inc = inMap[c[0]];
    if (known && !inc) return;                       // dihapus oleh perangkat ini
    let note = c[2] || '';
    if (inc) {
      if (known) { if (String(inc[2] || '') !== baseMap[c[0]]) note = inc[2] || ''; }   // catatan diubah di perangkat ini
      else if (inc[2]) note = inc[2];                // ditambahkan di kedua perangkat
    }
    out.push([c[0], c[1], note]);
    seen[c[0]] = true;
  });
  incoming.forEach(function (i) {
    if (seen[i[0]]) return;
    if (!Object.prototype.hasOwnProperty.call(baseMap, i[0])) out.push(i);   // baru ditambahkan perangkat ini
    // jika sudah diketahui perangkat ini tetapi hilang di server: pasangan menghapusnya, hapusan itu dihormati
  });
  return out;
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
  const incoming = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] || {};
    const id = String(it.id || '');
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || seen[id]) continue;
    seen[id] = true;
    incoming.push([id, String(it.name || '').slice(0, 100), String(it.note || '').slice(0, 400)]);
  }
  // base ada = mode gabung (klien baru); tanpa base = timpa seluruhnya (klien lama)
  const mergeMode = Array.isArray(src.base);
  const base = mergeMode ? src.base.slice(0, MAX_ITEMS).map(function (b) { return Array.isArray(b) ? [String(b[0] || ''), String(b[1] || '')] : [String(b || ''), '']; }) : [];

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let items = incoming;
    if (mergeMode) {
      const cur = readSelection_(code);
      const current = cur ? cur.items.map(function (x) { return [x.id, x.name, x.note || '']; }) : [];
      items = mergeSelection_(current, incoming, base);
    }
    if (items.length > MAX_ITEMS) return { ok: false, error: 'too_many', now: now };
    if (link.kuota !== null && items.length > link.kuota) return { ok: false, error: 'quota', now: now, kuota: link.kuota };
    const json = JSON.stringify(items);
    if (json.length > 48000) return { ok: false, error: 'too_large', now: now };
    const daftar = items.map(function (a, i) { return (i + 1) + '. ' + a[1] + (a[2] ? '  [catatan: ' + a[2] + ']' : ''); }).join('\n').slice(0, 45000);

    const f = findSelectionRow_(code);
    const rowValues = [[code, link.name, items.length, daftar, json, new Date()]];
    let row = f.row;
    if (!row) row = f.sheet.getLastRow() + 1;
    f.sheet.getRange(row, 1, 1, SEL_HEADERS.length).setValues(rowValues);
    f.sheet.getRange(row, 6).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    const updatedAt = Date.now();
    return {
      ok: true, now: updatedAt, updatedAt: updatedAt, count: items.length,
      rev: revOf_(json),
      selection: { items: items.map(function (a) { return { id: a[0], name: a[1], note: a[2] || '' }; }), updatedAt: updatedAt, rev: revOf_(json) }
    };
  } finally {
    lock.releaseLock();
  }
}

// Kehadiran: siapa lagi yang sedang membuka link yang sama (mis. pasangan klien).
// Perangkat mengirim denyut tiap ~20 detik; dianggap aktif jika terlihat < 60 detik terakhir.
// Jika isi pilihan di server berbeda dari yang diketahui perangkat (rev), pilihan ikut dikirim.
const PRESENCE_ACTIVE_MS = 60 * 1000;
function actionPresence_(src) {
  const code = clean_(src.c);
  const id = String(src.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!code || !id) return { ok: false, error: 'bad_request' };
  if (!findLink_(code)) return { ok: false, error: 'not_found' };
  const now = Date.now();
  const cache = CacheService.getScriptCache();
  const key = 'pres_' + code;
  let others = 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    let map = {};
    try { map = JSON.parse(cache.get(key) || '{}'); } catch (e) { map = {}; }
    map[id] = now;
    Object.keys(map).forEach(function (k) { if (now - map[k] > PRESENCE_ACTIVE_MS * 2) delete map[k]; });
    cache.put(key, JSON.stringify(map), 300);
    Object.keys(map).forEach(function (k) { if (k !== id && now - map[k] <= PRESENCE_ACTIVE_MS) others++; });
  } finally {
    lock.releaseLock();
  }
  const out = { ok: true, now: now, others: others };
  const sel = readSelection_(code);
  out.rev = sel ? sel.rev : '';
  if (sel && String(src.rev || '') !== sel.rev) out.selection = sel;
  return out;
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
// Pengaturan studio (nama, nomor WA admin, template pesan WA, Google API key)
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
  return { namaVendor: st.namaVendor, whatsappAdmin: st.whatsappAdmin, googleApiKey: st.googleApiKey, logoVersion: st.logoVersion, logoWmWhite: st.logoWmWhite, tema: st.tema };
}

function normalizePhone_(v) {
  let d = String(v || '').replace(/[^0-9]/g, '');
  if (d.indexOf('0') === 0) d = '62' + d.slice(1);
  else if (d.indexOf('8') === 0) d = '62' + d;
  return d.slice(0, 20);
}

function readLogo_() {
  const sh = ensureSheets_().set;
  const last = sh.getLastRow();
  if (last < 2) return '';
  const rows = sh.getRange(2, 1, last - 1, 2).getValues();
  const map = {};
  rows.forEach(function (r) { map[String(r[0] || '').trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]); });
  return LOGO_KEYS.map(function (k) { return map[k] || ''; }).join('');
}

// Publik: logo diambil klien hanya saat versinya berubah
function actionLogo_(src) {
  const st = readSettings_();
  return { ok: true, version: st.logoVersion, logo: st.logoVersion ? readLogo_() : '' };
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
  if (Object.prototype.hasOwnProperty.call(incoming, 'googleApiKey')) {
    const key = String(incoming.googleApiKey || '').trim();
    if (key && !/^[A-Za-z0-9_-]{20,80}$/.test(key)) return { ok: false, error: 'bad_apikey' };
    clean.googleApiKey = key;
  }

  if (Object.prototype.hasOwnProperty.call(incoming, 'tema')) {
    const tema = String(incoming.tema || '').trim();
    if (tema && ['bersih', 'gelap', 'elegan'].indexOf(tema) === -1) return { ok: false, error: 'bad_theme' };
    clean.tema = tema;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'logoWmWhite')) clean.logoWmWhite = truthy_(incoming.logoWmWhite) ? '1' : '';
  if (Object.prototype.hasOwnProperty.call(incoming, 'logo')) {
    const logo = String(incoming.logo || '').trim();
    if (logo === '') {
      clean.logoVersion = '';
      LOGO_KEYS.forEach(function (k) { clean[k] = ''; });
    } else {
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(logo)) return { ok: false, error: 'bad_logo' };
      if (logo.length > LOGO_MAX) return { ok: false, error: 'logo_too_big' };
      clean.logoVersion = String(Date.now());
      LOGO_KEYS.forEach(function (k, i) { clean[k] = logo.slice(i * LOGO_CHUNK, (i + 1) * LOGO_CHUNK); });
    }
  }

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
