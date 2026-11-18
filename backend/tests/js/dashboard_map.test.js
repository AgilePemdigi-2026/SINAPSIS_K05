// Uji fungsi murni peta GIS dashboard: node tests/js/dashboard_map.test.js
const assert = require('assert');
const M = require('../../app/static/dashboard_map.js');

const items = [
  { id_persimpangan: 1, nama_lokasi: 'Simpang Gubeng', status: 'Lancar', latitude: -7.2655, longitude: 112.752 },
  { id_persimpangan: 2, nama_lokasi: 'Simpang Pemuda', status: 'Padat', latitude: -7.2625, longitude: 112.7455 },
  { id_persimpangan: 3, nama_lokasi: 'Simpang Raya', status: 'Kritis', latitude: -7.2895, longitude: 112.739 },
  { id_persimpangan: 4, nama_lokasi: 'Tanpa Koordinat', status: 'Lancar', latitude: null, longitude: null },
];

// warna status
assert.strictEqual(M.colorFor('Kritis'), '#b3112b');
assert.strictEqual(M.colorFor('Lancar'), '#2f7d4a');
assert.strictEqual(M.colorFor('status asing'), M.COLORS['Belum ada data']);

// koordinat
assert.strictEqual(M.fmtCoord(-7.26551, 112.75199), '-7.2655, 112.7520');
assert.strictEqual(M.fmtCoord(null, null), '—');
assert.strictEqual(M.hasGeo(items[0]), true);
assert.strictEqual(M.hasGeo(items[3]), false);
assert.strictEqual(M.hasGeo({ latitude: NaN, longitude: 1 }), false);

// jalur koridor mengikuti urutan, melewati titik tanpa koordinat dan id yang tidak ada
const pts = M.corridorLatLngs({ urutan: [3, 1, 4, 99, 2] }, items);
assert.deepStrictEqual(pts, [[-7.2895, 112.739], [-7.2655, 112.752], [-7.2625, 112.7455]]);
assert.deepStrictEqual(M.corridorLatLngs({ urutan: [] }, items), []);

// tanda tangan penanda: berubah hanya bila tampilan berubah (agar ikon tidak dibuat ulang tiap detik)
const a = Object.assign({ koridor_hijau: false, koridor: null }, items[0]);
assert.strictEqual(M.markerSig(a, false), M.markerSig(Object.assign({}, a, { jumlah_kendaraan: 99 }), false));
assert.notStrictEqual(M.markerSig(a, false), M.markerSig(a, true));
assert.notStrictEqual(M.markerSig(a, false), M.markerSig(Object.assign({}, a, { status: 'Kritis' }), false));
assert.notStrictEqual(M.markerSig(a, false), M.markerSig(Object.assign({}, a, { koridor_hijau: true, koridor: { urutan: 2 } }), false));

// ringkasan status
assert.deepStrictEqual(M.summary(items), { 'Lancar': 2, 'Padat': 1, 'Kritis': 1, 'Sensor Offline': 0, 'Belum ada data': 0 });

// teks koridor
const t = M.corridorText({ emergency_id: 'EMG-1', jenis_kendaraan: 'Ambulans', urutan: [1, 3], tidak_terpetakan: ['SIMPANG-09'] }, items);
assert.strictEqual(t, 'EMG-1 · Ambulans · Simpang Gubeng → Simpang Raya (tidak dikenali: SIMPANG-09)');
assert.ok(/rute belum terpetakan/.test(M.corridorText({ emergency_id: 'E', urutan: [] }, items)));

console.log('dashboard_map: semua uji lulus');
