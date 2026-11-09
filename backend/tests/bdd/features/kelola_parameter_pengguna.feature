Feature: Parameter sistem AI dan akun pengguna (Kelola Sistem)
  Sebagai Administrator
  Saya ingin mengubah parameter AI dan menambah akun pengguna
  Agar sistem dapat dikonfigurasi dan dipakai personel Dishub

  Background:
    Given sistem SINAPSIS berjalan dengan data awal
    And saya login sebagai Administrator

  Scenario: Memperbarui Spike Threshold
    When saya mengubah parameter "spike_threshold" menjadi 0.85
    Then respons berstatus 200
    And pesan respons adalah "Parameter konfigurasi berhasil diperbarui!"
    And parameter "spike_threshold" bernilai aktif 0.85

  Scenario: Nilai parameter di luar rentang ditolak
    When saya mengubah parameter "spike_threshold" menjadi 5
    Then respons berstatus 422

  Scenario: Menambah akun Petugas Lalu Lintas
    When saya menambah pengguna "Budi Santoso" dengan username "budisantoso" dan peran "Petugas Lalu Lintas"
    Then respons berstatus 201
    And pesan respons adalah "Akun pengguna berhasil dibuat!"
    And pengguna diarahkan ke "/admin/users"

  Scenario: Password lemah ditolak
    When saya menambah pengguna "Budi Santoso" dengan password "lemah"
    Then respons berstatus 422
