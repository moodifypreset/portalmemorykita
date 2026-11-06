/* =====================================================================
 * Login admin (dipakai login.html, generatorLink.html, pengaturanStudio.html)
 * - Password diperiksa SERVER (Google Apps Script), bukan di browser.
 * - Server membalas token bertanda tangan; semua aksi admin memakai token.
 * - Halaman admin hanya "cangkang": tanpa login tidak ada data yang bisa
 *   dibaca atau diubah, karena semua datanya ada di server.
 * - Belum login / sesi habis -> otomatis diarahkan ke login.html.
 * ===================================================================== */
(function () {
    const TOKEN_KEY = 'cpAdminSession';
    const URL_KEY = 'cpServerUrl';
    // Versi Code.gs minimum yang dibutuhkan website ini. Naikkan angka ini (bersama SERVER_VERSION
    // di Code.gs) hanya saat rilis baru membutuhkan perubahan di server.
    const REQUIRED_SERVER_VERSION = 2;
    const LOGIN_PAGE = 'login.html';
    const ALLOWED_NEXT = ['generatorLink.html', 'pengaturanStudio.html'];
    const cfg = () => (typeof CONFIG_APP !== 'undefined' ? CONFIG_APP : {});

    function serverUrl() {
        const a = String(cfg().urlServer || '').trim();
        if (a) return a;
        try { return (localStorage.getItem(URL_KEY) || '').trim(); } catch (e) { return ''; }
    }
    function urlFromFile() { return !!String(cfg().urlServer || '').trim(); }
    function setServerUrl(u) { try { localStorage.setItem(URL_KEY, String(u || '').trim()); } catch (e) {} }

    function getSession() {
        try {
            const s = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
            if (s && s.token && s.expires > Date.now() + 60000) return s;
        } catch (e) {}
        return null;
    }
    function saveSession(s) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: s.token, expires: s.expires })); } catch (e) {} }
    function clearSession() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

    async function post(body) {
        const res = await fetch(serverUrl(), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        return await res.json();
    }

    function currentPage() {
        let f = location.pathname.split('/').pop() || '';
        if (f && !/\.html$/.test(f)) f += '.html';   // Vercel cleanUrls: /pengaturanStudio -> pengaturanStudio.html
        return ALLOWED_NEXT.indexOf(f) !== -1 ? f : ALLOWED_NEXT[0];
    }
    function toLogin(reason) {
        location.replace(LOGIN_PAGE + '?next=' + encodeURIComponent(currentPage()) + (reason ? '&msg=' + reason : ''));
    }
    // tujuan setelah login (hanya halaman admin yang diizinkan, mencegah pengalihan ke situs lain)
    function nextPage() {
        const n = new URLSearchParams(location.search).get('next') || '';
        return ALLOWED_NEXT.indexOf(n) !== -1 ? n : ALLOWED_NEXT[0];
    }

    // Panggilan admin: otomatis menyertakan token; sesi habis -> ke halaman login
    async function call(body) {
        const s = getSession();
        if (!s) { toLogin('expired'); return { ok: false, error: 'unauthorized' }; }
        const res = await post(Object.assign({}, body, { token: s.token }));
        if (!res.ok && res.error === 'unauthorized') { clearSession(); toLogin('expired'); }
        return res;
    }

    function errorText(code, res) {
        const map = {
            unauthorized: 'Password salah.',
            wrong_password: 'Password saat ini salah.',
            weak_password: 'Password baru minimal 8 karakter.',
            admin_key_not_set: 'ADMIN_KEY di Code.gs belum diganti dari nilai bawaan.',
            bad_folder: 'Link / ID folder Google Drive tidak valid.',
            bad_apikey: 'Google API Key tidak valid (huruf/angka/_/- , 20-80 karakter).',
            bad_logo: 'Format logo tidak valid (harus PNG, JPG, atau WebP).',
            logo_too_big: 'Logo terlalu besar. Pilih gambar yang lebih sederhana.',
            not_found: 'Link tidak ditemukan di Sheet.',
            unknown_action: 'Code.gs di server belum versi terbaru. Tempel kode baru lalu Deploy > New version.'
        };
        if (code === 'locked') {
            const m = Math.max(1, Math.ceil(((res && res.retryAfter) || 60) / 60));
            return 'Terlalu banyak percobaan salah. Coba lagi dalam ' + m + ' menit.';
        }
        return map[code] || ('Server menolak permintaan (' + (code || 'tidak diketahui') + ').');
    }

    // Dipakai login.html. Mengembalikan { ok, message }
    async function doLogin(password, remember, url) {
        if (url !== undefined && url !== null && String(url).trim() !== '') {
            const u = String(url).trim();
            if (!/^https:\/\/script\.google\.com\/.+/.test(u)) return { ok: false, message: 'URL server harus diawali https://script.google.com/ (salin dari Deploy > Web app).' };
            if (u !== serverUrl()) setServerUrl(u);
        }
        if (!serverUrl()) return { ok: false, message: 'Isi URL server terlebih dahulu.', needUrl: true };
        if (!password) return { ok: false, message: 'Isi password admin.' };
        try {
            const res = await post({ action: 'login', password, remember: !!remember });
            if (!res.ok) return { ok: false, message: errorText(res.error, res) };
            saveSession(res);
            return { ok: true };
        } catch (e) {
            return { ok: false, needUrl: true, message: 'Tidak dapat terhubung ke server. Periksa: URL berakhiran /exec, Deploy > Who has access = Anyone, dan sudah Deploy versi terbaru.' };
        }
    }

    // Tidak ada lagi peringatan versi untuk pengguna. Fitur yang butuh server baru mendeteksi
    // sendiri (mis. presence -> unknown_action) dan otomatis nonaktif tanpa pesan error.
    // Fungsi ini hanya mengembalikan info versi untuk keperluan debug (Admin.checkServer() di konsol).
    async function checkServer() {
        try {
            const r = await post({ action: 'ping' });
            const version = Number(r && r.version) || 0;
            return { version, required: REQUIRED_SERVER_VERSION, outdated: version < REQUIRED_SERVER_VERSION };
        } catch (e) { return { version: null, required: REQUIRED_SERVER_VERSION, outdated: false }; }
    }

    function logout() { clearSession(); try { localStorage.removeItem('cp_list_cache'); } catch (e) {} location.replace(LOGIN_PAGE); }

    // Dipanggil oleh halaman admin. fn jalan jika ada sesi; jika tidak, ke login.html
    function onReady(fn) {
        if (!getSession()) {
            const hide = document.createElement('style');
            hide.textContent = 'body{visibility:hidden}';
            document.head.appendChild(hide);
            toLogin('');
            return;
        }
        const start = () => { try { fn(); } catch (e) { console.error(e); } checkServer(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    }

    window.Admin = { checkServer, onReady, call, post, doLogin, serverUrl, setServerUrl, urlFromFile, errorText, logout, getSession, nextPage, loginPage: LOGIN_PAGE };
})();
