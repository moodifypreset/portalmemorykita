/* =====================================================================
 * Login admin (dipakai generatorLink.html & pengaturanStudio.html)
 * - Password diperiksa SERVER (Google Apps Script), bukan di browser.
 * - Server membalas token bertanda tangan; semua aksi admin memakai token.
 * - Halaman ini hanya "cangkang": tanpa login tidak ada data yang bisa dibaca
 *   atau diubah, karena semua datanya ada di server.
 * ===================================================================== */
(function () {
    const TOKEN_KEY = 'cpAdminSession';
    const URL_KEY = 'cpServerUrl';
    const cfg = () => (typeof CONFIG_APP !== 'undefined' ? CONFIG_APP : {});
    let readyFn = null;
    let gateEl = null;

    // Sembunyikan isi halaman sampai ada sesi (mencegah kilasan konten)
    const hideStyle = document.createElement('style');
    hideStyle.textContent = 'html.admin-gated body > *:not(#adminGate){display:none !important}';
    document.head.appendChild(hideStyle);

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

    // Panggilan admin: otomatis menyertakan token; sesi habis -> tampil login lagi
    async function call(body) {
        const s = getSession();
        if (!s) { showGate('Sesi berakhir, silakan masuk lagi.'); return { ok: false, error: 'unauthorized' }; }
        const res = await post(Object.assign({}, body, { token: s.token }));
        if (!res.ok && res.error === 'unauthorized') { clearSession(); showGate('Sesi berakhir, silakan masuk lagi.'); }
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
            not_found: 'Link tidak ditemukan di Sheet.',
            unknown_action: 'Code.gs di server belum versi terbaru. Tempel kode baru lalu Deploy > New version.'
        };
        if (code === 'locked') {
            const m = Math.max(1, Math.ceil(((res && res.retryAfter) || 60) / 60));
            return 'Terlalu banyak percobaan salah. Coba lagi dalam ' + m + ' menit.';
        }
        return map[code] || ('Server menolak permintaan (' + (code || 'tidak diketahui') + ').');
    }

    function logout() { clearSession(); location.reload(); }

    function runReady() {
        document.documentElement.classList.remove('admin-gated');
        if (gateEl) { gateEl.remove(); gateEl = null; }
        if (readyFn) { try { readyFn(); } catch (e) { console.error(e); } }
    }

    function showGate(msg) {
        document.documentElement.classList.add('admin-gated');
        if (gateEl) { const e = gateEl.querySelector('#gateMsg'); if (e && msg) { e.textContent = msg; e.className = 'text-xs text-amber-700 min-h-[1rem]'; } return; }
        const needUrl = !serverUrl();
        gateEl = document.createElement('div');
        gateEl.id = 'adminGate';
        gateEl.className = 'fixed inset-0 z-[100] bg-slate-100 flex items-center justify-center p-4 overflow-auto';
        gateEl.style.fontFamily = "'Inter', sans-serif";
        gateEl.innerHTML = `
          <div class="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div class="bg-slate-900 px-6 py-5 flex items-center gap-3">
              <div class="bg-white/20 text-white w-10 h-10 rounded-xl flex items-center justify-center"><i class="fa-solid fa-lock"></i></div>
              <div><h1 class="font-bold text-white">Masuk Admin</h1><p class="text-slate-400 text-[11px] uppercase tracking-wider">Khusus pemilik studio</p></div>
            </div>
            <form id="gateForm" class="p-6 space-y-4" autocomplete="off">
              <div id="gateUrlBox" class="${needUrl ? '' : 'hidden'}">
                <label class="block text-xs font-bold text-slate-700 mb-1.5">URL Server (Web app Apps Script)</label>
                <input type="url" id="gateUrl" placeholder="https://script.google.com/macros/s/.../exec" class="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg focus:border-blue-600 outline-none text-sm" value="${serverUrl().replace(/"/g, '&quot;')}">
                <p class="text-[11px] text-slate-500 mt-1">Cukup sekali. Salin dari Deploy &gt; Web app, berakhiran <span class="font-mono">/exec</span>.</p>
              </div>
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1.5">Password Admin</label>
                <input type="password" id="gatePw" autocomplete="current-password" placeholder="Password" class="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg focus:border-blue-600 outline-none text-sm">
              </div>
              <label class="flex items-center gap-2 text-xs text-slate-600 cursor-pointer"><input type="checkbox" id="gateRemember" class="w-4 h-4 rounded border-slate-300"> Tetap masuk di perangkat ini (30 hari)</label>
              <p id="gateMsg" class="text-xs ${msg ? 'text-amber-700' : 'text-slate-500'} min-h-[1rem]">${msg || ''}</p>
              <button type="submit" id="gateBtn" class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition flex justify-center items-center gap-2"><i class="fa-solid fa-right-to-bracket"></i> Masuk</button>
              ${needUrl ? '' : '<button type="button" id="gateChangeUrl" class="w-full text-[11px] text-slate-400 hover:text-blue-600 transition">Ganti URL server</button>'}
            </form>
          </div>`;
        document.body.appendChild(gateEl);
        const msgEl = gateEl.querySelector('#gateMsg');
        const say = (t, bad) => { msgEl.textContent = t; msgEl.className = 'text-xs min-h-[1rem] ' + (bad ? 'text-red-600 font-semibold' : 'text-slate-500'); };
        const chg = gateEl.querySelector('#gateChangeUrl');
        if (chg) chg.onclick = () => { gateEl.querySelector('#gateUrlBox').classList.remove('hidden'); chg.remove(); };

        gateEl.querySelector('#gateForm').onsubmit = async (ev) => {
            ev.preventDefault();
            const btn = gateEl.querySelector('#gateBtn');
            const urlBox = gateEl.querySelector('#gateUrlBox');
            if (!urlBox.classList.contains('hidden')) {
                const u = gateEl.querySelector('#gateUrl').value.trim();
                if (!/^https:\/\/script\.google\.com\/.+/.test(u)) return say('URL server harus diawali https://script.google.com/ (salin dari Deploy > Web app).', true);
                if (!urlFromFile()) setServerUrl(u);
                else if (u !== serverUrl()) setServerUrl(u);
            }
            if (!serverUrl()) return say('Isi URL server terlebih dahulu.', true);
            const pw = gateEl.querySelector('#gatePw').value;
            if (!pw) return say('Isi password admin.', true);
            btn.disabled = true; btn.classList.add('opacity-60'); say('Memeriksa...', false);
            try {
                const res = await post({ action: 'login', password: pw, remember: gateEl.querySelector('#gateRemember').checked });
                if (!res.ok) return say(errorText(res.error, res), true);
                saveSession(res);
                runReady();
            } catch (e) {
                gateEl.querySelector('#gateUrlBox').classList.remove('hidden');
                say('Tidak dapat terhubung ke server. Periksa: URL berakhiran /exec, Deploy > Who has access = Anyone, dan sudah Deploy versi terbaru.', true);
            } finally { btn.disabled = false; btn.classList.remove('opacity-60'); }
        };
        setTimeout(() => { const f = gateEl && gateEl.querySelector(needUrl ? '#gateUrl' : '#gatePw'); if (f) f.focus(); }, 50);
    }

    // fn dipanggil setiap kali admin berhasil masuk (sesi lama atau login baru)
    function onReady(fn) {
        readyFn = fn;
        const start = () => { if (getSession()) runReady(); else showGate(''); };
        if (!getSession()) document.documentElement.classList.add('admin-gated');
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    }

    window.Admin = { onReady, call, post, serverUrl, setServerUrl, urlFromFile, errorText, logout, getSession };
})();
