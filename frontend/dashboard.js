/* SINAPSIS — Dashboard Pemantauan Lalu Lintas (F2). HTML/CSS/JS murni, tanpa framework. */
(function () {
  'use strict';

  var API_DASHBOARD = '/api/monitoring/dashboard';
  var API_REFRESH = '/api/monitoring/refresh';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  // Ambang tampilan (mengikuti backend: Padat >= 50% kapasitas jalur, Kritis >= 85%)
  var PADAT_PCT = 50, KRITIS_PCT = 85;

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
  function two(n) { return (n < 10 ? '0' : '') + n; }

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

  function statusClass(s) {
    if (s === 'Lancar') return 'st-lancar';
    if (s === 'Padat') return 'st-padat';
    if (s === 'Kritis') return 'st-kritis';
    if (s === 'Sensor Offline') return 'st-offline';
    return 'st-belum';
  }

  function densityClass(pct) { return pct >= KRITIS_PCT ? 'q-kritis' : (pct >= PADAT_PCT ? 'q-padat' : 'q-lancar'); }

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
    s.textContent = '● ' + text;
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
    clear(a);
    if (d.congestion_alert) {
      a.appendChild(el('span', 'tag', 'ALERT'));
      a.appendChild(el('span', null, d.pesan_alert));
    }
    var s = $('bannerSensor');
    s.hidden = !d.pesan_sensor;
    s.textContent = d.pesan_sensor ? '⚠ ' + d.pesan_sensor : '';
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
      row.appendChild(el('span', 'name', s.nama_lokasi));
      var st = el('span', 'st ' + statusClass(s.status), (s.status === 'Kritis' ? '[!] ' : '') + s.status);
      row.appendChild(st);
      row.appendChild(el('span', 'num', s.jalur.length || s.jumlah_kendaraan ? String(s.jumlah_kendaraan) : '—'));
      row.addEventListener('click', function () { selectSimpang(s.id_persimpangan); });
      box.appendChild(row);
    });
  }

  function selectSimpang(id) {
    state.selected = id;
    if (state.data) render(state.data);
  }

  /* diagram skematik: 4 lengan, antrean (panjang = densitas), lampu per jalur */
  var ARMS = {
    Utara:   { max: 112, bar: function (n) { return { x: 300, y: 165 - n, width: 40, height: n }; },
               label: { x: 320, y: 20, a: 'middle' }, count: { x: 320, y: 37 }, flag: { x: 320, y: 53 }, sig: { x: 388, y: 146 } },
    Selatan: { max: 112, bar: function (n) { return { x: 300, y: 255, width: 40, height: n }; },
               label: { x: 320, y: 412, a: 'middle' }, count: { x: 320, y: 395 }, flag: { x: 320, y: 379 }, sig: { x: 252, y: 274 } },
    Timur:   { max: 170, bar: function (n) { return { x: 365, y: 190, width: n, height: 40 }; },
               label: { x: 628, y: 196, a: 'end' }, count: { x: 628, y: 213 }, flag: { x: 628, y: 229 }, sig: { x: 388, y: 274 } },
    Barat:   { max: 170, bar: function (n) { return { x: 275 - n, y: 190, width: n, height: 40 }; },
               label: { x: 12, y: 196, a: 'start' }, count: { x: 12, y: 213 }, flag: { x: 12, y: 229 }, sig: { x: 252, y: 146 } }
  };

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
    if (item.data_usang) box.appendChild(el('div', 'banner banner-sensor', '⚠ Sensor offline — menampilkan data terakhir yang tersedia.'));
    var s = svg('svg', { viewBox: '0 0 640 420', 'aria-hidden': 'true' });
    s.appendChild(svg('rect', { class: 'road', x: 275, y: 0, width: 90, height: 420 }));
    s.appendChild(svg('rect', { class: 'road', x: 0, y: 165, width: 640, height: 90 }));
    [[320, 0, 320, 165], [320, 255, 320, 420], [0, 210, 275, 210], [365, 210, 640, 210]].forEach(function (l) {
      s.appendChild(svg('line', { class: 'lane-line', x1: l[0], y1: l[1], x2: l[2], y2: l[3] }));
    });
    s.appendChild(svg('rect', { class: 'center', x: 275, y: 165, width: 90, height: 90 }));
    [[275, 165, 365, 165], [275, 255, 365, 255], [275, 165, 275, 255], [365, 165, 365, 255]].forEach(function (l) {
      s.appendChild(svg('line', { class: 'stop-line', x1: l[0], y1: l[1], x2: l[2], y2: l[3] }));
    });
    s.appendChild(svg('text', { class: 'center-text', x: 320, y: 206 }, item.periode || ''));
    s.appendChild(svg('text', { class: 'center-text', x: 320, y: 222 }, 'SIKLUS ' + item.siklus));

    item.jalur.forEach(function (lane) {
      var cfg = ARMS[lane.arah];
      if (!cfg) return;
      var g = svg('g', {});
      var tip = lane.arah + ': ' + lane.jumlah_kendaraan + ' kendaraan (' + lane.densitas_pct + '%), sinyal ' +
        lane.sinyal + ' ' + lane.durasi + ' dtk' + (lane.spike ? ', neuron spike' : '') + '. ' + lane.alasan;
      g.appendChild(svg('title', {}, tip));
      var len = Math.max(4, Math.min(1, lane.jumlah_kendaraan / cap) * cfg.max);
      var b = cfg.bar(len);
      g.appendChild(svg('rect', { class: densityClass(lane.densitas_pct), x: b.x, y: b.y, width: b.width, height: b.height, rx: 2 }));
      g.appendChild(svg('text', { class: 'arm-label', x: cfg.label.x, y: cfg.label.y, 'text-anchor': cfg.label.a }, lane.arah.toUpperCase()));
      g.appendChild(svg('text', { class: 'arm-count', x: cfg.count.x, y: cfg.count.y, 'text-anchor': cfg.label.a },
        lane.jumlah_kendaraan + '/' + cap + ' (' + lane.densitas_pct + '%)'));
      var flag = lane.spike ? 'SPIKE' : '';
      var corridor = /koridor/i.test(lane.alasan || '');
      if (corridor) flag = (flag ? flag + ' · ' : '') + 'KORIDOR';
      if (flag) {
        g.appendChild(svg('text', { class: 'arm-flag' + (corridor ? ' green' : ''), x: cfg.flag.x, y: cfg.flag.y, 'text-anchor': cfg.label.a }, flag));
      }
      g.appendChild(svg('circle', { class: lane.sinyal === 'HIJAU' ? 'sig-hijau' : 'sig-merah', cx: cfg.sig.x, cy: cfg.sig.y, r: 10 }));
      g.appendChild(svg('text', { class: 'sig-text', x: cfg.sig.x, y: cfg.sig.y + 26 }, lane.durasi + 's'));
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
    var critical = it.status === 'Kritis';
    box.appendChild(metric('Total kendaraan', String(it.jumlah_kendaraan), 'pada siklus terakhir', critical ? { text: 'KEMACETAN AKTIF' } : null));
    box.appendChild(metric('Jalur terpadat', it.jalur_terpadat.arah, it.jalur_terpadat.jumlah + ' kendaraan'));
    box.appendChild(metric('Densitas maks', it.densitas_maks_pct + '%', 'dari kapasitas ' + d.kapasitas_jalur + ' per jalur'));
    box.appendChild(metric('Periode', it.periode, 'ambang spike ' + it.ambang));
    var hot = it.prediksi_maks_pct !== null && d.ambang_peringatan_dini_pct !== null && it.prediksi_maks_pct >= d.ambang_peringatan_dini_pct;
    box.appendChild(metric('Prediksi jam depan', it.prediksi_maks_pct === null ? '—' : it.prediksi_maks_pct + '%',
      it.prediksi_maks_pct === null ? 'riwayat belum cukup' : 'densitas maks jalur', hot ? { text: 'PERINGATAN DINI', warn: true } : null));
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
      var row = el('div', 'pred-row');
      row.appendChild(el('span', null, l.arah));
      var bar = el('div', 'bar');
      var fill = el('span', limit !== null && pct >= limit ? 'hot' : '');
      fill.style.width = Math.max(2, Math.min(100, pct)) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'val', '≈ ' + Math.round(l.prediksi_rasio * cap) + ' kend.'));
      box.appendChild(row);
    });
    box.appendChild(el('p', 'note', 'Perkiraan jam berikutnya dari model terlatih (riwayat 24 jam). Batang merah = melewati ambang peringatan dini' +
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
        [has ? s.periode + ' (' + s.ambang + ')' : '—', ''],
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
    setOnline(true, 'SYSTEM ONLINE');
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
      setOnline(false, 'SERVER TIDAK TERSAMBUNG');
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
    $('modeLabel').textContent = 'MODE: ' + ($('autoToggle').checked ? 'OTOMATIS' : 'MANUAL');
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
      setOnline(false, 'SERVER TIDAK TERSAMBUNG');
      showError('Gagal memuat data lalu lintas: ' + e.message);
    }).then(schedule);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
