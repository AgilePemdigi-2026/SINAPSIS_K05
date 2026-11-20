/* SINAPSIS - deteksi jumlah lengan persimpangan dari data jalan OpenStreetMap (Overpass API).
   Fungsi inti `detect` murni (tanpa jaringan/DOM) sehingga bisa diuji di Node.
   Lengan dipetakan ke 4 arah mata angin (peta selalu utara-di-atas), sama dengan nama jalur SINAPSIS. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SinapsisArms = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var ORDER = ['Utara', 'Selatan', 'Timur', 'Barat'];
  var ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  var RADIUS_M = 45;      // jarak pencarian jalan dari titik klik
  var PATH_M = 60;        // panjang garis lengan yang digambar otomatis
  var WALK_M = 25;        // panjang telusur sepanjang jalan untuk menentukan arah lengan
  var HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|' +
                 'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

  function query(lat, lon) {
    return '[out:json][timeout:10];way(around:' + RADIUS_M + ',' + lat + ',' + lon + ')[highway~"^(' + HIGHWAYS + ')$"];out geom tags;';
  }

  function meters(a, b) {
    var k = Math.cos(a.lat * Math.PI / 180);
    return { dx: (b.lon - a.lon) * k * 111320, dy: (b.lat - a.lat) * 110540 };
  }
  function dist(a, b) { var m = meters(a, b); return Math.sqrt(m.dx * m.dx + m.dy * m.dy); }
  function bearing(a, b) {
    var m = meters(a, b), deg = Math.atan2(m.dx, m.dy) * 180 / Math.PI;
    return (deg + 360) % 360;
  }
  function bucket(deg) {
    if (deg >= 315 || deg < 45) return 'Utara';
    if (deg < 135) return 'Timur';
    if (deg < 225) return 'Selatan';
    return 'Barat';
  }

  /* Titik-titik geometri jalan sepanjang walk (tanpa titik awal), untuk menggambar lengan otomatis. */
  function walkPts(geom, pos, step) {
    var start = geom[pos], cur = pos, out = [];
    while (true) {
      var nxt = cur + step;
      if (nxt < 0 || nxt >= geom.length) break;
      cur = nxt; out.push([geom[cur].lat, geom[cur].lon]);
      if (dist(start, geom[cur]) >= PATH_M) break;
    }
    return out;
  }

  /* Telusuri satu arah sepanjang jalan dari indeks `pos` sampai WALK_M atau ujung jalan. */
  function walk(geom, pos, step) {
    var start = geom[pos], cur = pos, last = null;
    while (true) {
      var nxt = cur + step;
      if (nxt < 0 || nxt >= geom.length) break;
      last = geom[nxt]; cur = nxt;
      if (dist(start, last) >= WALK_M) break;
    }
    return last && dist(start, last) > 1 ? last : null;
  }

  /* elements: hasil Overpass (`out geom`), lat/lon: titik klik.
     Return { found, count, arms:[...urut kanonik], names:{arah:nama}, junction:{lat,lon} }. */
  function detect(elements, lat, lon) {
    var click = { lat: lat, lon: lon };
    var ways = (elements || []).filter(function (e) { return e.type === 'way' && e.geometry && e.geometry.length > 1 && e.nodes; });
    if (!ways.length) return { found: false, count: 0, arms: [], names: {}, rays: [], junction: null };

    var nodes = {}; // id -> { pt, occ:[{w,pos}] }
    ways.forEach(function (w, wi) {
      w.nodes.forEach(function (id, pos) {
        var g = w.geometry[pos];
        if (!g) return;
        var n = nodes[id] || (nodes[id] = { pt: { lat: g.lat, lon: g.lon }, occ: [] });
        n.occ.push({ w: wi, pos: pos });
      });
    });

    function mergeRays(list) {   // gabungkan arah yang berdekatan (< 25 derajat), mis. dua arah jalan bermedian
      var sorted = list.slice().sort(function (a, b) { return a.b - b.b; }), groups = [];
      sorted.forEach(function (r) {
        var g = groups[groups.length - 1];
        if (g && r.b - g.last < 25) { g.items.push(r); g.last = r.b; } else groups.push({ items: [r], last: r.b });
      });
      if (groups.length > 1 && (groups[0].items[0].b + 360) - groups[groups.length - 1].last < 25) {
        var tail = groups.pop(); groups[0].items = tail.items.concat(groups[0].items);
      }
      return groups.map(function (g) {
        var x = 0, y = 0, name = null, longest = [];
        g.items.forEach(function (r) {
          if (r.pts && r.pts.length > longest.length) longest = r.pts; x += Math.sin(r.b * Math.PI / 180); y += Math.cos(r.b * Math.PI / 180); if (!name && r.name) name = r.name; });
        return { bearing: Math.round(((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360 * 10) / 10, name: name, path: longest };
      }).sort(function (a, b) { return a.bearing - b.bearing; });
    }
    function armsOf(n) {
      var out = {}, names = {}, rays = [];
      n.occ.forEach(function (o) {
        var w = ways[o.w];
        [-1, 1].forEach(function (step) {
          var far = walk(w.geometry, o.pos, step);
          if (!far) return;
          var deg = bearing(n.pt, far), b = bucket(deg);
          rays.push({ b: deg, name: w.tags && w.tags.name, pts: walkPts(w.geometry, o.pos, step) });
          out[b] = true;
          if (!names[b] && w.tags && w.tags.name) names[b] = w.tags.name;
        });
      });
      return { arms: ORDER.filter(function (a) { return out[a]; }), names: names, rays: mergeRays(rays) };
    }

    var best = null, bestD = Infinity, fallback = null, fallbackD = Infinity;
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id], d = dist(click, n.pt);
      if (d < fallbackD) { fallbackD = d; fallback = n; }
      if (n.occ.length < 2) return; // simpul simpang dipakai >= 2 jalan; jalan tunggal paling banyak 2 lengan (bukan simpang)
      var a = armsOf(n);
      if (a.arms.length >= 3 && d < bestD) { bestD = d; best = { n: n, a: a }; }
    });
    // Hanya simpul dengan >= 3 lengan yang dianggap persimpangan; ruas jalan biasa (2 lengan) tidak.
    if (!best) return { found: false, count: fallback ? armsOf(fallback).arms.length : 0, arms: [], names: {}, rays: [], junction: null };
    return { found: true, count: best.a.arms.length, arms: best.a.arms, names: best.a.names, rays: best.a.rays, junction: best.n.pt };
  }

  function timeoutFetch(url, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* Ambil data jalan dari Overpass (coba server cadangan bila gagal), lalu deteksi. Promise -> hasil detect(). */
  function fetchArms(lat, lon, opts) {
    var endpoints = (opts && opts.endpoints) || ENDPOINTS;
    var q = encodeURIComponent(query(lat, lon));
    function attempt(i) {
      return timeoutFetch(endpoints[i] + '?data=' + q, 9000).then(function (json) {
        return detect(json.elements, lat, lon);
      }).catch(function (e) {
        if (i + 1 < endpoints.length) return attempt(i + 1);
        throw e;
      });
    }
    return attempt(0);
  }

  return { ORDER: ORDER, detect: detect, fetchArms: fetchArms, query: query, bucket: bucket };
});
