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

  function drawRoads(s, arms) {
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

  function renderDiagram(d) {
    var box = $("diagram");
    clear(box);
    var item = currentItem();
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
    drawCompass(s);
    s.appendChild(
      svg(
        "text",
        { class: "center-text", x: 380, y: 276 },
        sentence(item.periode),
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

  function carNode(c) {
    var g = svg("g", {});
    var w = c.w,
      l = c.len;
    g.appendChild(
      svg("rect", {
        class: "car",
        x: -w / 2,
        y: -l / 2,
        width: w,
        height: l,
        rx: c.kind === "motor" ? 2 : 2.5,
        fill: c.color,
      }),
    );
    if (c.kind === "motor")
      g.appendChild(svg("circle", { class: "rider", cx: 0, cy: 0, r: 2.4 }));
    else
      g.appendChild(
        svg("rect", {
          class: "glass",
          x: -w / 2 + 1.5,
          y: -l / 2 + 2,
          width: w - 3,
          height: Math.max(3, l * 0.26),
          rx: 1,
        }),
      );
    return g;
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
        n = traffic.nodes[c.id] = { el: carNode(c), kind: c.kind };
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
      var body = n.el.firstChild;
      if (body && Math.abs(Number(body.getAttribute("height")) - c.len) > 0.4) {
        body.setAttribute("height", c.len.toFixed(1));
        body.setAttribute("y", (-c.len / 2).toFixed(1));
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
  function syncTraffic(item, arms, layers, root) {
    var T = window.SinapsisTraffic;
    if (!T) return;
    var key = item.id_persimpangan + ":" + arms.join();
    if (!traffic.sim || traffic.key !== key) {
      traffic.sim = new T.Sim(arms);
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
        String(it.jumlah_kendaraan),
        (it.tipe || it.jalur.length + " lengan") + ", siklus terakhir",
        it.status === "Kritis" ? { text: "Macet" } : null,
      ),
    );
    box.appendChild(
      metric(
        "Jalur terpadat",
        it.jalur_terpadat.arah,
        it.jalur_terpadat.jumlah + " kendaraan (" + it.densitas_maks_pct + "%)",
      ),
    );
    box.appendChild(
      metric(
        "Lampu hijau",
        greens.length ? greens.join(", ") : "Tidak ada",
        "lengan lain menunggu",
      ),
    );
    box.appendChild(
      metric("Periode", sentence(it.periode), "ambang spike " + dec(it.ambang)),
    );
    box.appendChild(
      metric(
        "Prediksi jam depan",
        it.prediksi_maks_pct === null ? "—" : it.prediksi_maks_pct + "%",
        it.prediksi_maks_pct === null
          ? "riwayat belum cukup"
          : "kepadatan jalur terpadat",
        earlyWarning(it, d) ? { text: "Peringatan dini", warn: true } : null,
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
        [has ? String(s.jumlah_kendaraan) : "—", "num"],
        [
          has
            ? s.jalur_terpadat.arah + " (" + s.jalur_terpadat.jumlah + ")"
            : "—",
          "",
        ],
        [has ? s.densitas_maks_pct + "%" : "—", "num"],
        [has ? sentence(s.periode) + " (" + dec(s.ambang) + ")" : "—", ""],
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
    paintAnimToggle();
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
