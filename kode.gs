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
 *   (Notifikasi email: saat Deploy, Google menampilkan "Authorize access" -> klik dan izinkan
 *    semua akses. Jika terlewat, tombol "Izinkan Kirim Email" muncul di Pengaturan Studio.)
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
const ADMIN_KEY = '1234';
const DEFAULT_ADMIN_KEY = 'Moodifyserver';   // jangan diubah (penanda nilai bawaan)

// ====== VERSI SERVER ======
// Naik hanya jika rilis baru membutuhkan perubahan di Code.gs. Website (adminAuth.js,
// REQUIRED_SERVER_VERSION) membandingkan angka ini dan menampilkan peringatan update.
const SERVER_VERSION = 8;   // v3: hapus/edit link · v4: progres pengerjaan, kirim pilihan (submit), notifikasi email, statistik · v5: folder asal foto pilihan · v6: izin download foto per link · v7: PIN opsional per link · v8: mode tes vendor (preview) tidak menandai link dibuka

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

const LINK_HEADERS = ['Kode', 'Nama Klien', 'Folder ID', 'Kuota', 'Batas Waktu', 'Status', 'Proteksi', 'Watermark', 'Dibuat', 'No. WA', 'Progres', 'Link Hasil', 'Dibuka Klien', 'Dikirim Klien', 'Download', 'PIN'];
const SEL_HEADERS = ['Kode', 'Nama Klien', 'Jumlah', 'Daftar Foto', 'Data (JSON)', 'Diperbarui'];
// Pengaturan studio: kunci -> nilai awal (nama, nomor WA admin, template pesan WA)
const SETTING_KEYS = ['namaVendor', 'whatsappAdmin', 'waTemplate', 'googleApiKey', 'logoVersion', 'logoWmWhite', 'tema', 'notifOn', 'notifEmail'];
// Logo vendor disimpan sebagai data URI, dipecah ke beberapa baris (batas 1 sel Sheet = 50.000 karakter)
const LOGO_KEYS = ['logo0', 'logo1', 'logo2'];
const LOGO_CHUNK = 45000;
const LOGO_MAX = LOGO_CHUNK * LOGO_KEYS.length;
// Kolom Links (1-based)
const L = { CODE: 1, NAME: 2, FOLDER: 3, KUOTA: 4, DEADLINE: 5, STATUS: 6, PROT: 7, WM: 8, CREATED: 9, PHONE: 10, PROGRES: 11, HASIL: 12, OPENED: 13, SUBMITTED: 14, DL: 15, PIN: 16 };
// Progres pengerjaan: memilih -> dikirim (klien menekan Kirim) -> diedit -> selesai
const PROGRES = ['memilih', 'dikirim', 'diedit', 'selesai'];

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
      case 'deleteLink': return json_(actionDeleteLink_(src));
      case 'submit':     return json_(actionSubmit_(src));
      case 'testEmail':  return json_(actionTestEmail_(src));
      case 'list':       return json_(actionList_(src));
      case 'activity':   return json_(actionActivity_(src));
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
  // Sheet dari versi lama: tambahkan judul kolom baru (sekali saja)
  const p = props_();
  if (p.getProperty('LINK_HDR') !== String(LINK_HEADERS.length)) {
    links.getRange(1, 1, 1, LINK_HEADERS.length).setValues([LINK_HEADERS]);
    p.setProperty('LINK_HDR', String(LINK_HEADERS.length));
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

// Daftar link dipakai di setiap permintaan klien. Disimpan sementara di cache (20 detik) agar
// tidak membaca Sheet berulang kali; dihapus otomatis saat link dibuat/diubah lewat admin.
const LINKS_CACHE_KEY = 'lk_all';
const LINKS_CACHE_SEC = 20;
function clearLinksCache_() { try { CacheService.getScriptCache().remove(LINKS_CACHE_KEY); } catch (e) {} }
function readLinks_() {
  const sh = ensureSheets_().links;
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(LINKS_CACHE_KEY);
    if (hit) {
      const vals = JSON.parse(hit);
      return { sheet: sh, rows: vals.map(function (v, i) { return { row: i + 2, v: v }; }) };
    }
  } catch (e) {}
  const last = sh.getLastRow();
  if (last < 2) return { sheet: sh, rows: [] };
  const values = sh.getRange(2, 1, last - 1, LINK_HEADERS.length).getValues();
  try {
    const txt = JSON.stringify(values);
    if (txt.length < 90000) cache.put(LINKS_CACHE_KEY, txt, LINKS_CACHE_SEC);
  } catch (e) {}
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
    wm: truthy_(v[L.WM - 1]),
    dl: truthy_(v[L.DL - 1]),     // klien boleh mengunduh foto (resolusi asli)
    pin: String(v[L.PIN - 1] == null ? '' : v[L.PIN - 1]).replace(/[^0-9]/g, ''),   // PIN opsional (hanya untuk admin)
    hasPin: String(v[L.PIN - 1] == null ? '' : v[L.PIN - 1]).replace(/[^0-9]/g, '') !== '',
    progres: progresOf_(v[L.PROGRES - 1]),
    hasil: String(v[L.HASIL - 1] || ''),
    openedAt: toMs_(v[L.OPENED - 1]),
    submittedAt: toMs_(v[L.SUBMITTED - 1])
  };
}

function progresOf_(x) {
  const s = String(x || '').trim().toLowerCase();
  return PROGRES.indexOf(s) !== -1 ? s : 'memilih';
}
// ---- PIN opsional per link ----
const PIN_MAX_FAILS = 6;                    // salah PIN beberapa kali -> link dikunci sementara
const PIN_LOCK_MS = 15 * 60 * 1000;

// Salinan data link tanpa PIN, aman dikirim ke klien
function publicLink_(link) {
  const o = {};
  Object.keys(link).forEach(function (k) { o[k] = link[k]; });
  delete o.pin;
  return o;
}

// Ambil PIN dari permintaan admin: '' = tanpa PIN, false = format salah (harus 4-8 angka)
function pinFrom_(src) {
  const p = String(src.pin == null ? '' : src.pin).trim();
  if (!p) return '';
  return /^[0-9]{4,8}$/.test(p) ? p : false;
}

// Mengembalikan null jika boleh lanjut, atau objek error (pin_required / pin_wrong / pin_locked).
// Percobaan salah dihitung di semua aksi klien supaya PIN tidak bisa ditebak lewat aksi lain.
function pinCheck_(link, src) {
  if (!link.pin || isAdmin_(src)) return null;
  const cache = CacheService.getScriptCache();
  const key = 'pf_' + link.code;
  let st = { n: 0, t: 0 };
  try { st = JSON.parse(cache.get(key) || '{}'); } catch (e) { st = { n: 0, t: 0 }; }
  st.n = Number(st.n) || 0; st.t = Number(st.t) || 0;
  const now = Date.now();
  const locked = st.n >= PIN_MAX_FAILS && now - st.t < PIN_LOCK_MS;
  if (locked) return { ok: false, error: 'pin_locked', retryMin: Math.max(1, Math.ceil((PIN_LOCK_MS - (now - st.t)) / 60000)) };
  const given = String(src.pin == null ? '' : src.pin).replace(/[^0-9]/g, '');
  if (!given) return { ok: false, error: 'pin_required' };
  if (safeEq_(given, link.pin)) { if (st.n) { try { cache.remove(key); } catch (e) {} } return null; }
  const n = (st.n >= PIN_MAX_FAILS ? 0 : st.n) + 1;
  cache.put(key, JSON.stringify({ n: n, t: now }), 1800);
  if (n >= PIN_MAX_FAILS) return { ok: false, error: 'pin_locked', retryMin: Math.ceil(PIN_LOCK_MS / 60000) };
  return { ok: false, error: 'pin_wrong', left: PIN_MAX_FAILS - n };
}

// Saat foto sedang diedit / sudah selesai, klien tidak bisa mengubah pilihan lagi
function isProcessing_(link) { return link.progres === 'diedit' || link.progres === 'selesai'; }

function lockState_(link, now) {
  if (link.closed || isProcessing_(link)) return { locked: true, reason: 'closed' };
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

// Format simpanan pilihan di Sheet:
//   lama  : [[id, nama, catatan], ...]
//   baru  : {"f":["Outdoor/Cam 1", ...], "a":[[id, nama, catatan, indeksFolder], ...]}  (nama folder disimpan sekali saja agar hemat ukuran)
// Bila tidak ada satupun foto yang punya folder, tetap memakai format lama.
function parseSel_(str) {
  let d;
  try { d = JSON.parse(str || '[]'); } catch (e) { return []; }
  if (Array.isArray(d)) return d.map(function (a) { return [a[0], a[1], a[2] || '', '']; });
  const tbl = (d && d.f) || [];
  return ((d && d.a) || []).map(function (a) { return [a[0], a[1], a[2] || '', a[3] !== undefined && a[3] !== null && a[3] !== '' ? String(tbl[a[3]] || '') : '']; });
}
function packSel_(items) {
  if (!items.some(function (a) { return a[3]; })) return JSON.stringify(items.map(function (a) { return [a[0], a[1], a[2] || '']; }));
  const tbl = [], idx = {};
  const arr = items.map(function (a) {
    const fo = a[3] || '';
    if (!fo) return [a[0], a[1], a[2] || ''];
    if (idx[fo] === undefined) { idx[fo] = tbl.length; tbl.push(fo); }
    return [a[0], a[1], a[2] || '', idx[fo]];
  });
  return JSON.stringify({ f: tbl, a: arr });
}

function readSelection_(code) {
  const f = findSelectionRow_(code);
  if (!f.row) return null;
  const vals = f.sheet.getRange(f.row, 1, 1, SEL_HEADERS.length).getValues()[0];
  const arr = parseSel_(vals[4]);
  return {
    items: arr.map(function (a) { return { id: a[0], name: a[1], note: a[2] || '', folder: a[3] || '' }; }),
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
  const admin = isAdmin_(src);
  const gate = pinCheck_(link, src);
  if (gate) { gate.link = { name: link.name, hasPin: true }; gate.settings = publicSettings_(); gate.now = Date.now(); return gate; }
  const preview = String(src.preview == null ? '' : src.preview) === '1';   // vendor sedang mengetes link
  if (!admin && !preview && link.openedAt === null) {
    // catat kapan klien pertama kali membuka link (untuk statistik rata-rata waktu memilih)
    try { found.sheet.getRange(found.row, L.OPENED).setValue(new Date()).setNumberFormat('dd/MM/yyyy HH:mm'); clearLinksCache_(); link.openedAt = Date.now(); } catch (e) {}
  }
  if (!admin) link.closed = link.closed || isProcessing_(link);
  return {
    ok: true,
    now: Date.now(),
    link: admin ? link : publicLink_(link),
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
    out.push([c[0], c[1], note, c[3] || (inc && inc[3]) || '']);
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
  const gate = pinCheck_(link, src);
  if (gate) return gate;

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
    incoming.push([id, String(it.name || '').slice(0, 100), String(it.note || '').slice(0, 400), String(it.folder || '').slice(0, 120)]);
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
      const current = cur ? cur.items.map(function (x) { return [x.id, x.name, x.note || '', x.folder || '']; }) : [];
      items = mergeSelection_(current, incoming, base);
    }
    if (items.length > MAX_ITEMS) return { ok: false, error: 'too_many', now: now };
    if (link.kuota !== null && items.length > link.kuota) return { ok: false, error: 'quota', now: now, kuota: link.kuota };
    const json = packSel_(items);
    if (json.length > 48000) return { ok: false, error: 'too_large', now: now };
    const daftar = items.map(function (a, i) { return (i + 1) + '. ' + a[1] + (a[3] ? '  [folder: ' + a[3] + ']' : '') + (a[2] ? '  [catatan: ' + a[2] + ']' : ''); }).join('\n').slice(0, 45000);

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
      selection: { items: items.map(function (a) { return { id: a[0], name: a[1], note: a[2] || '', folder: a[3] || '' }; }), updatedAt: updatedAt, rev: revOf_(json) }
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
  const pf = findLink_(code);
  if (!pf) return { ok: false, error: 'not_found' };
  const pgate = pinCheck_(linkToObj_(pf.v), src);
  if (pgate) return pgate;
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

// Klien menekan "Kirim" (selesai memilih): catat waktunya, ubah progres ke 'dikirim', kirim email ke admin.
function actionSubmit_(src) {
  const code = clean_(src.c);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let link, first = false;
  try {
    const found = findLinkFresh_(code);
    if (!found) return { ok: false, error: 'not_found' };
    const v = found.sheet.getRange(found.row, 1, 1, LINK_HEADERS.length).getValues()[0];
    link = linkToObj_(v);
    const gate = pinCheck_(link, src);
    if (gate) return gate;
    if (link.submittedAt === null) {
      first = true;
      found.sheet.getRange(found.row, L.SUBMITTED).setValue(new Date()).setNumberFormat('dd/MM/yyyy HH:mm');
      link.submittedAt = Date.now();
    }
    if (link.progres === 'memilih') { found.sheet.getRange(found.row, L.PROGRES).setValue('dikirim'); link.progres = 'dikirim'; }
    clearLinksCache_();
  } finally {
    lock.releaseLock();
  }
  let mailed = false;
  const cache = CacheService.getScriptCache();
  if (!cache.get('mail_' + code)) {   // maksimal 1 email per klien tiap 2 menit
    cache.put('mail_' + code, '1', 120);
    try { mailed = sendSubmitMail_(link, String(src.admin || '')); } catch (e) { mailed = false; }
  }
  return { ok: true, progres: link.progres, first: first, mailed: mailed };
}

function notifTarget_(st) {
  if (!truthy_(st.notifOn)) return '';
  const e = String(st.notifEmail || '').trim();
  if (e) return e;
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (err) { return ''; }
}

function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function sendSubmitMail_(link, adminUrl) {
  const st = readSettings_();
  const to = notifTarget_(st);
  if (!to) return false;
  const sel = readSelection_(link.code);
  const items = sel ? sel.items : [];
  const vendor = st.namaVendor || 'Studio';
  const name = link.name || link.code;
  const list = items.slice(0, 300).map(function (it, i) {
    return '<tr><td style="padding:2px 10px 2px 0;color:#64748b">' + (i + 1) + '.</td><td style="padding:2px 0">' + esc_(it.name) + (it.folder ? ' <span style="color:#64748b;font-size:12px">· ' + esc_(it.folder) + '</span>' : '') +
      (it.note ? ' <span style="color:#b45309">— ' + esc_(it.note) + '</span>' : '') + '</td></tr>';
  }).join('');
  const quota = link.kuota ? items.length + ' dari ' + link.kuota + ' foto' : items.length + ' foto';
  const btn = /^https?:\/\//.test(adminUrl) ? '<p style="margin:20px 0"><a href="' + esc_(adminUrl) + '" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Buka Halaman Admin</a></p>' : '';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">' +
    '<p style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0">' + esc_(vendor) + '</p>' +
    '<h2 style="margin:6px 0 4px">' + esc_(name) + ' selesai memilih foto</h2>' +
    '<p style="margin:0 0 14px;color:#475569">Kode: ' + esc_(link.code) + ' · Terpilih: <b>' + quota + '</b></p>' + btn +
    '<table style="border-collapse:collapse;font-size:13px">' + list + '</table>' +
    (items.length > 300 ? '<p style="color:#64748b">… dan ' + (items.length - 300) + ' foto lainnya.</p>' : '') +
    '<p style="margin-top:20px;font-size:12px;color:#94a3b8">Email otomatis dari portal seleksi foto. Matikan di Pengaturan Studio &gt; Notifikasi Email.</p></div>';
  MailApp.sendEmail({ to: to, subject: '✅ ' + name + ' selesai memilih ' + items.length + ' foto', htmlBody: html, name: vendor + ' Portal' });
  return true;
}

// Cek apakah pemilik server sudah mengizinkan kirim email. Jika belum, kembalikan link izin dari Google
// sehingga bisa dibuka langsung dari Pengaturan Studio (tanpa membuka editor Apps Script).
function mailAuth_() {
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) return { ok: false, url: info.getAuthorizationUrl() || '' };
    return { ok: true };
  } catch (e) { return { ok: null }; }
}

// Dipanggil dari Pengaturan Studio untuk memastikan email sampai
function actionTestEmail_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const auth = mailAuth_();
  if (auth.ok === false) return { ok: false, error: 'mail_auth', authUrl: auth.url };
  const st = readSettings_();
  st.notifOn = '1';
  const to = notifTarget_(st);
  if (!to) return { ok: false, error: 'no_email' };
  try {
    MailApp.sendEmail({ to: to, subject: 'Tes notifikasi portal seleksi foto', htmlBody: '<p>Notifikasi email sudah aktif. Anda akan menerima email setiap klien selesai memilih foto.</p>', name: (st.namaVendor || 'Studio') + ' Portal' });
  } catch (e) {
    return { ok: false, error: 'mail_auth', authUrl: mailAuth_().url || '', message: String(e && e.message || e) };
  }
  return { ok: true, to: to };
}

// Opsional: cara lain memberi izin kirim email (pilih tesEmail > Run di editor Apps Script).
function tesEmail() {
  const to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'Tes notifikasi portal seleksi foto', 'Izin kirim email sudah aktif. Sekarang Deploy > Manage deployments > Edit > New version.');
  Logger.log('Email tes dikirim ke ' + to);
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
  const pin = pinFrom_(src);
  if (pin === false) return { ok: false, error: 'bad_pin' };

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
      String(src.phone || '').replace(/[^0-9]/g, ''),
      '', '', '', '',                 // Progres, Link Hasil, Dibuka, Dikirim (kosong saat link baru)
      src.dl ? true : false,          // Download
      ''                              // PIN (diisi di bawah sebagai teks agar angka 0 di depan tidak hilang)
    ]]);
    if (pin) { sh.getRange(row, L.PIN).setNumberFormat('@'); sh.getRange(row, L.PIN).setValue(pin); }
    sh.getRange(row, L.DEADLINE).setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange(row, L.CREATED).setNumberFormat('dd/MM/yyyy HH:mm');
    clearLinksCache_();
    return { ok: true, code: code };
  } finally {
    lock.releaseLock();
  }
}

// Cari baris link langsung dari Sheet (tanpa cache) agar nomor barisnya pasti benar sebelum diubah/dihapus.
function findLinkFresh_(code) {
  const sh = ensureSheets_().links;
  const last = sh.getLastRow();
  if (!code || last < 2) return null;
  const codes = sh.getRange(2, L.CODE, last - 1, 1).getValues();
  for (let i = 0; i < codes.length; i++) {
    if (clean_(codes[i][0]) === code) return { sheet: sh, row: i + 2 };
  }
  return null;
}

function actionUpdateLink_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const code = clean_(src.c);
  const hasPinField = Object.prototype.hasOwnProperty.call(src, 'pin');
  const newPin = hasPinField ? pinFrom_(src) : '';
  if (newPin === false) return { ok: false, error: 'bad_pin' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const found = findLinkFresh_(code);
    if (!found) return { ok: false, error: 'not_found' };
    const sh = found.sheet;
    if (hasPinField) {
      sh.getRange(found.row, L.PIN).setNumberFormat('@');
      sh.getRange(found.row, L.PIN).setValue(newPin);
      try { CacheService.getScriptCache().remove('pf_' + code); } catch (e) {}   // PIN baru: hitungan salah dimulai ulang
    }

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
      sh.getRange(found.row, L.KUOTA).setValue(k > 0 ? Math.min(MAX_ITEMS, Math.floor(k)) : '');
    }
    if (Object.prototype.hasOwnProperty.call(src, 'progres')) {
      const pg = String(src.progres || '').toLowerCase();
      if (PROGRES.indexOf(pg) === -1) return { ok: false, error: 'bad_request' };
      sh.getRange(found.row, L.PROGRES).setValue(pg);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'dl')) {
      sh.getRange(found.row, L.DL).setValue(src.dl ? true : false);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'hasil')) {
      const h = String(src.hasil || '').trim();
      if (h && !/^https?:\/\/\S{3,}$/i.test(h)) return { ok: false, error: 'bad_url' };
      sh.getRange(found.row, L.HASIL).setValue(h.slice(0, 500));
    }
    clearLinksCache_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Hapus link klien beserta data pilihannya (baris di sheet Links & Pilihan). Tidak bisa dibatalkan.
function actionDeleteLink_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const code = clean_(src.c);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const found = findLinkFresh_(code);
    if (!found) { clearLinksCache_(); return { ok: false, error: 'not_found' }; }
    found.sheet.deleteRow(found.row);
    const sel = findSelectionRow_(code);
    if (sel.row) sel.sheet.deleteRow(sel.row);
    clearLinksCache_();
    try { CacheService.getScriptCache().remove('pres_' + code); } catch (e) {}
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
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
    o.phone = String(r.v[L.PHONE - 1] || '');
    return o;
  }).reverse();
  return { ok: true, now: Date.now(), links: links.slice(0, 200) };
}

// Ringan untuk pemantauan realtime di generatorLink: hanya jumlah pilihan, waktu terakhir, dan
// jumlah perangkat klien yang sedang online. 'sig' berubah jika ada link baru / status / batas waktu berubah.
function actionActivity_(src) {
  if (!isAdmin_(src)) return adminError_(src);
  const now = Date.now();
  const all = readLinks_();
  const sh = ensureSheets_().sel;
  const last = sh.getLastRow();
  const counts = {};
  if (last >= 2) {
    const n = last - 1;
    const codes = sh.getRange(2, 1, n, 1).getValues();
    const cnt = sh.getRange(2, 3, n, 1).getValues();
    const upd = sh.getRange(2, 6, n, 1).getValues();
    for (let i = 0; i < n; i++) counts[clean_(codes[i][0])] = { count: Number(cnt[i][0]) || 0, updatedAt: toMs_(upd[i][0]) };
  }
  const objs = all.rows.map(function (r) { return linkToObj_(r.v); }).slice(-200);
  let pres = {};
  try { pres = CacheService.getScriptCache().getAll(objs.map(function (o) { return 'pres_' + o.code; })) || {}; } catch (e) { pres = {}; }
  const items = {};
  const sigParts = [];
  objs.forEach(function (o) {
    const c = counts[o.code] || { count: 0, updatedAt: null };
    let online = 0;
    try {
      const map = JSON.parse(pres['pres_' + o.code] || '{}');
      Object.keys(map).forEach(function (k) { if (now - map[k] <= PRESENCE_ACTIVE_MS) online++; });
    } catch (e) {}
    items[o.code] = { count: c.count, updatedAt: c.updatedAt, online: online, sub: o.submittedAt };
    sigParts.push([o.code, o.name, o.kuota, o.deadline, o.closed ? 1 : 0, o.progres, o.hasil, o.submittedAt].join('~'));
  });
  return { ok: true, now: now, sig: sha_(sigParts.join('|')).slice(0, 12), items: items };
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
    if (tema && ['bersih', 'gelap', 'elegan', 'mono'].indexOf(tema) === -1) return { ok: false, error: 'bad_theme' };
    clean.tema = tema;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'notifOn')) clean.notifOn = truthy_(incoming.notifOn) ? '1' : '';
  if (Object.prototype.hasOwnProperty.call(incoming, 'notifEmail')) {
    const em = String(incoming.notifEmail || '').trim().slice(0, 200);
    if (em && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(em)) return { ok: false, error: 'bad_email' };
    clean.notifEmail = em;
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
