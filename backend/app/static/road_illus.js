/* SINAPSIS - ilustrasi jalan persimpangan yang digenerate dari lengan yang digambar (tanpa data OpenStreetMap).
   Murni (tanpa DOM/jaringan): menghasilkan markup SVG berupa string, sehingga bisa diuji di Node dan dipakai di dashboard
   (di atas peta pudar) maupun di pratinjau form registrasi. Satuan geometri = "unit" (1 unit ~ 0,28 m), y ke bawah. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SinapsisRoadIllus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var M_PER_UNIT = 0.28;
  var RAD = { cx: 0, cy: 0, lane: 12, half: 22, disc: 40, stop: 52, end: 240 };
  var COL = { casing: '#1b2030', asphalt: '#454c5c', mark: '#e8c547', white: '#f1f3f8' };

  function f(n) { return (Math.round(n * 10) / 10).toString(); }

  /* lintang/bujur -> unit relatif terhadap pusat (y ke bawah) */
  function toUnits(c, p) {
    var mx = (p[1] - c.lon) * 111320 * Math.cos(c.lat * Math.PI / 180), my = (p[0] - c.lat) * 111132;
    return [mx / M_PER_UNIT, -my / M_PER_UNIT];
  }

  function cumLen(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return cum;
  }
  /* titik & arah pada jarak d sepanjang polyline */
  function along(pts, d) {
    var cum = cumLen(pts), i = 1;
    if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], dx: 0, dy: -1 };
    while (i < pts.length - 1 && cum[i] < d) i++;
    var a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
    var dx = (b[0] - a[0]) / seg, dy = (b[1] - a[1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx: dx, dy: dy };
  }
  /* potong polyline sampai panjang maks (unit) */
  function clip(pts, max) {
    var cum = cumLen(pts);
    if (!pts.length) return [];
    if (cum[cum.length - 1] <= max) return pts.slice();
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      if (cum[i] <= max) out.push(pts[i]);
      else { var p = along(pts, max); out.push([p.x, p.y]); break; }
    }
    return out;
  }
  /* Haluskan tikungan (Chaikin): titik awal & akhir tetap, sudut tajam di titik belokan menjadi lengkung. */
  function smooth(pts, iter) {
    var cur = pts.map(function (p) { return [p[0], p[1]]; }), n = iter == null ? 2 : iter;
    for (var k = 0; k < n; k++) {
      if (cur.length < 3) break;
      var out = [cur[0]];
      for (var i = 0; i < cur.length - 1; i++) {
        var a = cur[i], b = cur[i + 1];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
        out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      out.push(cur[cur.length - 1]);
      cur = out;
    }
    return cur;
  }
  /* Perpanjang polyline lurus searah segmen terakhir sampai panjang `len` (unit). */
  function extend(pts, len) {
    var out = pts.map(function (p) { return [p[0], p[1]]; }), cum = cumLen(out), tot = cum[cum.length - 1];
    if (out.length < 2 || tot >= len) return out;
    var i = out.length - 1, dx = 0, dy = 0, d = 0;
    while (i > 0 && d < 1e-6) { dx = out[i][0] - out[i - 1][0]; dy = out[i][1] - out[i - 1][1]; d = Math.hypot(dx, dy); i--; }
    if (d < 1e-6) return out;
    var last = out[out.length - 1];
    out.push([last[0] + dx / d * (len - tot), last[1] + dy / d * (len - tot)]);
    return out;
  }
  function poly(pts) { return pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' '); }

  /* roads = { namaLengan: [[x,y],...] } garis tengah dari pusat ke luar (unit).
     Mengembalikan { under, marks }: `under` = tepi + aspal + lingkaran tengah; `marks` = marka tengah dan garis henti. */
  function markup(roads, rad) {
    var R = {}, k;
    for (k in RAD) R[k] = rad && rad[k] != null ? rad[k] : RAD[k];
    var under = '', marks = '', names = Object.keys(roads);
    names.forEach(function (a) {
      var pts = clip(roads[a], R.end);
      if (pts.length < 2) return;
      under += '<polyline points="' + poly(pts) + '" fill="none" stroke="' + COL.casing + '" stroke-width="' + f(R.half * 2 + 5) + '" stroke-linejoin="round" stroke-linecap="butt"/>';
    });
    names.forEach(function (a) {
      var pts = clip(roads[a], R.end);
      if (pts.length < 2) return;
      under += '<polyline points="' + poly(pts) + '" fill="none" stroke="' + COL.asphalt + '" stroke-width="' + f(R.half * 2) + '" stroke-linejoin="round" stroke-linecap="butt"/>';
    });
    under += '<circle cx="0" cy="0" r="' + f(R.disc + 4) + '" fill="' + COL.casing + '"/><circle cx="0" cy="0" r="' + f(R.disc) + '" fill="' + COL.asphalt + '"/>';
    names.forEach(function (a) {
      var pts = clip(roads[a], R.end);
      if (pts.length < 2) return;
      var start = 0, cum = cumLen(pts), body = [], i;
      for (i = 0; i < pts.length; i++) if (cum[i] >= R.stop + 8) { body.push(pts[i]); }
      var first = along(pts, R.stop + 8);
      body.unshift([first.x, first.y]);
      if (body.length >= 2) marks += '<polyline points="' + poly(body) + '" fill="none" stroke="' + COL.mark + '" stroke-width="2" stroke-dasharray="11 9" opacity="0.9" stroke-linejoin="round"/>';
      // garis henti di lajur masuk (sisi kanan arah keluar, y ke bawah: normal kanan = (-dy, dx))
      var s = along(pts, R.stop), nx = -s.dy, ny = s.dx;
      marks += '<line x1="' + f(s.x + nx * 2) + '" y1="' + f(s.y + ny * 2) + '" x2="' + f(s.x + nx * (R.half - 1)) + '" y2="' + f(s.y + ny * (R.half - 1)) + '" stroke="' + COL.white + '" stroke-width="4"/>';
    });
    return { under: under, marks: marks };
  }

  /* Pratinjau mandiri (tanpa animasi) dari lengan yang digambar: untuk form registrasi.
     T = SinapsisTraffic (curveGeo). o = { center:{lat,lon}, names:[...], paths:{nama:[[lat,lon],...]} (tanpa titik pusat) }.
     Return { svg, inner, viewBox, count }, atau null bila belum ada lengan yang digambar. */
  function sketch(T, o) {
    var lines = {}, names = [];
    (o.names || []).forEach(function (n) {
      var p = o.paths && o.paths[n];
      if (p && p.length) { lines[n] = smooth([[0, 0]].concat(p.map(function (q) { return toUnits(o.center, q); })), 2).slice(1); names.push(n); }
    });
    if (!names.length || !T || !T.curveGeo) return null;
    var G = T.curveGeo(names, lines, RAD), roads = {}, ext = 0;
    G.names.forEach(function (a) {
      var pts = clip(G.geo[a].center, RAD.end);
      roads[a] = pts;
      pts.forEach(function (p) { ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1])); });
    });
    var mk = markup(roads), half = Math.max(120, Math.ceil(ext + 46)), s = '', vb = [-half, -half, half * 2, half * 2].join(' ');
    s += '<rect x="' + (-half) + '" y="' + (-half) + '" width="' + half * 2 + '" height="' + half * 2 + '" rx="14" fill="#eef1f6"/>';
    s += mk.under + mk.marks;
    (o.names || []).forEach(function (a, i) {
      if (!roads[a]) return;
      var b = along(roads[a], Math.min(RAD.end, Math.max(RAD.stop + 60, 0))), r = Math.max(15, Math.round(half * 0.085));
      s += '<g transform="translate(' + f(b.x) + ' ' + f(b.y) + ')"><circle r="' + r + '" fill="#0d1033" stroke="#fff" stroke-width="2"/>' +
        '<text y="' + f(r * 0.36) + '" text-anchor="middle" font-size="' + f(r * 1.1) + '" font-weight="700" fill="#fff">' + (i + 1) + '</text></g>';
    });
    return {
      inner: s, viewBox: vb, count: G.names.length,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" class="road-illus-svg" viewBox="' + vb + '" role="img" aria-label="Ilustrasi persimpangan hasil generate dari lengan yang digambar">' + s + '</svg>'
    };
  }

  return { RAD: RAD, M_PER_UNIT: M_PER_UNIT, toUnits: toUnits, along: along, clip: clip, smooth: smooth, extend: extend, markup: markup, sketch: sketch };
});
