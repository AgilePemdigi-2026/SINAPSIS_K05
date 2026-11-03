Feature: Pantau kondisi lalu lintas
  Sebagai petugas Dishub
  Saya ingin memantau kepadatan semua persimpangan
  Agar kemacetan dan gangguan sensor cepat diketahui

  Background:
    Given sistem SINAPSIS berjalan dengan data awal

  Scenario: Refresh data berhasil
    Given saya login sebagai Petugas Lalu Lintas
    When saya menekan Refresh Data
    Then respons berstatus 200
    And pesan respons adalah "Data lalu lintas berhasil dimuat ulang."
    And dashboard menampilkan 4 persimpangan

  Scenario: Peringatan muncul saat satu jalur kritis
    Given saya login sebagai Administrator
    When saya menjalankan siklus manual di persimpangan 1 dengan kendaraan "19,3,3,3"
    And saya membuka dashboard
    Then peringatan kemacetan aktif untuk "Simpang Gubeng"

  Scenario: Jumlah kendaraan tidak lengkap ditolak
    Given saya login sebagai Administrator
    When saya menjalankan siklus manual di persimpangan 1 dengan kendaraan "1,2"
    Then respons berstatus 422

  Scenario: Sensor offline ditampilkan lalu pulih
    Given saya login sebagai Administrator
    And sensor persimpangan 2 sedang offline
    When saya menekan Refresh Data
    Then persimpangan 2 berstatus "Sensor Offline"
    And pesan sensor adalah "Data pemantauan tidak tersedia untuk beberapa simpang."