Feature: Notifikasi Congestion Alert & Sensor Offline (Fitur 10)
  Sebagai petugas Dishub
  Saya ingin menerima notifikasi otomatis saat terjadi kemacetan atau sensor offline
  Agar saya dapat segera merespons kondisi darurat lalu lintas

  Background:
    Given sistem SINAPSIS berjalan dengan data awal

  Scenario: Alert kemacetan kritis dibuat otomatis
    Given saya login sebagai Administrator
    When saya menjalankan siklus manual di persimpangan 1 dengan kendaraan "19,3,3,3"
    And saya membuka dashboard
    Then peringatan kemacetan aktif untuk "Simpang Gubeng"
    And alert summary menunjukkan congestion aktif

  Scenario: Alert sensor offline dibuat otomatis
    Given saya login sebagai Administrator
    And sensor persimpangan 2 sedang offline
    When saya menekan Refresh Data
    Then persimpangan 2 berstatus "Sensor Offline"
    And pesan sensor adalah "Data pemantauan tidak tersedia untuk beberapa simpang."
    And terdapat alert sensor offline untuk persimpangan 2

  Scenario: Petugas dapat melihat daftar alert aktif
    Given saya login sebagai Administrator
    When saya menjalankan siklus manual di persimpangan 1 dengan kendaraan "19,3,3,3"
    And saya membuka dashboard
    And saya mengambil daftar alert aktif
    Then daftar alert tidak kosong

  Scenario: Petugas dapat acknowledge alert
    Given saya login sebagai Administrator
    When saya menjalankan siklus manual di persimpangan 1 dengan kendaraan "19,3,3,3"
    And saya membuka dashboard
    And saya mengambil daftar alert aktif
    And saya acknowledge alert pertama
    Then alert berhasil di-acknowledge

