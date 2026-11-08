Feature: Registrasi persimpangan baru (Kelola Sistem)
  Sebagai Administrator
  Saya ingin mendaftarkan persimpangan baru beserta koordinatnya
  Agar persimpangan itu bisa dipantau dan tampil di peta

  Background:
    Given sistem SINAPSIS berjalan dengan data awal
    And saya login sebagai Administrator

  Scenario: Menambah persimpangan baru dengan koordinat
    When saya mendaftarkan persimpangan "Simpang Empat Gubeng" dengan deskripsi "Persimpangan jalur utama arah timur-barat" di koordinat "-7.2655" dan "112.7520"
    Then respons berstatus 201
    And pesan respons adalah "Persimpangan baru berhasil ditambahkan!"
    And pengguna diarahkan ke "/admin/intersections"
    And persimpangan "Simpang Empat Gubeng" tercatat dengan koordinat "-7.2655" dan "112.752"

  Scenario: Menambah persimpangan tanpa koordinat tetap diterima
    When saya mendaftarkan persimpangan "Simpang Tanpa Titik" tanpa koordinat
    Then respons berstatus 201

  Scenario: Nama lokasi kosong ditolak
    When saya mendaftarkan persimpangan "" tanpa koordinat
    Then respons berstatus 422
    And pesan galat adalah "Nama lokasi persimpangan wajib diisi!"

  Scenario: Koordinat di luar rentang ditolak
    When saya mendaftarkan persimpangan "Simpang Salah" dengan deskripsi "" di koordinat "95" dan "112.7"
    Then respons berstatus 422
    And pesan galat adalah "Latitude harus berada di antara -90 dan 90."

  Scenario: Petugas tidak boleh mendaftarkan persimpangan
    Given saya login sebagai Petugas Lalu Lintas
    When saya mendaftarkan persimpangan "Simpang Terlarang" tanpa koordinat
    Then respons berstatus 403
