/* Editor lengan persimpangan: gambar garis jalan tiap lengan langsung di peta Leaflet.
   Lengan diberi nomor 1..N sesuai urutan menggambar. Titik dari tengah persimpangan keluar mengikuti bentuk jalan.
   Dipakai di form registrasi dan dialog "Gambar lengan" persimpangan yang sudah terdaftar. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SinapsisArmEditor = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var MAX_ARMS = 8, MAX_POINTS = 100;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, title, onClick, disabled) {
    var b = el('button', 'ae-btn', label);
    b.type = 'button';
    if (title) b.title = title;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  function r7(v) { return Math.round(v * 1e7) / 1e7; }

  /* o: { map, container, center: () => {lat, lon} | null, fixedNames?: [..], initial?: {nama: [[lat,lon],..]},
          onChange? } */
  function create(o) {
    var L = root.L, map = o.map, ui = o.container, fixed = o.fixedNames || null;
    var arms = [], cur = -1, layer = L.layerGroup().addTo(map), alive = true, msg = '';
    if (fixed) fixed.forEach(function (n) { arms.push(o.initial && o.initial[n] ? o.initial[n].map(function (p) { return [p[0], p[1]]; }) : []); });

    function center() { return o.center ? o.center() : null; }
    function names() {
      if (fixed) return fixed.slice();
      return arms.map(function (_, i) { return 'Lengan ' + (i + 1); });
    }
    function changed() { render(); if (o.onChange) o.onChange(api); }

    /* Titik tarik (putih) untuk membelokkan jalan, dan tanda "+" di tengah tiap ruas untuk menambah tikungan baru.
       Klik kanan / dobel-klik pada titik menghapusnya. Perubahan diterapkan saat tarikan dilepas. */
    function later(fn) { setTimeout(function () { if (alive) fn(); }, 0); }
    function addHandles(i, poly, base) {
      var pts = arms[i];
      pts.forEach(function (p, k) {
        var m = L.marker(p, { draggable: true, keyboard: false, title: 'Tarik untuk membelokkan jalan · klik kanan untuk menghapus titik',
          icon: L.divIcon({ className: '', html: '<div class="ae-vtx"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(layer);
        m.on('drag', function (e) { var x = base.slice(); x[k + 1] = e.latlng; poly.setLatLngs(x); });
        m.on('dragend', function (e) {
          var q = e.target.getLatLng();
          pts[k] = [r7(q.lat), r7(q.lng)];
          later(changed);
        });
        m.on('contextmenu dblclick', function (e) {
          L.DomEvent.stop(e);
          if (pts.length > 1) { pts.splice(k, 1); msg = ''; } else msg = 'Lengan minimal punya satu titik. Pakai "Hapus" untuk membuang lengan.';
          later(changed);
        });
      });
      if (pts.length >= MAX_POINTS) return;
      pts.forEach(function (p, k) {
        var a = base[k], b = base[k + 1];   // base[0] = pusat persimpangan, base[k+1] = pts[k]
        var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        var m = L.marker(mid, { draggable: true, keyboard: false, title: 'Tarik untuk menambah tikungan',
          icon: L.divIcon({ className: '', html: '<div class="ae-mid">+</div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(layer);
        m.on('drag', function (e) { var x = base.slice(); x.splice(k + 1, 0, e.latlng); poly.setLatLngs(x); });
        m.on('dragend', function (e) {
          var q = e.target.getLatLng();
          if (arms[i].length < MAX_POINTS) arms[i].splice(k, 0, [r7(q.lat), r7(q.lng)]);
          later(changed);
        });
      });
    }

    function drawLines() {
      layer.clearLayers();
      var c = center();
      if (!c) return;
      arms.forEach(function (pts, i) {
        if (!pts.length) return;
        var active = i === cur, ll = [[c.lat, c.lon]].concat(pts);
        var poly = L.polyline(ll, { color: active ? '#e07b00' : '#114eab', weight: 6, opacity: active ? 0.9 : 0.72, dashArray: active ? '2 8' : null, lineCap: 'round' }).addTo(layer);
        if (active) {
          pts.forEach(function (p) {
            L.circleMarker(p, { radius: 4, color: '#fff', weight: 1.5, fillColor: '#e07b00', fillOpacity: 1, interactive: false }).addTo(layer);
          });
        } else addHandles(i, poly, ll);
        var last = pts[pts.length - 1];
        L.marker(last, { interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', html: '<div class="arm-line-tag' + (active ? ' act' : '') + '">' + (i + 1) + '</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(layer);
      });
    }

    function startArm(i) {
      if (!center()) { msg = 'Tentukan titik persimpangan dulu (klik peta atau isi koordinat).'; render(); return; }
      finish(true);
      if (i == null) {
        if (arms.length >= MAX_ARMS) { msg = 'Maksimal ' + MAX_ARMS + ' lengan.'; render(); return; }
        arms.push([]); i = arms.length - 1;
      } else arms[i] = [];
      cur = i; msg = '';
      if (o.zoomTo) o.zoomTo();
      changed();
    }
    function finish(silent) {
      if (cur < 0) return;
      if (!arms[cur].length && !fixed) arms.splice(cur, 1);
      cur = -1;
      if (!silent) changed();
    }
    function addPoint(latlng) {
      if (cur < 0 || arms[cur].length >= MAX_POINTS) return;
      arms[cur].push([r7(latlng.lat), r7(latlng.lng)]);
      msg = '';
      changed();
    }
    function undo() {
      if (cur < 0 || !arms[cur].length) return;
      arms[cur].pop();
      changed();
    }
    function removeArm(i) {
      if (fixed) arms[i] = []; else arms.splice(i, 1);
      if (cur === i) cur = -1; else if (cur > i && !fixed) cur -= 1;
      changed();
    }
    function clearAll() {
      arms = fixed ? fixed.map(function () { return []; }) : [];
      cur = -1; msg = '';
      changed();
    }

    function render() {
      if (!alive) return;
      drawLines();
      if (!ui) return;
      while (ui.firstChild) ui.removeChild(ui.firstChild);
      var bar = el('div', 'ae-bar');
      if (!fixed) bar.appendChild(btn('+ Tambah lengan', 'Mulai menggambar lengan berikutnya', function () { startArm(null); }, cur >= 0 && false));
      if (cur >= 0) {
        bar.appendChild(btn('Selesai', 'Akhiri lengan ini (Esc)', function () { finish(); }));
        bar.appendChild(btn('Urungkan titik', 'Hapus titik terakhir', undo, !arms[cur].length));
      }
      if (!fixed) bar.appendChild(btn('Hapus semua', 'Hapus seluruh lengan', clearAll, !arms.length));
      ui.appendChild(bar);
      var hint = el('p', 'ae-hint');
      hint.setAttribute('role', 'status');
      hint.textContent = msg || (cur >= 0
        ? 'Lengan ' + (cur + 1) + ': klik di sepanjang jalan, dari tengah persimpangan ke luar. Kalau sudah, tekan Selesai.'
        : arms.some(function (a) { return a.length; })
          ? 'Tarik titik putih untuk membelokkan jalan, tarik tanda + di tengah garis untuk menambah tikungan, klik kanan titik untuk menghapusnya.'
          : 'Tekan "+ Tambah lengan", lalu klik di sepanjang jalan di peta.');
      ui.appendChild(hint);
      var list = el('ul', 'ae-list');
      var nm = names();
      arms.forEach(function (pts, i) {
        var li = el('li', i === cur ? 'cur' : '');
        li.appendChild(el('b', 'ae-num', String(i + 1)));
        li.appendChild(el('span', 'ae-name', (fixed ? nm[i] + ' · ' : '') + (pts.length ? pts.length + ' titik' : 'belum digambar')));
        li.appendChild(btn('Gambar ulang', 'Hapus garis lalu gambar lagi', function () { startArm(i); }));
        li.appendChild(btn(fixed ? 'Kosongkan' : 'Hapus', null, function () { removeArm(i); }));
        list.appendChild(li);
      });
      ui.appendChild(list);
    }

    var onKey = function (e) { if (e.key === 'Escape' && cur >= 0) finish(); };
    document.addEventListener('keydown', onKey);
    map.on('click', function (e) { addPoint(e.latlng); });

    var api = {
      isDrawing: function () { return cur >= 0; },
      names: names,
      count: function () { return fixed ? fixed.length : arms.filter(function (a) { return a.length; }).length; },
      // { namaLengan: [[lat,lon],...] } hanya lengan yang sudah digambar
      paths: function () {
        var out = {}, nm = names();
        arms.forEach(function (pts, i) { if (pts.length) out[nm[i]] = pts.map(function (p) { return [p[0], p[1]]; }); });
        return out;
      },
      setPaths: function (list) {   // list: array of [[lat,lon],..]; hanya mode bebas
        if (fixed) return;
        finish(true);
        arms = list.slice(0, MAX_ARMS).map(function (pts) { return pts.slice(0, MAX_POINTS).map(function (p) { return [r7(p[0]), r7(p[1])]; }); });
        msg = '';
        changed();
      },
      setPath: function (name, pts) {   // isi satu lengan (mode nama tetap)
        var i = names().indexOf(name);
        if (i < 0) return;
        if (cur === i) cur = -1;
        arms[i] = pts.slice(0, MAX_POINTS).map(function (p) { return [r7(p[0]), r7(p[1])]; });
        changed();
      },
      setMessage: function (m) { msg = m || ''; render(); },
      redraw: render,
      finish: finish,
      startArm: startArm,
      destroy: function () { alive = false; document.removeEventListener('keydown', onKey); layer.clearLayers(); map.removeLayer(layer); },
    };
    render();
    return api;
  }

  return { create: create, MAX_ARMS: MAX_ARMS };
});
