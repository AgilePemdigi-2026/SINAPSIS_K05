/* SINAPSIS — Dashboard Pemantauan Lalu Lintas (F2). HTML/CSS/JS murni, tanpa framework. */
(function () {
  "use strict";

  var API_DASHBOARD = "/api/monitoring/dashboard";
  var API_REFRESH = "/api/monitoring/refresh";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var BULAN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  // Ambang tampilan (mengikuti backend: Padat >= 50% kapasitas jalur, Kritis >= 85%)
  var PADAT_PCT = 50,
    KRITIS_PCT = 85;

  var state = {
    data: null,
    selected: null,
    busy: false,
    timer: null,
    toastTimer: null,
    ws: null,
    wsConnected: false,
    wsRetry: null,
    loaded: false,
    gis: null,
    view: "anim",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      n.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ---------- indikator memuat (skeleton) ---------- */
  function skel(cls) {
    return el("div", "skel " + cls);
  }

  function showSkeleton() {
    var main = $("traffic-density-map");
    if (main) main.setAttribute("aria-busy", "true");
    var kp = $("kpis");
    clear(kp);
    for (var i = 0; i < 5; i++) {
      var c = el("div", "kpi kpi-skel");
      c.appendChild(skel("skel-line w40"));
      c.appendChild(skel("skel-line big w60"));
      c.appendChild(skel("skel-line w80"));
      kp.appendChild(c);
    }
    var dg = $("diagram");
    clear(dg);
    dg.appendChild(skel("skel-diagram"));
    dg.appendChild(el("p", "skel-label", "Memuat data persimpangan…"));
    var sl = $("statusList");
    clear(sl);
    for (var j = 0; j < 5; j++) sl.appendChild(skel("skel-row"));
    var gl = $("gisList");
    if (gl) {
      clear(gl);
      for (var g = 0; g < 5; g++) gl.appendChild(skel("skel-row"));
    }
    var gm = $("gisMap");
    if (gm) gm.classList.add("loading");
    var tb = $("telemetryBody");
    clear(tb);
    for (var r = 0; r < 4; r++) {
      var tr = el("tr", "skel-tr");
      for (var t = 0; t < 8; t++) {
        var td = el("td");
        td.appendChild(skel("skel-line"));
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    }
    var pp = $("predPanel");
    clear(pp);
    pp.appendChild(skel("skel-line w80"));
    pp.appendChild(skel("skel-line w60"));
    pp.appendChild(skel("skel-line w80"));
  }

  function endSkeleton(failed) {
    var main = $("traffic-density-map");
    if (main) main.removeAttribute("aria-busy");
    var gm = $("gisMap");
    if (gm) gm.classList.remove("loading");
    if (!failed) return;
    ["kpis", "statusList", "gisList", "telemetryBody", "predPanel"].forEach(
      function (id) {
        var n = $(id);
        if (n) clear(n);
      },
    );
    var dg = $("diagram");
    clear(dg);
    dg.appendChild(
      el(
        "div",
        "empty",
        "Data persimpangan belum dapat dimuat. Periksa koneksi, lalu tekan “Refresh Data”.",
      ),
    );
  }

  /* ---------- format ---------- */
  function fmtSim(iso) {
    // "2017-01-02T03:00:00" -> "02 Jan 2017 03:00"
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m
      ? m[3] +
          " " +
          BULAN[Number(m[2]) - 1] +
          " " +
          m[1] +
          " " +
          m[4] +
          ":" +
          m[5]
      : iso;
  }

  function fmtWib(isoUtc) {
    // waktu server (UTC, tanpa zona) -> jam WIB
    if (!isoUtc) return "--";
    var d = new Date(isoUtc + "Z");
    if (isNaN(d.getTime())) return "--";
    return (
      d
        .toLocaleTimeString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour12: false,
        })
        .replace(/\./g, ":") + " WIB"
    );
  }

  function sentence(s) {
    s = String(s || "").toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function formatPeriod(s) {
    if (!s) return "—";
    var upper = String(s).toUpperCase();
    if (upper.indexOf("FAIL_SAFE") !== -1) return "Timer Tetap";
    if (upper === "RUSH_HOUR" || upper === "SIBUK") return "Jam Sibuk";
    if (upper === "NORMAL") return "Normal";
    if (upper === "NIGHT" || upper === "MALAM") return "Malam Hari";
    return sentence(s);
  }
  function dec(n) {
    return String(n).replace(".", ",");
  }

  function statusClass(s) {
    if (s === "Lancar") return "st-lancar";
    if (s === "Padat") return "st-padat";
    if (s === "Kritis") return "st-kritis";
    if (s === "Sensor Offline") return "st-offline";
    return "st-belum";
  }

  function densityClass(pct) {
    return pct >= KRITIS_PCT
      ? "q-kritis"
      : pct >= PADAT_PCT
        ? "q-padat"
        : "q-lancar";
  }
  function densityWord(pct) {
    return pct >= KRITIS_PCT ? "Kritis" : pct >= PADAT_PCT ? "Padat" : "Lancar";
  }

  /* ---------- jaringan ---------- */
  function request(url, opts) {
    var t0 = performance.now();
    opts = opts || {};
    var tk = null;
    try {
      tk = localStorage.getItem("access_token");
    } catch (e) {
      /* storage diblokir */
    }
    if (tk) {
      opts.headers = Object.assign({}, opts.headers, {
        Authorization: "Bearer " + tk,
      });
    }
    return fetch(url, opts).then(function (res) {
      var ms = Math.round(performance.now() - t0);
      if (res.status === 401) {
        window.location.href = "/login";
      } // mode terkunci: wajib login
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (b) {
            throw new Error(b.detail || "HTTP " + res.status);
          });
      }
      return res.json().then(function (json) {
        return { json: json, ms: ms };
      });
    });
  }

  function setOnline(ok, text) {
    var s = $("sysState");
    s.textContent = text;
    s.className = "sysstate " + (ok ? "ok" : "bad");
  }

  function showError(msg) {
    if (msg && !state.loaded) endSkeleton(true);
    var b = $("bannerError");
    b.hidden = !msg;
    b.textContent = msg || "";
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      t.hidden = true;
    }, 3500);
  }

  /* ---------- render ---------- */
  function render(data) {
    state.data = data;
    if (!state.loaded) {
      state.loaded = true;
      endSkeleton(false);
    }
    renderStatusbar(data);
    renderBanners(data);
    pickSelected(data);
    renderKpis(data);
    renderSelect(data);
    renderStatusList(data);
    renderDiagram(data);
    renderMetrics(data);
    renderPrediction(data);
    renderTelemetry(data);
    renderCctv();
    renderGis(data);
  }

  /* ---------- peta GIS dan koridor hijau (Fitur 9) ---------- */
  function coord(s) {
    return window.SinapsisMap
      ? window.SinapsisMap.fmtCoord(s.latitude, s.longitude)
      : "—";
  }

  function renderGis(d) {
    var count = $("gisCount");
    if (count) count.textContent = d.simpang.length + " titik";
    if (!state.gis && window.SinapsisMap && $("gisMap")) {
      state.gis = window.SinapsisMap.create({
        el: $("gisMap"),
        noteEl: $("gisNote"),
        chipEl: $("gisChip"),
        padding: [38, 38],
        popup: false,
        onSelect: function (id) {
          if (id !== state.selected) selectSimpang(id);
        },
      });
    }
    if (state.gis) {
      state.gis.update(d, state.selected);
      if (state.gisSel !== state.selected) {
        // pilihan berganti (dari peta, daftar, atau menu): peta ikut bergeser ke titik itu
        if (state.gisSel !== undefined) state.gis.focus(state.selected);
        state.gisSel = state.selected;
      }
    }
  }

  function corridorBadge(item) {
    var b = el("div", "corridor-badge");
    b.appendChild(el("strong", null, "KORIDOR HIJAU AKTIF"));
    var c = item.koridor;
    b.appendChild(
      el(
        "span",
        null,
        c
          ? c.emergency_id +
              (c.jenis_kendaraan ? " · " + c.jenis_kendaraan : "") +
              " · titik ke-" +
              c.urutan +
              " dari " +
              c.total
          : "Jalur darurat aktif pada persimpangan ini",
      ),
    );
    return b;
  }

  function renderStatusbar(d) {
    $("dataTime").textContent =
      "Data Lalu Lintas Real-Time Diperbarui: " + fmtWib(d.diperbarui);
    $("simTime").textContent = d.waktu_data
      ? "Waktu data (simulasi dataset): " + fmtSim(d.waktu_data)
      : "";
  }

  function renderBanners(d) {
    var a = $("bannerAlert");
    a.hidden = !d.congestion_alert;
    a.textContent = d.congestion_alert ? d.pesan_alert : "";
    var s = $("bannerSensor");
    s.hidden = !d.pesan_sensor;
    s.textContent = d.pesan_sensor || "";
    var cb = $("bannerCorridor"),
      cor = d.koridor_hijau || [];
    cb.hidden = !cor.length;
    cb.textContent = cor.length
      ? "Mode darurat: " +
        cor
          .map(function (c) {
            return window.SinapsisMap
              ? window.SinapsisMap.corridorText(c, d.simpang)
              : c.emergency_id;
          })
          .join(" | ")
      : "";
  }

  function pickSelected(d) {
    var ids = d.simpang.map(function (s) {
      return s.id_persimpangan;
    });
    if (state.selected !== null && ids.indexOf(state.selected) !== -1) return;
    var withData = d.simpang.filter(function (s) {
      return s.jalur.length > 0;
    });
    var crit = withData.filter(function (s) {
      return s.status === "Kritis";
    })[0];
    var chosen = crit || withData[0] || d.simpang[0];
    state.selected = chosen ? chosen.id_persimpangan : null;
  }

  function currentItem() {
    if (!state.data) return null;
    return (
      state.data.simpang.filter(function (s) {
        return s.id_persimpangan === state.selected;
      })[0] || null
    );
  }

  function earlyWarning(s, d) {
    return (
      s.prediksi_maks_pct !== null &&
      d.ambang_peringatan_dini_pct !== null &&
      s.prediksi_maks_pct >= d.ambang_peringatan_dini_pct
    );
  }

  function kpi(k, v, sub, alert) {
    var c = el("div", "kpi" + (alert ? " alert" : ""));
    c.appendChild(el("div", "k", k));
    c.appendChild(el("div", "v", v));
    if (sub) c.appendChild(el("div", "s", sub));
    return c;
  }

  function renderKpis(d) {
    var box = $("kpis");
    clear(box);
    var n = { Lancar: 0, Padat: 0, Kritis: 0 },
      offline = 0,
      early = [],
      crit = [];
    d.simpang.forEach(function (s) {
      if (n[s.status] !== undefined) n[s.status] += 1;
      if (s.sensor_offline) offline += 1;
      if (s.status === "Kritis") crit.push(s.nama_lokasi);
      if (earlyWarning(s, d)) early.push(s.nama_lokasi);
    });
    box.appendChild(
      kpi(
        "Persimpangan dipantau",
        String(d.simpang.length),
        "Lancar " + n.Lancar + " · Padat " + n.Padat + " · Kritis " + n.Kritis,
      ),
    );
    box.appendChild(
      kpi(
        "Total kendaraan",
        String(d.total_kendaraan),
        "pada siklus terakhir, semua simpang",
      ),
    );
    box.appendChild(
      kpi(
        "Kemacetan saat ini",
        String(crit.length),
        crit.length ? crit.join(", ") : "Tidak ada simpang kritis",
        crit.length > 0,
      ),
    );
    box.appendChild(
      kpi(
        "Peringatan dini",
        String(early.length),
        early.length
          ? early.join(", ")
          : "Prediksi jam depan di bawah " +
              (d.ambang_peringatan_dini_pct === null
                ? "ambang"
                : d.ambang_peringatan_dini_pct + "%"),
      ),
    );
    box.appendChild(
      kpi(
        "Sensor",
        offline ? offline + " offline" : "Semua online",
        offline
          ? "Data simpang terakhir ditampilkan"
          : "Data diterima dari semua simpang",
        offline > 0,
      ),
    );
  }

  function renderSelect(d) {
    var sel = $("selSimpang");
    clear(sel);
    d.simpang.forEach(function (s) {
      var o = el("option", null, s.nama_lokasi);
      o.value = String(s.id_persimpangan);
      if (s.id_persimpangan === state.selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderStatusList(d) {
    var box = $("statusList");
    clear(box);
    $("listCount").textContent = d.simpang.length + " simpang";
    d.simpang.forEach(function (s) {
      var row = el(
        "button",
        "row" + (s.id_persimpangan === state.selected ? " selected" : ""),
      );
      row.type = "button";
      var name = el("span", "name", s.nama_lokasi);
      if (s.jumlah_lengan && s.jumlah_lengan < 4)
        name.appendChild(el("small", null, s.jumlah_lengan + " lengan"));
      if (s.koridor_hijau) {
        row.classList.add("cor");
        name.appendChild(el("small", "cor-tag", "Koridor hijau"));
      }
      var mini = el("span", "mini");
      var fill = el(
        "i",
        s.status === "Kritis" ? "kritis" : s.status === "Padat" ? "padat" : "",
      );
      fill.style.width =
        (s.densitas_maks_pct === null ? 0 : Math.max(3, s.densitas_maks_pct)) +
        "%";
      mini.appendChild(fill);
      var first = el("div");
      first.appendChild(name);
      first.appendChild(mini);
      row.appendChild(first);
      row.appendChild(el("span", "st " + statusClass(s.status), s.status));
      row.appendChild(
        el(
          "span",
          "num",
          s.jalur.length || s.jumlah_kendaraan
            ? String(s.jumlah_kendaraan)
            : "—",
        ),
      );
      row.addEventListener("click", function () {
        selectSimpang(s.id_persimpangan);
      });
      box.appendChild(row);
    });
  }

  function selectSimpang(id) {
    state.selected = id;
    if (state.data) render(state.data);
  }

  function renderCctv() {
    var box = $("cctvFeed");
    if (!box) return;
    clear(box);
    var item = currentItem();
    var feeds =
      item && item.snapshots
        ? Object.keys(item.snapshots)
            .map(function (arah) {
              return { arah: arah, preview: item.snapshots[arah] };
            })
            .filter(function (feed) {
              return feed.preview;
            })
        : [];
    if (!feeds.length) {
      var empty = el("div", "cctv-empty");
      empty.appendChild(el("strong", null, "Snapshot belum tersedia"));
      empty.appendChild(
        el(
          "p",
          null,
          "Unggah frame vision dari Persimpangan Terdaftar untuk menampilkan hasil YOLOv8.",
        ),
      );
      box.appendChild(empty);
      return;
    }
    var grid = el("div", "cctv-grid");
    feeds.forEach(function (feed) {
      var card = el("figure", "cctv-snapshot");
      var image = document.createElement("img");
      image.src = feed.preview;
      image.alt = "Snapshot YOLOv8 Lajur " + feed.arah;
      card.appendChild(image);
      card.appendChild(el("figcaption", null, "Lajur " + feed.arah));
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  /* ---------- tampilan CCTV (monitor besar, satu kotak per lengan) ----------
     Hanya membaca data yang sudah ada (item.snapshots / item.jalur); tidak mengubah alur vision. */
  function readView() {
    try {
      return window.localStorage.getItem("sinapsis_view") === "cctv" ? "cctv" : "anim";
    } catch (e) {
      return "anim";
    }
  }
  function paintView() {
    var cctv = state.view === "cctv";
    $("viewAnim").setAttribute("aria-pressed", String(!cctv));
    $("viewCctv").setAttribute("aria-pressed", String(cctv));
    $("animToggle").hidden = cctv;
    var box = $("diagram");
    if (box) box.classList.toggle("cctv-mode", cctv);
  }
  function setView(v) {
    state.view = v === "cctv" ? "cctv" : "anim";
    try {
      window.localStorage.setItem("sinapsis_view", state.view);
    } catch (e) {
      /* diabaikan */
    }
    paintView();
    if (state.data) renderDiagram(state.data);
  }
  function wallCols(n) {
    return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  }
  function renderCctvWall(box, item, arms) {
    var wall = el("div", "cctv-wall");
    wall.style.setProperty("--cols", String(wallCols(arms.length)));
    var snaps = item.snapshots || {};
    arms.forEach(function (arah, i) {
      var lane = null;
      item.jalur.forEach(function (l) {
        if (l.arah === arah) lane = l;
      });
      var tile = el("figure", "cctv-tile");
      var screen = el("div", "cctv-screen");
      if (snaps[arah]) {
        var img = document.createElement("img");
        img.src = snaps[arah];
        img.alt = "Feed CCTV lengan " + arah;
        screen.appendChild(img);
      } else {
        screen.appendChild(el("span", "cctv-noimg", "Belum ada feed"));
      }
      screen.appendChild(el("span", "cctv-cam", "CAM " + (i + 1)));
      if (lane && lane.sinyal) {
        var on = lane.sinyal === "HIJAU";
        screen.appendChild(el("span", "cctv-sig " + (on ? "go" : "stop"), on ? "HIJAU" : "MERAH"));
      }
      tile.appendChild(screen);
      var cap = arah;
      if (lane) cap += " · " + lane.jumlah_kendaraan + " kendaraan · " + densityWord(lane.densitas_pct);
      tile.appendChild(el("figcaption", null, cap));
      wall.appendChild(tile);
    });
    box.appendChild(wall);
  }

  /* ---------- diagram persimpangan (SVG) ----------
     Lalu lintas Indonesia berjalan di sisi kiri, sehingga lajur masuk tiap lengan:
     Utara = sisi timur jalan, Selatan = sisi barat, Timur = sisi selatan, Barat = sisi utara. */
  var ARMS = {
    Utara: {
      stop: { x: 380, y: 212, width: 48, height: 4 },
      sig: { x: 438, y: 166, tx: 462, ty: 190, ta: "start" },
      tag: { x: 448, y: 10 },
    },
    Selatan: {
      stop: { x: 332, y: 344, width: 48, height: 4 },
      sig: { x: 304, y: 356, tx: 298, ty: 380, ta: "end" },
      tag: { x: 112, y: 482 },
    },
    Timur: {
      stop: { x: 446, y: 280, width: 4, height: 48 },
      sig: { x: 452, y: 336, tx: 476, ty: 360, ta: "start" },
      tag: { x: 548, y: 346 },
    },
    Barat: {
      stop: { x: 312, y: 232, width: 4, height: 48 },
      sig: { x: 294, y: 188, tx: 288, ty: 212, ta: "end" },
      tag: { x: 12, y: 150 },
    },
  };

  /* Bentuk jalan mengikuti lengan yang ada (2-4): lengan yang tidak ada ditutup dengan garis tepi. */
  var ROAD = {
    Utara: {
      rect: [332, 0, 96, 232],
      edges: [
        [332, 0, 332, 232],
        [428, 0, 428, 232],
      ],
      median: [380, 0, 380, 210],
      close: [332, 232, 428, 232],
      zebra: function (k) {
        return [336 + k * 14, 218, 8, 14];
      },
    },
    Selatan: {
      rect: [332, 328, 96, 232],
      edges: [
        [332, 328, 332, 560],
        [428, 328, 428, 560],
      ],
      median: [380, 350, 380, 560],
      close: [332, 328, 428, 328],
      zebra: function (k) {
        return [336 + k * 14, 328, 8, 14];
      },
    },
    Timur: {
      rect: [428, 232, 332, 96],
      edges: [
        [428, 232, 760, 232],
        [428, 328, 760, 328],
      ],
      median: [450, 280, 760, 280],
      close: [428, 232, 428, 328],
      zebra: function (k) {
        return [428, 236 + k * 14, 14, 8];
      },
    },
    Barat: {
      rect: [0, 232, 332, 96],
      edges: [
        [0, 232, 332, 232],
        [0, 328, 332, 328],
      ],
      median: [0, 280, 310, 280],
      close: [332, 232, 332, 328],
      zebra: function (k) {
        return [318, 236 + k * 14, 14, 8];
      },
    },
  };
  var ARM_NAMES = ["Utara", "Selatan", "Timur", "Barat"];

  /* Latar kota: blok bangunan di tiap sudut (trotoar 14 px dari tepi jalan). Pada pertigaan, dua blok di sisi
     tanpa lengan digabung menjadi satu blok memanjang. Koordinat sudah final: x, y, lebar, tinggi. */
  var NW = [0, 0, 318, 218],
    NE = [442, 0, 318, 218],
    SW = [0, 342, 318, 218],
    SE = [442, 342, 318, 218];
  function blockLayout(arms) {
    var has = function (a) {
      return arms.indexOf(a) >= 0;
    };
    if (!has("Utara")) return [[0, 0, 760, 218], SW, SE];
    if (!has("Selatan")) return [NW, NE, [0, 342, 760, 218]];
    if (!has("Barat")) return [[0, 0, 318, 560], NE, SE];
    if (!has("Timur")) return [NW, SW, [442, 0, 318, 560]];
    return [NW, NE, SW, SE];
  }
  function drawBlocks(s, arms) {
    var g = svg("g", { "aria-hidden": "true" });
    var rects = blockLayout(arms);
    rects.forEach(function (r) {
      g.appendChild(
        svg("rect", {
          class: "block",
          x: r[0],
          y: r[1],
          width: r[2],
          height: r[3],
        }),
      );
    });
    rects.forEach(function (r) {
      for (var cy = r[1] + 14; cy + 54 <= r[1] + r[3] - 6; cy += 70) {
        for (var cx = r[0] + 14; cx + 70 <= r[0] + r[2] - 6; cx += 88) {
          if ((cx * 7 + cy * 13) % 5 === 0) {
            // beberapa petak dibiarkan sebagai taman
            g.appendChild(
              svg("circle", { class: "tree", cx: cx + 30, cy: cy + 26, r: 16 }),
            );
            g.appendChild(
              svg("circle", {
                class: "tree2",
                cx: cx + 38,
                cy: cy + 30,
                r: 10,
              }),
            );
          } else {
            g.appendChild(
              svg("rect", {
                class: "bldg b" + ((cx + cy) % 3),
                x: cx,
                y: cy,
                width: 70 - (cx % 3) * 6,
                height: 54 - (cy % 4) * 3,
                rx: 4,
              }),
            );
          }
        }
      }
    });
    s.appendChild(g);
  }
  function drawCompass(s) {
    var g = svg("g", {
      transform: "translate(718,512)",
      "aria-hidden": "true",
    });
    g.appendChild(svg("circle", { class: "compass-ring", r: 22 }));
    g.appendChild(
      svg("path", { class: "compass-n", d: "M0,-15 L6,5 L0,1 L-6,5 Z" }),
    );
    g.appendChild(
      svg(
        "text",
        { class: "compass-t", x: 0, y: -26, "text-anchor": "middle" },
        "U",
      ),
    );
    s.appendChild(g);
  }

  /* tekstur aspal halus (pola titik) yang dilapiskan di atas warna dasar jalan */
  function drawDefs(s) {
    var defs = svg("defs", {});
    var pat = svg("pattern", {
      id: "asphaltTex",
      width: 18,
      height: 18,
      patternUnits: "userSpaceOnUse",
    });
    [
      [3, 4, 0.7],
      [11, 2, 0.5],
      [8, 9, 0.8],
      [15, 12, 0.6],
      [2, 14, 0.5],
    ].forEach(function (d) {
      pat.appendChild(svg("circle", { class: "grain", cx: d[0], cy: d[1], r: d[2] }));
    });
    defs.appendChild(pat);
    s.appendChild(defs);
  }
  function drawLaneArrows(s, arms) {
    var T = window.SinapsisTraffic;
    if (!T) return;
    arms.forEach(function (name) {
      var g = T.GEO[name];
      if (!g) return;
      var x = g.stop[0] - g.heading[0] * 58,
        y = g.stop[1] - g.heading[1] * 58,
        ang = (Math.atan2(g.heading[0], -g.heading[1]) * 180) / Math.PI;
      s.appendChild(
        svg("path", {
          class: "lane-arrow",
          d: "M0,-9 L6,0 L2.2,0 L2.2,9 L-2.2,9 L-2.2,0 L-6,0 Z",
          transform: "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ") rotate(" + ang.toFixed(0) + ")",
        }),
      );
    });
  }

  function drawRoads(s, arms) {
    drawDefs(s);
    s.appendChild(
      svg("rect", { class: "ground", x: 0, y: 0, width: 760, height: 560 }),
    );
    drawBlocks(s, arms);
    ARM_NAMES.forEach(function (name) {
      if (arms.indexOf(name) < 0) return;
      var r = ROAD[name].rect;
      s.appendChild(
        svg("rect", {
          class: "asphalt",
          x: r[0],
          y: r[1],
          width: r[2],
          height: r[3],
        }),
      );
      s.appendChild(
        svg("rect", {
          class: "asphalt-tex",
          x: r[0],
          y: r[1],
          width: r[2],
          height: r[3],
        }),
      );
    });
    ARM_NAMES.forEach(function (name) {
      var road = ROAD[name],
        present = arms.indexOf(name) >= 0;
      if (!present) {
        // sisi simpang tanpa lengan: tepi jalan tertutup
        s.appendChild(
          svg("line", {
            class: "edge",
            x1: road.close[0],
            y1: road.close[1],
            x2: road.close[2],
            y2: road.close[3],
          }),
        );
        return;
      }
      road.edges.forEach(function (l) {
        s.appendChild(
          svg("line", {
            class: "edge",
            x1: l[0],
            y1: l[1],
            x2: l[2],
            y2: l[3],
          }),
        );
      });
      s.appendChild(
        svg("line", {
          class: "median",
          x1: road.median[0],
          y1: road.median[1],
          x2: road.median[2],
          y2: road.median[3],
        }),
      );
      for (var k = 0; k < 7; k++) {
        // zebra cross di tiap lengan
        var z = road.zebra(k);
        s.appendChild(
          svg("rect", {
            class: "zebra",
            x: z[0],
            y: z[1],
            width: z[2],
            height: z[3],
          }),
        );
      }
    });
  }

  function drawSignal(g, cfg, lane) {
    var green = lane.sinyal === "HIJAU";
    var x = cfg.sig.x,
      y = cfg.sig.y;
    g.appendChild(
      svg("rect", {
        class: "signal-box",
        x: x,
        y: y,
        width: 18,
        height: 40,
        rx: 4,
      }),
    );
    if (!green)
      g.appendChild(
        svg("circle", { class: "lamp-glow-red", cx: x + 9, cy: y + 11, r: 9 }),
      );
    if (green)
      g.appendChild(
        svg("circle", {
          class: "lamp-glow-green",
          cx: x + 9,
          cy: y + 29,
          r: 9,
        }),
      );
    g.appendChild(
      svg("circle", {
        class: green ? "lamp-red-off" : "lamp-red-on",
        cx: x + 9,
        cy: y + 11,
        r: 6,
      }),
    );
    g.appendChild(
      svg("circle", {
        class: green ? "lamp-green-on" : "lamp-green-off",
        cx: x + 9,
        cy: y + 29,
        r: 6,
      }),
    );
    g.appendChild(
      svg(
        "text",
        {
          class: "sig-text",
          x: cfg.sig.tx,
          y: cfg.sig.ty,
          "text-anchor": cfg.sig.ta,
        },
        green ? lane.durasi + " dtk" : "Merah",
      ),
    );
  }

  function drawTag(g, cfg, lane, cap) {
    var p = cfg.tag,
      pct = lane.densitas_pct;
    g.appendChild(
      svg("rect", {
        class: "tag-box",
        x: p.x,
        y: p.y,
        width: 200,
        height: 68,
        rx: 6,
      }),
    );
    g.appendChild(
      svg("text", { class: "tag-name", x: p.x + 12, y: p.y + 21 }, lane.arah),
    );
    g.appendChild(
      svg(
        "text",
        { class: "tag-detail", x: p.x + 12, y: p.y + 39 },
        lane.jumlah_kendaraan +
          " kendaraan · " +
          pct +
          "% · " +
          densityWord(pct),
      ),
    );
    g.appendChild(
      svg("rect", {
        class: "tag-track",
        x: p.x + 12,
        y: p.y + 50,
        width: 176,
        height: 6,
        rx: 3,
      }),
    );
    g.appendChild(
      svg("rect", {
        class: densityClass(pct),
        x: p.x + 12,
        y: p.y + 50,
        width: Math.max(3, Math.min(1, lane.jumlah_kendaraan / cap) * 176),
        height: 6,
        rx: 3,
      }),
    );
    var corridor = /koridor/i.test(lane.alasan || "");
    var flags = [];
    if (lane.spike) flags.push("Spike");
    if (corridor) flags.push("Koridor");
    if (flags.length) {
      g.appendChild(
        svg(
          "text",
          {
            class: "arm-flag" + (corridor ? " green" : ""),
            x: p.x + 188,
            y: p.y + 21,
          },
          flags.join(" · "),
        ),
      );
    }
  }

  /* ---------- diagram radial: persimpangan dengan 5+ lengan, diberi label angka ---------- */
  function isNumberedArms(arms) {
    return arms.length > 0 && arms.every(function (a) { return /^Lengan \d+$/.test(a); });
  }
  function armNo(name) { return name.replace(/^\D+/, ""); }

  function renderRadial(box, item, d, arms) {
    var T = window.SinapsisTraffic;
    if (!T || !T.radialGeo) return false;
    var cap = d.kapasitas_jalur || 20, n = arms.length;
    var R = T.radialGeo(n), geo = R.geo, C = R.RAD;
    var rad = function (deg) { return (deg * Math.PI) / 180; };
    var rot = function (th, x, y) {
      var c = Math.cos(rad(th)), sn = Math.sin(rad(th));
      return { x: C.cx + x * c - y * sn, y: C.cy + x * sn + y * c };
    };
    var s = svg("svg", {
      viewBox: "0 0 760 560", role: "img", class: "radial",
      "aria-label": "Diagram persimpangan " + item.nama_lokasi + ", " + n + " lengan berlabel angka",
    });
    drawDefs(s);
    s.appendChild(svg("rect", { class: "ground", x: 0, y: 0, width: 760, height: 560 }));
    // blok kota di sektor antara dua lengan
    arms.forEach(function (a, i) {
      var phi = geo[a].bearing + 180 / n, q = rot(phi, 0, -150);
      var gb = svg("g", { transform: "translate(" + q.x.toFixed(1) + " " + q.y.toFixed(1) + ") rotate(" + phi.toFixed(0) + ")", "aria-hidden": "true" });
      gb.appendChild(svg("rect", { class: "block", x: -19, y: -26, width: 38, height: 52, rx: 6 }));
      s.appendChild(gb);
      var tp = rot(phi + 14, 0, -330);
      s.appendChild(svg("circle", { class: "tree", cx: tp.x.toFixed(1), cy: tp.y.toFixed(1), r: 15 }));
      s.appendChild(svg("circle", { class: "tree2", cx: (tp.x + 5).toFixed(1), cy: (tp.y + 5).toFixed(1), r: 9 }));
    });
    var armG = function (a) {
      return svg("g", { transform: "translate(" + C.cx + " " + C.cy + ") rotate(" + geo[a].bearing.toFixed(2) + ")" });
    };
    arms.forEach(function (a) {
      var g = armG(a);
      g.appendChild(svg("rect", { class: "asphalt", x: -C.half, y: -340, width: C.half * 2, height: 340 }));
      g.appendChild(svg("rect", { class: "asphalt-tex", x: -C.half, y: -340, width: C.half * 2, height: 340 }));
      s.appendChild(g);
    });
    s.appendChild(svg("circle", { class: "asphalt", cx: C.cx, cy: C.cy, r: C.disc }));
    s.appendChild(svg("circle", { class: "asphalt-tex", cx: C.cx, cy: C.cy, r: C.disc }));
    arms.forEach(function (a) {
      var g = armG(a);
      [-C.half, C.half].forEach(function (x) {
        g.appendChild(svg("line", { class: "edge", x1: x, x2: x, y1: -340, y2: -C.disc + 4 }));
      });
      g.appendChild(svg("line", { class: "median", x1: 0, x2: 0, y1: -340, y2: -C.stop - 6 }));
      for (var x = -C.half + 6; x < C.half - 6; x += 14)
        g.appendChild(svg("rect", { class: "zebra", x: x, y: -C.stop + 4, width: 9, height: 12, rx: 1 }));
      g.appendChild(svg("rect", { class: "stop", x: 4, y: -C.stop - 6, width: C.half - 6, height: 4 }));
      g.appendChild(svg("path", {
        class: "lane-arrow", d: "M0,-9 L6,0 L2.2,0 L2.2,9 L-2.2,9 L-2.2,0 L-6,0 Z",
        transform: "translate(" + C.lane + " " + (-(C.stop + 62)) + ") rotate(180)",
      }));
      s.appendChild(g);
    });
    s.appendChild(svg("text", { class: "center-text", x: C.cx, y: C.cy - 4 }, formatPeriod(item.periode)));
    s.appendChild(svg("text", { class: "center-text", x: C.cx, y: C.cy + 12 }, "Siklus " + item.siklus));

    var layers = {}, byArm = {};
    item.jalur.forEach(function (l) { byArm[l.arah] = l; });
    arms.forEach(function (a) {
      var lane = byArm[a], th = geo[a].bearing, no = armNo(a);
      var g = svg("g", {});
      if (lane)
        g.appendChild(svg("title", {}, a + ": " + lane.jumlah_kendaraan + " kendaraan (" + lane.densitas_pct + "%). " +
          (lane.sinyal === "HIJAU" ? "Lampu hijau " + lane.durasi + " dtk" : "Lampu merah, jatah hijau berikutnya " + lane.durasi + " dtk") +
          (lane.spike ? ". Neuron spike" : "") + ". " + (lane.alasan || "")));
      layers[a] = svg("g", { class: "cars" });
      g.appendChild(layers[a]);
      var bp = rot(th, 0, -262);                       // lencana nomor di ujung jalan
      var bg = svg("g", { transform: "translate(" + bp.x.toFixed(1) + " " + bp.y.toFixed(1) + ")" });
      bg.appendChild(svg("circle", { class: "arm-badge", r: 17 }));
      bg.appendChild(svg("text", { class: "arm-badge-t", y: 5.5 }, no));
      g.appendChild(bg);
      if (lane) {
        var lp = rot(th, C.lane + C.half + 16, -(C.stop + 22)), green = lane.sinyal === "HIJAU";
        var sg = svg("g", { transform: "translate(" + lp.x.toFixed(1) + " " + lp.y.toFixed(1) + ")" });
        sg.appendChild(svg("rect", { class: "signal-box", x: -12, y: -22, width: 24, height: 44, rx: 6 }));
        sg.appendChild(svg("circle", { class: green ? "lamp-glow-green" : "lamp-glow-red", cx: 0, cy: green ? 10 : -10, r: 11 }));
        sg.appendChild(svg("circle", { class: green ? "lamp-red-off" : "lamp-red-on", cx: 0, cy: -10, r: 6.5 }));
        sg.appendChild(svg("circle", { class: green ? "lamp-green-on" : "lamp-green-off", cx: 0, cy: 10, r: 6.5 }));
        sg.appendChild(svg("text", { class: "sig-text", x: 0, y: 38, "text-anchor": "middle" }, green ? lane.durasi + " dtk" : "Merah"));
        g.appendChild(sg);
        var phi = th + 180 / n, cx = C.cx + 262 * Math.sin(rad(phi)), cy = C.cy - 262 * Math.cos(rad(phi));
        cx = Math.max(72, Math.min(688, cx)); cy = Math.max(34, Math.min(530, cy));
        var pct = lane.densitas_pct, cg = svg("g", { transform: "translate(" + cx.toFixed(1) + " " + cy.toFixed(1) + ")" });
        cg.appendChild(svg("rect", { class: "tag-box", x: -66, y: -27, width: 132, height: 54, rx: 9 }));
        cg.appendChild(svg("circle", { class: "arm-badge", cx: -48, cy: -11, r: 9 }));
        cg.appendChild(svg("text", { class: "arm-badge-t sm", x: -48, y: -7 }, no));
        cg.appendChild(svg("text", { class: "tag-name rad", x: -34, y: -6 }, a));
        var radDetail = item.sensor_offline
          ? "Sensor offline"
          : lane.jumlah_kendaraan + " kend. · " + pct + "% · " + densityWord(pct);
        cg.appendChild(svg("text", { class: "tag-detail rad", x: -56, y: 10 }, radDetail));
        cg.appendChild(svg("rect", { class: "tag-track", x: -56, y: 17, width: 112, height: 5, rx: 2.5 }));
        cg.appendChild(svg("rect", { class: densityClass(pct), x: -56, y: 17, width: Math.max(3, Math.min(1, lane.jumlah_kendaraan / cap) * 112), height: 5, rx: 2.5 }));
        if (lane.spike) cg.appendChild(svg("text", { class: "arm-flag", x: 60, y: -6 }, "Spike"));
        g.appendChild(cg);
      }
      s.appendChild(g);
    });
    box.appendChild(s);
    syncTraffic(item, arms, layers, s, geo);
    return true;
  }

  /* ---------- Peta + animasi: animasi lalu lintas di atas peta OSM persimpangan terpilih ---------- */
  var live = { el: null, map: null, id: null, tiles: 0, errs: 0, failed: false, tried: null, root: null, marks: [], item: null };
  // geometri animasi dihitung dalam "unit" (1 unit ~ 0,28 m): lajur 3,4 m, mobil ~4,5 m. Skala piksel mengikuti zoom peta.
  var LIVE_RAD = { cx: 0, cy: 0, lane: 12, half: 22, disc: 40, stop: 52, end: 240 };
  var LIVE_M_PER_UNIT = 0.28;
  var LIVE_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

  function liveScale() {   // piksel per unit pada zoom & lintang saat ini
    var z = live.map.getZoom(), lat = live.item.latitude;
    var mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);   // meter per piksel
    return LIVE_M_PER_UNIT / mpp;
  }
  function applyLiveScale() {   // dipanggil saat zoom / geser peta: tanpa membangun ulang overlay
    if (!live.map || !live.root || !live.item) return;
    var p = live.map.latLngToContainerPoint([live.item.latitude, live.item.longitude]), s = liveScale();
    live.root.setAttribute("transform", "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ") scale(" + s.toFixed(4) + ")");
    live.marks.forEach(function (m) {   // lencana & lampu: ukuran tetap terbaca, hanya posisinya ikut peta
      m.g.setAttribute("transform", "translate(" + m.x.toFixed(1) + " " + m.y.toFixed(1) + ") scale(" + (m.k / s).toFixed(4) + ")");
    });
  }
  function destroyLive() {
    if (live.map) { try { live.map.remove(); } catch (e) { /* abaikan */ } }
    live.el = null; live.map = null; live.id = null; live.tiles = 0; live.errs = 0; live.root = null; live.marks = [];
  }
  function armLabel(a, i) { return String(i + 1); }   // lengan selalu diberi nomor 1..N di peta
  function hasGeo(item) { return !!(item && item.latitude != null && item.longitude != null && window.L); }

  // koordinat lintang/bujur -> unit animasi relatif terhadap pusat persimpangan (y ke bawah)
  function toUnits(item, p) {
    var lat0 = item.latitude, lon0 = item.longitude;
    var mx = (p[1] - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), my = (p[0] - lat0) * 111132;
    return [mx / LIVE_M_PER_UNIT, -my / LIVE_M_PER_UNIT];
  }
  function hasDrawnArms(item, arms) {
    var g = item.garis_lengan || {};
    return arms.length >= 3 && arms.every(function (a) { return g[a] && g[a].length >= 2; });
  }
  /* Susunan geometri di atas peta: garis yang digambar (melengkung) bila ada, selain itu lengan lurus menurut arah (bearing). */
  var LIVE_DRAW_LEN = 1800;   // jalan digambar sampai jauh di luar kotak supaya selalu mencapai tepi peta (zoom minimum 17,5)
  var LIVE_SIM_MAX = 900;     // panjang lintasan kendaraan maksimum
  /* jarak (unit) dari pusat persimpangan ke tepi kotak peta searah (dx,dy), supaya jalan terisi penuh sampai tepi tampilan */
  function reachUnits(view, dx, dy) {
    var tx = dx > 0 ? (view.W - view.cx) / dx : dx < 0 ? -view.cx / dx : Infinity;
    var ty = dy > 0 ? (view.H - view.cy) / dy : dy < 0 ? -view.cy / dy : Infinity;
    return Math.min(tx, ty) / view.s;
  }
  function liveLayout(T, item, arms, view) {
    var out = { hl: {}, badge: {}, lamp: {}, roads: {}, geo: null, drawn: false };
    var Ill = window.SinapsisRoadIllus;
    view = view || { W: 760, H: 520, cx: 380, cy: 260, s: 1 };
    var longer = function (pts) { return Ill ? Ill.extend(pts, LIVE_DRAW_LEN) : pts; };
    if (hasDrawnArms(item, arms)) {
      var lines = {};
      arms.forEach(function (a) {
        var pts = item.garis_lengan[a].slice(1).map(function (p) { return toUnits(item, p); });
        if (!Ill) { lines[a] = pts; return; }
        // tikungan dihaluskan, lalu lengan dipanjangkan lurus sampai tepi kotak peta (lintasan kendaraan ikut)
        var sm = Ill.smooth([[0, 0]].concat(pts), 2), n = sm.length, q = sm[n - 1], r = sm[n - 2] || [0, 0];
        var dx = q[0] - r[0], dy = q[1] - r[1], dl = Math.hypot(dx, dy) || 1;
        var target = Math.max(LIVE_RAD.end, Math.min(LIVE_SIM_MAX, reachUnits(view, dx / dl, dy / dl) + 50));
        lines[a] = Ill.clip(Ill.extend(sm, target), LIVE_SIM_MAX).slice(1);
      });
      var G = T.curveGeo(arms, lines, LIVE_RAD);
      if (G.names.length === arms.length) {
        out.geo = G.geo; out.drawn = true;
        arms.forEach(function (a) {
          var cp = T.makePath(G.geo[a].center), pb = T.pathAt(cp, G.R.stop + 70), pl = T.pathAt(cp, G.R.stop + 10);
          out.hl[a] = G.geo[a].center.filter(function (q, k) { return cp.cum[k] >= 14 && cp.cum[k] <= 230; });
          out.roads[a] = longer(G.geo[a].center);
          out.badge[a] = { x: pb.x, y: pb.y };
          out.lamp[a] = { x: pl.x - pl.dir[1] * (LIVE_RAD.half + 8), y: pl.y + pl.dir[0] * (LIVE_RAD.half + 8) };
        });
        return out;
      }
    }
    var bear = item.bearing || {};
    var rad = function (deg) { return (deg * Math.PI) / 180; };
    var rot = function (th, x, y) { var c = Math.cos(rad(th)), sn = Math.sin(rad(th)); return { x: x * c - y * sn, y: x * sn + y * c }; };
    var bears = arms.map(function (a) { return bear[a]; });
    var R0 = T.radialGeo(arms.length, bears, LIVE_RAD, arms), simEnd = LIVE_RAD.end;
    arms.forEach(function (a) {   // lengan lurus juga dipanjangkan sampai tepi kotak peta
      var th = R0.geo[a].bearing;
      simEnd = Math.max(simEnd, Math.min(LIVE_SIM_MAX, reachUnits(view, Math.sin(rad(th)), -Math.cos(rad(th))) + 50));
    });
    var RAD2 = { cx: 0, cy: 0, lane: LIVE_RAD.lane, half: LIVE_RAD.half, disc: LIVE_RAD.disc, stop: LIVE_RAD.stop, end: simEnd };
    var R = T.radialGeo(arms.length, bears, RAD2, arms);
    out.geo = R.geo;
    arms.forEach(function (a) {
      var th = R.geo[a].bearing;
      out.hl[a] = [rot(th, 0, -18), rot(th, 0, -LIVE_RAD.end * 0.82)].map(function (q) { return [q.x, q.y]; });
      out.roads[a] = [rot(th, 0, 0), rot(th, 0, -LIVE_DRAW_LEN)].map(function (q) { return [q.x, q.y]; });
      var bp = rot(th, 0, -LIVE_RAD.end * 0.74), lp = rot(th, LIVE_RAD.lane + LIVE_RAD.half * 0.9, -(LIVE_RAD.stop + 10));
      out.badge[a] = bp; out.lamp[a] = lp;
    });
    return out;
  }

  function renderLive(box, item, d, arms) {
    var T = window.SinapsisTraffic;
    if (!T || !T.radialGeo || !hasGeo(item)) return false;
    if (live.tried !== item.id_persimpangan) { live.tried = item.id_persimpangan; live.failed = false; }
    if (live.failed) return false;
    live.item = item;
    if (!live.el || live.id !== item.id_persimpangan) {
      destroyLive();
      live.el = el("div", "livemap illus");
      live.id = item.id_persimpangan;
      box.appendChild(live.el);   // harus ada di DOM sebelum Leaflet dibuat
      live.map = L.map(live.el, { zoomControl: true, zoomSnap: 0.5, zoomDelta: 0.5, minZoom: 17.5, maxZoom: 21,
        scrollWheelZoom: false }).setView([item.latitude, item.longitude], 19);
      L.tileLayer(LIVE_TILE, { maxZoom: 21, maxNativeZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' })
        .on("tileload", function () { live.tiles += 1; if (live.el) live.el.classList.remove("no-tiles"); })
        .on("tileerror", function () {
          live.errs += 1;
          if (live.errs >= 4 && live.tiles === 0 && live.el) {   // peta dasar tidak tersedia: ilustrasi tetap tampil di latar polos
            live.el.classList.add("no-tiles");
          }
        }).addTo(live.map);
      var Recenter = L.Control.extend({ options: { position: "topleft" }, onAdd: function () {
        var b = L.DomUtil.create("button", "lm-recenter leaflet-bar");
        b.type = "button"; b.title = "Pusatkan ke persimpangan"; b.textContent = "◎";
        L.DomEvent.disableClickPropagation(b);
        b.addEventListener("click", function () { live.map.setView([live.item.latitude, live.item.longitude], 19); });
        return b;
      } });
      new Recenter().addTo(live.map);
      live.map.on("move zoom", applyLiveScale);
    } else {
      box.appendChild(live.el);   // clear(box) hanya melepas; peta tetap utuh
      live.map.invalidateSize(false);
    }
    var old = live.el.querySelector("svg.live-ov");
    if (old) old.parentNode.removeChild(old);
    var chips = live.el.parentNode.querySelector(".live-arms");
    if (chips) chips.parentNode.removeChild(chips);

    var W = live.el.clientWidth || 760, H = live.el.clientHeight || 520;
    var cpx = live.map.latLngToContainerPoint([item.latitude, item.longitude]);
    var LY = liveLayout(T, item, arms, { W: W, H: H, cx: cpx.x, cy: cpx.y, s: liveScale() }), geo = LY.geo;
    var ov = svg("svg", { class: "live-ov", viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "Animasi lalu lintas di atas peta " + item.nama_lokasi });
    var root = svg("g", {});
    ov.appendChild(root);
    live.root = root; live.marks = [];
    var byArm = {};
    item.jalur.forEach(function (l) { byArm[l.arah] = l; });
    var layers = {};
    var col = function (pct) { return pct >= KRITIS_PCT ? "#d0334a" : pct >= PADAT_PCT ? "#114eab" : "#2f9e5a"; };
    var Ill = window.SinapsisRoadIllus, mk = Ill ? Ill.markup(LY.roads, { cx: 0, cy: 0, lane: LIVE_RAD.lane, half: LIVE_RAD.half, disc: LIVE_RAD.disc, stop: LIVE_RAD.stop, end: LIVE_DRAW_LEN }) : null;
    if (mk) {   // ilustrasi jalan hasil generate (aspal, marka, garis henti) menutupi jalan peta yang dipudarkan
      var gu = svg("g", { class: "illus-under" });
      gu.innerHTML = mk.under;
      root.appendChild(gu);
    }
    arms.forEach(function (a) {      // sorot jalan tiap lengan, diwarnai status kepadatan
      var l = byArm[a], pts = LY.hl[a];
      root.appendChild(svg("polyline", { class: "lm-hl", points: pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "),
        fill: "none", "stroke-linejoin": "round", "stroke-width": LIVE_RAD.half * 1.7, stroke: col(l ? l.densitas_pct : 0) }));
    });
    if (mk) {
      var gm = svg("g", { class: "illus-marks" });
      gm.innerHTML = mk.marks;
      root.appendChild(gm);
    } else {
      root.appendChild(svg("circle", { class: "lm-core", cx: 0, cy: 0, r: LIVE_RAD.disc * 0.6 }));
    }
    arms.forEach(function (a) { layers[a] = svg("g", { class: "cars" }); root.appendChild(layers[a]); });
    arms.forEach(function (a, i) {
      var l = byArm[a], bp = LY.badge[a];
      var bg = svg("g", {});
      bg.appendChild(svg("circle", { class: "arm-badge", r: 13, style: "stroke:" + col(l ? l.densitas_pct : 0) + ";stroke-width:3.5px" }));   // cincin = status kepadatan
      bg.appendChild(svg("text", { class: "arm-badge-t", y: 4.8, style: "font-size:13px" }, armLabel(a, i)));
      root.appendChild(bg);
      live.marks.push({ g: bg, x: bp.x, y: bp.y, k: 1 });
      if (l) {
        var green = l.sinyal === "HIJAU", lp = LY.lamp[a];
        var sg = svg("g", {});
        sg.appendChild(svg("rect", { class: "signal-box", x: -12, y: -22, width: 24, height: 44, rx: 6 }));
        sg.appendChild(svg("circle", { class: green ? "lamp-red-off" : "lamp-red-on", cx: 0, cy: -10, r: 6.5 }));
        sg.appendChild(svg("circle", { class: green ? "lamp-green-on" : "lamp-green-off", cx: 0, cy: 10, r: 6.5 }));
        root.appendChild(sg);
        live.marks.push({ g: sg, x: lp.x, y: lp.y, k: 0.5 });
      }
    });
    live.el.appendChild(ov);
    applyLiveScale();
    var list = el("div", "live-arms");
    var isOff = !!item.sensor_offline;
    arms.forEach(function (a, i) {
      var l = byArm[a]; if (!l) return;
      var chip = el("span", "live-chip " + (isOff ? "c-offline" : densityClass(l.densitas_pct).replace("q-", "c-")));
      chip.appendChild(el("b", null, armLabel(a, i)));
      var statusWord = isOff ? "Sensor offline" : densityWord(l.densitas_pct);
      var kendText = isOff ? "—" : l.jumlah_kendaraan + " kend.";
      chip.appendChild(document.createTextNode(" " + kendText + " · " + statusWord +
        (l.sinyal === "HIJAU" ? " · hijau " + l.durasi + " dtk" : "")));
      list.appendChild(chip);
    });
    box.appendChild(list);
    syncTraffic(item, arms, layers, ov, geo);
    return true;
  }

  function renderDiagram(d) {
    var box = $("diagram");
    clear(box);
    var item = currentItem();
    var legendEl = $("diagramLegend");
    if (legendEl) {
      if (item && (item.sensor_offline || (item.periode && String(item.periode).toUpperCase().indexOf("FAIL_SAFE") !== -1))) {
        legendEl.textContent = "Mode Fail-Safe: Sensor/CCTV offline. Lampu menyala berdasarkan jadwal timer konvensional bergilir (Fixed-Timer Round-Robin) demi keselamatan interlocking (tepat satu lajur hijau).";
      } else {
        legendEl.textContent = "Satu mobil atau motor di layar = satu kendaraan pada data siklus terakhir. Lajur masuk berada di sisi kiri jalan; kendaraan di lengan hijau dilepas satu per satu, lengan merah menunggu. Lampu menyala sesuai keputusan terakhir mesin LIF.";
      }
    }
    box.classList.toggle("corridor-on", !!(item && item.koridor_hijau));
    if (item && item.koridor_hijau) box.appendChild(corridorBadge(item));
    if (!item || !item.jalur.length) {
      box.appendChild(
        el(
          "div",
          "empty",
          item && item.sensor_offline
            ? "Sensor offline — belum ada data untuk ditampilkan."
            : "Belum ada data siklus. Tekan “Refresh Data” untuk memulai pemantauan.",
        ),
      );
      return;
    }
    var cap = d.kapasitas_jalur || 20;
    if (item.data_usang)
      box.appendChild(
        el(
          "div",
          "banner banner-sensor",
          "Sensor offline — menampilkan data terakhir yang tersedia.",
        ),
      );
    var arms = item.jalur.map(function (l) {
      return l.arah;
    });
    if (state.view === "cctv") {
      destroyLive();
      renderCctvWall(box, item, arms);
      return;
    }
    if (renderLive(box, item, d, arms)) return;
    if (live.failed && hasGeo(item))
      box.appendChild(el("div", "banner banner-sensor", "Peta dasar tidak dapat dimuat — menampilkan diagram skematik."));
    if (isNumberedArms(arms) && renderRadial(box, item, d, arms)) return;
    var s = svg("svg", {
      viewBox: "0 0 760 560",
      role: "img",
      "aria-label":
        "Diagram persimpangan " +
        item.nama_lokasi +
        ", " +
        (item.tipe || arms.length + " lengan"),
    });
    drawRoads(s, arms);
    s.appendChild(
      svg("rect", { x: 332, y: 232, width: 96, height: 96, fill: "#4d5158" }),
    );
    s.appendChild(
      svg("rect", { class: "asphalt-tex", x: 332, y: 232, width: 96, height: 96 }),
    );
    drawLaneArrows(s, arms);
    drawCompass(s);
    s.appendChild(
      svg(
        "text",
        { class: "center-text", x: 380, y: 276 },
        formatPeriod(item.periode),
      ),
    );
    s.appendChild(
      svg(
        "text",
        { class: "center-text", x: 380, y: 293 },
        "Siklus " + item.siklus,
      ),
    );

    var layers = {};
    item.jalur.forEach(function (lane) {
      var cfg = ARMS[lane.arah];
      if (!cfg) return;
      var g = svg("g", {});
      g.appendChild(
        svg(
          "title",
          {},
          lane.arah +
            ": " +
            lane.jumlah_kendaraan +
            " kendaraan (" +
            lane.densitas_pct +
            "%). " +
            (lane.sinyal === "HIJAU"
              ? "Lampu hijau " + lane.durasi + " dtk"
              : "Lampu merah, jatah hijau berikutnya " + lane.durasi + " dtk") +
            (lane.spike ? ". Neuron spike" : "") +
            ". " +
            lane.alasan,
        ),
      );
      [cfg.stop].forEach(function (r) {
        g.appendChild(
          svg("rect", {
            class: "stop",
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          }),
        );
      });
      layers[lane.arah] = svg("g", { class: "cars" }); // kendaraan (animasi) milik lengan ini
      g.appendChild(layers[lane.arah]);
      drawSignal(g, cfg, lane);
      drawTag(g, cfg, lane, cap);
      s.appendChild(g);
    });
    box.appendChild(s);
    syncTraffic(item, arms, layers, s);
  }

  /* ---------- animasi lalu lintas (logika di traffic_anim.js) ---------- */
  var traffic = {
    sim: null,
    key: "",
    fresh: true,
    layers: {},
    nodes: {},
    root: null,
    raf: 0,
    last: 0,
  };

  function animEnabled() {
    var saved = null;
    try {
      saved = window.localStorage.getItem("sinapsis_anim");
    } catch (e) {
      saved = null;
    }
    if (saved === "on") return true;
    if (saved === "off") return false;
    return !(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }
  function paintAnimToggle() {
    var b = $("animToggle"),
      on = animEnabled();
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Animasi: hidup" : "Animasi: mati";
  }

  /* Kendaraan dilihat dari atas, bagian depan menghadap atas (-y). Dibangun dari beberapa bagian agar
     tampak hidup: bayangan, bodi, kaca, lampu depan, lampu rem, dan sein belok. */
  function rectNode(cls, fill) {
    var r = svg("rect", { class: cls });
    if (fill) r.setAttribute("fill", fill);
    return r;
  }
  function carNode(c) {
    var motor = c.kind === "motor";
    var g = svg("g", { class: "veh " + (motor ? "veh-motor" : "veh-car") });
    var p = {
      shadow: rectNode("veh-shadow"),
      body: rectNode("car", c.color),
      glass: rectNode("glass"),
      rear: rectNode("glass rear"),
      roof: rectNode("veh-roof"),
      hl: rectNode("veh-head"),
      hr: rectNode("veh-head"),
      tl: rectNode("veh-tail"),
      tr: rectNode("veh-tail"),
      bl: svg("circle", { class: "veh-blink bl-l", r: 1.5 }),
      br: svg("circle", { class: "veh-blink bl-r", r: 1.5 }),
      rider: svg("circle", { class: "rider", cx: 0, r: 2.5 }),
      bar: rectNode("veh-bar"),
    };
    var order = motor
      ? ["shadow", "body", "bar", "rider", "hl", "tl", "bl", "br"]
      : ["shadow", "body", "glass", "rear", "roof", "hl", "hr", "tl", "tr", "bl", "br"];
    order.forEach(function (k) {
      g.appendChild(p[k]);
    });
    return { el: g, p: p, kind: c.kind, len: -1, brake: null, turn: null };
  }
  function fitCar(n, c) {
    var p = n.p,
      w = c.w,
      l = c.len,
      set = function (node, a) {
        Object.keys(a).forEach(function (k) {
          node.setAttribute(k, typeof a[k] === "number" ? a[k].toFixed(1) : a[k]);
        });
      };
    set(p.shadow, { x: -w / 2 + 1.4, y: -l / 2 + 1.8, width: w, height: l, rx: 3 });
    set(p.body, { x: -w / 2, y: -l / 2, width: w, height: l, rx: n.kind === "motor" ? 2.4 : 3 });
    if (n.kind === "motor") {
      set(p.bar, { x: -w / 2 - 1.6, y: -l / 2 + 2.2, width: w + 3.2, height: 1.2, rx: 0.6 });
      set(p.rider, { cy: 0.8 });
      set(p.hl, { x: -0.9, y: -l / 2 - 0.2, width: 1.8, height: 1.2, rx: 0.5 });
      set(p.tl, { x: -0.9, y: l / 2 - 1.3, width: 1.8, height: 1.1, rx: 0.5 });
      set(p.bl, { cx: -w / 2 - 1.6, cy: -l / 2 + 2.8 });
      set(p.br, { cx: w / 2 + 1.6, cy: -l / 2 + 2.8 });
    } else {
      set(p.glass, { x: -w / 2 + 1.4, y: -l / 2 + 2.6, width: w - 2.8, height: Math.max(2.6, l * 0.22), rx: 1.1 });
      set(p.rear, { x: -w / 2 + 1.6, y: l / 2 - 2.6 - Math.max(2, l * 0.13), width: w - 3.2, height: Math.max(2, l * 0.13), rx: 1 });
      set(p.roof, { x: -w / 2 + 2, y: -l * 0.1, width: w - 4, height: Math.max(3, l * 0.3), rx: 1.4 });
      set(p.hl, { x: -w / 2 + 0.7, y: -l / 2 - 0.2, width: 2.4, height: 1.5, rx: 0.6 });
      set(p.hr, { x: w / 2 - 3.1, y: -l / 2 - 0.2, width: 2.4, height: 1.5, rx: 0.6 });
      set(p.tl, { x: -w / 2 + 0.7, y: l / 2 - 1.5, width: 2.4, height: 1.4, rx: 0.5 });
      set(p.tr, { x: w / 2 - 3.1, y: l / 2 - 1.5, width: 2.4, height: 1.4, rx: 0.5 });
      set(p.bl, { cx: -w / 2 + 0.2, cy: -l / 2 + 1.2 });
      set(p.br, { cx: w / 2 - 0.2, cy: -l / 2 + 1.2 });
    }
    n.len = c.len;
  }
  function paintCars() {
    var sim = traffic.sim,
      alive = {};
    sim.cars.forEach(function (c) {
      alive[c.id] = true;
      var n = traffic.nodes[c.id];
      if (!n) {
        var layer = traffic.layers[c.lane];
        if (!layer) return;
        n = traffic.nodes[c.id] = carNode(c);
        fitCar(n, c);
        layer.appendChild(n.el);
      }
      n.el.setAttribute(
        "transform",
        "translate(" +
          c.x.toFixed(1) +
          " " +
          c.y.toFixed(1) +
          ") rotate(" +
          c.angle.toFixed(0) +
          ")",
      );
      n.el.setAttribute("opacity", c.alpha < 1 ? c.alpha.toFixed(2) : "1");
      if (Math.abs(n.len - c.len) > 0.4) fitCar(n, c);
      // lampu rem menyala saat kendaraan menunggu di lampu merah; sein menyala saat membelok
      var lane = sim.lanes[c.lane],
        brake = c.state === "queue" && !!lane && !lane.green;
      if (n.brake !== brake) {
        n.brake = brake;
        n.el.classList.toggle("braking", brake);
      }
      if (n.turn !== c.turn) {
        n.turn = c.turn;
        if (c.turn) n.el.setAttribute("data-turn", String(c.turn));
        else n.el.removeAttribute("data-turn");
      }
    });
    Object.keys(traffic.nodes).forEach(function (id) {
      if (!alive[id]) {
        var n = traffic.nodes[id];
        if (n.el.parentNode) n.el.parentNode.removeChild(n.el);
        delete traffic.nodes[id];
      }
    });
  }
  function frame(ts) {
    traffic.raf = 0;
    if (
      !traffic.sim ||
      !traffic.root ||
      !document.body.contains(traffic.root) ||
      !animEnabled()
    )
      return;
    var dt = traffic.last ? (ts - traffic.last) / 1000 : 0;
    traffic.last = ts;
    traffic.sim.step(dt);
    paintCars();
    traffic.raf = window.requestAnimationFrame(frame);
  }
  function syncTraffic(item, arms, layers, root, geo) {
    var T = window.SinapsisTraffic;
    if (!T) return;
    var key = item.id_persimpangan + ":" + arms.join() + (geo && geo[arms[0]] ? ":" + geo[arms[0]].stop[0].toFixed(0) + ":" + arms.map(function (a) { return geo[a].bearing.toFixed(0); }).join() : "");
    if (!traffic.sim || traffic.key !== key) {
      traffic.sim = new T.Sim(arms, geo ? { geo: geo } : undefined);
      traffic.key = key;
      traffic.fresh = true;
    }
    var data = {};
    item.jalur.forEach(function (l) {
      data[l.arah] = {
        n: l.jumlah_kendaraan,
        green: l.sinyal === "HIJAU" && !item.data_usang,
      };
    });
    var on = animEnabled();
    traffic.sim.update(data, traffic.fresh || !on); // pertama kali / animasi mati: langsung sesuai data
    traffic.fresh = false;
    traffic.layers = layers;
    traffic.nodes = {};
    traffic.root = root; // DOM dibuat ulang tiap render
    paintCars();
    window.cancelAnimationFrame(traffic.raf);
    traffic.raf = 0;
    traffic.last = 0;
    if (on) traffic.raf = window.requestAnimationFrame(frame);
  }

  function metric(k, v, sub, badge) {
    var m = el("div", "metric");
    m.appendChild(el("div", "k", k));
    var val = el("div", "v", v);
    if (badge) {
      val.appendChild(document.createTextNode(" "));
      val.appendChild(
        el("span", "badge" + (badge.warn ? " warn" : ""), badge.text),
      );
    }
    m.appendChild(val);
    if (sub) m.appendChild(el("div", "s", sub));
    return m;
  }

  function renderMetrics(d) {
    var box = $("metrics");
    clear(box);
    var it = currentItem();
    if (!it || !it.jalur.length) return;
    var isOffline = !!it.sensor_offline;
    var isFailSafe = isOffline || (it.periode && String(it.periode).toUpperCase().indexOf("FAIL_SAFE") !== -1);

    var greens = it.jalur
      .filter(function (l) {
        return l.sinyal === "HIJAU";
      })
      .map(function (l) {
        return l.arah + " " + l.durasi + " dtk";
      });
    box.appendChild(
      metric(
        "Total kendaraan",
        isOffline ? "0" : String(it.jumlah_kendaraan),
        isOffline ? "Sensor offline, siklus terakhir" : (it.tipe || it.jalur.length + " lengan") + ", siklus terakhir",
        it.status === "Kritis" ? { text: "Macet" } : (isOffline ? { text: "Offline", warn: true } : null),
      ),
    );

    var terpadatTitle = isOffline ? "—" : it.jalur_terpadat.arah;
    var terpadatSub = isOffline
      ? "Data sensor terputus"
      : it.jalur_terpadat.jumlah + " kendaraan (" + it.densitas_maks_pct + "%)";
    box.appendChild(
      metric(
        "Jalur terpadat",
        terpadatTitle,
        terpadatSub,
        isOffline ? { text: "Offline", warn: true } : null,
      ),
    );

    box.appendChild(
      metric(
        "Lampu hijau",
        greens.length ? greens.join(", ") : "Tidak ada",
        isFailSafe ? "Rotasi fixed-timer (Interlocking Safety)" : "lengan lain menunggu",
      ),
    );

    var periodeTitle = isFailSafe ? "Timer Tetap" : formatPeriod(it.periode);
    var periodeSub = isFailSafe ? "Fail-Safe (Non-AI)" : "ambang spike " + dec(it.ambang);
    box.appendChild(
      metric("Periode", periodeTitle, periodeSub),
    );

    box.appendChild(
      metric(
        "Prediksi jam depan",
        (isOffline || it.prediksi_maks_pct === null) ? "—" : it.prediksi_maks_pct + "%",
        isOffline
          ? "mode darurat fixed-timer"
          : (it.prediksi_maks_pct === null ? "riwayat belum cukup" : "kepadatan jalur terpadat"),
        (!isOffline && earlyWarning(it, d)) ? { text: "Peringatan dini", warn: true } : null,
      ),
    );
  }

  function renderPrediction(d) {
    var box = $("predPanel");
    clear(box);
    var it = currentItem();
    $("predModel").textContent =
      it && it.model_prediksi ? it.model_prediksi : "";
    if (!it || !it.jalur.length) {
      box.appendChild(el("p", "pred-msg", "Menunggu data siklus pertama."));
      return;
    }
    var has = it.jalur.some(function (l) {
      return l.prediksi_rasio !== null;
    });
    if (!has) {
      box.appendChild(
        el(
          "p",
          "pred-msg",
          "Prediksi belum tersedia: riwayat 24 siklus belum terkumpul untuk persimpangan ini.",
        ),
      );
      return;
    }
    var cap = d.kapasitas_jalur || 20;
    var limit = d.ambang_peringatan_dini_pct;
    it.jalur.forEach(function (l) {
      var pct = Math.round(100 * l.prediksi_rasio);
      var pred = Math.round(l.prediksi_rasio * cap);
      var delta = pred - l.jumlah_kendaraan;
      var row = el("div", "pred-row");
      row.appendChild(el("span", null, l.arah));
      var bars = el("div", "bars");
      var now = el("div", "bar");
      var nf = el("span");
      nf.style.width = Math.max(2, Math.min(100, l.densitas_pct)) + "%";
      now.appendChild(nf);
      var nxt = el("div", "bar next");
      var xf = el("span", limit !== null && pct >= limit ? "hot" : "");
      xf.style.width = Math.max(2, Math.min(100, pct)) + "%";
      nxt.appendChild(xf);
      bars.appendChild(now);
      bars.appendChild(nxt);
      row.appendChild(bars);
      var val = el("span", "val");
      val.appendChild(document.createTextNode(l.jumlah_kendaraan + " → "));
      val.appendChild(
        el("span", delta >= 2 ? "up" : delta <= -2 ? "down" : "", String(pred)),
      );
      row.appendChild(val);
      box.appendChild(row);
    });
    var key = el("div", "key");
    var a = el("span");
    a.appendChild(el("i"));
    a.appendChild(document.createTextNode("sekarang"));
    var b = el("span");
    b.appendChild(el("i", "n"));
    b.appendChild(document.createTextNode("jam berikutnya"));
    key.appendChild(a);
    key.appendChild(b);
    box.appendChild(key);
    box.appendChild(
      el(
        "p",
        "note",
        "Perkiraan dari model terlatih (riwayat 24 jam). Bilah merah melewati ambang peringatan dini" +
          (limit !== null ? " (" + limit + "%)." : "."),
      ),
    );
  }

  function renderTelemetry(d) {
    var body = $("telemetryBody");
    clear(body);
    d.simpang.forEach(function (s) {
      var tr = el(
        "tr",
        (s.status === "Kritis" ? "crit" : "") + (s.data_usang ? " stale" : ""),
      );
      var has = s.jalur.length > 0;
      var cells = [
        [s.nama_lokasi, ""],
        [coord(s), "mono"],
        [has ? (s.sensor_offline ? "0" : String(s.jumlah_kendaraan)) : "—", "num"],
        [
          has
            ? (s.sensor_offline ? "—" : s.jalur_terpadat.arah + " (" + s.jalur_terpadat.jumlah + ")")
            : "—",
          "",
        ],
        [has ? (s.sensor_offline ? "—" : s.densitas_maks_pct + "%") : "—", "num"],
        [has ? (s.sensor_offline ? "Timer Tetap (Fail-Safe)" : formatPeriod(s.periode) + " (" + dec(s.ambang) + ")") : "—", ""],
        [
          has && s.prediksi_maks_pct !== null ? s.prediksi_maks_pct + "%" : "—",
          "num",
        ],
        [
          has
            ? s.status_algoritma
            : s.sensor_offline
              ? "Sensor Offline"
              : "Belum ada data",
          "",
        ],
      ];
      cells.forEach(function (c) {
        tr.appendChild(el("td", c[1], c[0]));
      });
      body.appendChild(tr);
    });
  }

  /* ---------- siklus pembaruan ---------- */
  function load() {
    return request(API_DASHBOARD).then(function (r) {
      onData(r);
      var needSeed = r.json.simpang.some(function (s) {
        return s.jalur.length === 0;
      });
      return needSeed ? tick(false) : null;
    });
  }

  function onData(r) {
    showError("");
    setOnline(true, "Sistem online");
    $("latency").textContent = "Latensi API: " + r.ms + " ms";
    render(r.json);
  }

  function onRealtimeData(data) {
    showError("");
    setOnline(true, "Sistem online");
    render(data);
  }

  function tick(manual) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    $("btnRefresh").disabled = true;
    return request(API_REFRESH, { method: "POST" })
      .then(function (r) {
        onData(r);
        if (manual)
          toast(r.json.pesan || "Data lalu lintas berhasil dimuat ulang.");
      })
      .catch(function (e) {
        setOnline(false, "Server tidak tersambung");
        showError("Gagal memuat data lalu lintas: " + e.message);
      })
      .then(function () {
        state.busy = false;
        $("btnRefresh").disabled = false;
      });
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!$("autoToggle").checked || state.wsConnected) return;
    state.timer = setTimeout(
      function () {
        pollDashboard().then(schedule);
      },
      Number($("autoInterval").value),
    );
  }

  function pollDashboard() {
    return request(API_DASHBOARD)
      .then(onData)
      .catch(function (e) {
        setOnline(false, "Server tidak tersambung");
        showError("Gagal memuat data lalu lintas: " + e.message);
      });
  }

  function connectLive() {
    var token = null;
    try {
      token = localStorage.getItem("access_token");
    } catch (e) {
      /* storage diblokir */
    }
    if (!token || !window.WebSocket) {
      schedule();
      return;
    }
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    var url =
      protocol +
      "//" +
      window.location.host +
      "/ws/live?token=" +
      encodeURIComponent(token) +
      "&interval=1";
    var ws = new WebSocket(url);
    state.ws = ws;
    ws.onopen = function () {
      state.wsConnected = true;
      clearTimeout(state.timer);
      setOnline(true, "Sistem online");
    };
    ws.onmessage = function (event) {
      try {
        onRealtimeData(JSON.parse(event.data));
      } catch (e) {
        /* abaikan frame rusak */
      }
    };
    ws.onerror = function () {
      ws.close();
    };
    ws.onclose = function () {
      state.wsConnected = false;
      if (state.ws === ws) state.ws = null;
      schedule();
      clearTimeout(state.wsRetry);
      state.wsRetry = setTimeout(connectLive, 5000);
    };
  }

  function updateMode() {
    $("modeLabel").textContent =
      "Mode: " + ($("autoToggle").checked ? "otomatis" : "manual");
    schedule();
  }

  function startClock() {
    function paint() {
      $("clock").textContent =
        new Date()
          .toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            hour12: false,
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
          .replace(/\./g, ":") + " WIB";
    }
    paint();
    setInterval(paint, 1000);
  }

  function init() {
    startClock();
    showSkeleton();
    paintAnimToggle();
    state.view = readView();
    paintView();
    $("viewAnim").addEventListener("click", function () {
      setView("anim");
    });
    $("viewCctv").addEventListener("click", function () {
      setView("cctv");
    });
    $("animToggle").addEventListener("click", function () {
      var next = animEnabled() ? "off" : "on";
      try {
        window.localStorage.setItem("sinapsis_anim", next);
      } catch (e) {
        /* diabaikan */
      }
      paintAnimToggle();
      if (state.data) renderDiagram(state.data);
    });
    $("btnRefresh").addEventListener("click", function () {
      tick(true).then(schedule);
    });
    $("autoToggle").addEventListener("change", updateMode);
    $("autoInterval").addEventListener("change", schedule);
    $("selSimpang").addEventListener("change", function (e) {
      selectSimpang(Number(e.target.value));
    });
    load()
      .catch(function (e) {
        setOnline(false, "Server tidak tersambung");
        showError("Gagal memuat data lalu lintas: " + e.message);
      })
      .then(connectLive);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
