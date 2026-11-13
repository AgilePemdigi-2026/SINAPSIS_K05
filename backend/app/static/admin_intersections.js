/* SINAPSIS: Kelola Sistem / Registrasi Persimpangan (F5, GIS & Mapping).
   HTML/CSS/JS murni + Leaflet 1.9.4 (disertakan di /static/vendor/leaflet, tanpa CDN). Peta dasar OpenStreetMap
   dimuat dari internet; bila gagal, titik persimpangan dan pengisian koordinat tetap berfungsi.
   Rute halaman: /admin/intersections (daftar + peta) dan /admin/intersections/add (form). */
(function () {
  "use strict";

  var API_LIST = "/api/admin/intersections";
  var API_DASH = "/api/monitoring/dashboard";
  var API_REFRESH = "/api/monitoring/refresh";
  var MODE = /\/add\/?$/.test(window.location.pathname) ? "add" : "list";
  var MSG_OK = "Persimpangan baru berhasil ditambahkan!";
  var MSG_NAMA = "Nama lokasi persimpangan wajib diisi!"; // REQ-13
  var DESK_MAX = 250; // SRS 3.1.2
  var POLL_MS = 5000;
  var LANES = ["Utara", "Selatan", "Timur", "Barat"];
  var ID_BOX = { latMin: -11.5, latMax: 6.5, lonMin: 94.5, lonMax: 141.5 }; // perkiraan wilayah Indonesia
  var START_VIEW = { lat: -7.2575, lon: 112.7521, zoom: 12 }; // Surabaya, bila belum ada titik terdaftar
  var TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var LABEL_MIN_ZOOM = 12; // nama persimpangan disembunyikan bila peta terlalu jauh

  var state = {
    items: [],
    live: {},
    liveAt: null,
    selected: null,
    draft: null,
    freshId: null,
    timer: null,
    autoRefreshed: false,
    registrationVision: {},
  };
  var gis = {
    map: null,
    layer: null,
    pins: {},
    draftPin: null,
    fitted: false,
    tileErrors: 0,
  };

  /* ---------- util DOM ---------- */
  function $(id) {
    return document.getElementById(id);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function dec(n) {
    return String(n).replace(".", ",");
  }
  function fmtCoord(n) {
    return dec(Number(n).toFixed(5));
  }
  function store(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function drop(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* diabaikan */
    }
  }

  /* ---------- jaringan ---------- */
  function toLogin() {
    drop("access_token");
    drop("user_info"); // token basi dibuang agar tidak berputar
    window.location.replace("/login");
  }

  function request(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers);
    var tk = store("access_token");
    if (tk) headers.Authorization = "Bearer " + tk;
    return fetch(url, Object.assign({}, opts, { headers: headers })).then(
      function (res) {
        if (res.status === 401) {
          toLogin();
          var authError = new Error("Sesi berakhir. Silakan login ulang.");
          authError.status = 401;
          throw authError;
        }
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!res.ok) {
              var d = body.detail;
              var err = new Error(
                typeof d === "string"
                  ? d
                  : "Permintaan gagal (HTTP " + res.status + ").",
              );
              err.status = res.status;
              throw err;
            }
            return body;
          });
      },
    );
  }

  function requestImage(url, body) {
    var headers = { Accept: "image/jpeg" };
    var token = store("access_token");
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(url, { method: "POST", headers: headers, body: body }).then(
      function (response) {
        if (!response.ok) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              throw new Error(
                body.detail ||
                  "Gagal memproses gambar (HTTP " + response.status + ").",
              );
            });
        }
        return response.blob();
      },
    );
  }

  function visionPreviewKey(intersectionId, lane) {
    return "sinapsis_vision_preview:" + intersectionId + ":" + lane;
  }

  function getVisionPreview(intersectionId, lane) {
    return store(visionPreviewKey(intersectionId, lane));
  }

  function saveVisionPreview(intersectionId, lane, dataUrl) {
    try {
      window.localStorage.setItem(
        visionPreviewKey(intersectionId, lane),
        dataUrl,
      );
    } catch (e) {
      // Preview tetap ditampilkan meskipun storage browser penuh/terblokir.
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function reloadIntersectionData() {
    return request(API_LIST).then(function (items) {
      state.items = items;
      renderTable();
      redrawMaps();
      return items;
    });
  }

  function closeAddDialog() {
    var dialog = $("intersectionDialog");
    if (dialog && typeof dialog.close === "function" && dialog.open)
      dialog.close();
    var section = $("addSection");
    if (section) section.hidden = true;
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
    window.clearTimeout(toast.t);
    toast.t = window.setTimeout(function () {
      t.hidden = true;
    }, 6000);
  }

  /* ---------- status (mengikuti kelas dashboard.css) ---------- */
  function liveOf(id) {
    return state.live[id] || null;
  }
  function statusText(id) {
    var l = liveOf(id);
    return l ? l.status : "Belum ada data";
  }
  function statusClass(s) {
    if (s === "Lancar") return "st-lancar";
    if (s === "Padat") return "st-padat";
    if (s === "Kritis") return "st-kritis";
    if (s === "Sensor Offline") return "st-offline";
    return "st-belum";
  }
  function qClass(s) {
    if (s === "Lancar") return "q-lancar";
    if (s === "Padat") return "q-padat";
    if (s === "Kritis") return "q-kritis";
    return "q-off";
  }
  function hasGeo(it) {
    return typeof it.latitude === "number" && typeof it.longitude === "number";
  }

  /* ---------- peta (Leaflet) ---------- */
  var PIN_PATH =
    "M0,0 C-2,-6 -10,-12 -10,-20 a10,10 0 1 1 20,0 C10,-12 2,-6 0,0 Z";

  function pinIcon(cls, selected) {
    var html =
      '<svg class="pin ' +
      cls +
      (selected ? " selected" : "") +
      '" viewBox="-18 -40 36 44" width="36" height="44" aria-hidden="true">' +
      (cls === "q-kritis"
        ? '<circle class="pin-pulse" cx="0" cy="-20" r="16"/>'
        : "") +
      '<path class="pin-body" d="' +
      PIN_PATH +
      '"/><circle class="pin-dot" cx="0" cy="-20" r="3.5"/></svg>';
    return L.divIcon({
      className: "pin-icon",
      html: html,
      iconSize: [36, 44],
      iconAnchor: [18, 40],
      tooltipAnchor: [14, -22],
    });
  }

  function showMapNote(msg) {
    var n = $(MODE === "add" ? "mapNoteAdd" : "mapNoteList");
    if (n) {
      n.hidden = !msg;
      n.textContent = msg || "";
    }
  }

  function initMap() {
    var node = $(MODE === "add" ? "mapMini" : "mapNet");
    if (!window.L) {
      showMapNote(
        "Pustaka peta tidak dapat dimuat. Isi koordinat secara manual pada form.",
      );
      return;
    }
    var map = L.map(node, {
      minZoom: 5,
      maxZoom: 19,
      zoomSnap: 0.5,
      maxBounds: [
        [ID_BOX.latMin, ID_BOX.lonMin],
        [ID_BOX.latMax, ID_BOX.lonMax],
      ],
      maxBoundsViscosity: 0.85,
      scrollWheelZoom: false, // aktif setelah peta diklik, supaya tidak membajak scroll halaman
    }).setView([START_VIEW.lat, START_VIEW.lon], START_VIEW.zoom);

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR })
      .on("tileload", function () {
        gis.tileErrors = 0;
        showMapNote("");
      })
      .on("tileerror", function () {
        gis.tileErrors += 1;
        if (gis.tileErrors >= 4)
          showMapNote(
            "Peta dasar belum dapat dimuat (periksa koneksi internet). Titik persimpangan dan pengisian koordinat tetap berfungsi.",
          );
      })
      .addTo(map);

    gis.map = map;
    gis.layer = L.layerGroup().addTo(map);
    node.addEventListener("mouseleave", function () {
      map.scrollWheelZoom.disable();
    });
    map.on("click", function () {
      map.scrollWheelZoom.enable();
    });
    map.on("zoomend", function () {
      node.classList.toggle("labels-off", map.getZoom() < LABEL_MIN_ZOOM);
    });
    node.classList.toggle("labels-off", map.getZoom() < LABEL_MIN_ZOOM);

    if (MODE === "add") {
      node.classList.add("pickable");
      map.on("click", function (e) {
        setCoordFields(e.latlng.lat, e.latlng.lng);
      });
    } else {
      map.on("click", function (e) {
        offerCreateHere(e.latlng);
      });
    }
  }

  // Tampilan awal: sesuaikan dengan titik terdaftar (sekali saja, supaya "Muat ulang" tidak menggeser peta)
  function fitView() {
    var map = gis.map;
    if (!map || gis.fitted) return;
    gis.fitted = true;
    var pts = state.items.filter(hasGeo).map(function (i) {
      return [i.latitude, i.longitude];
    });
    if (state.draft) {
      map.setView([state.draft.lat, state.draft.lon], 16);
      return;
    }
    if (!pts.length) return;
    if (pts.length === 1) {
      map.setView(pts[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
  }

  function ensureVisible(lat, lon) {
    var map = gis.map;
    if (map && !map.getBounds().pad(-0.1).contains([lat, lon]))
      map.panTo([lat, lon]);
  }

  function redrawMaps() {
    var map = gis.map;
    if (!map) return;
    var seen = {};
    state.items.filter(hasGeo).forEach(function (it) {
      var id = it.id_persimpangan,
        st = statusText(id),
        cls = qClass(st);
      var sel = MODE === "list" && state.selected === id,
        key = cls + "|" + sel;
      var pin = gis.pins[id];
      if (!pin) {
        pin = L.marker([it.latitude, it.longitude], {
          icon: pinIcon(cls, sel),
          title: it.nama_lokasi + ": " + st,
          keyboard: true,
        });
        pin.bindTooltip(it.nama_lokasi, {
          permanent: true,
          direction: "right",
          className: "plabel",
          opacity: 1,
        });
        if (MODE === "list")
          pin.on("click", function () {
            select(id);
          });
        pin.addTo(gis.layer);
        pin._key = key;
        gis.pins[id] = pin;
      } else {
        pin.setLatLng([it.latitude, it.longitude]);
        if (pin._key !== key) {
          pin.setIcon(pinIcon(cls, sel));
          pin._key = key;
        }
      }
      pin.setZIndexOffset(sel ? 1000 : cls === "q-kritis" ? 500 : 0);
      seen[id] = true;
    });
    Object.keys(gis.pins).forEach(function (id) {
      if (!seen[id]) {
        gis.layer.removeLayer(gis.pins[id]);
        delete gis.pins[id];
      }
    });
    if (MODE === "add") drawDraft();
    fitView();
  }

  function drawDraft() {
    var d = state.draft;
    if (!d) {
      if (gis.draftPin) {
        gis.map.removeLayer(gis.draftPin);
        gis.draftPin = null;
      }
      return;
    }
    if (!gis.draftPin) {
      gis.draftPin = L.marker([d.lat, d.lon], {
        icon: pinIcon("draft", false),
        draggable: true,
        title: "Titik baru (seret untuk menggeser)",
        keyboard: false,
        zIndexOffset: 2000,
      });
      gis.draftPin.bindTooltip("Titik baru", {
        permanent: true,
        direction: "right",
        className: "plabel",
        opacity: 1,
      });
      gis.draftPin.on("dragend", function () {
        var ll = gis.draftPin.getLatLng();
        setCoordFields(ll.lat, ll.lng);
      });
      gis.draftPin.addTo(gis.map);
    } else {
      gis.draftPin.setLatLng([d.lat, d.lon]);
    }
  }

  // Klik pada peta (atau seret pin) mengisi kolom koordinat pada form
  function setCoordFields(lat, lon) {
    $("fLat").value = dec(lat.toFixed(6));
    $("fLon").value = dec(lon.toFixed(6));
    setErr("fLat", "eLat", "");
    setErr("fLon", "eLon", "");
    syncDraft();
  }

  // Mode daftar: klik titik kosong pada peta menawarkan pendaftaran persimpangan di lokasi itu
  function offerCreateHere(ll) {
    var box = el("div", "popup-create");
    box.appendChild(el("strong", null, "Daftarkan persimpangan di sini?"));
    box.appendChild(
      el("p", "muted", fmtCoord(ll.lat) + ", " + fmtCoord(ll.lng)),
    );
    var a = el("a", "btn", "Daftarkan di titik ini");
    a.href =
      "/admin/intersections/add?lat=" +
      ll.lat.toFixed(6) +
      "&lon=" +
      ll.lng.toFixed(6);
    box.appendChild(a);
    L.popup({ closeButton: true, autoPan: true })
      .setLatLng(ll)
      .setContent(box)
      .openOn(gis.map);
  }

  /* ---------- daftar, ringkasan, detail ---------- */
  function renderSummary() {
    var off = state.items.filter(function (i) {
      return statusText(i.id_persimpangan) === "Sensor Offline";
    }).length;
    $("sumTotal").textContent = String(state.items.length);
    $("sumGeo").textContent =
      state.items.filter(hasGeo).length + " dari " + state.items.length;
    $("sumOff").textContent = state.liveAt ? String(off) : "--";
  }

  function coordText(it) {
    return hasGeo(it)
      ? fmtCoord(it.latitude) + ", " + fmtCoord(it.longitude)
      : null;
  }

  function renderTable() {
    var body = $("tblBody");
    clear(body);
    $("tblCount").textContent = state.items.length + " persimpangan";
    if (!state.items.length) {
      var r0 = el("tr");
      var c0 = el("td", "empty-cell", "Belum ada persimpangan terdaftar.");
      c0.colSpan = 7;
      r0.appendChild(c0);
      body.appendChild(r0);
      return;
    }
    state.items.forEach(function (it) {
      var id = it.id_persimpangan,
        st = statusText(id),
        l = liveOf(id);
      var tr = el(
        "tr",
        (state.freshId === id ? "fresh " : "") +
          (MODE === "list" && state.selected === id ? "sel" : ""),
      );
      tr.appendChild(el("td", "name", it.nama_lokasi));
      var cc = coordText(it);
      tr.appendChild(el("td", cc ? "coord" : "muted", cc || "Belum diisi"));
      var tdS = el("td");
      tdS.appendChild(el("span", "st " + statusClass(st), st));
      tr.appendChild(tdS);
      tr.appendChild(
        el(
          "td",
          "num",
          l && st !== "Sensor Offline" && st !== "Belum ada data"
            ? String(l.jumlah_kendaraan)
            : "--",
        ),
      );
      var tdD = el("td");
      tdD.appendChild(
        el(
          "span",
          "chip" + (it.detektor_virtual ? "" : " off"),
          it.detektor_virtual ? "Aktif" : "Nonaktif",
        ),
      );
      tr.appendChild(tdD);
      tr.appendChild(
        el("td", null, it.tipe ? it.tipe.replace(/ \(\d lengan\)/, "") : "--"),
      );
      tr.appendChild(el("td", "num", String((it.jalur || []).length)));
      if (MODE === "list") {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", function () {
          select(id);
        });
      }
      body.appendChild(tr);
    });
  }

  function renderVisionSlots(intersection) {
    var feed = $("vision-feeds-section");
    if (!feed) return;
    clear(feed);
    feed.hidden = !intersection;
    if (!intersection) return;
    feed.style.maxHeight = "280px";
    feed.style.overflowY = "auto";
    feed.setAttribute("aria-labelledby", "visionFeedTitle");
    var feedTitle = el("h4", null, "Feed Vision Computer (YOLOv8)");
    feedTitle.id = "visionFeedTitle";
    feed.appendChild(feedTitle);
    var lanes = (intersection && intersection.jalur) || [];
    if (!lanes.length) {
      feed.appendChild(el("p", "muted", "Belum ada lajur untuk ditampilkan."));
      return feed;
    }

    lanes.forEach(function (lane) {
      var slot = el("article", "vision-slot");
      var slotHead = el("div", "vision-slot-head");
      slotHead.appendChild(el("strong", null, "Lajur " + lane.arah));
      var update = el(
        "button",
        "btn btn-sm btn-outline-primary w-100 mt-1 btn-outline sm",
        "Update Vision",
      );
      update.type = "button";
      update.title = "Pilih gambar atau video feed untuk lajur " + lane.arah;
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*";
      input.className = "vision-file";
      input.setAttribute("aria-label", "Update feed " + lane.arah);
      update.addEventListener("click", function () {
        input.click();
      });
      slotHead.appendChild(update);
      slot.appendChild(slotHead);

      var preview = el("div", "vision-preview");
      var placeholder = document.createElement("img");
      var savedPreview =
        getVisionPreview(intersection.id_persimpangan, lane.arah) ||
        lane.vision_preview;
      placeholder.src = savedPreview || "/static/img/placeholder_lane.jpg";
      placeholder.className = "img-fluid rounded my-1 vision-placeholder-image";
      placeholder.alt = "Placeholder feed Lajur " + lane.arah;
      placeholder.addEventListener("error", function () {
        placeholder.hidden = true;
      });
      preview.appendChild(placeholder);
      preview.appendChild(
        el("span", "vision-placeholder", "Feed CCTV belum terhubung"),
      );
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (file.type.indexOf("image/") !== 0) {
          showError(
            "Upload Vision hanya menerima file gambar untuk deteksi YOLOv8.",
          );
          input.value = "";
          return;
        }
        update.disabled = true;
        update.textContent = "Menganalisis...";
        var imageForm = new FormData();
        imageForm.append("frame", file);
        Promise.all([
          requestImage(
            "/api/vision/detect-image?lane=" +
              encodeURIComponent(lane.arah) +
              "&id_persimpangan=" +
              encodeURIComponent(intersection.id_persimpangan),
            imageForm,
          ),
        ])
          .then(function (responses) {
            return blobToDataUrl(responses[0]).then(function (dataUrl) {
              saveVisionPreview(
                intersection.id_persimpangan,
                lane.arah,
                dataUrl,
              );
              return dataUrl;
            });
          })
          .then(function (dataUrl) {
            clear(preview);
            var media = document.createElement("img");
            media.className = "vision-media";
            media.src = dataUrl;
            media.alt = "Pratinjau deteksi YOLOv8 Lajur " + lane.arah;
            preview.appendChild(media);
            update.textContent = "Update Vision";
            update.disabled = false;
            loadLive().then(renderAll);
          })
          .catch(function (error) {
            update.disabled = false;
            update.textContent = "Update Vision";
            showError(
              "Gagal memproses vision " + lane.arah + ": " + error.message,
            );
          });
      });
      slot.appendChild(preview);
      slot.appendChild(input);
      feed.appendChild(slot);
    });
    return feed;
  }

  function renderDetail() {
    var box = $("detailCard");
    if (!box) return;
    clear(box);
    var it = state.items.filter(function (i) {
      return i.id_persimpangan === state.selected;
    })[0];
    if (!it) {
      box.appendChild(
        el(
          "p",
          "muted",
          "Pilih titik pada peta atau baris pada tabel untuk melihat detail.",
        ),
      );
      return;
    }
    var st = statusText(it.id_persimpangan),
      l = liveOf(it.id_persimpangan);
    box.appendChild(el("h3", null, it.nama_lokasi));
    box.appendChild(el("span", "st " + statusClass(st), st));
    var dl = el("dl");
    function row(k, v) {
      var d = el("div");
      d.appendChild(el("dt", null, k));
      d.appendChild(el("dd", null, v));
      dl.appendChild(d);
    }
    row("Koordinat", coordText(it) || "Belum diisi");
    row(
      "Kendaraan",
      l && st !== "Sensor Offline" && st !== "Belum ada data"
        ? String(l.jumlah_kendaraan)
        : "--",
    );
    row("Bentuk", it.tipe || "--");
    row(
      "Lengan",
      (it.jalur || [])
        .map(function (j) {
          return j.arah;
        })
        .join(", "),
    );
    row("Detektor virtual", it.detektor_virtual ? "Aktif" : "Nonaktif");
    box.appendChild(dl);
    if (it.deskripsi) box.appendChild(el("p", "note", it.deskripsi));
  }

  function renderAll() {
    renderSummary();
    renderTable();
    if (MODE === "list") {
      renderDetail();
      renderVisionSlots(
        state.items.filter(function (i) {
          return i.id_persimpangan === state.selected;
        })[0] || null,
      );
    }
    redrawMaps();
    var note = $("dataNote");
    note.textContent = state.liveAt
      ? "Status dan jumlah kendaraan berasal dari data simulasi. Diperbarui " +
        state.liveAt +
        " WIB."
      : "Status belum tersedia (data pemantauan belum dimuat).";
  }

  function select(id) {
    state.selected = id;
    renderTable();
    renderDetail();
    renderVisionSlots(
      state.items.filter(function (i) {
        return i.id_persimpangan === id;
      })[0] || null,
    );
    redrawMaps();
    var it = state.items.filter(function (i) {
      return i.id_persimpangan === id;
    })[0];
    if (it && hasGeo(it)) ensureVisible(it.latitude, it.longitude);
  }

  /* ---------- pemuatan data ---------- */
  function wibClock(iso) {
    var d = iso ? new Date(iso + "Z") : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d
      .toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })
      .replace(/\./g, ":");
  }

  function applyLive(data) {
    var live = {};
    (data.simpang || []).forEach(function (s) {
      live[s.id_persimpangan] = s;
    });
    state.live = live;
    state.liveAt = wibClock(data.diperbarui);
  }

  function loadLive() {
    return request(API_DASH)
      .then(applyLive)
      .catch(function () {
        /* status opsional: tabel dan peta tetap tampil tanpa status */
      });
  }

  // Menjalankan satu siklus di semua simpang (sama dengan tombol "Muat ulang data" di dashboard)
  function refreshLive() {
    return request(API_REFRESH, { method: "POST" })
      .then(applyLive)
      .catch(function () {
        /* status opsional */
      });
  }

  // Simpang yang belum pernah menjalankan siklus (mis. baru didaftarkan) dilengkapi sekali saat halaman dibuka
  function ensureData() {
    var missing = state.items.some(function (i) {
      return statusText(i.id_persimpangan) === "Belum ada data";
    });
    if (!missing || state.autoRefreshed) return null;
    state.autoRefreshed = true;
    return refreshLive();
  }

  function loadAll() {
    return request(API_LIST)
      .then(function (items) {
        state.items = items;
        if (state.selected === null && items.length) {
          state.selected = items[0].id_persimpangan;
        }
        setOnline(true, "Terhubung");
        showError("");
        return loadLive();
      })
      .then(ensureData)
      .then(renderAll)
      .catch(function (e) {
        if (e.status === 403) {
          showDenied(e.message);
          return;
        }
        setOnline(false, "Gagal memuat");
        showError(e.message || "Gagal memuat data persimpangan.");
        renderAll();
      });
  }

  function showDenied(msg) {
    $("content").hidden = true;
    $("denied").hidden = false;
    if (msg) $("deniedMsg").textContent = msg;
    setOnline(false, "Akses ditolak");
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    state.timer = window.setInterval(function () {
      if (document.hidden) return;
      loadLive().then(renderAll);
    }, POLL_MS);
  }
  function stopPolling() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  /* ---------- form tambah ---------- */
  function parseCoord(raw) {
    var s = String(raw || "")
      .trim()
      .replace(",", ".");
    if (s === "") return null;
    return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  function setErr(inputId, errId, msg) {
    var i = $(inputId),
      e = $(errId);
    e.hidden = !msg;
    e.textContent = msg || "";
    if (msg) i.setAttribute("aria-invalid", "true");
    else i.removeAttribute("aria-invalid");
  }

  function validate() {
    var errs = [];
    var nama = $("fNama").value.trim();
    var latRaw = parseCoord($("fLat").value),
      lonRaw = parseCoord($("fLon").value);
    var m = { nama: "", lat: "", lon: "", desk: "" };
    if (!nama) m.nama = MSG_NAMA;
    if (Number.isNaN(latRaw))
      m.lat = "Latitude harus berupa angka (contoh: -7,2655).";
    else if (latRaw !== null && (latRaw < -90 || latRaw > 90))
      m.lat = "Latitude harus berada di antara -90 dan 90.";
    if (Number.isNaN(lonRaw))
      m.lon = "Longitude harus berupa angka (contoh: 112,7520).";
    else if (lonRaw !== null && (lonRaw < -180 || lonRaw > 180))
      m.lon = "Longitude harus berada di antara -180 dan 180.";
    if (!m.lat && !m.lon) {
      if (latRaw === null && lonRaw !== null)
        m.lat = "Latitude harus diisi berpasangan dengan longitude.";
      if (lonRaw === null && latRaw !== null)
        m.lon = "Longitude harus diisi berpasangan dengan latitude.";
    }
    if ($("fDesk").value.length > DESK_MAX)
      m.desk = "Deskripsi maksimal " + DESK_MAX + " karakter.";
    setErr("fNama", "eNama", m.nama);
    setErr("fLat", "eLat", m.lat);
    setErr("fLon", "eLon", m.lon);
    setErr("fDesk", "eDesk", m.desk);
    ["fNama", "fLat", "fLon", "fDesk"].forEach(function (id, k) {
      if ([m.nama, m.lat, m.lon, m.desk][k]) errs.push(id);
    });
    if (selectedArms().length < MIN_ARMS) {
      errs.push("armsFirst");
      renderArms();
    }
    return { errors: errs, nama: nama, lat: latRaw, lon: lonRaw };
  }

  function syncDraft() {
    var lat = parseCoord($("fLat").value),
      lon = parseCoord($("fLon").value);
    var ok =
      lat !== null &&
      lon !== null &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180;
    state.draft = ok ? { lat: lat, lon: lon } : null;
    $("geoReadout").textContent = ok
      ? fmtCoord(lat) + ", " + fmtCoord(lon)
      : "Belum ada titik";
    var hint = $("geoHint");
    var outside =
      ok &&
      (lat < ID_BOX.latMin ||
        lat > ID_BOX.latMax ||
        lon < ID_BOX.lonMin ||
        lon > ID_BOX.lonMax);
    hint.className = "hint" + (outside ? " warn" : "");
    hint.textContent = outside
      ? "Koordinat ini berada di luar wilayah Indonesia. Periksa apakah latitude dan longitude tertukar."
      : "Isi koordinat, klik titik pada peta, atau seret pin. Boleh dikosongkan dan dilengkapi nanti.";
    redrawMaps();
    if (ok) {
      ensureVisible(lat, lon);
      scheduleDetect();
    }
  }

  /* ---------- lengan persimpangan (3-4) ---------- */
  var armsTouched = false,
    detectSeq = 0,
    detectTimer = null,
    lastDetectKey = "";
  var MIN_ARMS = 3; // 2 lengan hanya ruas jalan biasa

  function armBoxes() {
    return Array.prototype.slice.call(
      document.querySelectorAll('input[name="lengan"]'),
    );
  }
  function selectedArms() {
    return armBoxes()
      .filter(function (b) {
        return b.checked;
      })
      .map(function (b) {
        return b.value;
      });
  }
  function armType(arms) {
    if (arms.length >= 4) return "Perempatan (4 lengan)";
    if (arms.length === 3) return "Pertigaan (3 lengan)";
    return "Pilih minimal " + MIN_ARMS + " lengan";
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) {
      n.setAttribute(k, attrs[k]);
    });
    return n;
  }
  // Pratinjau: pusat 40..80, tiap lengan 40 px; lengan yang tidak dipilih digambar sebagai tepi tertutup
  var ARM_RECT = {
    Utara: [40, 0, 40, 40],
    Selatan: [40, 80, 40, 40],
    Timur: [80, 40, 40, 40],
    Barat: [0, 40, 40, 40],
  };
  var ARM_LABEL = {
    Utara: [60, 10, "U"],
    Selatan: [60, 116, "S"],
    Timur: [112, 64, "T"],
    Barat: [8, 64, "B"],
  };
  function drawArmPreview(arms) {
    var s = $("armPreview");
    clear(s);
    s.appendChild(
      sv("rect", {
        class: "ap-ground",
        x: 0,
        y: 0,
        width: 120,
        height: 120,
        rx: 6,
      }),
    );
    LANES.forEach(function (a) {
      var r = ARM_RECT[a],
        on = arms.indexOf(a) >= 0;
      if (on)
        s.appendChild(
          sv("rect", {
            class: "ap-road",
            x: r[0],
            y: r[1],
            width: r[2],
            height: r[3],
          }),
        );
      var l = ARM_LABEL[a];
      var t = sv("text", {
        class: "ap-label" + (on ? "" : " off"),
        x: l[0],
        y: l[1],
        "text-anchor": "middle",
      });
      t.textContent = l[2];
      s.appendChild(t);
    });
    s.appendChild(
      sv("rect", { class: "ap-center", x: 40, y: 40, width: 40, height: 40 }),
    );
  }

  function renderArms() {
    var arms = selectedArms();
    drawArmPreview(arms);
    $("armType").textContent =
      armType(arms) + (arms.length >= MIN_ARMS ? " · " + arms.join(", ") : "");
    $("eArms").hidden = arms.length >= MIN_ARMS;
    $("eArms").textContent =
      arms.length >= MIN_ARMS
        ? ""
        : "Pilih minimal " +
          MIN_ARMS +
          " lengan: pertigaan (3) atau perempatan (4).";
    renderLanes();
  }
  function setArms(list) {
    armBoxes().forEach(function (b) {
      b.checked = list.indexOf(b.value) >= 0;
    });
    renderArms();
  }
  function say(node, text, btnLabel, onBtn) {
    node.hidden = !text;
    clear(node);
    if (!text) return;
    node.appendChild(document.createTextNode(text));
    if (btnLabel) {
      var b = el("button", "link-btn", btnLabel);
      b.type = "button";
      b.addEventListener("click", onBtn);
      node.appendChild(document.createTextNode(" "));
      node.appendChild(b);
    }
  }
  function describeDetect(res) {
    var parts = res.arms.map(function (a) {
      return res.names[a] ? a + " (" + res.names[a] + ")" : a;
    });
    return armType(res.arms) + ": " + parts.join(", ");
  }
  function runDetect() {
    var d = state.draft,
      box = $("armDetect");
    if (!d || !window.SinapsisArms) return;
    var key = d.lat.toFixed(5) + "," + d.lon.toFixed(5);
    if (key === lastDetectKey) return;
    lastDetectKey = key;
    var seq = ++detectSeq;
    say(box, "Mendeteksi lengan dari data jalan di sekitar titik...");
    window.SinapsisArms.fetchArms(d.lat, d.lon)
      .then(function (res) {
        if (seq !== detectSeq) return;
        if (!res.found) {
          say(
            box,
            "Titik ini belum terdeteksi sebagai pertigaan/perempatan (mungkin hanya ruas jalan). Geser pin tepat ke tengah persimpangan atau pilih lengan secara manual.",
          );
          return;
        }
        if (!armsTouched) {
          setArms(res.arms);
          say(
            box,
            "Terdeteksi otomatis: " +
              describeDetect(res) +
              ". Ubah bila tidak sesuai.",
          );
          return;
        }
        var same = res.arms.join() === selectedArms().join();
        say(
          box,
          same
            ? "Pilihan Anda sesuai dengan data peta."
            : "Saran dari peta: " + describeDetect(res) + ".",
          same ? "" : "Pakai saran",
          function () {
            armsTouched = false;
            setArms(res.arms);
            say(box, "Memakai saran peta: " + describeDetect(res) + ".");
          },
        );
      })
      .catch(function () {
        if (seq !== detectSeq) return;
        lastDetectKey = "";
        say(
          box,
          "Deteksi otomatis tidak tersedia (tidak terhubung ke data jalan OpenStreetMap). Pilih lengan secara manual.",
        );
      });
  }
  function scheduleDetect() {
    if (detectTimer) window.clearTimeout(detectTimer);
    detectTimer = window.setTimeout(runDetect, 700);
  }

  function renderLanes() {
    var on = $("fLoop").checked,
      ul = $("laneSources");
    if (ul) {
      clear(ul);
      selectedArms().forEach(function (n) {
        var li = el("li");
        li.appendChild(el("span", null, "Lajur " + n));
        li.appendChild(
          el("span", on ? "ok" : "muted", on ? "Aktif (simulasi)" : "Nonaktif"),
        );
        ul.appendChild(li);
      });
    }
    renderRegistrationVisionSlots();
  }

  function renderRegistrationVisionSlots() {
    var container = $("registrationVisionSlots");
    if (!container) return;
    clear(container);
    selectedArms().forEach(function (lane) {
      var slot = el("article", "vision-slot registration-vision-slot");
      slot.appendChild(el("strong", null, "Vision Lajur " + lane));

      var preview = el("div", "vision-preview");
      var image = document.createElement("img");
      image.src =
        state.registrationVision[lane] || "/static/img/placeholder_lane.jpg";
      image.className = "img-fluid rounded my-1 vision-placeholder-image";
      image.alt = "Placeholder Vision Lajur " + lane;
      image.addEventListener("error", function () {
        image.hidden = true;
      });
      preview.appendChild(image);
      preview.appendChild(
        el("span", "vision-placeholder", "Belum ada feed CCTV untuk lajur ini"),
      );
      slot.appendChild(preview);

      var input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*";
      input.className = "vision-file";
      input.setAttribute("aria-label", "Upload Vision Lajur " + lane);
      var button = el(
        "button",
        "btn btn-sm btn-outline-primary w-100 mt-1 btn-outline sm",
        "Upload Vision",
      );
      button.type = "button";
      button.addEventListener("click", function () {
        input.click();
      });
      input.addEventListener("change", function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (file.type.indexOf("image/") !== 0) {
          showError("Vision registrasi hanya menerima gambar.");
          input.value = "";
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          state.registrationVision[lane] = reader.result;
          clear(preview);
          var media = document.createElement("img");
          media.className = "vision-media";
          media.src = reader.result;
          media.alt = "Preview Vision Lajur " + lane;
          preview.appendChild(media);
        };
        reader.readAsDataURL(file);
      });
      slot.appendChild(button);
      slot.appendChild(input);
      container.appendChild(slot);
    });
  }

  function onSubmit(ev) {
    ev.preventDefault();
    showError("");
    var v = validate();
    if (v.errors.length) {
      var first = v.errors[0] === "armsFirst" ? armBoxes()[0] : $(v.errors[0]);
      first.focus();
      return;
    } // tetap di halaman tambah
    var btn = $("btnSave");
    btn.disabled = true;
    btn.textContent = "Menyimpan...";
    request(API_LIST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nama_lokasi: v.nama,
        deskripsi: $("fDesk").value.trim() || null,
        latitude: v.lat,
        longitude: v.lon,
        detektor_virtual: $("fLoop").checked,
        bentuk: armType(selectedArms()),
        jumlah_lengan: selectedArms().length,
        lengan: selectedArms(),
        vision_feeds: selectedArms().reduce(function (feeds, lane) {
          if (state.registrationVision[lane])
            feeds[lane] = state.registrationVision[lane];
          return feeds;
        }, {}),
      }),
    })
      .then(function (res) {
        return reloadIntersectionData().then(function () {
          closeAddDialog();
          // Halaman tambah adalah route tersendiri, bukan dialog; navigasi ini
          // memuat ulang tabel dan marker Leaflet dalam mode daftar.
          window.location.assign(
            "/admin/intersections?berhasil=" +
              encodeURIComponent(res.id_persimpangan),
          );
        });
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Simpan Persimpangan";
        if ([401, 403, 422].indexOf(e.status) >= 0) {
          window.alert(
            e.message || "Permintaan pendaftaran persimpangan ditolak.",
          );
        }
        if (e.status === 403) {
          showDenied(e.message);
          return;
        }
        if (e.status === 422 && /lengan/i.test(e.message)) {
          showError(e.message);
          renderArms();
          return;
        }
        if (e.status === 422 && /nama lokasi/i.test(e.message)) {
          setErr("fNama", "eNama", e.message);
          $("fNama").focus();
          return;
        }
        showError(e.message || "Gagal menyimpan persimpangan.");
      });
  }

  function updateCounter() {
    var n = $("fDesk").value.length,
      c = $("cDesk");
    c.textContent = n + "/" + DESK_MAX;
    c.className = "counter" + (n >= DESK_MAX ? " max" : "");
  }

  /* ---------- ekspor CSV ---------- */
  function csvCell(v, isText) {
    var s = String(v === null || v === undefined ? "" : v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah formula injection di Excel
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var rows = [
      [
        "Nama Lokasi",
        "Latitude",
        "Longitude",
        "Status Operasi",
        "Kendaraan",
        "Detektor Virtual",
        "Bentuk",
        "Jumlah Lengan",
      ],
    ];
    state.items.forEach(function (it) {
      var l = liveOf(it.id_persimpangan),
        st = statusText(it.id_persimpangan);
      rows.push([
        csvCell(it.nama_lokasi, true),
        csvCell(hasGeo(it) ? it.latitude : ""),
        csvCell(hasGeo(it) ? it.longitude : ""),
        csvCell(st, true),
        csvCell(l && st !== "Sensor Offline" ? l.jumlah_kendaraan : ""),
        csvCell(it.detektor_virtual ? "Aktif" : "Nonaktif", true),
        csvCell(it.tipe || "", true),
        csvCell((it.jalur || []).length),
      ]);
    });
    var head = rows
      .shift()
      .map(function (h) {
        return csvCell(h, true);
      })
      .join(",");
    var csv =
      "﻿" +
      head +
      "\r\n" +
      rows
        .map(function (r) {
          return r.join(",");
        })
        .join("\r\n");
    var url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    var a = el("a");
    a.href = url;
    a.download = "persimpangan-terdaftar.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /* ---------- awal ---------- */
  // /admin/intersections/add?lat=-7.26&lon=112.75 (dari klik peta pada halaman daftar)
  function prefillFromQuery() {
    var q = window.location.search,
      mLat = /[?&]lat=(-?\d+(?:\.\d+)?)/.exec(q),
      mLon = /[?&]lon=(-?\d+(?:\.\d+)?)/.exec(q);
    if (!mLat || !mLon) return;
    var lat = Number(mLat[1]),
      lon = Number(mLon[1]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    $("fLat").value = dec(lat.toFixed(6));
    $("fLon").value = dec(lon.toFixed(6));
    syncDraft();
  }

  function init() {
    if (!store("access_token")) {
      window.location.replace("/login");
      return;
    }
    var who = null;
    try {
      who = JSON.parse(store("user_info") || "null");
    } catch (e) {
      who = null;
    }
    $("userName").textContent = who
      ? who.nama || who.full_name || who.username || "Pengguna"
      : "Pengguna";
    if (who && who.role && who.role !== "Administrator") {
      showDenied(
        "Halaman Kelola Sistem hanya untuk Administrator. Anda masuk sebagai " +
          who.role +
          ".",
      );
      return;
    }

    $("tabAdd").className = "tab" + (MODE === "add" ? " active" : "");
    $("tabList").className = "tab" + (MODE === "list" ? " active" : "");
    $("crumbLeaf").textContent =
      MODE === "add" ? "Registrasi Simpang Baru" : "Persimpangan Terdaftar";
    document.title =
      "SINAPSIS " +
      (MODE === "add" ? "Registrasi Simpang Baru" : "Persimpangan Terdaftar");
    $("btnExport").addEventListener("click", exportCsv);

    if (MODE === "add") {
      $("addSection").hidden = false;
      $("formAdd").addEventListener("submit", onSubmit);
      $("fLat").addEventListener("input", syncDraft);
      $("fLon").addEventListener("input", syncDraft);
      $("fDesk").addEventListener("input", updateCounter);
      $("fNama").addEventListener("input", function () {
        if ($("fNama").value.trim()) setErr("fNama", "eNama", "");
      });
      $("fLoop").addEventListener("change", renderLanes);
      armBoxes().forEach(function (b) {
        b.addEventListener("change", function () {
          armsTouched = true;
          renderArms();
        });
      });
      initMap();
      updateCounter();
      renderArms();
      prefillFromQuery();
      $("fNama").focus();
    } else {
      $("listSection").hidden = false;
      initMap();
      $("btnReload").addEventListener("click", function () {
        loadAll().then(refreshLive).then(renderAll);
      });
      var m = /[?&]berhasil=(\d+)/.exec(window.location.search);
      if (m) {
        state.freshId = Number(m[1]);
        state.selected = state.freshId;
        toast(MSG_OK);
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch (e) {
          /* diabaikan */
        }
      }
      renderDetail();
      startPolling();
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) loadLive().then(renderAll);
      });
    }
    loadAll();
  }

  init();
})();
