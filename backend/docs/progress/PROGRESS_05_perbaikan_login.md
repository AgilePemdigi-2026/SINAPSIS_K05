# Progress 05: Perbaikan Login (satu sistem akun)

## Masalah
`main` memuat dua sistem login yang bertabrakan: `routers/auth.py` (tabel `pengguna`, kunci dari `.env`) dan `auth_system.py`
(tabel `users`, kunci tertanam di kode, `./sinapsis.db` mengikuti folder kerja). Token dari login baru tidak dikenali endpoint lain
(401), nama role berbeda (`admin` vs `Administrator`), akun demo tidak bisa login, dan siapa pun bisa mendaftar sebagai admin.

## Perbaikan
- Satu sistem akun: tabel `pengguna`, JWT dari `settings.SECRET_KEY`. `auth_system.py` dihapus.
- Register, Lupa Password, dan Reset Password dipindah ke `routers/auth.py`.
- Registrasi publik hanya untuk Petugas; akun Administrator hanya bisa dibuat Administrator yang login.
- Token reset disimpan sebagai hash SHA-256, berlaku 15 menit, sekali pakai. Username tak terdaftar dijawab sama (tidak bocor).
  `EXPOSE_RESET_TOKEN=true` (demo) mengembalikan token di respons; set `false` bila sudah ada email/SMS.
- Kolom `reset_token` dan `reset_token_expires` ditambahkan ke `pengguna`; `ensure_schema()` menambahkannya otomatis pada `sinapsis.db` lama.
- Aturan password (8 karakter, huruf kapital, angka) dan username sekarang satu sumber (`core/security.py`).
- Tes baru: `tests/test_auth_account.py`.

## Akibat bagi anggota
- Akun yang dulu dibuat lewat `auth_system` (tabel `users`) tidak terbawa. Daftar ulang, atau hapus `sinapsis.db` agar seed demo dibuat ulang.
- `.env` lama tetap dipakai; tambahkan `EXPOSE_RESET_TOKEN=true` (opsional, defaultnya true).
