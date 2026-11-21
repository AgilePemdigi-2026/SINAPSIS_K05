// Uji unit ilustrasi jalan hasil generate (jalankan: node tests/js/road_illus.test.js).
const assert = require('assert');
const I = require('../../app/static/road_illus.js');
const T = require('../../app/static/traffic_anim.js');

const LAT = -7.2655, LON = 112.752, C = { lat: LAT, lon: LON };
const M_LAT = 1 / 111132, M_LON = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const ll = (x, y) => [LAT + y * M_LAT, LON + x * M_LON];   // meter (timur, utara) -> [lat, lon]
const line = (...pts) => pts.map(p => ll(p[0], p[1]));

// toUnits: 28 m ke timur = 100 unit ke kanan; 28 m ke utara = 100 unit ke atas (y negatif)
const u = I.toUnits(C, ll(28, 28));
assert(Math.abs(u[0] - 100) < 0.5 && Math.abs(u[1] + 100) < 0.5, 'toUnits ' + u);

// clip / along
const pl = [[0, 0], [100, 0], [100, 100]];
assert.deepStrictEqual(I.clip(pl, 50), [[0, 0], [50, 0]]);
assert.strictEqual(I.clip(pl, 500).length, 3);
const a = I.along(pl, 150);
assert(Math.abs(a.x - 100) < 1e-6 && Math.abs(a.y - 50) < 1e-6 && Math.abs(a.dy - 1) < 1e-6);

// markup: aspal + marka + garis henti, tanpa NaN
const roads = { A: [[0, 0], [0, -240]], B: [[0, 0], [240, 0]], C: [[0, 0], [0, 240]] };
const mk = I.markup(roads);
assert(mk.under.includes('<circle') && (mk.under.match(/<polyline/g) || []).length === 6, 'tepi + aspal per lengan');
assert((mk.marks.match(/<line/g) || []).length === 3 && (mk.marks.match(/<polyline/g) || []).length === 3);
assert(!/NaN|undefined/.test(mk.under + mk.marks));
// garis henti di lengan A (keluar ke atas): lajur masuk = kanan arah keluar (timur, +x) pada y = -stop
assert(/<line x1="2" y1="-52" x2="21" y2="-52"/.test(mk.marks), mk.marks.slice(0, 400));
// jalan lebih panjang dari end dipotong
assert(!/y="-300"/.test(I.markup({ A: [[0, 0], [0, -900]] }).under) && /-240/.test(I.markup({ A: [[0, 0], [0, -900]] }).under));
assert.strictEqual(I.markup({}).under.includes('<polyline'), false);

// sketch: perempatan miring yang digambar tangan
const names = ['Lengan 1', 'Lengan 2', 'Lengan 3', 'Lengan 4'];
const paths = {
  'Lengan 1': line([-10, 3], [-40, 8], [-80, 20]),
  'Lengan 2': line([2, 15], [4, 50], [-5, 90]),
  'Lengan 3': line([3, -15], [6, -50], [10, -90]),
  'Lengan 4': line([12, 8], [35, 25], [70, 60]),
};
const sk = I.sketch(T, { center: C, names, paths });
assert(sk && sk.count === 4 && /^-\d+ -\d+ \d+ \d+$/.test(sk.viewBox));
assert(sk.svg.startsWith('<svg') && sk.svg.endsWith('</svg>') && !/NaN|undefined/.test(sk.svg));
assert((sk.inner.match(/font-weight="700"/g) || []).length === 4, 'lencana nomor 1-4');
['>1<', '>2<', '>3<', '>4<'].forEach(t => assert(sk.inner.includes(t)));

// lengan yang belum digambar tidak membuat error; nomor tetap sesuai urutan nama
const part = I.sketch(T, { center: C, names, paths: { 'Lengan 2': paths['Lengan 2'] } });
assert(part && part.count === 1 && part.inner.includes('>2<') && !part.inner.includes('>1<'));
assert.strictEqual(I.sketch(T, { center: C, names, paths: {} }), null);
assert.strictEqual(I.sketch(null, { center: C, names, paths }), null);
assert.strictEqual(I.sketch(T, { center: C, names: [], paths }), null);

// 5 dan 8 lengan menyebar
const many = n => { const p = {}, nm = []; for (let i = 0; i < n; i++) { const th = i * 2 * Math.PI / n, nmx = 'Lengan ' + (i + 1); nm.push(nmx); p[nmx] = line([Math.sin(th) * 15, Math.cos(th) * 15], [Math.sin(th) * 60, Math.cos(th) * 60]); } return I.sketch(T, { center: C, names: nm, paths: p }); };
assert.strictEqual(many(5).count, 5);
assert.strictEqual(many(8).count, 8);

// viewBox membesar bila lengan digambar sangat panjang tetapi isi dipotong di end
const longSk = I.sketch(T, { center: C, names: ['Lengan 1'], paths: { 'Lengan 1': line([0, 10], [0, 300]) } });
assert(/ 3\d\d \d+$/.test(longSk.viewBox) || longSk.viewBox.split(' ')[2] >= 240);

// smooth: titik awal/akhir tetap, sudut siku menjadi lengkung (tidak ada titik di sudut aslinya)
const sm = I.smooth([[0, 0], [100, 0], [100, 100]], 2);
assert.deepStrictEqual(sm[0], [0, 0]); assert.deepStrictEqual(sm[sm.length - 1], [100, 100]);
assert(sm.length > 3 && !sm.some(p => p[0] === 100 && p[1] === 0), 'sudut dihaluskan');
assert(sm.every(p => p[0] <= 100 + 1e-9 && p[1] >= -1e-9), 'hasil tidak keluar dari cangkang titik');
assert.deepStrictEqual(I.smooth([[0, 0], [50, 0]], 2), [[0, 0], [50, 0]], 'garis 2 titik tidak berubah');
assert.deepStrictEqual(I.smooth([[0, 0], [10, 0], [20, 0]], 2).filter(p => p[1] !== 0), [], 'garis lurus tetap lurus');

// extend: perpanjang lurus searah segmen terakhir; tidak memotong yang sudah cukup panjang
const ex = I.extend([[0, 0], [0, -100]], 500);
assert.deepStrictEqual(ex[ex.length - 1].map(Math.round), [0, -500]);
assert.strictEqual(I.extend([[0, 0], [0, -900]], 500).length, 2);
const ex2 = I.extend([[0, 0], [30, 0], [30, 0]], 100);   // segmen terakhir nol panjang -> pakai segmen sebelumnya
assert.deepStrictEqual(ex2[ex2.length - 1].map(Math.round), [100, 0]);
assert.deepStrictEqual(I.extend([[5, 5]], 100), [[5, 5]]);

// sketch dengan tikungan: garis dibelokkan -> hasil beda dari garis lurus dan tanpa NaN
const bent = I.sketch(T, { center: C, names: ['Lengan 1'], paths: { 'Lengan 1': line([0, 20], [0, 50], [30, 70], [60, 70]) } });
const straight = I.sketch(T, { center: C, names: ['Lengan 1'], paths: { 'Lengan 1': line([0, 20], [60, 70]) } });
assert(bent && straight && bent.inner !== straight.inner && !/NaN/.test(bent.svg));

console.log('road_illus.test.js OK');
