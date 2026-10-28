/* SINAPSIS — Dashboard Pemantauan Lalu Lintas (F2). HTML/CSS/JS murni, tanpa framework. */
(function () {
  'use strict';

  var API_DASHBOARD = '/api/monitoring/dashboard';
  var API_REFRESH = '/api/monitoring/refresh';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  // Ambang tampilan (mengikuti backend: Padat >= 50% kapasitas jalur, Kritis >= 85%)
  var PADAT_PCT = 50, KRITIS_PCT = 85;
  var VEH_PER_ICON = 2.5, MAX_ICONS = 8;

  var state = { data: null, selected: null, busy: false, timer: null, toastTimer: null };

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

  /* ---------- format ---------- */
  function fmtSim(iso) {            // "2017-01-02T03:00:00" -> "02 Jan 2017 03:00"
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m ? m[3] + ' ' + BULAN[Number(m[2]) - 1] + ' ' + m[1] + ' ' + m[4] + ':' + m[5] : iso;
  }

  function fmtWib(isoUtc) {         // waktu server (UTC, tanpa zona) -> jam WIB
    if (!isoUtc) return '--';
    var d = new Date(isoUtc + 'Z');
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }).replace(/\./g, ':') + ' WIB';
  }

  function sentence(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function dec(n) { return String(n).replace('.', ','); }

  function statusClass(s) {
    if (s === 'Lancar') return 'st-lancar';
    if (s === 'Padat') return 'st-padat';
    if (s === 'Kritis') return 'st-kritis';
    if (s === 'Sensor Offline') return 'st-offline';
    return 'st-belum';
  }

  function densityClass(pct) { return pct >= KRITIS_PCT ? 'q-kritis' : (pct >= PADAT_PCT ? 'q-padat' : 'q-lancar'); }
  function densityWord(pct) { return pct >= KRITIS_PCT ? 'Kritis' : (pct >= PADAT_PCT ? 'Padat' : 'Lancar'); }

  /* ---------- jaringan ---------- */
  function request(url, opts) {
    var t0 = performance.now();
    return fetch(url, opts).then(function (res) {
      var ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (b) {
          throw new Error(b.detail || ('HTTP ' + res.status));
        });
      }
      return res.json().then(function (json) { return { json: json, ms: ms }; });
    });
  }

  function setOnline(ok, text) {
    var s = $('sysState');
    s.textContent = text;
    s.className = 'sysstate ' + (ok ? 'ok' : 'bad');
  }

  function showError(msg) {
    var b = $('bannerError');
    b.hidden = !msg;
    b.textContent = msg || '';
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  /* ---------- render ---------- */
  function render(data) {
    state.data = data;
    renderStatusbar(data);
    renderBanners(data);
    pickSelected(data);
    renderKpis(data);
    renderSelect(data);
    renderStatusList(data);
    renderDiagram(data);
    renderMetrics(data);
    renderPrediction(data);
    renderTelemetry(data);
  }

  function renderStatusbar(d) {
    $('dataTime').textContent = 'Data Lalu Lintas Real-Time Diperbarui: ' + fmtWib(d.diperbarui);
    $('simTime').textContent = d.waktu_data ? 'Waktu data (simulasi dataset): ' + fmtSim(d.waktu_data) : '';
  }

  function renderBanners(d) {
    var a = $('bannerAlert');
    a.hidden = !d.congestion_alert;
    a.textContent = d.congestion_alert ? d.pesan_alert : '';
    var s = $('bannerSensor');
    s.hidden = !d.pesan_sensor;
    s.textContent = d.pesan_sensor || '';
  }

  function pickSelected(d) {
    var ids = d.simpang.map(function (s) { return s.id_persimpangan; });
    if (state.selected !== null && ids.indexOf(state.selected) !== -1) return;
    var withData = d.simpang.filter(function (s) { return s.jalur.length > 0; });
    var crit = withData.filter(function (s) { return s.status === 'Kritis'; })[0];
    var chosen = crit || withData[0] || d.simpang[0];
    state.selected = chosen ? chosen.id_persimpangan : null;
  }

  function currentItem() {
    if (!state.data) return null;
    return state.data.simpang.filter(function (s) { return s.id_persimpangan === state.selected; })[0] || null;
  }

  function earlyWarning(s, d) {
    return s.prediksi_maks_pct !== null && d.ambang_peringatan_dini_pct !== null && s.prediksi_maks_pct >= d.ambang_peringatan_dini_pct;
  }

  function kpi(k, v, sub, alert) {
    var c = el('div', 'kpi' + (alert ? ' alert' : ''));
    c.appendChild(el('div', 'k', k));
    c.appendChild(el('div', 'v', v));
    if (sub) c.appendChild(el('div', 's', sub));
    return c;
  }

  function renderKpis(d) {
    var box = $('kpis');
    clear(box);
    var n = { Lancar: 0, Padat: 0, Kritis: 0 }, offline = 0, early = [], crit = [];
    d.simpang.forEach(function (s) {
      if (n[s.status] !== undefined) n[s.status] += 1;
      if (s.sensor_offline) offline += 1;
      if (s.status === 'Kritis') crit.push(s.nama_lokasi);
      if (earlyWarning(s, d)) early.push(s.nama_lokasi);
    });
    box.appendChild(kpi('Persimpangan dipantau', String(d.simpang.length),
      'Lancar ' + n.Lancar + ' · Padat ' + n.Padat + ' · Kritis ' + n.Kritis));
    box.appendChild(kpi('Total kendaraan', String(d.total_kendaraan), 'pada siklus terakhir, semua simpang'));
    box.appendChild(kpi('Kemacetan saat ini', String(crit.length), crit.length ? crit.join(', ') : 'Tidak ada simpang kritis', crit.length > 0));
    box.appendChild(kpi('Peringatan dini', String(early.length),
      early.length ? early.join(', ') : 'Prediksi jam depan di bawah ' + (d.ambang_peringatan_dini_pct === null ? 'ambang' : d.ambang_peringatan_dini_pct + '%')));
    box.appendChild(kpi('Sensor', offline ? offline + ' offline' : 'Semua online', offline ? 'Data simpang terakhir ditampilkan' : 'Data diterima dari semua simpang', offline > 0));
  }

  function renderSelect(d) {
    var sel = $('selSimpang');
    clear(sel);
    d.simpang.forEach(function (s) {
      var o = el('option', null, s.nama_lokasi);
      o.value = String(s.id_persimpangan);
      if (s.id_persimpangan === state.selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderStatusList(d) {
    var box = $('statusList');
    clear(box);
    $('listCount').textContent = d.simpang.length + ' simpang';
    d.simpang.forEach(function (s) {
      var row = el('button', 'row' + (s.id_persimpangan === state.selected ? ' selected' : ''));
      row.type = 'button';
      var name = el('span', 'name', s.nama_lokasi);
      var mini = el('span', 'mini');
      var fill = el('i', s.status === 'Kritis' ? 'kritis' : (s.status === 'Padat' ? 'padat' : ''));
      fill.style.width = (s.densitas_maks_pct === null ? 0 : Math.max(3, s.densitas_maks_pct)) + '%';
      mini.appendChild(fill);
      var first = el('div');
      first.appendChild(name);
      first.appendChild(mini);
      row.appendChild(first);
      row.appendChild(el('span', 'st ' + statusClass(s.status), s.status));
      row.appendChild(el('span', 'num', s.jalur.length || s.jumlah_kendaraan ? String(s.jumlah_kendaraan) : '—'));
      row.addEventListener('click', function () { selectSimpang(s.id_persimpangan); });
      box.appendChild(row);
    });
  }

  function selectSimpang(id) {
    state.selected = id;
    if (state.data) render(state.data);
  }

  /* ---------- diagram persimpangan (SVG) ----------
     Lalu lintas Indonesia berjalan di sisi kiri, sehingga lajur masuk tiap lengan:
     Utara = sisi timur jalan, Selatan = sisi barat, Timur = sisi selatan, Barat = sisi utara. */
  var CAR_COLORS = ['#f3f3ef', '#dcdcd7', '#b9c4d0', '#e7d8a2', '#cdbcbc', '#c3d0c2'];
  var ARMS = {
    Utara:   { queue: function (i) { return { x: 399, y: 192 - i * 20, width: 10, height: 16 }; },
               stop: { x: 380, y: 212, width: 48, height: 4 },
               sig: { x: 438, y: 166, tx: 462, ty: 190, ta: 'start' }, tag: { x: 448, y: 10 } },
    Selatan: { queue: function (i) { return { x: 351, y: 354 + i * 20, width: 10, height: 16 }; },
               stop: { x: 332, y: 344, width: 48, height: 4 },
               sig: { x: 304, y: 356, tx: 298, ty: 380, ta: 'end' }, tag: { x: 112, y: 482 } },
    Timur:   { queue: function (i) { return { x: 454 + i * 20, y: 299, width: 16, height: 10 }; },
               stop: { x: 446, y: 280, width: 4, height: 48 },
               sig: { x: 452, y: 336, tx: 476, ty: 360, ta: 'start' }, tag: { x: 548, y: 346 } },
    Barat:   { queue: function (i) { return { x: 292 - i * 20, y: 251, width: 16, height: 10 }; },
               stop: { x: 312, y: 232, width: 4, height: 48 },
               sig: { x: 294, y: 188, tx: 288, ty: 212, ta: 'end' }, tag: { x: 12, y: 150 } }
  };

  function drawRoads(s) {
    s.appendChild(svg('rect', { class: 'ground', x: 0, y: 0, width: 760, height: 560 }));
    s.appendChild(svg('rect', { class: 'asphalt', x: 332, y: 0, width: 96, height: 560 }));
    s.appendChild(svg('rect', { class: 'asphalt', x: 0, y: 232, width: 760, height: 96 }));
    // garis tepi jalan (hanya pada lengan)
    [[332, 0, 332, 232], [332, 328, 332, 560], [428, 0, 428, 232], [428, 328, 428, 560],
     [0, 232, 332, 232], [428, 232, 760, 232], [0, 328, 332, 328], [428, 328, 760, 328]].forEach(function (l) {
      s.appendChild(svg('line', { class: 'edge', x1: l[0], y1: l[1], x2: l[2], y2: l[3] }));
    });
    // marka tengah putus-putus
    [[380, 0, 380, 210], [380, 350, 380, 560], [0, 280, 310, 280], [450, 280, 760, 280]].forEach(function (l) {
      s.appendChild(svg('line', { class: 'median', x1: l[0], y1: l[1], x2: l[2], y2: l[3] }));
    });
    // zebra cross di tiap lengan
    for (var k = 0; k < 7; k++) {
      s.appendChild(svg('rect', { class: 'zebra', x: 336 + k * 14, y: 218, width: 8, height: 14 }));
      s.appendChild(svg('rect', { class: 'zebra', x: 336 + k * 14, y: 328, width: 8, height: 14 }));
      s.appendChild(svg('rect', { class: 'zebra', x: 428, y: 236 + k * 14, width: 14, height: 8 }));
      s.appendChild(svg('rect', { class: 'zebra', x: 318, y: 236 + k * 14, width: 14, height: 8 }));
    }
  }

  function drawSignal(g, cfg, lane) {
    var green = lane.sinyal === 'HIJAU';
    var x = cfg.sig.x, y = cfg.sig.y;
    g.appendChild(svg('rect', { class: 'signal-box', x: x, y: y, width: 18, height: 40, rx: 4 }));
    if (!green) g.appendChild(svg('circle', { class: 'lamp-glow-red', cx: x + 9, cy: y + 11, r: 9 }));
    if (green) g.appendChild(svg('circle', { class: 'lamp-glow-green', cx: x + 9, cy: y + 29, r: 9 }));
    g.appendChild(svg('circle', { class: green ? 'lamp-red-off' : 'lamp-red-on', cx: x + 9, cy: y + 11, r: 6 }));
    g.appendChild(svg('circle', { class: green ? 'lamp-green-on' : 'lamp-green-off', cx: x + 9, cy: y + 29, r: 6 }));
    g.appendChild(svg('text', { class: 'sig-text', x: cfg.sig.tx, y: cfg.sig.ty, 'text-anchor': cfg.sig.ta }, green ? lane.durasi + ' dtk' : 'Merah'));
  }

  function drawQueue(g, cfg, lane, armIndex) {
    var n = lane.jumlah_kendaraan;
    var icons = n <= 0 ? 0 : Math.max(1, Math.min(MAX_ICONS, Math.round(n / VEH_PER_ICON)));
    for (var i = 0; i < icons; i++) {
      var r = cfg.queue(i);
      g.appendChild(svg('rect', { class: 'car', x: r.x, y: r.y, width: r.width, height: r.height, rx: 2.5,
        fill: CAR_COLORS[(i * 2 + armIndex) % CAR_COLORS.length] }));
    }
  }

  function drawTag(g, cfg, lane, cap) {
    var p = cfg.tag, pct = lane.densitas_pct;
    g.appendChild(svg('rect', { class: 'tag-box', x: p.x, y: p.y, width: 200, height: 68, rx: 6 }));
    g.appendChild(svg('text', { class: 'tag-name', x: p.x + 12, y: p.y + 21 }, lane.arah));
    g.appendChild(svg('text', { class: 'tag-detail', x: p.x + 12, y: p.y + 39 },
      lane.jumlah_kendaraan + ' kendaraan · ' + pct + '% · ' + densityWord(pct)));
    g.appendChild(svg('rect', { class: 'tag-track', x: p.x + 12, y: p.y + 50, width: 176, height: 6, rx: 3 }));
    g.appendChild(svg('rect', { class: densityClass(pct), x: p.x + 12, y: p.y + 50,
      width: Math.max(3, Math.min(1, lane.jumlah_kendaraan / cap) * 176), height: 6, rx: 3 }));
    var corridor = /koridor/i.test(lane.alasan || '');
    var flags = [];
    if (lane.spike) flags.push('Spike');
    if (corridor) flags.push('Koridor');
    if (flags.length) {
      g.appendChild(svg('text', { class: 'arm-flag' + (corridor ? ' green' : ''), x: p.x + 188, y: p.y + 21 }, flags.join(' · ')));
    }
  }

  function renderDiagram(d) {
    var box = $('diagram');
    clear(box);
    var item = currentItem();
    if (!item || !item.jalur.length) {
      box.appendChild(el('div', 'empty', item && item.sensor_offline
        ? 'Sensor offline — belum ada data untuk ditampilkan.'
        : 'Belum ada data siklus. Tekan “Refresh Data” untuk memulai pemantauan.'));
      return;
    }
    var cap = d.kapasitas_jalur || 20;
    if (item.data_usang) box.appendChild(el('div', 'banner banner-sensor', 'Sensor offline — menampilkan data terakhir yang tersedia.'));
    var s = svg('svg', { viewBox: '0 0 760 560', role: 'img', 'aria-label': 'Diagram persimpangan ' + item.nama_lokasi });
    drawRoads(s);
    s.appendChild(svg('rect', { x: 332, y: 232, width: 96, height: 96, fill: '#4d5158' }));
    s.appendChild(svg('text', { class: 'center-text', x: 380, y: 276 }, sentence(item.periode)));
    s.appendChild(svg('text', { class: 'center-text', x: 380, y: 293 }, 'Siklus ' + item.siklus));

    var order = ['Utara', 'Selatan', 'Timur', 'Barat'];
    item.jalur.forEach(function (lane) {
      var cfg = ARMS[lane.arah];
      if (!cfg) return;
      var g = svg('g', {});
      g.appendChild(svg('title', {}, lane.arah + ': ' + lane.jumlah_kendaraan + ' kendaraan (' + lane.densitas_pct + '%). ' +
        (lane.sinyal === 'HIJAU' ? 'Lampu hijau ' + lane.durasi + ' dtk' : 'Lampu merah, jatah hijau berikutnya ' + lane.durasi + ' dtk') +
        (lane.spike ? '. Neuron spike' : '') + '. ' + lane.alasan));
      [cfg.stop].forEach(function (r) { g.appendChild(svg('rect', { class: 'stop', x: r.x, y: r.y, width: r.width, height: r.height })); });
      drawQueue(g, cfg, lane, order.indexOf(lane.arah));
      drawSignal(g, cfg, lane);
      drawTag(g, cfg, lane, cap);
      s.appendChild(g);
    });
    box.appendChild(s);
  }

  function metric(k, v, sub, badge) {
    var m = el('div', 'metric');
    m.appendChild(el('div', 'k', k));
    var val = el('div', 'v', v);
    if (badge) { val.appendChild(document.createTextNode(' ')); val.appendChild(el('span', 'badge' + (badge.warn ? ' warn' : ''), badge.text)); }
    m.appendChild(val);
    if (sub) m.appendChild(el('div', 's', sub));
    return m;
  }

  function renderMetrics(d) {
    var box = $('metrics');
    clear(box);
    var it = currentItem();
    if (!it || !it.jalur.length) return;
    var greens = it.jalur.filter(function (l) { return l.sinyal === 'HIJAU'; })
      .map(function (l) { return l.arah + ' ' + l.durasi + ' dtk'; });
    box.appendChild(metric('Total kendaraan', String(it.jumlah_kendaraan), '4 jalur, siklus terakhir',
      it.status === 'Kritis' ? { text: 'Macet' } : null));
    box.appendChild(metric('Jalur terpadat', it.jalur_terpadat.arah, it.jalur_terpadat.jumlah + ' kendaraan (' + it.densitas_maks_pct + '%)'));
    box.appendChild(metric('Lampu hijau', greens.length ? greens.join(', ') : 'Tidak ada', 'lengan lain menunggu'));
    box.appendChild(metric('Periode', sentence(it.periode), 'ambang spike ' + dec(it.ambang)));
    box.appendChild(metric('Prediksi jam depan', it.prediksi_maks_pct === null ? '—' : it.prediksi_maks_pct + '%',
      it.prediksi_maks_pct === null ? 'riwayat belum cukup' : 'kepadatan jalur terpadat',
      earlyWarning(it, d) ? { text: 'Peringatan dini', warn: true } : null));
  }

  function renderPrediction(d) {
    var box = $('predPanel');
    clear(box);
    var it = currentItem();
    $('predModel').textContent = it && it.model_prediksi ? it.model_prediksi : '';
    if (!it || !it.jalur.length) { box.appendChild(el('p', 'pred-msg', 'Menunggu data siklus pertama.')); return; }
    var has = it.jalur.some(function (l) { return l.prediksi_rasio !== null; });
    if (!has) { box.appendChild(el('p', 'pred-msg', 'Prediksi belum tersedia: riwayat 24 siklus belum terkumpul untuk persimpangan ini.')); return; }
    var cap = d.kapasitas_jalur || 20;
    var limit = d.ambang_peringatan_dini_pct;
    it.jalur.forEach(function (l) {
      var pct = Math.round(100 * l.prediksi_rasio);
      var pred = Math.round(l.prediksi_rasio * cap);
      var delta = pred - l.jumlah_kendaraan;
      var row = el('div', 'pred-row');
      row.appendChild(el('span', null, l.arah));
      var bars = el('div', 'bars');
      var now = el('div', 'bar'); var nf = el('span'); nf.style.width = Math.max(2, Math.min(100, l.densitas_pct)) + '%'; now.appendChild(nf);
      var nxt = el('div', 'bar next'); var xf = el('span', limit !== null && pct >= limit ? 'hot' : ''); xf.style.width = Math.max(2, Math.min(100, pct)) + '%'; nxt.appendChild(xf);
      bars.appendChild(now); bars.appendChild(nxt);
      row.appendChild(bars);
      var val = el('span', 'val');
      val.appendChild(document.createTextNode(l.jumlah_kendaraan + ' → '));
      val.appendChild(el('span', delta >= 2 ? 'up' : (delta <= -2 ? 'down' : ''), String(pred)));
      row.appendChild(val);
      box.appendChild(row);
    });
    var key = el('div', 'key');
    var a = el('span'); a.appendChild(el('i')); a.appendChild(document.createTextNode('sekarang'));
    var b = el('span'); b.appendChild(el('i', 'n')); b.appendChild(document.createTextNode('jam berikutnya'));
    key.appendChild(a); key.appendChild(b);
    box.appendChild(key);
    box.appendChild(el('p', 'note', 'Perkiraan dari model terlatih (riwayat 24 jam). Bilah merah melewati ambang peringatan dini' +
      (limit !== null ? ' (' + limit + '%).' : '.')));
  }

  function renderTelemetry(d) {
    var body = $('telemetryBody');
    clear(body);
    d.simpang.forEach(function (s) {
      var tr = el('tr', (s.status === 'Kritis' ? 'crit' : '') + (s.data_usang ? ' stale' : ''));
      var has = s.jalur.length > 0;
      var cells = [
        [s.nama_lokasi, ''],
        [has ? String(s.jumlah_kendaraan) : '—', 'num'],
        [has ? s.jalur_terpadat.arah + ' (' + s.jalur_terpadat.jumlah + ')' : '—', ''],
        [has ? s.densitas_maks_pct + '%' : '—', 'num'],
        [has ? sentence(s.periode) + ' (' + dec(s.ambang) + ')' : '—', ''],
        [has && s.prediksi_maks_pct !== null ? s.prediksi_maks_pct + '%' : '—', 'num'],
        [has ? s.status_algoritma : (s.sensor_offline ? 'Sensor Offline' : 'Belum ada data'), '']
      ];
      cells.forEach(function (c) { tr.appendChild(el('td', c[1], c[0])); });
      body.appendChild(tr);
    });
  }

  /* ---------- siklus pembaruan ---------- */
  function load() {
    return request(API_DASHBOARD).then(function (r) {
      onData(r);
      var needSeed = r.json.simpang.some(function (s) { return s.jalur.length === 0; });
      return needSeed ? tick(false) : null;
    });
  }

  function onData(r) {
    showError('');
    setOnline(true, 'Sistem online');
    $('latency').textContent = 'Latensi API: ' + r.ms + ' ms';
    render(r.json);
  }

  function tick(manual) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    $('btnRefresh').disabled = true;
    return request(API_REFRESH, { method: 'POST' }).then(function (r) {
      onData(r);
      if (manual) toast(r.json.pesan || 'Data lalu lintas berhasil dimuat ulang.');
    }).catch(function (e) {
      setOnline(false, 'Server tidak tersambung');
      showError('Gagal memuat data lalu lintas: ' + e.message);
    }).then(function () {
      state.busy = false;
      $('btnRefresh').disabled = false;
    });
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!$('autoToggle').checked) return;
    state.timer = setTimeout(function () {
      tick(false).then(schedule);
    }, Number($('autoInterval').value));
  }

  function updateMode() {
    $('modeLabel').textContent = 'Mode: ' + ($('autoToggle').checked ? 'otomatis' : 'manual');
    schedule();
  }

  function startClock() {
    function paint() {
      $('clock').textContent = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false,
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':') + ' WIB';
    }
    paint();
    setInterval(paint, 1000);
  }

  function init() {
    startClock();
    $('btnRefresh').addEventListener('click', function () { tick(true).then(schedule); });
    $('autoToggle').addEventListener('change', updateMode);
    $('autoInterval').addEventListener('change', schedule);
    $('selSimpang').addEventListener('change', function (e) { selectSimpang(Number(e.target.value)); });
    load().catch(function (e) {
      setOnline(false, 'Server tidak tersambung');
      showError('Gagal memuat data lalu lintas: ' + e.message);
    }).then(schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
