Feature: Permintaan rute darurat dan koridor hijau
  Sebagai Petugas Lalu Lintas
  Saya ingin membuka koridor hijau untuk kendaraan darurat
  Agar ambulans tidak terhenti di persimpangan

  Background:
    Given sistem SINAPSIS berjalan dengan data awal
    And saya login sebagai Petugas Lalu Lintas

  Scenario: Rute darurat optimal ditemukan
    When saya mencari rute dari "RSUD Dr. Soetomo" ke "Jalan Darmo"
    Then respons berstatus 200
    And rute yang ditemukan adalah "RSUD Dr. Soetomo > Simpang Gubeng > Simpang Pemuda > Jalan Darmo"

  Scenario: Tujuan kosong ditolak
    When saya mencari rute dari "RSUD Dr. Soetomo" ke ""
    Then respons berstatus 422
    And pesan galat adalah "Lokasi tujuan wajib diisi!"

  Scenario: Koridor hijau memaksa lampu hijau pada jalur rute
    Given rute dari "RSUD Dr. Soetomo" ke "Jalan Darmo" sudah diaktifkan
    When saya menjalankan siklus di Simpang Gubeng
    Then koridor darurat aktif
    And lampu jalur Barat berwarna "HIJAU"