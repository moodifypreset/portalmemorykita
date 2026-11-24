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
            bad_email: 'Alamat email notifikasi tidak valid.',
            no_email: 'Alamat email tujuan tidak ditemukan. Isi email notifikasi.',
            mail_auth: 'Server belum diizinkan mengirim email. Deploy ulang (Deploy > Manage deployments > Edit > New version) lalu klik Authorize access dan izinkan semua akses.',
            bad_url: 'Link hasil harus diawali https://',
            bad_pin: 'PIN harus 4–8 angka.',
            unknown_action: 'kode.gs di server belum versi terbaru. Tempel kode baru lalu Deploy > New version.'
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

    // ---- Ajakan review dari pembeli (tombol kecil mengambang di pojok kanan bawah) ----
    // Muncul otomatis setelah 7 hari pemakaian (dihitung dari pemakaian pertama di browser ini, atau dari link tertua
    // di daftar link bila lebih lama). Hilang selamanya di browser ini setelah pembeli menyatakan review sudah terkirim.
    // (Browser tidak bisa tahu apakah pesan WhatsApp benar-benar terkirim, jadi pembeli ditanya setelah kembali ke halaman ini.)
    const REVIEW_KEY = 'cp_review_done';
    const FIRSTUSE_KEY = 'cp_first_use';
    const REVIEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
    const REVIEW_WA = '6282117102831';
    const REVIEW_TEXT = 'Halo Moodify Preset, saya pembeli Quick Selection & Sorter. Ini review saya: ';
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

    function reviewFirstUse() {
        const v = Number(lsGet(FIRSTUSE_KEY));
        return v > 0 ? v : null;
    }
    // Dipanggil halaman admin bila tahu tanggal pemakaian yang lebih awal (mis. link pertama yang pernah dibuat)
    function noteFirstUse(ts) {
        ts = Number(ts);
        if (!(ts > 0) || ts > Date.now()) return;
        const cur = reviewFirstUse();
        if (cur === null || ts < cur) lsSet(FIRSTUSE_KEY, String(ts));
        maybeShowReview();
    }
    function reviewEligible() {
        if (lsGet(REVIEW_KEY) === '1') return false;
        const f = reviewFirstUse();
        return f !== null && Date.now() - f >= REVIEW_AFTER_MS;
    }
    function setupReviewDock() {
        if (lsGet(REVIEW_KEY) === '1') return;
        if (reviewFirstUse() === null) lsSet(FIRSTUSE_KEY, String(Date.now()));
        maybeShowReview();
    }
    function maybeShowReview() {
        if (document.getElementById('reviewDock') || !document.body || !reviewEligible()) return;
        const css = document.createElement('style');
        css.textContent = '.review-dock{position:fixed;right:12px;bottom:12px;z-index:30;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100vw - 24px);pointer-events:none}' +
            '.review-dock>*{pointer-events:auto}' +
            '.review-fab{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:.5rem;padding:.55rem .95rem;border-radius:999px;font-family:inherit;font-weight:800;font-size:12px;line-height:1.2;color:#78350f;background:linear-gradient(135deg,#fde68a,#fbbf24);border:1px solid #f59e0b;box-shadow:0 4px 14px rgba(15,23,42,.28);text-decoration:none;cursor:pointer;transition:filter .15s,transform .1s;animation:rvIn .7s cubic-bezier(.2,1.4,.4,1) both,rvPulse 2.8s ease-out 1.2s infinite}' +
            '.review-fab:hover{filter:brightness(.95);transform:translateY(-1px)}.review-fab:active{transform:translateY(1px)}' +
            '.review-fab i{color:#b45309;display:inline-block;transform-origin:50% 55%;animation:rvStar 2.8s ease-in-out 1.2s infinite}' +
            '.review-fab::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.65),transparent);transform:skewX(-20deg);animation:rvShine 4.2s ease-in-out 1.8s infinite;pointer-events:none}' +
            '.review-ask{width:min(280px,calc(100vw - 24px));background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;padding:12px;box-shadow:0 10px 28px rgba(15,23,42,.3);font-family:inherit;font-weight:600;font-size:12px;line-height:1.4;animation:rvAsk .25s ease-out both}' +
            '.review-ask p{margin:0 0 10px}.review-ask .ra-row{display:flex;gap:8px}' +
            '.review-ask button{flex:1;padding:.5rem .4rem;border-radius:.6rem;font-family:inherit;font-weight:800;font-size:11.5px;line-height:1.2;border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;cursor:pointer}' +
            '.review-ask button.ra-yes{background:#16a34a;border-color:#16a34a;color:#fff}' +
            'body.has-review-dock{padding-bottom:64px}' +
            '@keyframes rvIn{0%{opacity:0;transform:translateY(40px) scale(.7)}100%{opacity:1;transform:none}}' +
            '@keyframes rvPulse{0%{box-shadow:0 4px 14px rgba(15,23,42,.28),0 0 0 0 rgba(245,158,11,.55)}70%,100%{box-shadow:0 4px 14px rgba(15,23,42,.28),0 0 0 14px rgba(245,158,11,0)}}' +
            '@keyframes rvStar{0%,60%,100%{transform:rotate(0) scale(1)}70%{transform:rotate(-18deg) scale(1.25)}80%{transform:rotate(14deg) scale(1.25)}90%{transform:rotate(0) scale(1.1)}}' +
            '@keyframes rvShine{0%,55%{left:-60%}100%{left:140%}}' +
            '@keyframes rvAsk{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}' +
            '@media (prefers-reduced-motion:reduce){.review-fab,.review-fab i,.review-fab::after,.review-ask{animation:none!important}}';
        document.head.appendChild(css);
        const dock = document.createElement('div');
        dock.id = 'reviewDock'; dock.className = 'review-dock';
        dock.innerHTML = '<div id="reviewAsk" class="review-ask" style="display:none"><p>Review sudah terkirim ke WhatsApp?</p><div class="ra-row"><button type="button" class="ra-yes" id="reviewYes">Sudah terkirim</button><button type="button" id="reviewNo">Belum</button></div></div>' +
            '<a id="reviewBtn" class="review-fab" target="_blank" rel="noopener noreferrer" href="https://wa.me/' + REVIEW_WA + '?text=' + encodeURIComponent(REVIEW_TEXT) + '" title="Kirim review lewat WhatsApp"><i class="fa-solid fa-star"></i><span>Review Quick Selection &amp; Sorter disini</span></a>';
        document.body.appendChild(dock);
        document.body.classList.add('has-review-dock');
        const ask = document.getElementById('reviewAsk');
        let pending = false;
        document.getElementById('reviewBtn').addEventListener('click', () => { pending = true; });
        const showAsk = () => { if (pending) { pending = false; setTimeout(() => { ask.style.display = 'block'; }, 500); } };
        document.addEventListener('visibilitychange', () => { if (!document.hidden) showAsk(); });
        window.addEventListener('focus', showAsk);
        document.getElementById('reviewNo').addEventListener('click', () => { ask.style.display = 'none'; });
        document.getElementById('reviewYes').addEventListener('click', () => {
            lsSet(REVIEW_KEY, '1');
            dock.remove(); document.body.classList.remove('has-review-dock');
        });
    }

    // Dipanggil oleh halaman admin. fn jalan jika ada sesi; jika tidak, ke login.html
    function onReady(fn) {
        if (!getSession()) {
            const hide = document.createElement('style');
            hide.textContent = 'body{visibility:hidden}';
            document.head.appendChild(hide);
            toLogin('');
            return;
        }
        const start = () => { try { fn(); } catch (e) { console.error(e); } checkServer(); try { setupReviewDock(); } catch (e) {} };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    }

    window.Admin = { noteFirstUse, checkServer, onReady, call, post, doLogin, serverUrl, setServerUrl, urlFromFile, errorText, logout, getSession, nextPage, loginPage: LOGIN_PAGE };
})();
