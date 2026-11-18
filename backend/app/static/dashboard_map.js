/* SINAPSIS - peta GIS dashboard: titik persimpangan berwarna menurut status kepadatan, plus visual
   Automated Green Corridor (Fitur 9). Fungsi murni (warna, koordinat, urutan koridor) dipisah dari
   pengikatan Leaflet supaya bisa diuji di Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SinapsisMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var COLORS = { 'Lancar': '#2f7d4a', 'Padat': '#114eab', 'Kritis': '#b3112b', 'Sensor Offline': '#6b7280', 'Belum ada data': '#94a3b8' };
  var CORRIDOR = '#16a34a';
  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var DEFAULT_VIEW = { lat: -7.2756, lon: 112.7468, zoom: 12 }; // Surabaya, dipakai bila belum ada titik

  function colorFor(status) { return COLORS[status] || COLORS['Belum ada data']; }
  function hasGeo(i) { return typeof i.latitude === 'number' && typeof i.longitude === 'number' && isFinite(i.latitude) && isFinite(i.longitude); }
  function fmtCoord(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return '—';
    return lat.toFixed(4) + ', ' + lon.toFixed(4);
  }
  function byId(items) { var m = {}; (items || []).forEach(function (i) { m[i.id_persimpangan] = i; }); return m; }

  /* Titik [lat, lon] sepanjang koridor, berurutan; persimpangan tanpa koordinat dilewati. */
  function corridorLatLngs(corridor, items) {
    var idx = byId(items);
    return (corridor.urutan || []).map(function (id) { return idx[id]; }).filter(function (i) { return i && hasGeo(i); })
      .map(function (i) { return [i.latitude, i.longitude]; });
  }

  /* Tanda tangan tampilan satu penanda; ikon hanya dibuat ulang bila berubah (data tiba tiap detik). */
  function markerSig(item, selected) {
    return [item.status, selected ? 1 : 0, item.koridor ? item.koridor.urutan : 0, item.koridor_hijau ? 1 : 0].join('|');
  }

  function summary(items) {
    var n = { 'Lancar': 0, 'Padat': 0, 'Kritis': 0, 'Sensor Offline': 0, 'Belum ada data': 0 };
    (items || []).forEach(function (i) { if (n[i.status] !== undefined) n[i.status] += 1; });
    return n;
  }

  function corridorText(c, items) {
    var idx = byId(items);
    var names = (c.urutan || []).map(function (id) { return idx[id] ? idx[id].nama_lokasi : '#' + id; });
    var t = c.emergency_id + (c.jenis_kendaraan ? ' · ' + c.jenis_kendaraan : '') + ' · ' + (names.length ? names.join(' → ') : 'rute belum terpetakan');
    if (c.tidak_terpetakan && c.tidak_terpetakan.length) t += ' (tidak dikenali: ' + c.tidak_terpetakan.join(', ') + ')';
    return t;
  }

  /* ---------- Leaflet ---------- */
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function iconFor(item, selected) {
    var wrap = mk('div', 'gm' + (selected ? ' gm-sel' : '') + (item.koridor_hijau ? ' gm-cor' : ''));
    var dot = mk('span', 'gm-dot', item.koridor ? String(item.koridor.urutan) : '');
    dot.style.background = item.koridor_hijau ? CORRIDOR : colorFor(item.status);
    wrap.appendChild(dot);
    return L.divIcon({ className: 'gm-icon', html: wrap, iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18], tooltipAnchor: [16, 0] });
  }

  function popupFor(item) {
    var box = mk('div', 'gm-pop');
    box.appendChild(mk('strong', null, item.nama_lokasi));
    var st = mk('div', 'gm-pop-st');
    var sw = mk('i'); sw.style.background = colorFor(item.status);
    st.appendChild(sw); st.appendChild(mk('span', null, item.status));
    box.appendChild(st);
    var rows = [
      ['Kendaraan', item.jalur && item.jalur.length ? String(item.jumlah_kendaraan) : '—'],
      ['Kepadatan', item.densitas_maks_pct !== null && item.densitas_maks_pct !== undefined ? item.densitas_maks_pct + '% (jalur terpadat)' : '—'],
      ['Koordinat', fmtCoord(item.latitude, item.longitude)],
      ['Tipe', item.tipe || '—']
    ];
    rows.forEach(function (r) {
      var row = mk('div', 'gm-pop-row');
      row.appendChild(mk('span', null, r[0])); row.appendChild(mk('b', null, r[1]));
      box.appendChild(row);
    });
    if (item.koridor) box.appendChild(mk('div', 'gm-pop-cor', 'Koridor hijau ' + item.koridor.emergency_id + ' · titik ke-' + item.koridor.urutan + ' dari ' + item.koridor.total));
    else if (item.koridor_hijau) box.appendChild(mk('div', 'gm-pop-cor', 'Koridor hijau aktif pada persimpangan ini'));
    return box;
  }

  /* opts: { el, noteEl, chipEl, listEl, onSelect(id) } -> { update(data, selectedId) } */
  function create(opts) {
    var ctl = { map: null, markers: {}, sigs: {}, lines: [], corSig: '', fitKey: '', tileErrors: 0, latest: {} };
    var hasMap = typeof L !== 'undefined' && opts.el;

    function note(msg) { if (opts.noteEl) { opts.noteEl.hidden = !msg; opts.noteEl.textContent = msg || ''; } }

    if (hasMap) {
      var map = L.map(opts.el, { minZoom: 5, maxZoom: 19, zoomSnap: 0.5, scrollWheelZoom: false })
        .setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR })
        .on('tileload', function () { ctl.tileErrors = 0; note(''); })
        .on('tileerror', function () {
          ctl.tileErrors += 1;
          if (ctl.tileErrors >= 4) note('Peta dasar belum dapat dimuat (periksa koneksi internet). Titik persimpangan, status, dan koridor hijau tetap ditampilkan.');
        }).addTo(map);
      opts.el.addEventListener('mouseleave', function () { map.scrollWheelZoom.disable(); });
      map.on('click', function () { map.scrollWheelZoom.enable(); });
      if (typeof ResizeObserver === 'function') new ResizeObserver(function () { map.invalidateSize(); }).observe(opts.el);
      ctl.map = map;
      ctl.group = L.layerGroup().addTo(map);
      ctl.lineGroup = L.layerGroup().addTo(map);
    } else {
      note('Pustaka peta tidak dapat dimuat. Daftar titik persimpangan di bawah tetap tersedia.');
    }

    function renderList(items, selectedId) {
      if (!opts.listEl) return;
      while (opts.listEl.firstChild) opts.listEl.removeChild(opts.listEl.firstChild);
      items.forEach(function (i) {
        var b = mk('button', 'gm-item' + (i.id_persimpangan === selectedId ? ' selected' : '') + (i.koridor_hijau ? ' cor' : ''));
        b.type = 'button';
        var sw = mk('i'); sw.style.background = i.koridor_hijau ? CORRIDOR : colorFor(i.status);
        b.appendChild(sw);
        var t = mk('span', 'gm-item-t');
        t.appendChild(mk('b', null, i.nama_lokasi));
        t.appendChild(mk('small', null, fmtCoord(i.latitude, i.longitude)));
        b.appendChild(t);
        var s = mk('span', 'gm-item-s');
        s.appendChild(mk('span', null, i.koridor_hijau ? 'Koridor hijau' : i.status));
        s.appendChild(mk('small', null, i.densitas_maks_pct !== null && i.densitas_maks_pct !== undefined ? i.densitas_maks_pct + '% padat' : 'belum ada data'));
        b.appendChild(s);
        b.addEventListener('click', function () {
          if (opts.onSelect) opts.onSelect(i.id_persimpangan);
          var m = ctl.markers[i.id_persimpangan];
          if (m && ctl.map) { ctl.map.panTo(m.getLatLng()); m.openPopup(); }
        });
        opts.listEl.appendChild(b);
      });
    }

    function renderChip(corridors, items) {
      if (!opts.chipEl) return;
      while (opts.chipEl.firstChild) opts.chipEl.removeChild(opts.chipEl.firstChild);
      opts.chipEl.hidden = !corridors.length;
      corridors.forEach(function (c) {
        var row = mk('div', 'gm-chip-row');
        row.appendChild(mk('span', 'gm-chip-badge', 'KORIDOR HIJAU AKTIF'));
        row.appendChild(mk('span', null, corridorText(c, items)));
        opts.chipEl.appendChild(row);
      });
    }

    ctl.update = function (data, selectedId) {
      var items = (data && data.simpang) || [];
      var corridors = (data && data.koridor_hijau) || [];
      ctl.latest = byId(items);
      renderChip(corridors, items);
      renderList(items.filter(hasGeo), selectedId);
      if (!ctl.map) return;

      var seen = {};
      items.filter(hasGeo).forEach(function (i) {
        var id = i.id_persimpangan, sel = id === selectedId, sig = markerSig(i, sel);
        seen[id] = true;
        var m = ctl.markers[id];
        if (!m) {
          m = L.marker([i.latitude, i.longitude], { icon: iconFor(i, sel), keyboard: true, title: i.nama_lokasi, riseOnHover: true });
          m.bindTooltip(i.nama_lokasi, { direction: 'right', offset: [8, 0], className: 'gm-tip' });
          m.bindPopup(function () { return popupFor(ctl.latest[id] || i); }, { closeButton: true });
          m.on('click', function () { if (opts.onSelect) opts.onSelect(id); });
          m.addTo(ctl.group);
          ctl.markers[id] = m; ctl.sigs[id] = sig;
        } else if (ctl.sigs[id] !== sig) {
          m.setIcon(iconFor(i, sel)); ctl.sigs[id] = sig;
        }
        if (sel) m.setZIndexOffset(1000); else m.setZIndexOffset(i.koridor_hijau ? 500 : 0);
      });
      Object.keys(ctl.markers).forEach(function (id) {
        if (!seen[id]) { ctl.group.removeLayer(ctl.markers[id]); delete ctl.markers[id]; delete ctl.sigs[id]; }
      });

      var corSig = JSON.stringify(corridors.map(function (c) { return [c.emergency_id, corridorLatLngs(c, items)]; }));
      if (corSig !== ctl.corSig) {
        ctl.corSig = corSig;
        ctl.lineGroup.clearLayers();
        corridors.forEach(function (c) {
          var pts = corridorLatLngs(c, items);
          if (pts.length < 2) return;
          L.polyline(pts, { color: '#ffffff', weight: 11, opacity: 0.9, interactive: false }).addTo(ctl.lineGroup);
          L.polyline(pts, { color: CORRIDOR, weight: 6, opacity: 1, className: 'gm-corridor', interactive: false }).addTo(ctl.lineGroup);
        });
      }

      // sesuaikan tampilan saat pertama kali, dan lagi bila himpunan persimpangan berubah (mis. registrasi baru)
      var geo = items.filter(hasGeo), fitKey = geo.map(function (i) { return i.id_persimpangan; }).join(',');
      if (geo.length && ctl.fitKey !== fitKey) {
        ctl.fitKey = fitKey;
        var pts = geo.map(function (i) { return [i.latitude, i.longitude]; });
        ctl.map.invalidateSize();
        if (pts.length === 1) ctl.map.setView(pts[0], 15);
        else ctl.map.fitBounds(L.latLngBounds(pts), { padding: [56, 56], maxZoom: 15 });
      }
    };

    return ctl;
  }

  return { COLORS: COLORS, CORRIDOR: CORRIDOR, colorFor: colorFor, hasGeo: hasGeo, fmtCoord: fmtCoord,
           corridorLatLngs: corridorLatLngs, markerSig: markerSig, summary: summary, corridorText: corridorText, create: create };
});
