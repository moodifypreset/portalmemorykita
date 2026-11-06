/* theme.js — memilih & menerapkan tema tampilan (bersih | gelap | elegan | mono).
 * Tema dipilih admin di Pengaturan Studio, tersimpan di server, lalu disalin ke localStorage
 * agar halaman berikutnya langsung tampil dengan tema yang benar (tanpa berkedip). */
(function () {
  var KEY = 'cp_theme', LIST = ['bersih', 'gelap', 'elegan', 'mono'], DEFAULT = 'bersih';
  var meta = document.querySelector('meta[name="cp-page"]');
  var page = (meta && meta.content) || 'admin';
  var root = document.documentElement;
  root.setAttribute('data-page', page);

  function valid(n) { return LIST.indexOf(n) !== -1 ? n : DEFAULT; }
  function get() { try { return valid(localStorage.getItem(KEY)); } catch (e) { return DEFAULT; } }

  function apply(name, persist) {
    name = valid(name);
    root.setAttribute('data-theme', name);
    if (persist) { try { localStorage.setItem(KEY, name); } catch (e) {} }
    var colors = { bersih: '#2563eb', gelap: '#0b0d12', elegan: '#f7f3ee', mono: '#0a0a0a' };
    var tc = document.querySelector('meta[name="theme-color"]');
    if (!tc) { tc = document.createElement('meta'); tc.name = 'theme-color'; (document.head || root).appendChild(tc); }
    tc.content = colors[name];
    if (page === 'client') {
      // gelap/elegan/mono menentukan terang-gelapnya sendiri; bersih mengikuti pilihan klien (tombol bulan/matahari)
      var dark;
      if (name === 'gelap') dark = true;
      else if (name === 'elegan' || name === 'mono') dark = false;
      else { try { dark = localStorage.getItem('theme') === 'dark'; } catch (e) { dark = false; } }
      root.classList.toggle('dark', dark);
      if (typeof window.updateDarkModeIcon === 'function') { try { window.updateDarkModeIcon(dark); } catch (e) {} }
    }
    return name;
  }

  apply(get(), false);
  window.Theme = { apply: apply, get: get, list: LIST, DEFAULT: DEFAULT };
})();
