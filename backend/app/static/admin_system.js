/* SINAPSIS: Kelola Sistem / Parameter Sistem AI (REQ-14) dan Pengguna (REQ-15).
   HTML/CSS/JS murni. Rute: /admin/parameters, /admin/users (daftar), /admin/users/add (form).
   Akses khusus Administrator; pembatasan sebenarnya ada di API (/api/admin/*). */
(function () {
  'use strict';

  var API_PARAM = '/api/admin/parameters';
  var API_HIST = '/api/admin/parameters/history';
  var API_USERS = '/api/admin/users';
  var PATH = window.location.pathname.replace(/\/+$/, '');
  var MODE = PATH === '/admin/parameters' ? 'param' : (PATH === '/admin/users/add' ? 'useradd' : 'users');
  var MSG_USER_OK = 'Akun pengguna berhasil dibuat!';
  var PASS_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  var MSG_PASS = 'Password minimal 8 karakter, mengandung huruf kapital dan angka.';
  var USER_RULE = /^[A-Za-z0-9_.]{3,50}$/;
  var MSG_USER = 'Username 3-50 karakter alfanumerik (boleh _ dan .).';

  var NOTES = {
    spike_threshold: 'Ambang yang lebih rendah membuat sistem lebih sensitif terhadap lonjakan antrean (lebih mudah memicu spike). Ambang yang lebih tinggi lebih toleran. Dipakai mulai siklus berikutnya.',
    min_green_time: 'Setiap fase hijau berlangsung minimal selama nilai ini. Harus lebih kecil dari durasi hijau maksimum.',
    max_green_time: 'Batas atas durasi hijau satu fase, termasuk saat diperpanjang untuk lajur yang padat. Harus lebih besar dari durasi minimum.',
    amber_duration: 'Lama lampu kuning sebelum merah, yaitu waktu pengosongan persimpangan.'
  };
  var ROLES = {
    'Administrator': 'Mengelola persimpangan, parameter AI, dan akun pengguna, serta memantau dashboard real-time. Tidak mengajukan permintaan rute darurat.',
    'Petugas Lalu Lintas': 'Memantau dashboard real-time dan mengajukan permintaan rute darurat (Koridor Hijau). Tidak dapat mengubah konfigurasi sistem.'
  };

  var state = { params: [], current: null, changed: null, changedTimer: null };

  /* ---------- util ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function dec(n) { return String(n).replace('.', ','); }
  function store(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function drop(key) { try { window.localStorage.removeItem(key); } catch (e) { /* diabaikan */ } }
  function fmtTime(iso) {
    if (!iso) return '--';
    var d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
    return isNaN(d) ? iso : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function toLogin() { drop('access_token'); drop('user_info'); window.location.replace('/login'); }
  function request(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers);
    var tk = store('access_token');
    if (tk) headers.Authorization = 'Bearer ' + tk;
    return fetch(url, Object.assign({}, opts, { headers: headers })).then(function (res) {
      if (res.status === 401) { toLogin(); throw new Error('Sesi berakhir. Silakan login ulang.'); }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var d = body.detail;
          var err = new Error(typeof d === 'string' ? d : 'Permintaan gagal (HTTP ' + res.status + ').');
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }
  function setOnline(ok, text) { var s = $('sysState'); s.textContent = text; s.className = 'sysstate ' + (ok ? 'ok' : 'bad'); }
  function showError(msg) { var b = $('bannerError'); b.hidden = !msg; b.textContent = msg || ''; }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    window.clearTimeout(toast.t);
    toast.t = window.setTimeout(function () { t.hidden = true; }, 7000);
  }
  function fieldError(inputId, errId, msg) {
    var i = $(inputId), e = $(errId);
    if (msg) { i.setAttribute('aria-invalid', 'true'); e.textContent = msg; e.hidden = false; }
    else { i.removeAttribute('aria-invalid'); e.textContent = ''; e.hidden = true; }
  }

  /* ---------- Parameter Sistem ---------- */
  function paramBy(key) { return state.params.filter(function (p) { return p.jenis_parameter === key; })[0]; }
  function fmtVal(p, v) { return p.tipe === 'int' ? String(Math.round(v)) : dec(v); }
  function rangeText(p) { return fmtVal(p, p.rentang[0]) + ' - ' + fmtVal(p, p.rentang[1]); }

  function renderParamSelect() {
    var sel = $('fJenis'), keep = sel.value;
    clear(sel);
    state.params.forEach(function (p) { var o = el('option', null, p.label); o.value = p.jenis_parameter; sel.appendChild(o); });
    if (keep && paramBy(keep)) sel.value = keep;
  }

  function renderParamForm(resetValue) {
    var p = paramBy($('fJenis').value);
    if (!p) return;
    state.current = p;
    $('unitLabel').textContent = '(' + p.satuan + ')';
    $('paramMeta').textContent = 'Nilai aktif: ' + fmtVal(p, p.nilai_aktif) + ' ' + p.satuan + ' · Baseline rekomendasi: ' +
      fmtVal(p, p.baseline) + ' · Rentang: ' + rangeText(p);
    $('paramNote').textContent = NOTES[p.jenis_parameter] || p.keterangan;
    if (resetValue) { $('fNilai').value = fmtVal(p, p.nilai_aktif); fieldError('fNilai', 'eNilai', ''); }
  }

  function renderParamTable() {
    var tb = $('paramBody'); clear(tb);
    state.params.forEach(function (p) {
      var tr = el('tr', state.changed === p.jenis_parameter ? 'changed' : null);
      var c0 = el('td'); c0.appendChild(el('strong', null, p.label)); c0.appendChild(el('div', 'muted', p.keterangan)); tr.appendChild(c0);
      tr.appendChild(el('td', 'num', fmtVal(p, p.nilai_aktif)));
      tr.appendChild(el('td', null, p.satuan));
      tr.appendChild(el('td', 'num', fmtVal(p, p.baseline)));
      tr.appendChild(el('td', null, rangeText(p)));
      var cs = el('td'), diff = Math.abs(p.nilai_aktif - p.baseline) > 1e-9;
      cs.appendChild(el('span', 'chip' + (diff ? '' : ' off'), diff ? 'Diubah' : 'Baseline'));
      tr.appendChild(cs);
      var ca = el('td'), b = el('button', 'btn-outline sm', 'Ubah');
      b.type = 'button'; b.setAttribute('aria-label', 'Ubah ' + p.label);
      b.addEventListener('click', function () {
        $('fJenis').value = p.jenis_parameter; renderParamForm(true);
        $('fNilai').focus(); $('fNilai').select();
        $('formParam').scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      ca.appendChild(b); tr.appendChild(ca);
      tb.appendChild(tr);
    });
  }

  function renderHistory(rows) {
    var tb = $('histBody'); clear(tb);
    $('histCount').textContent = rows.length ? rows.length + ' perubahan terakhir' : '';
    if (!rows.length) {
      var tr = el('tr'), td = el('td', 'empty-cell', 'Belum ada perubahan. Nilai yang dipakai adalah baseline.');
      td.colSpan = 3; tr.appendChild(td); tb.appendChild(tr); return;
    }
    rows.slice(0, 10).forEach(function (r) {
      var p = paramBy(r.jenis_parameter), tr = el('tr');
      var c0 = el('td');
      c0.appendChild(el('strong', null, p ? p.label : r.jenis_parameter));
      c0.appendChild(el('div', 'muted', r.id_transaksi + ' · ' + (r.diubah_oleh_nama || ('ID ' + r.diubah_oleh))));
      tr.appendChild(c0);
      tr.appendChild(el('td', 'num', dec(r.nilai)));
      tr.appendChild(el('td', 'nowrap', fmtTime(r.waktu)));
      tb.appendChild(tr);
    });
  }

  function loadParams(resetValue) {
    return Promise.all([request(API_PARAM), request(API_HIST)]).then(function (res) {
      state.params = res[0];
      renderParamSelect(); renderParamForm(resetValue); renderParamTable(); renderHistory(res[1]);
      setOnline(true, 'Terhubung'); showError('');
    });
  }

  function parseNumber(raw) {
    var s = String(raw).trim().replace(',', '.');
    if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }

  function onParamSubmit(ev) {
    ev.preventDefault();
    var p = state.current; if (!p) return;
    var raw = $('fNilai').value.trim(), msg = '';
    var v = parseNumber(raw);
    if (raw === '') msg = 'Nilai parameter wajib diisi.';
    else if (isNaN(v)) msg = 'Nilai harus berupa angka.';
    else if (p.tipe === 'int' && !Number.isInteger(v)) msg = 'Nilai harus bilangan bulat.';
    else if (v < p.rentang[0] || v > p.rentang[1]) msg = 'Nilai harus antara ' + rangeText(p).replace(' - ', ' dan ') + '.';
    fieldError('fNilai', 'eNilai', msg);
    if (msg) { $('fNilai').focus(); return; }
    var btn = $('btnParam'); btn.disabled = true;
    request(API_PARAM, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jenis_parameter: p.jenis_parameter, nilai: v }) })
      .then(function (r) {
        state.changed = r.jenis_parameter;
        window.clearTimeout(state.changedTimer);
        state.changedTimer = window.setTimeout(function () { state.changed = null; renderParamTable(); }, 8000);
        $('paramOkMsg').textContent = r.pesan;
        $('paramOkTrx').textContent = r.id_transaksi || '--';
        $('paramOkTime').textContent = fmtTime(r.waktu);
        $('paramOkNote').textContent = r.catatan || '';
        $('paramOk').hidden = false;
        $('paramOk').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return loadParams(true);
      })
      .catch(function (e) {
        if (e.status === 422) fieldError('fNilai', 'eNilai', e.message); else showError(e.message);
      })
      .then(function () { btn.disabled = false; });
  }

  function initParam() {
    $('crumbLeaf').textContent = 'Parameter Sistem';
    $('tabParam').classList.add('active'); $('tabParam').setAttribute('aria-current', 'page');
    $('modParam').classList.add('on');
    $('sumUsersRow').hidden = true;
    $('paramSection').hidden = false;
    $('fJenis').addEventListener('change', function () { renderParamForm(true); $('paramOk').hidden = true; });
    $('formParam').addEventListener('submit', onParamSubmit);
    $('btnReset').addEventListener('click', function () { renderParamForm(true); $('paramOk').hidden = true; $('fNilai').focus(); });
    return loadParams(true);
  }

  /* ---------- Pengguna ---------- */
  function loadUsers() {
    return request(API_USERS).then(function (rows) {
      $('sumUsers').textContent = String(rows.length);
      return rows;
    });
  }

  function initUsers() {
    $('crumbLeaf').textContent = 'Pengguna Terdaftar';
    $('modUser').classList.add('on');
    $('usersSection').hidden = false;
    var q = new URLSearchParams(window.location.search);
    if (q.get('dibuat')) { toast(MSG_USER_OK + ' (' + q.get('dibuat') + ')'); window.history.replaceState(null, '', '/admin/users'); }
    return loadUsers().then(function (rows) {
      var tb = $('usersBody'); clear(tb);
      $('usersCount').textContent = rows.length + ' akun';
      rows.forEach(function (u) {
        var tr = el('tr');
        tr.appendChild(el('td', null, u.nama));
        tr.appendChild(el('td', null, u.username));
        var c = el('td'); c.appendChild(el('span', 'chip' + (u.role === 'Administrator' ? '' : ' off'), u.role)); tr.appendChild(c);
        tb.appendChild(tr);
      });
      setOnline(true, 'Terhubung'); showError('');
    });
  }

  function suggestUsername(nama) {
    var base = nama.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
    return base.length >= 3 ? base + '_dishub' : '';
  }
  function renderRoleInfo() {
    var role = $('uRole').value, box = $('roleInfo'); clear(box);
    box.appendChild(el('strong', null, 'Hak Akses: ' + role));
    box.appendChild(el('p', null, ROLES[role] || ''));
  }

  function resetUserForm() {
    $('formUser').reset();
    ['uNama:eUNama', 'uUser:eUUser', 'uPass:ePass'].forEach(function (p) { var a = p.split(':'); fieldError(a[0], a[1], ''); });
    $('uSuggest').hidden = true; showError(''); renderRoleInfo();
  }

  function onUserSubmit(ev) {
    ev.preventDefault();
    var nama = $('uNama').value.trim(), user = $('uUser').value.trim(), pass = $('uPass').value, role = $('uRole').value;
    var eN = nama ? '' : 'Nama lengkap wajib diisi.';
    var eU = !user ? 'Username wajib diisi.' : (USER_RULE.test(user) ? '' : MSG_USER);
    var eP = !pass ? 'Kata sandi wajib diisi.' : (PASS_RULE.test(pass) ? '' : MSG_PASS);
    fieldError('uNama', 'eUNama', eN); fieldError('uUser', 'eUUser', eU); fieldError('uPass', 'ePass', eP);
    var first = eN ? 'uNama' : (eU ? 'uUser' : (eP ? 'uPass' : ''));
    if (first) { $(first).focus(); return; }
    var btn = $('btnUser'); btn.disabled = true;
    request(API_USERS, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama: nama, username: user, password: pass, role: role }) })
      .then(function () { window.location.assign('/admin/users?dibuat=' + encodeURIComponent(user)); })
      .catch(function (e) {
        btn.disabled = false;
        if (e.status === 409) { fieldError('uUser', 'eUUser', e.message); $('uUser').focus(); }
        else if (e.status === 422 && /password/i.test(e.message)) { fieldError('uPass', 'ePass', e.message); $('uPass').focus(); }
        else if (e.status === 422 && /username/i.test(e.message)) { fieldError('uUser', 'eUUser', e.message); $('uUser').focus(); }
        else showError(e.message);
      });
  }

  function initUserAdd() {
    $('crumbLeaf').textContent = 'Tambah Pengguna';
    $('tabUser').classList.add('active'); $('tabUser').setAttribute('aria-current', 'page');
    $('modUser').classList.add('on');
    $('userAddSection').hidden = false;
    renderRoleInfo();
    $('uRole').addEventListener('change', renderRoleInfo);
    $('formUser').addEventListener('submit', onUserSubmit);
    $('btnUserReset').addEventListener('click', resetUserForm);
    var touched = false;
    $('uUser').addEventListener('input', function () { touched = true; $('uSuggest').hidden = true; });
    $('uNama').addEventListener('input', function () {
      var s = suggestUsername($('uNama').value), box = $('uSuggest');
      if (touched || !s) { box.hidden = true; return; }
      clear(box); box.appendChild(document.createTextNode('Saran username: '));
      var b = el('button', 'link-btn', s); b.type = 'button';
      b.addEventListener('click', function () { $('uUser').value = s; touched = true; box.hidden = true; $('uUser').focus(); });
      box.appendChild(b); box.hidden = false;
    });
    $('btnShowPass').addEventListener('click', function () {
      var i = $('uPass'), show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      this.textContent = show ? 'Sembunyikan' : 'Tampilkan'; this.setAttribute('aria-pressed', String(show));
    });
    return loadUsers().then(function () { setOnline(true, 'Terhubung'); });
  }

  /* ---------- awal ---------- */
  function init() {
    var info = null;
    try { info = JSON.parse(store('user_info') || 'null'); } catch (e) { info = null; }
    if (!store('access_token')) { toLogin(); return; }
    $('userName').textContent = info && (info.nama || info.username) ? (info.nama || info.username) : '--';
    if (info && info.role && info.role !== 'Administrator') {
      $('content').hidden = true; $('denied').hidden = false;
      $('deniedMsg').textContent = 'Halaman ini hanya untuk Administrator. Anda masuk sebagai ' + info.role + '.';
      setOnline(false, 'Akses dibatasi'); return;
    }
    var run = MODE === 'param' ? initParam() : (MODE === 'useradd' ? initUserAdd() : initUsers());
    run.catch(function (e) {
      if (e.status === 403) { $('content').hidden = true; $('denied').hidden = false; setOnline(false, 'Akses dibatasi'); return; }
      setOnline(false, 'Terputus'); showError(e.message || 'Gagal memuat data.');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
