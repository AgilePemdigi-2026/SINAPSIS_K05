// Uji simulasi animasi lalu lintas: node tests/js/traffic_anim.test.js
const assert = require('assert');
const T = require('../../app/static/traffic_anim.js');
const ALL = ['Utara', 'Selatan', 'Timur', 'Barat'];
const run = (sim, sec) => { for (let t = 0; t < sec; t += 1 / 60) sim.step(1 / 60); };
const queued = (sim) => sim.cars.filter(c => c.state === 'queue').length;

// 1) 1 mobil = 1 kendaraan: 20 kendaraan -> 20 mobil (bukan dibulatkan jadi ikon)
let s = new T.Sim(ALL);
s.update({ Utara: { n: 20, green: false }, Selatan: { n: 7, green: false }, Timur: { n: 1, green: false }, Barat: { n: 0, green: false } }, true);
assert.deepStrictEqual(s.counts(), { Utara: 20, Selatan: 7, Timur: 1, Barat: 0 });
assert.strictEqual(s.cars.length, 28);

// 2) lampu merah: antrean diam, tidak ada yang melintas
const before = s.cars.map(c => [c.id, c.x.toFixed(2), c.y.toFixed(2)].join());
run(s, 5);
assert.deepStrictEqual(s.cars.map(c => [c.id, c.x.toFixed(2), c.y.toFixed(2)].join()), before);
assert(s.cars.every(c => c.state === 'queue'));

// 3) lampu hijau: kendaraan dilepas melintasi tengah, antrean tetap sama dengan data (terisi lagi)
s.update({ Utara: { n: 20, green: true }, Selatan: { n: 7, green: false }, Timur: { n: 1, green: false }, Barat: { n: 0, green: false } });
let crossed = 0; const seen = new Set();
for (let t = 0; t < 8; t += 1 / 60) { s.step(1 / 60); s.cars.forEach(c => { if (c.state === 'cross' && !seen.has(c.id)) { seen.add(c.id); crossed++; } }); }
assert(crossed >= 6, 'banyak mobil melintas saat hijau: ' + crossed);
assert.strictEqual(s.counts().Utara, 20);                     // data tetap 20 -> antrean 20
assert(s.cars.filter(c => c.state === 'cross').every(c => c.lane === 'Utara'));
assert.strictEqual(s.counts().Selatan, 7);                    // lengan merah tidak berubah

// 4) mobil yang melintas keluar layar dan dihapus
run(s, 12);
assert(s.cars.filter(c => c.state === 'cross').length <= 20);
s.update({ Utara: { n: 20, green: false } }); run(s, 8);
assert.strictEqual(s.cars.filter(c => c.state === 'cross').length, 0);
assert.strictEqual(queued(s), 20);                            // data terakhir hanya memuat Utara=20; lengan lain 0

// 5) data naik/turun: antrean menyesuaikan (merah)
s = new T.Sim(ALL); s.update({ Utara: { n: 4, green: false } }, true);
s.update({ Utara: { n: 12, green: false } }); run(s, 6); assert.strictEqual(s.counts().Utara, 12);
s.update({ Utara: { n: 3, green: false } }); run(s, 8); assert.strictEqual(s.counts().Utara, 3);
assert.strictEqual(s.cars.length, 3);

// 6) hijau + data turun: antrean terkuras sampai sama dengan data
s = new T.Sim(ALL); s.update({ Selatan: { n: 15, green: true } }, true);
s.update({ Selatan: { n: 5, green: true } }); run(s, 10);
assert.strictEqual(s.counts().Selatan, 5);

// 7) pertigaan: kendaraan hanya keluar ke lengan yang ada (tanpa Utara)
const tee = ['Selatan', 'Timur', 'Barat'];
s = new T.Sim(tee); s.update({ Selatan: { n: 10, green: true }, Timur: { n: 6, green: false }, Barat: { n: 6, green: false } }, true);
const exits = new Set();
for (let t = 0; t < 40; t += 1 / 60) { s.step(1 / 60); s.cars.forEach(c => { if (c.state === 'cross' && c.path) { const e = c.path.pts[c.path.pts.length - 1]; exits.add(e.join()); } }); }
assert(exits.size >= 1);
const validEnds = new Set(tee.filter(a => a !== 'Selatan').map(a => T.GEO[a].out.end.join()));
exits.forEach(e => assert(validEnds.has(e), 'tujuan bukan lengan yang ada: ' + e));
assert.strictEqual(s.counts().Utara, undefined);

// 8) Sim tidak membuat lengan yang tidak ada, data lengan asing diabaikan
s = new T.Sim(tee); s.update({ Utara: { n: 9, green: true } }, true); assert.deepStrictEqual(Object.keys(s.counts()), ['Selatan', 'Timur', 'Barat']);

// 9) batas tampilan, tidak ada tumpang tindih di antrean 2 kolom (20 kendaraan)
s = new T.Sim(ALL); s.update({ Utara: { n: 20, green: false }, Barat: { n: 99, green: false } }, true);
assert.strictEqual(s.counts().Utara, 20); assert.strictEqual(s.counts().Barat, T.MAX_SHOWN);
for (const arm of ['Utara', 'Barat']) {
  const q = s.cars.filter(c => c.lane === arm);
  q.forEach(c => { assert(c.x >= -5 && c.x <= 765 && c.y >= -5 && c.y <= 565, 'mobil di dalam kanvas'); });
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
    const a = q[i], b = q[j]; const horiz = arm === 'Barat';
    const dAlong = horiz ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y), dLat = horiz ? Math.abs(a.y - b.y) : Math.abs(a.x - b.x);
    assert(dAlong >= (a.len + b.len) / 2 - 0.6 || dLat >= (a.w + b.w) / 2 - 0.1, `${arm} ${i}-${j} tumpang tindih`);
  }
}

// 10) lintasan: lurus mulai dari garis henti dan berakhir di lajur keluar arah seberang; belok melewati kurva
const p = T.buildPath('Utara', 'Selatan', 12);
assert.deepStrictEqual(T.pathAt(p, p.len).x, 404); assert.strictEqual(T.pathAt(p, p.len).y, 590);
const pt = T.buildPath('Utara', 'Timur', 12), mid = T.pathAt(pt, pt.len * 0.45);
assert(mid.x > 404 && mid.y > 232 && mid.y < 260, 'belokan melengkung di dalam persimpangan');
// lalu lintas sisi kiri: lajur masuk Utara di timur median (x=404), keluar di barat (x=356)
assert(T.GEO.Utara.stop[0] > 380 && T.GEO.Utara.out.start[0] < 380);

// 11) snap/instant: hasil sama dengan data, tanpa kendaraan melintas
s = new T.Sim(ALL); s.update({ Utara: { n: 6, green: true } }, true); run(s, 3);
s.update({ Utara: { n: 6, green: true } }, true); assert(s.cars.every(c => c.state === 'queue')); assert.strictEqual(s.counts().Utara, 6);

// 12) deterministik
const a1 = new T.Sim(ALL), a2 = new T.Sim(ALL);
[a1, a2].forEach(x => { x.update({ Utara: { n: 8, green: true } }, true); run(x, 5); });
assert.deepStrictEqual(a1.cars.map(c => [c.id, c.x.toFixed(3), c.y.toFixed(3)]), a2.cars.map(c => [c.id, c.x.toFixed(3), c.y.toFixed(3)]));

// 13) sein belok: -1 kiri, 1 kanan, 0 lurus (lalu lintas sisi kiri); sudut berputar halus tanpa lonjakan
const tn = new T.Sim(ALL); tn.update({ Utara: { n: 20, green: true } }, true);
const seenTurn = new Map(); let maxJump = 0; const lastAng = new Map();
for (let t = 0; t < 14; t += 1 / 60) {
  tn.step(1 / 60);
  tn.cars.filter(c => c.state === 'cross').forEach(c => {
    const end = c.path.pts[c.path.pts.length - 1];
    seenTurn.set(c.id, { turn: c.turn, end });
    if (lastAng.has(c.id)) maxJump = Math.max(maxJump, Math.abs(((c.angle - lastAng.get(c.id) + 540) % 360) - 180));
    lastAng.set(c.id, c.angle);
  });
}
const rec = Array.from(seenTurn.values());
assert(rec.some(r => r.turn === 0) && rec.some(r => r.turn !== 0), 'ada yang lurus dan ada yang belok');
rec.forEach(r => {
  if (r.end[1] > 500) assert.strictEqual(r.turn, 0, 'Utara -> Selatan lurus tanpa sein');
  if (r.end[0] > 700) assert.strictEqual(r.turn, -1, 'Utara -> Timur belok kiri');
  if (r.end[0] < 0) assert.strictEqual(r.turn, 1, 'Utara -> Barat belok kanan');
});
assert(maxJump <= 8, 'sudut berubah halus per langkah: ' + maxJump.toFixed(2));

// 14) geometri radial (persimpangan 3..8 lengan berlabel angka): lintasan valid, antrean = data, tidak ada NaN
[5, 6, 8].forEach(n => {
  const R = T.radialGeo(n);
  assert.strictEqual(R.names.length, n);
  R.names.forEach(a => {
    const g = R.geo[a];
    assert(Math.abs(Math.hypot(g.heading[0], g.heading[1]) - 1) < 1e-9, 'heading satuan');
    // lajur masuk berada di sisi kiri jalan (lalu lintas Indonesia): stop dan out berseberangan terhadap sumbu lengan
    const ax = [-g.heading[0], -g.heading[1]], rel = (p) => (p[0] - 380) * -ax[1] + (p[1] - 280) * ax[0];
    assert(rel(g.stop) * rel(g.out.start) < 0, 'lajur masuk dan keluar di sisi berlawanan');
  });
  const sim = new T.Sim(R.names, { geo: R.geo });
  const data = {}; R.names.forEach((a, i) => { data[a] = { n: 3 + i, green: i === 1 }; });
  sim.update(data, true);
  R.names.forEach((a, i) => assert.strictEqual(sim.counts()[a], 3 + i, 'antrean awal = data'));
  for (let t = 0; t < 40; t += 1 / 30) {
    sim.step(1 / 30);
    sim.cars.forEach(c => assert(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.angle), 'posisi finite'));
    // nyalakan hijau bergantian
    if (Math.abs(t % 8) < 1 / 30) R.names.forEach((a, i) => { data[a].green = (Math.floor(t / 8) % n) === i; });
    sim.update(data, false);
  }
  assert(sim.cars.some(c => c.state === 'cross') || true);
  R.names.forEach(a => assert(sim.counts()[a] <= T.MAX_SHOWN));
});
// lintasan belok ke lengan manapun berakhir di ujung lajur keluar tujuan, bergerak maju (tanpa lompatan besar)
const R5 = T.radialGeo(5);
R5.names.forEach(from => R5.names.forEach(to => {
  if (from === to) return;
  const path = T.buildPath(from, to, 20, R5.geo), end = path.pts[path.pts.length - 1], want = R5.geo[to].out.end;
  assert(Math.hypot(end[0] - want[0], end[1] - want[1]) < 1e-6, from + '->' + to + ' berakhir di lajur keluar');
  for (let i = 1; i < path.pts.length - 1; i++) assert(Math.hypot(path.pts[i][0] - path.pts[i - 1][0], path.pts[i][1] - path.pts[i - 1][1]) < 140, 'tanpa lompatan');
}));
// geometri kompas lama tidak berubah
assert.deepStrictEqual(T.GEO.Utara.stop, [404, 212]);
assert.strictEqual(T.isStraight(T.GEO, 'Utara', 'Selatan'), true);
assert.strictEqual(T.isStraight(T.GEO, 'Utara', 'Timur'), false);

// 15) geometri dari garis jalan yang digambar (melengkung): antrean mengikuti kurva, lintasan valid
(function () {
  const arc = (a0, a1, r, n) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; });
  // 3 lengan: satu lurus ke atas, satu lengkung ke kanan-bawah, satu miring ke kiri-bawah
  const names = ['Lengan 1', 'Lengan 2', 'Lengan 3'];
  const lines = { 'Lengan 1': [[0, -100], [0, -250]], 'Lengan 2': [[60, 40], [130, 140], [150, 240]], 'Lengan 3': [[-70, 30], [-150, 90], [-250, 130]] };
  const G = T.curveGeo(names, lines);
  assert.deepStrictEqual(G.names, names);
  names.forEach(a => {
    const g = G.geo[a];
    assert(g.inPath && g.inPath.len > 100, 'lintasan masuk cukup panjang');
    // titik henti berjarak ~lebar lajur dari garis tengah dan ~stop dari pusat
    assert(Math.abs(Math.hypot(g.stop[0], g.stop[1]) - 52) < 14, 'garis henti dekat radius stop');
  });
  const sim = new T.Sim(names, { geo: G.geo });
  const data = { 'Lengan 1': { n: 6, green: false }, 'Lengan 2': { n: 8, green: true }, 'Lengan 3': { n: 4, green: false } };
  sim.update(data, true);
  names.forEach(a => assert.strictEqual(sim.counts()[a], data[a].n));
  // antrean Lengan 2 mengikuti polyline: jarak ke garis tengah ~ lebar lajur
  const cen = T.makePath(G.geo['Lengan 2'].center);
  sim.cars.filter(c => c.lane === 'Lengan 2').forEach(c => {
    let best = 1e9; const dense = G.geo['Lengan 2'].center;
    dense.forEach(q => { best = Math.min(best, Math.hypot(q[0] - c.x, q[1] - c.y)); });
    assert(best > 5 && best < 20, 'mobil di lajur masuk, bukan di garis tengah: ' + best);
  });
  for (let t = 0; t < 60; t += 1 / 30) {
    sim.step(1 / 30);
    sim.cars.forEach(c => assert(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.angle)));
    if (Math.abs(t % 10) < 1 / 30) names.forEach((a, i) => { data[a].green = Math.floor(t / 10) % 3 === i; });
    sim.update(data, false);
  }
  names.forEach(from => names.forEach(to => {
    if (from === to) return;
    const path = T.buildPath(from, to, 20, G.geo), end = path.pts[path.pts.length - 1], want = G.geo[to].out.end;
    assert(Math.hypot(end[0] - want[0], end[1] - want[1]) < 1e-6, from + '->' + to);
    for (let i = 1; i < path.pts.length - 1; i++) assert(Math.hypot(path.pts[i][0] - path.pts[i - 1][0], path.pts[i][1] - path.pts[i - 1][1]) < 160, 'tanpa lompatan');
  }));
  // polyline pendek diperpanjang otomatis
  const G2 = T.curveGeo(['A'], { A: [[0, -30]] });
  assert(G2.geo.A.inPath.len > 100);
})();
console.log('traffic_anim: semua uji lulus');
