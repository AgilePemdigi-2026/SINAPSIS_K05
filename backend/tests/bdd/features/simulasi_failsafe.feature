Feature: Simulasi Skenario Lalu Lintas & Mode Fail-Safe (Fitur 11)
  Sebagai Administrator atau Petugas Lalu Lintas
  Saya ingin menjalankan simulasi skenario lalu lintas dan memastikan mode fail-safe aktif saat gangguan
  Agar lampu lalu lintas tetap beroperasi secara aman tanpa risiko tabrakan saat sensor offline

  Background:
    Given sistem SINAPSIS berjalan dengan data awal

  Scenario: Administrator menjalankan simulasi skenario jam sibuk dengan cuaca ekstrem
    Given saya login sebagai Administrator
    When saya menjalankan simulasi profil "RUSH_HOUR" dengan 10 siklus dan gangguan cuaca
    Then respons berstatus 200
    And hasil simulasi memiliki 10 siklus
    And rata-rata hijau per jalur terhitung

  Scenario: Simulasi sensor failure memicu mekanisme fail-safe fallback timer
    Given saya login sebagai Administrator
    When saya menjalankan simulasi profil "NORMAL" dengan 12 siklus dan gangguan sensor
    Then respons berstatus 200
    And simulasi mendeteksi siklus sensor offline
    And mode fail-safe aktif dalam hasil simulasi

  Scenario: Petugas mengecek status fail-safe persimpangan
    Given saya login sebagai Petugas Lalu Lintas
    When saya memeriksa status fail-safe sistem
    Then respons berstatus 200
    And status fail-safe mencakup seluruh persimpangan

  Scenario: Eksekusi fail-safe memastikan interlocking safety satu jalur hijau
    Given saya login sebagai Administrator
    When saya mengeksekusi siklus fail-safe pada persimpangan 1
    Then respons berstatus 200
    And tepat satu jalur berstatus "HIJAU" pada mode fail-safe
