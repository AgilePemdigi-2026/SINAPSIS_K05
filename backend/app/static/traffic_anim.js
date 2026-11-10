/* SINAPSIS: simulasi animasi lalu lintas untuk diagram dashboard.
   Murni logika (tanpa DOM) agar bisa diuji di Node. Aturan utamanya:
   - 1 mobil/motor di layar = 1 kendaraan pada data (jumlah_kendaraan), tidak ada ikon "mewakili banyak".
   - Lampu merah: antrean berhenti. Lampu hijau: kendaraan dilepas satu per satu melewati persimpangan.
   - Antrean selalu diisi/dikurangi sampai sama dengan data terbaru.
   - Lintasan mengikuti lengan yang ada (pertigaan tidak punya lengan yang hilang). Lalu lintas Indonesia: sisi kiri. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SinapsisTraffic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var ORDER = ['Utara', 'Selatan', 'Timur', 'Barat'];
  var OPPOSITE = { Utara: 'Selatan', Selatan: 'Utara', Timur: 'Barat', Barat: 'Timur' };
  var HEAD = 12;            // jarak mobil terdepan dari garis henti (px)
  var MAX_SHOWN = 24;       // batas tampilan per lengan (kapasitas data 20)
  var SPEED_Q = 90;         // kecepatan merapat ke antrean (px/dtk)
  var SPEED_X = 120;        // kecepatan maksimum melintasi persimpangan
  var HEADWAY = 0.85;       // jeda pelepasan normal pada lampu hijau (dtk)
  var HEADWAY_FAST = 0.35;  // saat antrean lebih panjang dari data
  var SPAWN_GAP = 0.3;      // jeda kedatangan kendaraan baru (dtk)
  var FADE_S = 0.4;

  // Geometri 760 x 560. heading = arah gerak kendaraan masuk; stop = titik garis henti pada lajur masuk;
  // entry = batas lajur masuk dengan kotak persimpangan; out = lajur keluar {start, dir, end}; L = panjang lengan dari garis henti.
  var GEO = {
    Utara:   { heading: [0, 1],  stop: [404, 212], L: 212, entry: [404, 232], out: { start: [356, 232], dir: [0, -1], end: [356, -30] } },
    Selatan: { heading: [0, -1], stop: [356, 348], L: 212, entry: [356, 328], out: { start: [404, 328], dir: [0, 1],  end: [404, 590] } },
    Timur:   { heading: [-1, 0], stop: [450, 304], L: 310, entry: [428, 304], out: { start: [428, 256], dir: [1, 0],  end: [790, 256] } },
    Barat:   { heading: [1, 0],  stop: [312, 256], L: 312, entry: [332, 256], out: { start: [332, 304], dir: [-1, 0], end: [-30, 304] } }
  };
  var CAR_COLORS = ['#f3f3ef', '#dcdcd7', '#b9c4d0', '#e7d8a2', '#cdbcbc', '#c3d0c2', '#8fa8c8', '#d98c8c'];
  var MOTOR_COLORS = ['#2f3b52', '#5a2d2d', '#2d4a3e', '#6b5a2d'];

  function perp(h) { return [-h[1], h[0]]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function approach(cur, target, maxStep) { return cur + clamp(target - cur, -maxStep, maxStep); }
  function angleOf(dir) { return Math.atan2(dir[0], -dir[1]) * 180 / Math.PI; }  // 0 = menghadap atas layar

  /* Polyline lintasan dengan panjang kumulatif. Belokan memakai kurva Bezier kuadrat. */
  function makePath(points) {
    var cum = [0];
    for (var i = 1; i < points.length; i++) {
      var dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    return { pts: points, cum: cum, len: cum[cum.length - 1] };
  }
  function pathAt(path, s) {
    s = clamp(s, 0, path.len);
    var i = 1;
    while (i < path.pts.length - 1 && path.cum[i] < s) i++;
    var a = path.pts[i - 1], b = path.pts[i], seg = path.cum[i] - path.cum[i - 1] || 1, t = (s - path.cum[i - 1]) / seg;
    var dx = b[0] - a[0], dy = b[1] - a[1], n = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: a[0] + dx * t, y: a[1] + dy * t, dir: [dx / n, dy / n] };
  }

  /* Lintasan dari posisi mobil (d di belakang garis henti) -> melintasi persimpangan -> lajur keluar lengan tujuan. */
  function buildPath(from, to, d) {
    var g = GEO[from], o = GEO[to].out;
    var start = [g.stop[0] - g.heading[0] * d, g.stop[1] - g.heading[1] * d];
    var pts = [start, g.stop, g.entry];
    var turning = to !== OPPOSITE[from];
    if (!turning) {
      pts.push(o.start);
    } else {
      var ctrl = g.heading[0] === 0 ? [g.entry[0], o.start[1]] : [o.start[0], g.entry[1]];
      for (var k = 1; k <= 10; k++) {
        var t = k / 10, u = 1 - t;
        pts.push([u * u * g.entry[0] + 2 * u * t * ctrl[0] + t * t * o.start[0],
                  u * u * g.entry[1] + 2 * u * t * ctrl[1] + t * t * o.start[1]]);
      }
    }
    pts.push(o.end);
    return makePath(pts);
  }

  function Sim(arms, opts) {
    opts = opts || {};
    var self = this;
    this.arms = ORDER.filter(function (a) { return (arms || []).indexOf(a) >= 0; });
    this.seed = opts.seed || 20261109;
    this.nextId = 1;
    this.lanes = {};
    this.cars = [];
    this.arms.forEach(function (a) { self.lanes[a] = { name: a, q: [], target: 0, green: false, timer: 0, spawnT: 0, excessT: 0 }; });
  }

  Sim.prototype.rand = function () {  // LCG deterministik
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  };

  Sim.prototype.layout = function (lane) {
    var count = Math.max(lane.q.length, lane.target), cols = count > 10 ? 2 : 1;
    var rows = Math.max(1, Math.ceil(count / cols));
    var spacing = Math.min(21, (GEO[lane.name].L - HEAD - 8) / rows);
    return { cols: cols, spacing: spacing };
  };

  Sim.prototype.newCar = function (lane, d, lat) {
    var motor = this.rand() < 0.3;
    var car = { id: this.nextId++, lane: lane.name, kind: motor ? 'motor' : 'car', state: 'queue', d: d, lat: lat,
                w: motor ? 5 : 10, len: motor ? 11 : 16, alpha: 1, x: 0, y: 0, angle: angleOf(GEO[lane.name].heading), s: 0, t: 0, path: null };
    var palette = motor ? MOTOR_COLORS : CAR_COLORS;
    car.color = palette[Math.floor(this.rand() * palette.length)];
    this.cars.push(car);
    return car;
  };

  Sim.prototype.slot = function (lane, i) {
    var l = this.layout(lane);
    return { d: HEAD + Math.floor(i / l.cols) * l.spacing, lat: l.cols === 2 ? (i % 2 ? 6 : -6) : 0, spacing: l.spacing };
  };

  Sim.prototype.place = function (car) {
    var g = GEO[car.lane], p = perp(g.heading);
    car.x = g.stop[0] - g.heading[0] * car.d + p[0] * car.lat;
    car.y = g.stop[1] - g.heading[1] * car.d + p[1] * car.lat;
  };

  Sim.prototype.fit = function (car, spacing) { car.len = Math.min(car.kind === 'motor' ? 11 : 16, Math.max(6, spacing - 3)); };

  /* Data terbaru: { Utara: {n, green}, ... }. instant=true -> langsung rapi tanpa animasi kedatangan. */
  Sim.prototype.update = function (data, instant) {
    var self = this;
    this.arms.forEach(function (a) {
      var lane = self.lanes[a], d = data && data[a];
      lane.target = d ? clamp(Math.round(d.n || 0), 0, MAX_SHOWN) : 0;
      lane.green = !!(d && d.green);
    });
    if (instant) this.snap();
  };

  /* Susun ulang semua lengan sesuai target: tanpa kendaraan di tengah persimpangan, antrean pas. */
  Sim.prototype.snap = function () {
    var self = this;
    this.cars = this.cars.filter(function (c) { return c.state === 'queue'; });
    this.arms.forEach(function (a) {
      var lane = self.lanes[a];
      lane.q = lane.q.filter(function (c) { return self.cars.indexOf(c) >= 0; });
      while (lane.q.length > lane.target) { var gone = lane.q.pop(); self.cars.splice(self.cars.indexOf(gone), 1); }
      while (lane.q.length < lane.target) lane.q.push(self.newCar(lane, HEAD, 0));
      lane.q.forEach(function (c, i) { var s = self.slot(lane, i); c.d = s.d; c.lat = s.lat; self.fit(c, s.spacing); self.place(c); });
    });
  };

  Sim.prototype.pickExit = function (from) {
    var self = this, options = this.arms.filter(function (a) { return a !== from; });
    if (!options.length) return null;
    var weights = options.map(function (a) { return a === OPPOSITE[from] ? 3 : 1; });
    var total = weights.reduce(function (s, w) { return s + w; }, 0), r = this.rand() * total;
    for (var i = 0; i < options.length; i++) { r -= weights[i]; if (r <= 0) return options[i]; }
    return options[options.length - 1];
  };

  Sim.prototype.step = function (dt) {
    dt = clamp(dt, 0, 0.05);
    var self = this;
    this.arms.forEach(function (a) {
      var lane = self.lanes[a];
      lane.timer += dt; lane.spawnT += dt;
      var need = lane.target - lane.q.length;

      if (need > 0 && lane.spawnT >= SPAWN_GAP) {          // kendaraan baru datang dari tepi
        lane.spawnT = 0;
        var tail = self.slot(lane, lane.q.length);
        lane.q.push(self.newCar(lane, GEO[a].L + 14, tail.lat));
        need--;
      }
      if (need < 0 && !lane.green) {                       // data turun saat merah: kendaraan terakhir keluar lewat tepi
        lane.excessT += dt;
        if (lane.excessT >= (-need > 4 ? 0.1 : 0.4)) { lane.excessT = 0; var out = lane.q.pop(); out.state = 'fade'; }  // selisih besar: lebih cepat
      } else if (need >= 0) lane.excessT = 0;

      if (lane.green && lane.q.length) {                   // lepas kendaraan terdepan
        var head = lane.q[0], hw = lane.q.length > lane.target ? HEADWAY_FAST : HEADWAY;
        var exit = self.pickExit(a);
        if (exit && head.d <= HEAD + 2 && lane.timer >= hw) {
          lane.timer = 0; lane.q.shift();
          head.state = 'cross'; head.t = 0; head.s = 0; head.path = buildPath(a, exit, head.d);
        }
      }

      lane.q.forEach(function (c, i) {                     // merapat ke slot antrean
        var s = self.slot(lane, i);
        c.d = approach(c.d, s.d, SPEED_Q * dt);
        c.lat = approach(c.lat, s.lat, 40 * dt);
        c.len = approach(c.len, Math.min(c.kind === 'motor' ? 11 : 16, Math.max(6, s.spacing - 3)), 20 * dt);
        self.place(c);
      });
    });

    this.cars.forEach(function (c) {
      if (c.state === 'cross') {
        c.t += dt;
        c.s += Math.min(SPEED_X, 35 + 170 * c.t) * dt;
        c.lat = approach(c.lat, 0, 60 * dt);
        var p = pathAt(c.path, c.s), pp = perp(p.dir);
        c.x = p.x + pp[0] * c.lat; c.y = p.y + pp[1] * c.lat; c.angle = angleOf(p.dir);
        if (c.s >= c.path.len) c.state = 'gone';
      } else if (c.state === 'fade') {
        c.alpha -= dt / FADE_S;
        if (c.alpha <= 0) c.state = 'gone';
      }
    });
    this.cars = this.cars.filter(function (c) { return c.state !== 'gone'; });
  };

  /* Jumlah kendaraan yang sedang menunggu/mengantre per lengan (tanpa yang sedang melintas). */
  Sim.prototype.counts = function () {
    var out = {}, self = this;
    this.arms.forEach(function (a) { out[a] = self.lanes[a].q.length; });
    return out;
  };

  return { Sim: Sim, GEO: GEO, ORDER: ORDER, OPPOSITE: OPPOSITE, buildPath: buildPath, pathAt: pathAt, HEAD: HEAD, MAX_SHOWN: MAX_SHOWN };
});
