Feature: Autentikasi dan hak akses pengguna
  Sebagai pengguna Dishub
  Saya ingin login sesuai role saya
  Agar hanya fitur yang menjadi hak saya yang bisa dibuka

  Background:
    Given sistem SINAPSIS berjalan dengan data awal

  Scenario Outline: Login berhasil menampilkan menu sesuai role
    When pengguna login dengan username "<username>" dan password "<password>"
    Then respons berstatus 200
    And pesan respons adalah "Login Berhasil!"
    And pengguna diarahkan ke "/dashboard"
    And menu yang tampil adalah "<menu>"

    Examples:
      | username        | password         | menu                                                |
      | admin_sinapsis  | adminSecure2026  | Pantau Kondisi Lalu Lintas; Kelola Sistem           |
      | petugas_lalin01 | petugasPass123   | Pantau Kondisi Lalu Lintas; Permintaan Rute Darurat |

  Scenario: Login ditolak bila field kosong
    When pengguna login dengan username "" dan password ""
    Then respons berstatus 400
    And pesan galat adalah "Login gagal. Semua field harus diisi!"

  Scenario: Login ditolak bila akun tidak terdaftar
    When pengguna login dengan username "unknown_user" dan password "pass12345"
    Then respons berstatus 401
    And pesan galat adalah "Login gagal. Akun tidak terdaftar."

  Scenario: Login ditolak bila password salah
    When pengguna login dengan username "admin_sinapsis" dan password "wrongpassword"
    Then respons berstatus 401
    And pesan galat adalah "Login gagal. Username atau password Anda salah."

  Scenario: Password tersimpan dalam bentuk hash bcrypt
    Then password pengguna "admin_sinapsis" tersimpan sebagai hash bcrypt

  Scenario: Dashboard terkunci bagi pengguna yang belum login
    When pengguna membuka endpoint dashboard pemantauan tanpa token
    Then respons berstatus 401

  Scenario: Petugas tidak boleh membuka Kelola Sistem
    Given saya login sebagai Petugas Lalu Lintas
    When saya membuka daftar pengguna di Kelola Sistem
    Then respons berstatus 403