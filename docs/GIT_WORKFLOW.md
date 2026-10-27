# Alur Kerja Git Kelompok 5 — SINAPSIS

Repo: `AgilePemdigi-2026/SINAPSIS_K05`. Alur ini disepakati kelompok: tiap anggota punya branch sendiri untuk mencatat progres dan kontribusi,
tiap sprint punya branch sendiri, dan PM meninjau sebelum pekerjaan masuk ke branch sprint.

## Gambaran

```
main            ●─────────────────────────●──────────────────────●   hasil akhir tiap sprint (selalu bisa dijalankan)
                 \                       ▲ PM merge setelah       ▲
sprint-1          ●──●─────●──────●──────● Sprint Review           │
                   ▲        ▲      ▲                              │
              PR, ditinjau PM                                     │
                   │        │      │                              │
dev/andhika   ●──●─┘   ●──●─┘      │                              │
dev/fahrezi   ●───────────●────────┘            sprint-2 dibuat dari main setelah Sprint 1 selesai
```

## Peran tiap branch

| Branch | Fungsi | Siapa yang boleh mengubah |
|---|---|---|
| `main` | Hasil akhir sprint yang sudah ditinjau, selalu bisa dijalankan. Berisi kode sprint terakhir yang selesai, `README.md`, `docs/`, dan arsip `legacy-neric/` | hanya PM, lewat PR dari branch sprint |
| `sprint-1`, `sprint-2`, `sprint-3` | Tempat menggabungkan pekerjaan semua anggota selama satu sprint | hanya PM, lewat PR dari branch anggota |
| `dev/<nama>` (mis. `dev/andhika`) | Branch pribadi: tempat mengerjakan dan menyimpan progres sendiri | pemiliknya |

Tiap sprint dibuat dari `main` yang terbaru: `sprint-2` dibuat dari `main` setelah `sprint-1` digabung, supaya kode terus menumpuk (kumulatif).

## Aturan utama

1. **Kerjakan di branch pribadi, bukan di `main` atau branch sprint.**
2. **Pekerjaan masuk ke branch sprint lewat Pull Request (PR) yang ditinjau PM.** Anggota tidak mendorong langsung ke branch sprint.
3. **Saat membuat PR, pilih `base` = branch sprint yang berjalan (mis. `sprint-1`), bukan `main`.** GitHub memilih `main` secara bawaan, jadi periksa setiap kali.
4. **PM menggabungkan lewat tombol Merge di GitHub**, jangan menyalin file lalu commit atas nama sendiri (alasannya di bagian "Kontribusi tercatat").
5. **Sinkronkan branch pribadi dengan branch sprint secara rutin** (setidaknya sebelum mulai kerja dan sebelum membuat PR).
6. **Ubah folder bagianmu saja**: `backend/` (tim backend), `frontend/` (tim frontend), `docs/` (siapa saja). Mengubah folder lain dibicarakan dulu.
7. **Jangan `git push --force`.** PM melacak progres lewat riwayat commit.
8. **Jangan commit rahasia atau berkas yang tidak perlu**: `.env`, `*.db`, `venv/`, `__pycache__/`.
9. **Branch sprint harus tetap bisa dijalankan.** Jalankan `pytest -q` di folder `backend` sebelum membuat PR.

## Siklus kerja anggota

Sekali di awal sprint (setelah PM membuat `sprint-1`):
```powershell
git fetch
git checkout sprint-1
git pull
git checkout -b dev/nama-kamu
git push -u origin dev/nama-kamu
```

Sehari-hari:
```powershell
git checkout dev/nama-kamu
git pull origin sprint-1                  # ambil pekerjaan teman yang sudah digabung PM

# ... kerjakan, lalu:
git add <folder-atau-file-yang-kamu-ubah>
git status                                # cek: tidak ada .env / .db / venv
git commit -m "feat(frontend): deskripsi singkat (F2)"
git push                                  # progres tercatat di branch pribadi
```

Saat siap digabung, di GitHub: **Pull requests → New pull request**, atur **base: `sprint-1`** dan **compare: `dev/nama-kamu`**, isi deskripsi, pilih PM sebagai Reviewer, lalu **Create pull request**.

## Peninjauan PM

1. Buka tab **Files changed**: pastikan hanya berkas yang seharusnya, tidak ada `.env`, `*.db`, atau `venv`.
2. Jalankan tes bila perlu, lalu setujui (**Approve**) atau minta perbaikan lewat komentar.
3. Gabungkan dengan **Merge pull request** (metode *Create a merge commit*), supaya commit tiap anggota tetap atas nama masing-masing.

Perbaikan setelah review dikerjakan di branch pribadi yang sama (`git add`, `git commit`, `git push`); PR otomatis terbarui.

## Akhir sprint (dilakukan PM)

1. Setelah Sprint Review, buat PR **`sprint-1` → `main`** dan gabungkan dengan **Merge pull request**.
2. Tandai hasilnya dengan tag (nama tag jangan sama dengan nama branch):
   ```powershell
   git checkout main
   git pull
   git tag sprint-1-selesai
   git push origin sprint-1-selesai
   ```
3. Buat branch sprint berikutnya dari `main`:
   ```powershell
   git checkout -b sprint-2
   git push -u origin sprint-2
   ```
4. Semua anggota memperbarui branch pribadinya ke sprint baru:
   ```powershell
   git checkout dev/nama-kamu
   git pull origin sprint-2
   ```
   Branch pribadi dipakai terus sepanjang proyek; tidak dihapus tiap sprint.

## Kontribusi tercatat

- GitHub (grafik **Insights → Contributors** dan grafik kontribusi profil) menghitung commit yang sudah masuk ke **branch default `main`**. Commit di branch pribadi dan branch sprint tetap terlihat di riwayat branch dan di PR, tetapi baru masuk hitungan setelah `sprint-N` digabung ke `main`.
- Itu sebabnya PM harus menggabungkan lewat tombol **Merge pull request**. Bila PM menyalin file lalu commit atas nama sendiri, kontribusi anggota hilang dari catatan.
- Untuk melacak progres per orang di tengah sprint, lihat commit tiap branch pribadi (`github.com/AgilePemdigi-2026/SINAPSIS_K05/commits/dev/nama`) dan daftar PR.

## Menghindari bentrok

- Branch pribadi berumur panjang, jadi sinkronkan sering (`git pull origin sprint-1`). Makin lama tidak disinkronkan, makin besar konfliknya.
- Kerja per folder (aturan 6). Dua orang yang mengubah file yang sama di waktu yang sama adalah sumber konflik terbesar.
- Bila frontend bergantung pada perubahan backend, tunggu PR backend digabung ke branch sprint, lalu `git pull origin sprint-N` di branch frontend. Bila bentuk data API berubah, tulis di deskripsi PR. Kontrak data dashboard ada di `frontend/README.md`.
- Bila muncul konflik, VS Code menampilkan penanda `<<<<<<<` di file terkait. Pilih versi yang benar, simpan, lalu `git add` dan `git commit`. Bila ragu, tanya orang yang mengubah file itu.
- Perbaikan untuk sprint yang sudah selesai dikerjakan di sprint yang berjalan, bukan dengan membuka kembali branch sprint lama.

## Format pesan commit

`jenis(area): deskripsi singkat (kode backlog)`, misalnya:
- `feat(backend): tambah endpoint prediksi kepadatan (F13)`
- `fix(frontend): perbaiki validasi form login (F1)`
- `docs: perbarui burndown chart sprint 1`

Jenis yang dipakai: `feat`, `fix`, `docs`, `chore`, `test`.

## Isi PR yang baik

- Judul: `feat(backend): ... (F12)`.
- Deskripsi: apa yang berubah, cara menjalankan atau mengujinya, dan hal yang perlu diperhatikan reviewer.
- Pastikan `base` sudah benar (branch sprint, bukan `main`).

## Pengaturan repo (dilakukan PM atau pemilik repo)

Di **Settings** repo:
1. **Branches → Add branch protection rule** untuk `main` dan `sprint-*`: aktifkan **Require a pull request before merging** dan **Require approvals = 1**, serta batasi push langsung.
2. **General → Pull Requests**: biarkan **Allow merge commits** aktif. **Jangan aktifkan "Automatically delete head branches"**, karena branch pribadi (`dev/nama`) akan ikut terhapus setiap PR digabung.
3. **Collaborators**: semua anggota kelompok berperan **Write**.

## Pelacakan backlog (opsional)

Gunakan **Issues** (satu issue per backlog, mis. "F2 Dashboard Pemantauan") dan **Milestones** ("Sprint 1", "Sprint 2", ...) bila PM memakainya. Tulis `Closes #nomor` di deskripsi PR agar issue tertutup saat PR digabung.
