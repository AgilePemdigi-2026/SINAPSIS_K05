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
console.log('traffic_anim: semua uji lulus');
