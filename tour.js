/* tour.js — tur interaktif ringan (spotlight + balon penjelasan), tanpa library.
 *
 *   Tour.start({
 *     key: 'cp_tour_admin_settings_v1',      // tersimpan di localStorage -> tur hanya tampil sekali
 *     steps: [{ el: '#id' | null, title: '...', text: '...' }],
 *     labels: { next, prev, skip, done, step },   // opsional (default Indonesia)
 *     onEnd: (completed) => {}
 *   });
 *   Tour.seen(key) / Tour.reset(key)
 *
 * Langkah dengan elemen yang tidak ada / tersembunyi otomatis tampil di tengah layar.
 */
(function () {
  const DEF = { next: 'Lanjut', prev: 'Kembali', skip: 'Lewati', done: 'Selesai', step: 'Langkah {i} dari {n}' };
  let active = null;

  const seen = (k) => { try { return !!k && localStorage.getItem(k) === '1'; } catch (e) { return false; } };
  const mark = (k) => { try { if (k) localStorage.setItem(k, '1'); } catch (e) {} };
  const reset = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  function exists(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  // ada DAN terlihat di layar (elemen fixed yang disembunyikan di luar layar dianggap tidak terlihat)
  function visible(el) {
    if (!exists(el)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }

  function start(opts) {
    if (active) end(false, true);
    const steps = (opts.steps || []).filter(Boolean);
    if (!steps.length) return;
    const L = Object.assign({}, DEF, opts.labels || {});

    const root = document.createElement('div');
    root.id = 'tourRoot';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;';
    root.innerHTML =
      '<div id="tourShield" style="position:absolute;inset:0;"></div>' +
      '<div id="tourSpot" style="position:absolute;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.78);transition:all .25s ease;pointer-events:none;"></div>' +
      '<div id="tourCard" role="dialog" aria-live="polite" style="position:absolute;max-width:340px;width:calc(100vw - 24px);background:var(--surface,#fff);color:var(--text,#0f172a);border:1px solid var(--border,transparent);border-radius:18px;padding:18px 18px 14px;box-shadow:0 20px 50px rgba(0,0,0,.45);font-family:inherit;">' +
        '<p id="tourStep" style="font-size:11px;font-weight:700;color:var(--accfg,#2563eb);text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px"></p>' +
        '<h3 id="tourTitle" style="font-size:16px;font-weight:800;margin:0 0 6px;line-height:1.3"></h3>' +
        '<div id="tourText" style="font-size:13px;line-height:1.55;color:var(--text2,#475569);margin:0 0 14px"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<button id="tourSkip" type="button" style="font-size:12px;font-weight:700;color:var(--muted,#64748b);background:none;border:0;padding:8px 4px;cursor:pointer"></button>' +
          '<div style="display:flex;gap:8px">' +
            '<button id="tourPrev" type="button" style="font-size:12px;font-weight:700;color:var(--text,#334155);background:var(--surface,#fff);border:1px solid var(--border,#cbd5e1);border-radius:10px;padding:8px 12px;cursor:pointer"></button>' +
            '<button id="tourNext" type="button" style="font-size:12px;font-weight:700;color:var(--acct,#fff);background:var(--acc,#2563eb);border:0;border-radius:10px;padding:8px 16px;cursor:pointer"></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    const $ = (id) => root.querySelector('#' + id);
    const st = { i: 0, steps, opts, root, L };
    active = st;
    $('tourSkip').textContent = L.skip;
    $('tourPrev').textContent = L.prev;
    $('tourSkip').onclick = () => end(false);
    $('tourPrev').onclick = () => go(st.i - 1);
    $('tourNext').onclick = () => (st.i >= steps.length - 1 ? end(true) : go(st.i + 1));
    st.onKey = (e) => {
      if (e.key === 'Escape') end(false);
      else if (e.key === 'ArrowRight' || e.key === 'Enter') $('tourNext').click();
      else if (e.key === 'ArrowLeft') go(st.i - 1);
    };
    st.onResize = () => place();
    document.addEventListener('keydown', st.onKey);
    window.addEventListener('resize', st.onResize);
    window.addEventListener('scroll', st.onResize, true);

    function go(i) {
      if (i < 0 || i >= steps.length) return;
      st.i = i;
      const s = steps[i];
      const el = s.el ? document.querySelector(s.el) : null;
      if (el && exists(el)) { try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { el.scrollIntoView(); } }
      $('tourStep').textContent = L.step.replace('{i}', i + 1).replace('{n}', steps.length);
      $('tourTitle').textContent = s.title || '';
      $('tourText').innerHTML = s.text || '';
      $('tourPrev').style.visibility = i === 0 ? 'hidden' : 'visible';
      $('tourNext').textContent = i === steps.length - 1 ? L.done : L.next;
      place();
      setTimeout(place, 320);
      if (s.onShow) { try { s.onShow(el); } catch (e) {} }
    }

    function place() {
      if (active !== st) return;
      const s = steps[st.i];
      const el = s.el ? document.querySelector(s.el) : null;
      const spot = $('tourSpot'), card = $('tourCard');
      const vw = window.innerWidth, vh = window.innerHeight;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      if (el && visible(el)) {
        const r = el.getBoundingClientRect(), pad = 6;
        spot.style.display = 'block';
        spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
        let top = r.bottom + 14;
        if (top + ch > vh - 8) top = r.top - ch - 14;
        if (top < 8) top = Math.max(8, Math.min(vh - ch - 8, (vh - ch) / 2));
        let left = r.left + r.width / 2 - cw / 2;
        left = Math.max(12, Math.min(vw - cw - 12, left));
        card.style.top = top + 'px'; card.style.left = left + 'px';
      } else {
        spot.style.display = 'block';
        spot.style.left = (vw / 2) + 'px'; spot.style.top = (vh / 2) + 'px'; spot.style.width = '0px'; spot.style.height = '0px';
        card.style.top = Math.max(8, (vh - ch) / 2) + 'px'; card.style.left = Math.max(12, (vw - cw) / 2) + 'px';
      }
    }

    go(0);
  }

  function end(completed, silent) {
    const st = active;
    if (!st) return;
    active = null;
    document.removeEventListener('keydown', st.onKey);
    window.removeEventListener('resize', st.onResize);
    window.removeEventListener('scroll', st.onResize, true);
    if (st.root.parentNode) st.root.parentNode.removeChild(st.root);
    mark(st.opts.key);   // selesai ATAU dilewati = tidak muncul lagi otomatis
    if (!silent && st.opts.onEnd) { try { st.opts.onEnd(completed); } catch (e) {} }
  }

  window.Tour = { start, end: (c) => end(!!c), seen, reset, isActive: () => !!active };
})();
