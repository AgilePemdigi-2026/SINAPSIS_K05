/* SINAPSIS: Kelola Sistem / Registrasi Persimpangan (F5, GIS & Mapping).
   HTML/CSS/JS murni. Peta digambar sebagai kanvas vektor SVG (tanpa tile dan tanpa pustaka luar), sesuai SRS
   "Map Canvas Vector". Rute halaman: /admin/intersections (daftar + peta) dan /admin/intersections/add (form). */
(function () {
  'use strict';

  var API_LIST = '/api/admin/intersections';
  var API_DASH = '/api/monitoring/dashboard';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MODE = /\/add\/?$/.test(window.location.pathname) ? 'add' : 'list';
  var MSG_OK = 'Persimpangan baru berhasil ditambahkan!';
  var MSG_NAMA = 'Nama lokasi persimpangan wajib diisi!';   // REQ-13
  var DESK_MAX = 250;                                        // SRS 3.1.2
  var POLL_MS = 5000;
  var LANES = ['Utara', 'Selatan', 'Timur', 'Barat'];
  // Kotak awal peta saat belum ada titik terdaftar (wilayah Surabaya)
  var DEFAULT_BOX = { latMin: -7.36, latMax: -7.20, lonMin: 112.66, lonMax: 112.84 };
  var ID_BOX = { latMin: -11.5, latMax: 6.5, lonMin: 94.5, lonMax: 141.5 };  // perkiraan wilayah Indonesia
  var MIN_SPAN = 0.05;                                       // derajat; mencegah peta terlalu zoom

  var state = { items: [], live: {}, liveAt: null, selected: null, draft: null, freshId: null, timer: null };

  /* ---------- util DOM ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function dec(n) { return String(n).replace('.', ','); }
  function fmtCoord(n) { return dec(Number(n).toFixed(5)); }
  function store(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function drop(key) { try { window.localStorage.removeItem(key); } catch (e) { /* diabaikan */ } }

  /* ---------- jaringan ---------- */
  function toLogin() {
    drop('access_token'); drop('user_info');          // token basi dibuang agar tidak berputar
    window.location.replace('/login');
  }

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

  function setOnline(ok, text) {
    var s = $('sysState');
    s.textContent = text;
    s.className = 'sysstate ' + (ok ? 'ok' : 'bad');
  }
  function showError(msg) { var b = $('bannerError'); b.hidden = !msg; b.textContent = msg || ''; }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    window.clearTimeout(toast.t);
    toast.t = window.setTimeout(function () { t.hidden = true; }, 6000);
  }

  /* ---------- status (mengikuti kelas dashboard.css) ---------- */
  function liveOf(id) { return state.live[id] || null; }
  function statusText(id) { var l = liveOf(id); return l ? l.status : 'Belum ada data'; }
  function statusClass(s) {
    if (s === 'Lancar') return 'st-lancar';
    if (s === 'Padat') return 'st-padat';
    if (s === 'Kritis') return 'st-kritis';
    if (s === 'Sensor Offline') return 'st-offline';
    return 'st-belum';
  }
  function qClass(s) {
    if (s === 'Lancar') return 'q-lancar';
    if (s === 'Padat') return 'q-padat';
    if (s === 'Kritis') return 'q-kritis';
    return 'q-off';
  }
  function hasGeo(it) { return typeof it.latitude === 'number' && typeof it.longitude === 'number'; }

  /* ---------- proyeksi peta ---------- */
  function boundsOf(points) {
    var b;
    if (!points.length) {
      b = { latMin: DEFAULT_BOX.latMin, latMax: DEFAULT_BOX.latMax, lonMin: DEFAULT_BOX.lonMin, lonMax: DEFAULT_BOX.lonMax };
    } else {
      b = { latMin: 90, latMax: -90, lonMin: 180, lonMax: -180 };
      points.forEach(function (p) {
        b.latMin = Math.min(b.latMin, p.lat); b.latMax = Math.max(b.latMax, p.lat);
        b.lonMin = Math.min(b.lonMin, p.lon); b.lonMax = Math.max(b.lonMax, p.lon);
      });
      var padLat = Math.max((b.latMax - b.latMin) * 0.25, 0.004), padLon = Math.max((b.lonMax - b.lonMin) * 0.25, 0.004);
      b.latMin -= padLat; b.latMax += padLat; b.lonMin -= padLon; b.lonMax += padLon;
    }
    var cLat = (b.latMin + b.latMax) / 2, cLon = (b.lonMin + b.lonMax) / 2;
    if (b.latMax - b.latMin < MIN_SPAN) { b.latMin = cLat - MIN_SPAN / 2; b.latMax = cLat + MIN_SPAN / 2; }
    if (b.lonMax - b.lonMin < MIN_SPAN) { b.lonMin = cLon - MIN_SPAN / 2; b.lonMax = cLon + MIN_SPAN / 2; }
    return b;
  }

  function projection(points, W, H) {
    var b = boundsOf(points), pad = 28;
    var latMid = (b.latMin + b.latMax) / 2;
    var kx = 111.32 * Math.cos(latMid * Math.PI / 180), ky = 110.57;          // km per derajat
    var spanX = (b.lonMax - b.lonMin) * kx, spanY = (b.latMax - b.latMin) * ky;
    var scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);        // px per km
    var offX = (W - spanX * scale) / 2, offY = (H - spanY * scale) / 2;
    var p = { W: W, H: H, scale: scale };
    p.x = function (lon) { return offX + (lon - b.lonMin) * kx * scale; };
    p.y = function (lat) { return offY + (b.latMax - lat) * ky * scale; };
    p.lon = function (x) { return b.lonMin + (x - offX) / (kx * scale); };
    p.lat = function (y) { return b.latMax - (y - offY) / (ky * scale); };
    p.visible = { latMin: p.lat(H), latMax: p.lat(0), lonMin: p.lon(0), lonMax: p.lon(W) };
    return p;
  }

  // Proyeksi stabil: dihitung dari titik terdaftar saja; titik draft hanya memperluas bila di luar area terlihat,
  // sehingga klik pada peta tidak menggeser peta.
  function buildProjection(W, H) {
    var pts = state.items.filter(hasGeo).map(function (i) { return { lat: i.latitude, lon: i.longitude }; });
    var proj = projection(pts, W, H);
    var d = state.draft;
    if (d) {
      // pin menjulang ~44 px di atas titiknya dan labelnya ke samping: beri ruang agar tidak terpotong tepi peta
      var px = proj.x(d.lon), py = proj.y(d.lat), mx = 48, top = 62, bottom = 24;
      var inside = px > mx && px < W - mx && py > top && py < H - bottom;
      if (!inside) proj = projection(pts.concat([d]), W, H);
    }
    return proj;
  }

  function niceStep(range, maxLines) {
    var steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) { if (range / steps[i] <= maxLines) return steps[i]; }
    return 10;
  }
  function stepDecimals(step) { return step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3)); }

  // Faktor pembesaran teks/pin agar tetap terbaca ketika SVG diperkecil (layar ponsel). Minimal 1, maksimal 1,7.
  function textScale(node, W) {
    var w = node.getBoundingClientRect().width;
    return w > 0 ? Math.min(1.7, Math.max(1, W / w * 0.85)) : 1;
  }

  function drawGrid(root, proj, k) {
    var v = proj.visible, W = proj.W, H = proj.H;
    root.appendChild(svg('rect', { 'class': 'land', x: 0, y: 0, width: W, height: H }));
    var stLat = niceStep(v.latMax - v.latMin, 6), stLon = niceStep(v.lonMax - v.lonMin, 6);
    var t, y, x;
    for (t = Math.ceil(v.latMin / stLat) * stLat; t <= v.latMax; t += stLat) {
      y = proj.y(t);
      root.appendChild(svg('line', { 'class': 'grat', x1: 0, x2: W, y1: y, y2: y }));
      root.appendChild(svg('text', { 'class': 'glabel', x: 5, y: y - 3, style: 'font-size:' + (10 * k) + 'px' },
        dec(t.toFixed(stepDecimals(stLat))) + '°'));
    }
    for (t = Math.ceil(v.lonMin / stLon) * stLon; t <= v.lonMax; t += stLon) {
      x = proj.x(t);
      root.appendChild(svg('line', { 'class': 'grat', x1: x, x2: x, y1: 0, y2: H }));
      if (x < W - 44 * k) {      // label yang akan terpotong di tepi kanan dilewati
        root.appendChild(svg('text', { 'class': 'glabel', x: x + 3, y: H - 6, style: 'font-size:' + (10 * k) + 'px' },
          dec(t.toFixed(stepDecimals(stLon))) + '°'));
      }
    }
    // penunjuk utara dan skala
    root.appendChild(svg('path', { d: 'M' + (W - 24) + ',14 l6,16 l-6,-4 l-6,4 z', fill: '#0f0945' }));
    root.appendChild(svg('text', { 'class': 'compass', x: W - 24, y: 44, style: 'font-size:' + (11 * k) + 'px' }, 'U'));
    var kms = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20], km = kms[0], i;
    for (i = 0; i < kms.length; i++) { km = kms[i]; if (km * proj.scale >= 60) break; }
    var len = km * proj.scale, x0 = W - 20 - len, yb = H - 22;
    root.appendChild(svg('line', { 'class': 'scale-line', x1: x0, x2: x0 + len, y1: yb, y2: yb }));
    root.appendChild(svg('line', { 'class': 'scale-line', x1: x0, x2: x0, y1: yb - 4, y2: yb + 4 }));
    root.appendChild(svg('line', { 'class': 'scale-line', x1: x0 + len, x2: x0 + len, y1: yb - 4, y2: yb + 4 }));
    root.appendChild(svg('text', { 'class': 'scale-text', x: x0 + len / 2, y: yb - 7, style: 'font-size:' + (10 * k) + 'px' }, dec(km) + ' km'));
  }

  var PIN_PATH = 'M0,0 C-2,-6 -10,-12 -10,-20 a10,10 0 1 1 20,0 C10,-12 2,-6 0,0 Z';

  function drawPin(root, proj, cfg) {
    var x = proj.x(cfg.lon), y = proj.y(cfg.lat);
    var g = svg('g', { 'class': 'pin ' + cfg.cls + (cfg.selected ? ' selected' : ''),
      transform: 'translate(' + x + ',' + y + ') scale(' + cfg.k + ')' });
    if (cfg.pulse) g.appendChild(svg('circle', { 'class': 'pin-pulse', cx: 0, cy: -20, r: 16 }));
    g.appendChild(svg('path', { 'class': 'pin-body', d: PIN_PATH }));
    g.appendChild(svg('circle', { 'class': 'pin-dot', cx: 0, cy: -20, r: 3.5 }));
    if (cfg.label) {
      var left = cfg.labelLeft || x > proj.W - 170 * cfg.k;
      g.appendChild(svg('text', { 'class': 'plabel', x: left ? -15 : 15, y: -16, 'text-anchor': left ? 'end' : 'start' }, cfg.label));
    }
    if (cfg.onSelect) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', cfg.aria);
      g.addEventListener('click', function (e) { e.stopPropagation(); cfg.onSelect(); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cfg.onSelect(); }
      });
    }
    if (cfg.title) g.appendChild(svg('title', {}, cfg.title));
    root.appendChild(g);
  }

  function drawMap(node, opts) {
    var vb = node.viewBox.baseVal, W = vb.width, H = vb.height;
    var proj = buildProjection(W, H);
    node._proj = proj;
    var k = textScale(node, W);
    node.style.setProperty('--ts', String(k));
    clear(node);
    drawGrid(node, proj, k);
    var pts = state.items.filter(hasGeo).slice().sort(function (a, b) { return b.latitude - a.latitude; });
    // Label ditaruh di kiri pin bila di sebelah kanannya ada pin lain yang akan tertimpa teks.
    function crowdedRight(it) {
      var x = proj.x(it.longitude), y = proj.y(it.latitude), w = (it.nama_lokasi.length * 6.4 + 22) * k;
      return pts.some(function (o) {
        if (o === it) return false;
        var dx = proj.x(o.longitude) - x, dy = proj.y(o.latitude) - y;
        return dx > 0 && dx < w && Math.abs(dy) < 24 * k;
      });
    }
    pts.forEach(function (it) {
      var st = statusText(it.id_persimpangan);
      drawPin(node, proj, {
        k: k, labelLeft: crowdedRight(it),
        lat: it.latitude, lon: it.longitude, cls: qClass(st), label: it.nama_lokasi,
        selected: opts.selectable && state.selected === it.id_persimpangan, pulse: st === 'Kritis',
        title: it.nama_lokasi + ': ' + st,
        onSelect: opts.selectable ? function () { select(it.id_persimpangan); } : null,
        aria: it.nama_lokasi + ', status ' + st
      });
    });
    if (opts.draft && state.draft) {
      drawPin(node, proj, { k: k, lat: state.draft.lat, lon: state.draft.lon, cls: 'draft', label: 'Titik baru' });
    }
  }

  function redrawMaps() {
    if (MODE === 'add') drawMap($('mapMini'), { selectable: false, draft: true });
    else drawMap($('mapNet'), { selectable: true, draft: false });
  }

  /* ---------- daftar, ringkasan, detail ---------- */
  function renderSummary() {
    var off = state.items.filter(function (i) { return statusText(i.id_persimpangan) === 'Sensor Offline'; }).length;
    $('sumTotal').textContent = String(state.items.length);
    $('sumGeo').textContent = state.items.filter(hasGeo).length + ' dari ' + state.items.length;
    $('sumOff').textContent = state.liveAt ? String(off) : '--';
  }

  function coordText(it) { return hasGeo(it) ? fmtCoord(it.latitude) + ', ' + fmtCoord(it.longitude) : null; }

  function renderTable() {
    var body = $('tblBody');
    clear(body);
    $('tblCount').textContent = state.items.length + ' persimpangan';
    if (!state.items.length) {
      var r0 = el('tr'); var c0 = el('td', 'empty-cell', 'Belum ada persimpangan terdaftar.'); c0.colSpan = 6;
      r0.appendChild(c0); body.appendChild(r0); return;
    }
    state.items.forEach(function (it) {
      var id = it.id_persimpangan, st = statusText(id), l = liveOf(id);
      var tr = el('tr', (state.freshId === id ? 'fresh ' : '') + (MODE === 'list' && state.selected === id ? 'sel' : ''));
      tr.appendChild(el('td', 'name', it.nama_lokasi));
      var cc = coordText(it);
      tr.appendChild(el('td', cc ? 'coord' : 'muted', cc || 'Belum diisi'));
      var tdS = el('td'); tdS.appendChild(el('span', 'st ' + statusClass(st), st)); tr.appendChild(tdS);
      tr.appendChild(el('td', 'num', l && st !== 'Sensor Offline' && st !== 'Belum ada data' ? String(l.jumlah_kendaraan) : '--'));
      var tdD = el('td'); tdD.appendChild(el('span', 'chip' + (it.detektor_virtual ? '' : ' off'), it.detektor_virtual ? 'Aktif' : 'Nonaktif')); tr.appendChild(tdD);
      tr.appendChild(el('td', 'num', String((it.jalur || []).length)));
      if (MODE === 'list') { tr.style.cursor = 'pointer'; tr.addEventListener('click', function () { select(id); }); }
      body.appendChild(tr);
    });
  }

  function renderDetail() {
    var box = $('detailCard');
    if (!box) return;
    clear(box);
    var it = state.items.filter(function (i) { return i.id_persimpangan === state.selected; })[0];
    if (!it) { box.appendChild(el('p', 'muted', 'Pilih titik pada peta atau baris pada tabel untuk melihat detail.')); return; }
    var st = statusText(it.id_persimpangan), l = liveOf(it.id_persimpangan);
    box.appendChild(el('h3', null, it.nama_lokasi));
    box.appendChild(el('span', 'st ' + statusClass(st), st));
    var dl = el('dl');
    function row(k, v) { var d = el('div'); d.appendChild(el('dt', null, k)); d.appendChild(el('dd', null, v)); dl.appendChild(d); }
    row('Koordinat', coordText(it) || 'Belum diisi');
    row('Kendaraan', l && st !== 'Sensor Offline' && st !== 'Belum ada data' ? String(l.jumlah_kendaraan) : '--');
    row('Jalur', (it.jalur || []).map(function (j) { return j.arah; }).join(', '));
    row('Detektor virtual', it.detektor_virtual ? 'Aktif' : 'Nonaktif');
    box.appendChild(dl);
    if (it.deskripsi) box.appendChild(el('p', 'note', it.deskripsi));
  }

  function renderAll() {
    renderSummary();
    renderTable();
    if (MODE === 'list') renderDetail();
    redrawMaps();
    var note = $('dataNote');
    note.textContent = state.liveAt
      ? 'Status dan jumlah kendaraan berasal dari data simulasi. Diperbarui ' + state.liveAt + ' WIB.'
      : 'Status belum tersedia (data pemantauan belum dimuat).';
  }

  function select(id) {
    state.selected = id;
    renderTable(); renderDetail(); redrawMaps();
  }

  /* ---------- pemuatan data ---------- */
  function wibClock(iso) {
    var d = iso ? new Date(iso + 'Z') : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }).replace(/\./g, ':');
  }

  function loadLive() {
    return request(API_DASH).then(function (data) {
      var live = {};
      (data.simpang || []).forEach(function (s) { live[s.id_persimpangan] = s; });
      state.live = live;
      state.liveAt = wibClock(data.diperbarui);
    }).catch(function () { /* status opsional: tabel dan peta tetap tampil tanpa status */ });
  }

  function loadAll() {
    return request(API_LIST).then(function (items) {
      state.items = items;
      setOnline(true, 'Terhubung');
      showError('');
      return loadLive();
    }).then(renderAll).catch(function (e) {
      if (e.status === 403) { showDenied(e.message); return; }
      setOnline(false, 'Gagal memuat');
      showError(e.message || 'Gagal memuat data persimpangan.');
      renderAll();
    });
  }

  function showDenied(msg) {
    $('content').hidden = true;
    $('denied').hidden = false;
    if (msg) $('deniedMsg').textContent = msg;
    setOnline(false, 'Akses ditolak');
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    state.timer = window.setInterval(function () {
      if (document.hidden) return;
      loadLive().then(renderAll);
    }, POLL_MS);
  }
  function stopPolling() { if (state.timer) { window.clearInterval(state.timer); state.timer = null; } }

  /* ---------- form tambah ---------- */
  function parseCoord(raw) {
    var s = String(raw || '').trim().replace(',', '.');
    if (s === '') return null;
    return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function setErr(inputId, errId, msg) {
    var i = $(inputId), e = $(errId);
    e.hidden = !msg; e.textContent = msg || '';
    if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid');
  }

  function validate() {
    var errs = [];
    var nama = $('fNama').value.trim();
    var latRaw = parseCoord($('fLat').value), lonRaw = parseCoord($('fLon').value);
    var m = { nama: '', lat: '', lon: '', desk: '' };
    if (!nama) m.nama = MSG_NAMA;
    if (Number.isNaN(latRaw)) m.lat = 'Latitude harus berupa angka (contoh: -7,2655).';
    else if (latRaw !== null && (latRaw < -90 || latRaw > 90)) m.lat = 'Latitude harus berada di antara -90 dan 90.';
    if (Number.isNaN(lonRaw)) m.lon = 'Longitude harus berupa angka (contoh: 112,7520).';
    else if (lonRaw !== null && (lonRaw < -180 || lonRaw > 180)) m.lon = 'Longitude harus berada di antara -180 dan 180.';
    if (!m.lat && !m.lon) {
      if (latRaw === null && lonRaw !== null) m.lat = 'Latitude harus diisi berpasangan dengan longitude.';
      if (lonRaw === null && latRaw !== null) m.lon = 'Longitude harus diisi berpasangan dengan latitude.';
    }
    if ($('fDesk').value.length > DESK_MAX) m.desk = 'Deskripsi maksimal ' + DESK_MAX + ' karakter.';
    setErr('fNama', 'eNama', m.nama); setErr('fLat', 'eLat', m.lat); setErr('fLon', 'eLon', m.lon); setErr('fDesk', 'eDesk', m.desk);
    ['fNama', 'fLat', 'fLon', 'fDesk'].forEach(function (id, k) {
      if ([m.nama, m.lat, m.lon, m.desk][k]) errs.push(id);
    });
    return { errors: errs, nama: nama, lat: latRaw, lon: lonRaw };
  }

  function syncDraft() {
    var lat = parseCoord($('fLat').value), lon = parseCoord($('fLon').value);
    var ok = lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon) &&
             lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    state.draft = ok ? { lat: lat, lon: lon } : null;
    $('geoReadout').textContent = ok ? fmtCoord(lat) + ', ' + fmtCoord(lon) : 'Belum ada titik';
    var hint = $('geoHint');
    var outside = ok && (lat < ID_BOX.latMin || lat > ID_BOX.latMax || lon < ID_BOX.lonMin || lon > ID_BOX.lonMax);
    hint.className = 'hint' + (outside ? ' warn' : '');
    hint.textContent = outside
      ? 'Koordinat ini berada di luar wilayah Indonesia. Periksa apakah latitude dan longitude tertukar.'
      : 'Isi koordinat atau klik titik pada peta di sebelah. Boleh dikosongkan dan dilengkapi nanti.';
    redrawMaps();
  }

  function renderLanes() {
    var on = $('fLoop').checked, ul = $('laneSources');
    clear(ul);
    LANES.forEach(function (n) {
      var li = el('li'); li.appendChild(el('span', null, 'Lajur ' + n));
      li.appendChild(el('span', on ? 'ok' : 'muted', on ? 'Aktif (simulasi)' : 'Nonaktif'));
      ul.appendChild(li);
    });
  }

  function onMapClick(ev) {
    var node = $('mapMini'), proj = node._proj;
    if (!proj) return;
    var rect = node.getBoundingClientRect();
    var x = (ev.clientX - rect.left) * (proj.W / rect.width), y = (ev.clientY - rect.top) * (proj.H / rect.height);
    $('fLat').value = dec(proj.lat(y).toFixed(6));
    $('fLon').value = dec(proj.lon(x).toFixed(6));
    setErr('fLat', 'eLat', ''); setErr('fLon', 'eLon', '');
    syncDraft();
  }

  function onSubmit(ev) {
    ev.preventDefault();
    showError('');
    var v = validate();
    if (v.errors.length) { $(v.errors[0]).focus(); return; }          // tetap di halaman tambah
    var btn = $('btnSave');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    request(API_LIST, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama_lokasi: v.nama, deskripsi: $('fDesk').value.trim() || null,
        latitude: v.lat, longitude: v.lon, detektor_virtual: $('fLoop').checked
      })
    }).then(function (res) {
      window.location.assign('/admin/intersections?berhasil=' + encodeURIComponent(res.id_persimpangan));
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = 'Simpan Persimpangan';
      if (e.status === 403) { showDenied(e.message); return; }
      if (e.status === 422 && /nama lokasi/i.test(e.message)) { setErr('fNama', 'eNama', e.message); $('fNama').focus(); return; }
      showError(e.message || 'Gagal menyimpan persimpangan.');
    });
  }

  function updateCounter() {
    var n = $('fDesk').value.length, c = $('cDesk');
    c.textContent = n + '/' + DESK_MAX;
    c.className = 'counter' + (n >= DESK_MAX ? ' max' : '');
  }

  /* ---------- ekspor CSV ---------- */
  function csvCell(v, isText) {
    var s = String(v === null || v === undefined ? '' : v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;                // cegah formula injection di Excel
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var rows = [['Nama Lokasi', 'Latitude', 'Longitude', 'Status Operasi', 'Kendaraan', 'Detektor Virtual', 'Jumlah Jalur']];
    state.items.forEach(function (it) {
      var l = liveOf(it.id_persimpangan), st = statusText(it.id_persimpangan);
      rows.push([csvCell(it.nama_lokasi, true), csvCell(hasGeo(it) ? it.latitude : ''), csvCell(hasGeo(it) ? it.longitude : ''),
        csvCell(st, true), csvCell(l && st !== 'Sensor Offline' ? l.jumlah_kendaraan : ''),
        csvCell(it.detektor_virtual ? 'Aktif' : 'Nonaktif', true), csvCell((it.jalur || []).length)]);
    });
    var head = rows.shift().map(function (h) { return csvCell(h, true); }).join(',');
    var csv = '﻿' + head + '\r\n' + rows.map(function (r) { return r.join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = el('a'); a.href = url; a.download = 'persimpangan-terdaftar.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- awal ---------- */
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = window.requestAnimationFrame(function () { resizeRaf = 0; redrawMaps(); });
  });

  function init() {
    if (!store('access_token')) { window.location.replace('/login'); return; }
    var who = null;
    try { who = JSON.parse(store('user_info') || 'null'); } catch (e) { who = null; }
    $('userName').textContent = who ? (who.nama || who.full_name || who.username || 'Pengguna') : 'Pengguna';
    if (who && who.role && who.role !== 'Administrator') {
      showDenied('Halaman Kelola Sistem hanya untuk Administrator. Anda masuk sebagai ' + who.role + '.');
      return;
    }

    $('tabAdd').className = 'tab' + (MODE === 'add' ? ' active' : '');
    $('tabList').className = 'tab' + (MODE === 'list' ? ' active' : '');
    $('crumbLeaf').textContent = MODE === 'add' ? 'Registrasi Simpang Baru' : 'Persimpangan Terdaftar';
    document.title = 'SINAPSIS ' + (MODE === 'add' ? 'Registrasi Simpang Baru' : 'Persimpangan Terdaftar');
    $('btnExport').addEventListener('click', exportCsv);

    if (MODE === 'add') {
      $('addSection').hidden = false;
      $('formAdd').addEventListener('submit', onSubmit);
      $('fLat').addEventListener('input', syncDraft);
      $('fLon').addEventListener('input', syncDraft);
      $('fDesk').addEventListener('input', updateCounter);
      $('fNama').addEventListener('input', function () { if ($('fNama').value.trim()) setErr('fNama', 'eNama', ''); });
      $('fLoop').addEventListener('change', renderLanes);
      $('mapMini').classList.add('pickable');
      $('mapMini').addEventListener('click', onMapClick);
      updateCounter(); renderLanes();
      $('fNama').focus();
    } else {
      $('listSection').hidden = false;
      $('btnReload').addEventListener('click', function () { loadAll(); });
      var m = /[?&]berhasil=(\d+)/.exec(window.location.search);
      if (m) {
        state.freshId = Number(m[1]); state.selected = state.freshId;
        toast(MSG_OK);
        try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* diabaikan */ }
      }
      renderDetail();
      startPolling();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) loadLive().then(renderAll); });
    }
    loadAll();
  }

  init();
})();
