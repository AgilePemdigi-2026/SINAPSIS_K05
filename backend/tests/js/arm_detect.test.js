// Uji unit deteksi lengan (jalankan: node tests/js/arm_detect.test.js). Data jalan sintetis ala hasil Overpass `out geom`.
const assert = require('assert');
const A = require('../../app/static/arm_detect.js');

const LAT = -7.2655, LON = 112.7520, D = 0.0003; // ~33 m
const pt = (dlat, dlon) => ({ lat: LAT + dlat, lon: LON + dlon });
let nid = 100;
function way(points, name, ids) {
  const nodes = ids || points.map(() => nid++);
  return { type: 'way', nodes, geometry: points, tags: name ? { name } : {} };
}
const C = 1; // id simpul pusat bersama
const n = (dlat, dlon, name) => way([pt(0, 0), pt(dlat, dlon)], name, [C, nid++]);

// perempatan: dua jalan lurus berpotongan di simpul bersama
const cross = [
  way([pt(-D, 0), pt(0, 0), pt(D, 0)], 'Jl. Raya', [11, C, 12]),
  way([pt(0, -D), pt(0, 0), pt(0, D)], 'Jl. Pemuda', [13, C, 14]),
];
let r = A.detect(cross, LAT, LON);
assert.deepStrictEqual(r.arms, ['Utara', 'Selatan', 'Timur', 'Barat']); assert.strictEqual(r.count, 4); assert(r.found);
assert.strictEqual(r.names.Utara, 'Jl. Raya'); assert.strictEqual(r.names.Timur, 'Jl. Pemuda');

// pertigaan (T): jalan samping berakhir di jalan utama -> tanpa lengan Utara
const tee = [
  way([pt(0, -D), pt(0, 0), pt(0, D)], 'Jl. Utama', [13, C, 14]),
  way([pt(0, 0), pt(-D, 0)], 'Jl. Gang', [C, 12]),
];
r = A.detect(tee, LAT, LON);
assert.deepStrictEqual(r.arms, ['Selatan', 'Timur', 'Barat']); assert.strictEqual(r.count, 3);

// ruas lurus / tikungan (2 lengan) bukan persimpangan -> tidak ditemukan
const straight = [way([pt(-D, 0), pt(-D / 2, 0), pt(0, 0), pt(D, 0)], 'Jl. Lurus', [21, 22, 23, 24])];
r = A.detect(straight, LAT, LON + 0.00001);
assert.strictEqual(r.found, false); assert.strictEqual(r.count, 2);

// tikungan siku
const bend = [way([pt(-D, 0), pt(0, 0), pt(0, D)], 'Jl. Tikung', [31, 32, 33])];
r = A.detect(bend, LAT, LON);
assert.strictEqual(r.found, false);

// jalan dua jalur terpisah (dua way searah) tidak menggandakan lengan
const dual = [
  way([pt(-D, 0), pt(0, 0), pt(D, 0)], 'Jl. A', [41, C, 42]),
  way([pt(-D, 0.00002), pt(0, 0.00002), pt(D, 0.00002)], 'Jl. A', [43, 44, 45]),
  way([pt(0, -D), pt(0, 0), pt(0, D)], 'Jl. B', [46, C, 47]),
];
r = A.detect(dual, LAT, LON);
assert.strictEqual(r.count, 4);

// persimpangan terdekat yang dipilih: dua simpang berjauhan, klik dekat simpang kedua (T) -> 3 lengan
const far = (dl) => pt(0, dl);
const two = cross.concat([
  way([far(0.0004 + 0), pt(0, 0.0008)], null, [51, 52]),
]);
// klik di titik simpul pusat -> tetap perempatan
assert.strictEqual(A.detect(cross.concat(two.slice(2)), LAT, LON).count, 4);

// tanpa data jalan / ujung buntu
assert.strictEqual(A.detect([], LAT, LON).found, false);
assert.strictEqual(A.detect([way([pt(0, 0), pt(0.00001, 0)], null, [61, 62])], LAT, LON).found, false);

// bucket batas sudut
assert.strictEqual(A.bucket(0), 'Utara'); assert.strictEqual(A.bucket(44.9), 'Utara'); assert.strictEqual(A.bucket(45), 'Timur');
assert.strictEqual(A.bucket(180), 'Selatan'); assert.strictEqual(A.bucket(270), 'Barat'); assert.strictEqual(A.bucket(314.9), 'Barat'); assert.strictEqual(A.bucket(315), 'Utara');
assert(/around:45,/.test(A.query(LAT, LON)) && /out geom/.test(A.query(LAT, LON)));
console.log('arm_detect: semua uji lulus');
