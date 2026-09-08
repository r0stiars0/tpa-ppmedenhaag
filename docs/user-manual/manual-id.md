# Panduan Pengguna Aplikasi TPA PPME Den Haag

*Bahasa: **Indonesia** · [Nederlands](./manual-nl.md)*

Aplikasi TPA PPME Den Haag digunakan untuk mencatat dan memantau perkembangan santri di TPA (Taman Pendidikan Al-Qur'an) PPME Den Haag: kehadiran, tugas/huiswerk, bacaan Yanbu'a, tilawah Al-Qur'an, murajaah (hafalan ulang), dan rapor akhir tahun. Panduan ini menjelaskan setiap layar, kolom, dan tombol yang akan Anda temui, dengan tangkapan layar dari tampilan ponsel (mobile).

## Daftar Isi

1. [Peran Pengguna](#1-peran-pengguna)
2. [Masuk ke Aplikasi](#2-masuk-ke-aplikasi)
3. [Navigasi Umum](#3-navigasi-umum)
4. [Beranda](#4-beranda)
5. [Kehadiran](#5-kehadiran)
6. [Tugas](#6-tugas)
7. [Yanbu'a](#7-yanbua)
8. [Al-Quran](#8-al-quran)
9. [Murajaah](#9-murajaah)
10. [Rapor](#10-rapor)
11. [Notifikasi](#11-notifikasi)
12. [Kelola (Khusus Admin)](#12-kelola-khusus-admin)
13. [Akun dengan Peran Ganda](#13-akun-dengan-peran-ganda)
14. [Elemen & Istilah Umum](#14-elemen--istilah-umum)
15. [Lampiran: Istilah Indonesia ⟷ Belanda](#15-lampiran-istilah-indonesia--belanda)

---

## 1. Peran Pengguna

Aplikasi ini melayani empat jenis hubungan (bukan sekadar satu "peran" tetap per akun):

| Peran | Bisa apa |
|---|---|
| **Guru** (tutor) | Mencatat kehadiran, tugas, Yanbu'a, Al-Quran, dan menetapkan target murajaah untuk grup yang diampu; menulis dan menerbitkan rapor. |
| **Orang Tua** | Melihat riwayat kehadiran, tugas, Yanbu'a, Al-Quran, dan rapor anaknya; mengonfirmasi murajaah harian di rumah. |
| **Santri** (16+ dengan akun sendiri) | Melihat riwayat miliknya sendiri, seperti orang tua, tetapi **tidak bisa** mengonfirmasi murajaah untuk dirinya sendiri — itu tetap tugas orang tua. |
| **Admin** | Mengelola pendaftaran pengguna, grup, dan data santri; memiliki akses baca/tulis penuh yang setara guru di semua grup; membuat draf rapor massal — tetapi **tidak bisa menerbitkan** rapor. |

Satu akun bisa memegang **lebih dari satu** hubungan sekaligus — misalnya seorang guru yang juga orang tua dari santri di grup lain. Akun seperti ini mendapat **saklar tampilan (scope switch)** untuk berpindah antara "Grup saya" (tampilan guru) dan "Anak saya" (tampilan orang tua) — lihat [§13](#13-akun-dengan-peran-ganda).

---

## 2. Masuk ke Aplikasi

<img src="./screenshots/id/signin.png" width="360" alt="Layar masuk">

Layar pertama yang tampil sebelum masuk.

| Elemen | Fungsi |
|---|---|
| Logo & nama aplikasi | "TPA PPME Den Haag" — tampilan statis. |
| Tagline | "TPA Progress Tracker" |
| **Tombol "Masuk dengan Google"** | Memulai proses masuk melalui akun Google (Google OAuth). Ini satu-satunya cara masuk untuk pengguna sungguhan. |

> **Keluarga baru** didaftarkan lewat Google Formulir pendaftaran ulang tahunan ("Daftar Ulang"). Di sana Anda mengisi nama dan tanggal lahir setiap anak, serta nama dan alamat email Anda sendiri (Anda harus login ke Google). Ada kotak centang kebijakan privasi yang opsional — boleh dicentang, tetapi pendaftaran tetap berjalan tanpa itu. Tidak lama kemudian Anda menerima **email undangan**; jika Anda kemudian masuk dengan akun Google yang sama, akun Anda sudah siap dan Anda langsung masuk ke aplikasi. Jika Anda tidak sengaja mengirim formulir lagi untuk anak yang sama, tidak ada yang berubah — data yang ada hanya diperbarui. Admin kemudian menempatkan anak Anda ke sebuah grup. Jika pada formulir Anda juga mengisi **alamat email anak Anda**, anak akan menerima undangan sendiri untuk masuk dan melihat datanya sendiri saja (berhasil atau tidak tergantung batas usia Google).

Jika akun Google Anda belum terdaftar oleh admin TPA (misalnya karena Anda login tanpa mengisi formulir pendaftaran), setelah masuk Anda akan melihat layar **"Akun Anda belum terdaftar. Hubungi admin TPA."** dengan sebuah formulir singkat di bawahnya dan tombol **Keluar**.

**Formulir "Minta akses"** — isi agar admin dapat mendaftarkan Anda lebih cepat dan dengan peran yang tepat:

| Bidang | Fungsi |
|---|---|
| **Nama lengkap** | Wajib. Sudah terisi dengan nama dari akun Google Anda; dapat Anda ubah. |
| **Keterangan** | Opsional. Teks bebas: siapa Anda, untuk anak yang mana, mengapa Anda memerlukan akses. |
| **Kirim permintaan** | Mengirim data ke admin. Tombol nonaktif selama bidang nama masih kosong. |

Setelah dikirim, teks di atas berubah menjadi **"Permintaan Anda telah diterima. Admin akan meninjaunya sesegera mungkin."** Anda tetap di layar ini — permintaan itu sendiri tidak memberi akses. Anda dapat membuka formulir lagi dan memperbaiki data Anda selama admin belum mendaftarkan Anda. Begitu itu terjadi, saat memuat berikutnya Anda otomatis masuk ke aplikasi. Admin juga dapat **menolak** permintaan (lihat [§12.1](#121-pendaftaran)); setelah itu Anda tetap bisa masuk lagi dan mengajukan permintaan baru.

> Catatan: pada versi pengembangan (developer), muncul kotak tambahan "Dev only — local fixture sign-in" untuk menguji berbagai akun contoh tanpa Google. Kotak ini **tidak pernah muncul** di aplikasi produksi/nyata dan tidak relevan bagi pengguna sehari-hari.

---

## 3. Navigasi Umum

Setelah masuk, setiap layar memiliki bagian-bagian tetap berikut (tampak di hampir semua tangkapan layar pada panduan ini).

### Bilah Atas (Top Bar)
| Elemen | Fungsi |
|---|---|
| Logo | Tautan kembali ke Beranda. |
| 🔔 Ikon Lonceng | Hanya muncul untuk akun yang bisa menerima notifikasi (orang tua, atau santri 16+ dengan akun sendiri). Menampilkan angka jika ada notifikasi belum dibaca (maks. tampilan "9+"). Tekan untuk membuka [Pusat Notifikasi](#111-pusat-notifikasi). |
| 🌙/☀️ Ikon bulan/matahari | Beralih mode gelap/terang. |
| **ID** / **NL** | Mengganti bahasa antarmuka ke Indonesia atau Belanda. Pilihan tersimpan di perangkat. |
| **Keluar** | Keluar dari akun dan kembali ke layar masuk. |

### Bilah Bawah (Bottom Tab — hanya di ponsel)
Lima tab tetap, sama untuk semua peran termasuk admin:

**Hadir · Tugas · Yanbu'a · Al-Quran · Murajaah**

Menu **Rapor** dan **Kelola** (khusus admin) tidak ada di bilah bawah — keduanya diakses lewat ubin di Beranda, karena hanya ada ruang untuk lima tombol yang nyaman disentuh di layar ponsel.

### Saklar Tampilan (Scope Switch)
Muncul di atas konten, **hanya untuk akun dengan lebih dari satu hubungan** (misalnya guru yang juga orang tua), dan **hanya** pada enam layar berikut: Hadir, Tugas, Yanbu'a, Al-Quran, Murajaah, Rapor. Lihat [§13](#13-akun-dengan-peran-ganda) untuk detail lengkap.

---

## 4. Beranda

Layar pertama setelah masuk. Isinya berbeda sedikit tergantung peran.

### 4.1 Tampilan Guru

<img src="./screenshots/id/dashboard-tutor.png" width="360" alt="Beranda — tampilan guru">

| Elemen | Fungsi |
|---|---|
| Kartu sapaan | Nama pengguna + daftar hubungan yang dimiliki (mis. "Guru", atau gabungan "Guru · Orang Tua" jika kedua-duanya). |
| Kartu **"Minggu ini"** *(hanya muncul untuk akun dengan anak/santri terkait — lihat §4.2)* | Tidak tampil untuk guru murni. |
| Ubin **Hadir / Tugas / Yanbu'a / Al-Quran / Murajaah / Rapor** | Tekan salah satu untuk membuka fitur terkait. |
| Baris **Notifikasi →** | Membuka halaman [Pengaturan Notifikasi](#112-pengaturan-notifikasi) — tersedia untuk semua peran, bukan hanya penerima notifikasi, karena semua orang berhak membaca apa isi sebuah notifikasi. |

### 4.2 Tampilan Keluarga (Orang Tua / Santri)

<img src="./screenshots/id/dashboard-family.png" width="360" alt="Beranda — tampilan orang tua">

Sama seperti di atas, ditambah kartu **"Minggu ini"** yang merangkum aktivitas anak (atau diri sendiri, untuk santri 16+) sejak Senin sampai hari ini:

| Kolom di kartu "Minggu ini" | Isi |
|---|---|
| Kehadiran | Persentase kehadiran minggu ini, atau "—" jika belum ada catatan. |
| Yanbu'a | Jumlah sesi Yanbu'a yang dicatat minggu ini. |
| Al-Quran | Jumlah sesi tilawah minggu ini. |
| Murajaah | Jumlah konfirmasi murajaah minggu ini. |

Kartu ini otomatis **tersembunyi** jika tidak ada aktivitas sama sekali minggu itu — minggu yang sepi tidak ditampilkan sebagai kartu penuh angka nol. Jika anak memiliki lebih dari satu, setiap anak dengan aktivitas mendapat kartunya sendiri.

### 4.3 Tampilan Admin

<img src="./screenshots/id/dashboard-admin.png" width="360" alt="Beranda — tampilan admin">

Sama seperti tampilan guru, ditambah bagian **"Kelola"** di bagian bawah — satu-satunya jalan masuk ke [halaman administrasi](#12-kelola-khusus-admin) (pendaftaran, grup, santri).

---

## 5. Kehadiran

### 5.1 Tampilan Guru — Mencatat Kehadiran

<img src="./screenshots/id/attendance-tutor.png" width="360" alt="Kehadiran — daftar hadir guru">

Layar untuk mencatat kehadiran per grup. Layar terbuka pada sesi terkini
grup — hari ini jika grup bertemu hari ini, jika tidak maka hari
pertemuan terakhir sebelumnya. Hari pertemuan sebuah grup diatur oleh
admin pada grup tersebut (lihat [§12.2](#122-grup) → Hari pertemuan).

| Elemen | Fungsi |
|---|---|
| **Pilih Grup** | Muncul hanya jika guru mengampu lebih dari satu grup. Memilih grup memuat ulang daftar santri dan sesinya. |
| Baris tanggal dengan **‹** / **›** | Menampilkan tanggal sesi yang sedang dibuka (hari, tanggal, dan bulan; tahun ikut ditampilkan bila sesi bukan pada tahun kalender berjalan). Panah memindahkan sesi mengikuti hari pertemuan grup: **‹** mundur sampai 1 Agustus tahun ajaran berjalan, **›** maju sampai sesi terkini (tidak bisa lebih maju dari itu). Jika di bawah tanggal tertulis **belum diisi**, kehadiran untuk hari pertemuan itu belum dicatat — Anda masih bisa mencatatnya; sesinya dibuat saat Anda mengirim. Sesi yang sudah dicatat selalu bisa dikoreksi, termasuk yang tanggalnya bukan hari pertemuan. |
| Baris santri + tombol **Hadir / Terlambat / Absen** | Tekan salah satu untuk menetapkan status santri tersebut. Warna hijau = status aktif yang tersimpan sementara di layar (belum terkirim ke server sampai ditekan **Kirim Kehadiran**). Status awal semua santri adalah "Hadir". |

Menekan **Absen** membuka kolom alasan tambahan:

<img src="./screenshots/id/attendance-tutor-absent.png" width="360" alt="Kehadiran — memilih alasan absen">

| Elemen | Fungsi |
|---|---|
| Chip **Sakit / Izin / Tanpa keterangan** | Tekan salah satu untuk langsung mengisi kolom alasan dengan teks tersebut. |
| Chip **Lainnya** | Mengosongkan kolom alasan agar Anda bisa mengetik alasan sendiri. |
| Kolom teks **Alasan** | Bisa diedit bebas, menimpa pilihan chip di atas. |

Di bagian bawah:

| Elemen | Fungsi |
|---|---|
| **Kirim Kehadiran** | Membuka kotak konfirmasi. Kotak itu menyebut jumlah santri yang akan dikirim (santri asisten yang menjadi bagian dari grup — lihat catatan di bawah — tidak dihitung) dan, pada baris terpisah, jumlah guru (lihat **Kehadiran guru** di bawah). |
| **Konfirmasi** / **Batal** | Konfirmasi mengirim data ke server; Batal membatalkan tanpa mengirim apa pun. |

**Catatan khusus — santri asisten**: jika seorang santri berusia 16+ juga membantu mengajar di grup itu, namanya tetap muncul di daftar hadir dengan status yang sudah tersimpan (tanda "Hadir" default), tetapi baris itu **tidak bisa diubah olehnya sendiri** — hanya guru lain atau admin yang bisa mencatat kehadirannya. Keterangan ini muncul langsung di bawah namanya di layar. Namanya **tidak** muncul lagi di bagian "Kehadiran guru": kehadirannya cukup dicatat sekali, sebagai santri.

**Kehadiran guru**: di bawah daftar santri ada bagian **"Kehadiran guru"** yang memuat setiap guru grup itu dengan tombol **Hadir / Terlambat / Absen** yang sama (dan kolom alasan yang sama saat Absen). Bagian ini dikirim bersama daftar santri saat Anda menekan **Kirim Kehadiran**. Seorang guru boleh mencatat kehadirannya sendiri maupun rekan segrupnya. Jika grup belum punya guru terdaftar, muncul keterangan untuk menetapkannya lewat menu **Kelola**. Catatan kehadiran guru **hanya terlihat oleh admin dan oleh guru lain di grup yang sama** — tidak pernah oleh orang tua atau santri — dan dipakai pimpinan TPA untuk meninjau kehadiran guru secara berkala.

**Status offline**: jika koneksi internet terputus saat mengirim, aplikasi menyimpan data itu di perangkat dan menampilkan pesan *"Anda sedang offline. Data akan dikirim saat kembali online."* — data akan otomatis terkirim begitu koneksi kembali, tanpa perlu mencatat ulang.

### 5.2 Tampilan Keluarga — Melihat Riwayat Kehadiran

<img src="./screenshots/id/attendance-family.png" width="360" alt="Kehadiran — tampilan orang tua">

Layar ini **hanya untuk melihat** — orang tua dan santri tidak bisa mengubah data kehadiran.

| Elemen | Fungsi |
|---|---|
| **Pilih Anak** | Muncul hanya jika akun memiliki lebih dari satu anak terkait. |
| Judul | "Kehadiranku" (untuk santri yang melihat datanya sendiri) atau "Kehadiran {nama anak}". |
| Kolom **Dari** / **Sampai** | Rentang tanggal untuk memfilter riwayat (default: 90 hari terakhir sampai hari ini). |
| Angka persentase besar | Tingkat kehadiran pada rentang tanggal yang dipilih. |
| **Hari pertemuan** | Baris hanya-baca di bawah persentase berisi hari dalam seminggu saat grup anak bertemu (mis. "Hari pertemuan: Sab"). Tidak muncul jika anak belum masuk grup. |
| **Riwayat Kehadiran** | Daftar per tanggal dengan status **Hadir / Terlambat / Tidak Hadir**, dan alasan (jika ada) untuk yang tidak hadir. |

---

## 6. Tugas

### 6.1 Tampilan Guru — Membuat & Menilai Tugas

<img src="./screenshots/id/assignments-tutor.png" width="360" alt="Tugas — daftar guru">

| Elemen | Fungsi |
|---|---|
| **Pilih Grup** | Sama seperti di Kehadiran. |
| **Buat** | Membuka formulir tugas baru. |
| Daftar tugas | Menampilkan judul dan tenggat waktu tiap tugas; tugas yang lewat tenggat mendapat label **"Lewat Tenggat"**. Tekan salah satu tugas untuk membuka layar penilaian. |

Formulir **Buat**:

<img src="./screenshots/id/assignments-tutor-new.png" width="360" alt="Tugas — formulir tugas baru">

| Kolom | Fungsi |
|---|---|
| **Judul** | Wajib diisi, maksimal 200 karakter. |
| **Deskripsi** | Opsional, teks bebas. |
| **Batas waktu** | Wajib diisi, default hari ini. |
| **Pilih Santri** | Daftar centang santri di grup yang dipilih — **semua santri tercentang secara otomatis**; hilangkan centang untuk mengecualikan santri tertentu. |
| **Simpan** | Aktif hanya jika judul terisi, tanggal terisi, dan minimal satu santri dicentang. |
| **Batal** | Menutup formulir tanpa menyimpan. |

Layar penilaian (setelah menekan salah satu tugas dari daftar):

<img src="./screenshots/id/assignments-tutor-detail.png" width="360" alt="Tugas — layar penilaian per santri">

| Elemen | Fungsi |
|---|---|
| **← Kembali** | Kembali ke daftar tugas. |
| Judul, deskripsi, dan batas waktu tugas | Informasi tugas yang dipilih. |
| Baris santri + tombol **Menunggu / Selesai / Terlambat / Sebagian** | Menetapkan status pengumpulan tugas santri tersebut. Setiap kali ditekan, status **langsung tersimpan** ke server (tidak perlu tombol "Kirim" terpisah seperti di Kehadiran). |
| Kolom **Catatan** per santri | Catatan bebas dari guru untuk santri itu; tersimpan otomatis saat kolom kehilangan fokus (misalnya setelah Anda mengetik lalu menekan bagian lain layar). |

> Perhatian: label status "Terlambat" pada Tugas berarti **tugas dikumpulkan terlambat/tidak selesai**, berbeda dari "Terlambat" pada Kehadiran yang berarti **datang terlambat ke kelas** — kata yang sama, arti berbeda di dua layar berbeda.

### 6.2 Tampilan Keluarga — Melihat Tugas

<img src="./screenshots/id/assignments-family.png" width="360" alt="Tugas — tampilan orang tua">

Hanya untuk melihat — status tugas hanya bisa diubah oleh guru.

| Elemen | Fungsi |
|---|---|
| **Pilih Anak** | Sama seperti di Kehadiran. |
| Baris jumlah tugas aktif | "{jumlah} tugas aktif" — menghitung tugas berstatus "Menunggu" atau yang sudah lewat tenggat. |
| Kartu tiap tugas | Judul, deskripsi, batas waktu, catatan dari guru (jika ada), dan lencana status: **Menunggu / Selesai / Terlambat / Sebagian / Lewat Tenggat**. |

---

## 7. Yanbu'a

Yanbu'a adalah metode belajar membaca Al-Qur'an bertahap (jilid 1–7 + halaman). Layar ini mencatat jilid, halaman, dan tingkat penguasaan bacaan santri.

### 7.1 Tampilan Guru — Mencatat Progres

<img src="./screenshots/id/yanbua-tutor.png" width="360" alt="Yanbu'a — daftar santri guru">

| Elemen | Fungsi |
|---|---|
| **Pilih Grup** | Sama seperti di layar lain. |
| Daftar santri | Tekan nama santri untuk membuka layar pencatatan. |

Layar pencatatan (setelah memilih santri):

<img src="./screenshots/id/yanbua-tutor-record.png" width="360" alt="Yanbu'a — formulir pencatatan">

| Elemen | Fungsi |
|---|---|
| **← Kembali** | Kembali ke daftar santri. |
| Kartu **Level saat ini** | Menampilkan jilid, halaman, dan penguasaan terakhir yang tercatat untuk santri ini. |
| **Jilid** | Pilihan jilid 1–7. |
| **Halaman** | Nomor halaman dalam jilid tersebut. |
| **Penguasaan** | Lancar / Kurang Lancar / Ulang. |
| **Catatan** | Teks bebas, opsional. |
| **Catat Progres** | Menyimpan entri baru. Jika halaman yang dicatat adalah halaman terakhir jilid tersebut **dan** penguasaan "Lancar", muncul pesan perayaan **"Selesai Jilid {n}! 🎉"** dan formulir otomatis berpindah ke jilid berikutnya, halaman 1 — siap untuk sesi berikutnya. |
| **Riwayat Sesi** | Daftar semua entri sebelumnya untuk santri ini, dengan tanggal. |

**Status offline**: sama seperti Kehadiran — jika gagal terkirim karena jaringan, data disimpan di perangkat dan dikirim otomatis saat online kembali.

### 7.2 Tampilan Keluarga — Melihat Progres

<img src="./screenshots/id/yanbua-family.png" width="360" alt="Yanbu'a — tampilan orang tua">

Hanya untuk melihat.

| Elemen | Fungsi |
|---|---|
| **Pilih Anak** | Sama seperti layar lain. |
| Kartu **Level sekarang** | Jilid, halaman, dan penguasaan terkini. |
| **Riwayat Sesi** | Sama seperti tampilan guru — daftar seluruh riwayat, tanpa kemampuan mengubah apa pun. |

---

## 8. Al-Quran

Mencatat posisi tilawah (bacaan) Al-Qur'an santri: surah, rentang ayat, dan kualitas bacaan.

### 8.1 Tampilan Guru — Mencatat Tilawah

<img src="./screenshots/id/quran-tutor.png" width="360" alt="Al-Quran — daftar santri guru">

Struktur sama seperti Yanbu'a: **Pilih Grup** → daftar santri → tekan nama untuk mencatat.

Layar pencatatan:

<img src="./screenshots/id/quran-tutor-record.png" width="360" alt="Al-Quran — formulir pencatatan tilawah">

| Elemen | Fungsi |
|---|---|
| Kartu **Posisi saat ini** | Surah dan ayat terakhir yang tercatat, plus perkiraan persentase Al-Qur'an yang telah ditempuh santri (mis. "~12% Al-Quran"). |
| **Surah** | Kolom pencarian teks (ketik nama atau nomor surah untuk menyaring) + dropdown pilihan surah. |
| **Ayat Dari** / **Ayat Sampai** | Rentang ayat yang dibaca pada sesi ini. |
| **Kualitas** | Mumtaz / Jayyid Jiddan / Jayyid / Maqbul / Perlu Perbaikan (dari terbaik ke yang perlu perbaikan). |
| **Catatan tajweed** | Teks bebas, opsional. |
| **Catat Tilawah** | Menyimpan entri. Berbeda dari Yanbu'a, di sini **tidak ada** perayaan otomatis atau lompat-surah otomatis — kolom surah/ayat/kualitas tetap seperti sebelumnya untuk entri berikutnya. |
| **Riwayat Tilawah** | Daftar seluruh entri sebelumnya. |

**Status offline**: sama seperti Kehadiran/Yanbu'a.

### 8.2 Tampilan Keluarga — Melihat Tilawah

<img src="./screenshots/id/quran-family.png" width="360" alt="Al-Quran — tampilan orang tua">

Hanya untuk melihat: kartu **Posisi sekarang** + **Riwayat Tilawah**, sama seperti Yanbu'a.

---

## 9. Murajaah

Murajaah adalah kegiatan mengulang hafalan Al-Qur'an secara rutin di rumah. Guru menetapkan target (surah + rentang ayat + frekuensi), lalu orang tua mengonfirmasi setiap kali dikerjakan di rumah.

Menu Murajaah untuk guru memiliki **dua tab**:

### 9.1 Tab "Tetapkan Target"

<img src="./screenshots/id/murajaah-tutor-assign.png" width="360" alt="Murajaah — tab Tetapkan Target">

Sama seperti Yanbu'a/Al-Quran: **Pilih Grup** → daftar santri → tekan nama untuk membuka detail.

Di layar detail santri, Anda akan menemukan:

| Elemen | Fungsi |
|---|---|
| Daftar target aktif | Setiap target ditampilkan sebagai kartu: nama surah, rentang ayat, dan frekuensi (Setiap hari / 3x seminggu / Seminggu sekali). |
| **Tandai Sudah Hafal** (per kartu target) | Menandai target tersebut selesai dihafal — target berpindah ke bagian "Hafalan Selesai". |
| **Tetapkan Target Baru** | Membuka formulir target baru: pilih **Surah**, rentang **Ayat Dari/Sampai**, dan **Frekuensi**. Tombol **Simpan** aktif hanya jika rentang ayat valid. |
| **Hafalan Selesai** | Daftar target yang sudah ditandai selesai dihafal — tidak bisa diubah lagi dari sini. |
| **Riwayat Konfirmasi** | Daftar tanggal setiap kali murajaah dikonfirmasi oleh orang tua, beserta kualitasnya. |

### 9.2 Tab "Ringkasan Grup"

<img src="./screenshots/id/murajaah-tutor-overview.png" width="360" alt="Murajaah — tab Ringkasan Grup">

Layar ini **hanya untuk melihat** — guru tidak bisa mengonfirmasi murajaah untuk santri (hanya orang tua yang bisa).

| Elemen | Fungsi |
|---|---|
| Ringkasan persentase | "{persen}% santri sudah murajaah hari ini". |
| Baris per santri | Target aktif (jika ada), status **"✓ Selesai Murajaah"** atau **"Belum dikonfirmasi hari ini"**, dan jumlah hari terkonfirmasi minggu ini (mis. "3/7 minggu ini"). |

### 9.3 Tampilan Keluarga — Konfirmasi Murajaah

<img src="./screenshots/id/murajaah-family.png" width="360" alt="Murajaah — tampilan orang tua">

| Elemen | Fungsi |
|---|---|
| **Pilih Anak** | Sama seperti layar lain. |
| Kartu target aktif | Surah, rentang ayat, frekuensi, **jumlah hari/minggu berturut-turut (streak)**, dan rekor terbaik jika ada. |
| **Kualitas** (dropdown) | Hafal Lancar / Hafal Kurang Lancar / Belum Hafal — dipilih sebelum mengonfirmasi. |
| **✓ Selesai Murajaah** (tombol) | Mencatat bahwa murajaah hari ini sudah dilakukan. **Hanya muncul untuk orang tua/wali** — jika Anda santri 16+ yang melihat data Anda sendiri, tombol ini tidak tersedia; hanya orang tua/wali yang bisa mengonfirmasi murajaah, walaupun santri bisa melihat progresnya. |
| **Hafalan Selesai** & **Riwayat Konfirmasi** | Sama seperti tampilan guru. |

**Status offline**: jika konfirmasi gagal terkirim karena jaringan, tampil pesan *"Anda sedang offline..."* dan tercatat sementara di perangkat sampai bisa dikirim ulang otomatis.

**Sudah dikonfirmasi**: jika seorang anak punya lebih dari satu orang tua/wali, masing-masing bisa mengonfirmasi murajaah hari itu. Konfirmasi pertama yang berlaku; jika orang tua/wali kedua mengonfirmasi lagi untuk hari yang sama, muncul pesan *"Murajaah hari ini sudah dikonfirmasi."* dan tidak ada yang berubah.

---

## 10. Rapor

Rapor akhir tahun merangkum kehadiran, nilai per bidang (Yanbu'a, Al-Quran, Murajaah), dan catatan guru, lalu diterbitkan sebagai PDF yang bisa diunduh keluarga.

### 10.1 Tampilan Guru/Admin — Daftar Rapor

<img src="./screenshots/id/reports-tutor.png" width="360" alt="Rapor — daftar untuk guru">

| Elemen | Fungsi |
|---|---|
| *(Khusus admin)* Panel **"Buat Draf Rapor"** | Admin bisa membuat draf rapor untuk seluruh grup atau satu grup tertentu, untuk satu tahun ajaran (format "2025/2026"). Setelah dibuat, panel menampilkan jumlah draf yang berhasil dibuat serta yang dilewati (karena sudah punya rapor, atau karena grupnya tidak punya guru pengampu). |
| **Pilih Grup** | Sama seperti layar lain. |
| Daftar rapor | Nama santri, tahun ajaran, dan lencana status **Draf** (abu-abu) atau **Diterbitkan** (hijau). Tekan salah satu untuk membuka. |

### 10.2 Editor Rapor

<img src="./screenshots/id/reports-tutor-editor.png" width="360" alt="Rapor — editor">

| Elemen | Fungsi |
|---|---|
| **← Kembali** | Kembali ke daftar. |
| **Ringkasan Kehadiran** | Angka persentase + jumlah Hadir/Terlambat/Tidak Hadir — **ini adalah cuplikan (snapshot)** dari saat draf dibuat, bukan data langsung, sehingga angkanya tetap sama meski catatan kehadiran diperbaiki setelahnya. |
| **Ringkasan Perkembangan** *(hanya untuk guru/admin, tidak muncul di tampilan keluarga)* | Posisi Yanbu'a, Al-Quran, dan jumlah target murajaah terkini — data langsung (bukan cuplikan), sebagai bahan referensi saat mengisi nilai. |
| **Nilai per Bidang**: Yanbu'a, Al-Quran, Murajaah | Masing-masing punya dropdown nilai (Mumtaz / Jayyid Jiddan / Jayyid / Maqbul / Perlu Bimbingan / "Belum dinilai") + kolom catatan singkat. |
| **Nilai Keseluruhan** | Dropdown nilai gabungan, tanpa kolom catatan. |
| **Catatan Guru** | Kolom teks panjang berisi narasi perkembangan santri — **wajib diisi sebelum rapor bisa diterbitkan**. |
| **Simpan** | Menyimpan perubahan tanpa menerbitkan — bisa dilakukan kapan saja, baik rapor masih draf maupun sudah diterbitkan. |
| **Terbitkan Rapor** / **Terbitkan Ulang & Perbarui PDF** | Hanya muncul untuk **guru penulis rapor** (bukan admin). Menampilkan kotak konfirmasi, lalu membuat berkas PDF dan mengubah status menjadi "Diterbitkan" — setelah itu orang tua dan santri bisa melihat & mengunduhnya. Nonaktif sampai kolom Catatan Guru terisi. |
| **Unduh PDF** | Muncul jika PDF sudah pernah dibuat. |

**Catatan untuk admin**: admin bisa mengubah nilai/catatan pada rapor apa pun, tetapi **tidak bisa menerbitkannya** — hanya guru penulis asli yang bisa menekan tombol terbit. Jika admin mengubah rapor yang sudah terbit, perubahan langsung tersimpan di aplikasi, tetapi berkas PDF baru menunggu sampai guru yang bersangkutan menerbitkan ulang.

### 10.3 Tampilan Keluarga — Melihat & Mengunduh Rapor

<img src="./screenshots/id/reports-family.png" width="360" alt="Rapor — tampilan orang tua">

Keluarga **hanya bisa melihat rapor yang sudah diterbitkan** — rapor berstatus draf tidak akan pernah muncul di tampilan ini.

| Elemen | Fungsi |
|---|---|
| **Pilih Anak** | Sama seperti layar lain. |
| Ringkasan kehadiran, nilai per bidang, dan catatan guru | Sama seperti yang ditulis guru, hanya untuk dibaca. |
| **Unduh PDF** | Membuka berkas PDF rapor di tab baru. |

Jika belum ada rapor yang diterbitkan untuk anak tersebut, layar menampilkan pesan **"Belum ada rapor tersedia"**.

---

## 11. Notifikasi

### 11.1 Pusat Notifikasi

<img src="./screenshots/id/notifications-centre.png" width="360" alt="Pusat Notifikasi">

Dibuka lewat ikon lonceng di bilah atas. Hanya tersedia (berisi data) untuk akun yang berstatus penerima notifikasi (orang tua, atau santri 16+ dengan akun sendiri) — guru dan admin murni akan melihat pesan bahwa akun mereka belum terhubung ke santri manapun.

| Elemen | Fungsi |
|---|---|
| Daftar notifikasi | Setiap baris berupa satu peristiwa: santri tidak hadir, tugas baru, pengingat tenggat, jilid Yanbu'a selesai, surah baru dihafal, pengingat murajaah, rapor siap, atau ringkasan mingguan. Tekan salah satu untuk membuka layar terkait. |
| Membaca notifikasi | Semua notifikasi otomatis ditandai "sudah dibaca" begitu halaman ini dibuka — tidak ada tombol tersendiri untuk itu. |
| Tautan **Pengaturan notifikasi** | Membuka [§11.2](#112-pengaturan-notifikasi). |

### 11.2 Pengaturan Notifikasi

<img src="./screenshots/id/notifications-settings.png" width="360" alt="Pengaturan Notifikasi">

Diakses dari Beranda atau dari Pusat Notifikasi. Terbuka untuk **semua peran**, walau isinya berbeda:

| Elemen | Fungsi |
|---|---|
| Status notifikasi push saat ini | "Notifikasi aktif di perangkat ini" / "tidak aktif" / "aktif di perangkat lain" (satu akun hanya bisa menerima notifikasi di satu perangkat sekaligus). |
| **Aktifkan notifikasi** / **Matikan notifikasi** / **Pindahkan ke perangkat ini** | Tombol tunggal yang berubah label sesuai status di atas. |
| *(Khusus akun penerima notifikasi)* Daftar **"Yang akan Anda terima"** | Penjelasan singkat 4 jenis notifikasi yang akan dikirim: ketidakhadiran, tugas baru, capaian (jilid/surah selesai), dan rapor siap. |
| **"Apa yang tampil di layar kunci"** | Penjelasan privasi: notifikasi di layar kunci hanya memuat nama depan anak dan jenis peristiwa — **tidak pernah** memuat alasan ketidakhadiran, nilai, atau detail progres; semua itu baru terlihat setelah membuka aplikasi. |

Jika peramban memblokir izin notifikasi, layar menampilkan penjelasan untuk membuka pengaturan izin peramban secara manual.

---

## 12. Kelola (Khusus Admin)

Hanya bisa diakses oleh akun dengan peran Admin, lewat ubin **Kelola** di Beranda. Terdiri dari lima sub-halaman dengan menu tab di bagian atas: **Pendaftaran · Grup · Santri · Kehadiran Guru · Pengguna**.

### 12.1 Pendaftaran

<img src="./screenshots/id/admin-registrations.png" width="360" alt="Kelola — Pendaftaran">

**Bagian "Undang Pengguna Baru"**

| Kolom | Fungsi |
|---|---|
| **Alamat Email** | Wajib diisi. |
| **Nama Lengkap** | Wajib diisi. |
| **Peran** | Orang Tua / Guru / Santri / Admin (default: Orang Tua). |
| **Kirim Undangan** | Membuat akun baru dan mengirim tautan undangan ke email tersebut. |

**Bagian "Menunggu Pendaftaran"** — daftar orang yang sudah pernah masuk lewat Google tetapi belum diberi profil/peran (misalnya karena diundang oleh orang lain, atau masuk sendiri sebelum didaftarkan admin):

| Kolom | Fungsi |
|---|---|
| Email & tanggal pertama masuk | Informasi otomatis, tidak bisa diubah. |
| **Keterangan dari pengguna** | Hanya tampil jika orang tersebut mengisi keterangan pada formulir permintaan (lihat [§2](#2-masuk-ke-aplikasi)). Hanya-baca. |
| **Nama Lengkap** | Sudah terisi dengan nama yang diberikan orang tersebut sendiri; kosong jika tidak ada (misalnya untuk akun yang diundang). Selalu dapat Anda ubah sebelum mendaftarkan. |
| **Peran** | Sama seperti di atas. |
| **Daftarkan** | Menyelesaikan pendaftaran orang tersebut — baris otomatis hilang dari daftar setelah berhasil, dan permintaan (beserta keterangannya) dihapus. |
| **Tolak** | Menghapus pendaftaran yang menunggu. Muncul dulu pertanyaan konfirmasi berisi alamat email. Setelah dikonfirmasi, akun (yang belum terdaftar) beserta permintaannya dihapus dan baris hilang dari daftar. **Menolak bukan pemblokiran**: pengguna Google yang sama dapat masuk lagi dan akan muncul sebagai pendaftaran menunggu yang baru. Pendaftaran yang akunnya sudah terlanjur dibuat tidak dapat ditolak. |

### 12.2 Grup

<img src="./screenshots/id/admin-classes.png" width="360" alt="Kelola — daftar Grup">

| Elemen | Fungsi |
|---|---|
| **+ Grup Baru** | Membuka formulir grup baru (lihat gambar di bawah). |
| Kartu tiap grup | Nama, jadwal, hari pertemuan (mis. "Rab, Sab"), dan daftar guru pengampu. |
| **Ubah** | Membuka formulir edit untuk grup tersebut, terisi data yang sudah ada. |

Formulir Grup (sama untuk buat baru maupun ubah):

<img src="./screenshots/id/admin-classes-new-form.png" width="360" alt="Kelola — formulir Grup">

| Kolom | Fungsi |
|---|---|
| **Nama Grup** | Wajib diisi. |
| **Jadwal** | Opsional, teks bebas untuk waktu (mis. "Sabtu 10:00-12:00"). |
| **Hari pertemuan** | Daftar centang Senin sampai Ahad. Pada grup baru, **Sabtu** sudah tercentang; boleh lebih dari satu hari. Minimal satu hari harus dipilih — jika tidak, tombol **Simpan** nonaktif dengan pesan *"Pilih minimal satu hari"*. Hari-hari inilah yang menentukan pada tanggal berapa daftar hadir dapat membuat sesi. |
| **Guru Pengampu** | Daftar centang — bisa memilih lebih dari satu guru, atau tidak memilih sama sekali. |
| **Simpan** / **Batal** | Menyimpan atau membatalkan. |

> Tidak ada tombol hapus grup di aplikasi ini.

### 12.3 Santri

<img src="./screenshots/id/admin-students.png" width="360" alt="Kelola — daftar Santri">

| Elemen | Fungsi |
|---|---|
| **+ Santri Baru** | Membuka formulir santri baru. |
| Kartu tiap santri | Nama, lencana **"Akun sendiri"** (jika santri punya login Google sendiri, misalnya santri 16+), grup, dan nama orang tua/wali yang tertaut. |
| **Ubah** | Membuka formulir edit. |
| **Hapus** | Menghapus data santri **secara permanen**, beserta seluruh kehadiran, progres, dan rapornya (muncul pertanyaan konfirmasi lebih dulu). Gunakan hanya untuk membersihkan data ganda — misalnya jika orang tua mengirim ulang formulir pendaftaran dengan ejaan nama yang diperbaiki, sehingga muncul dua data untuk satu anak. |

Formulir Santri:

<img src="./screenshots/id/admin-students-new-form.png" width="360" alt="Kelola — formulir Santri">

| Kolom | Fungsi |
|---|---|
| **Nama Lengkap** | Wajib diisi. |
| **Tanggal Lahir** | Wajib diisi. |
| **Orang tua / wali** | Wajib — **minimal satu**. Pilih tiap orang tua/wali dari daftar pengguna terdaftar, dan gunakan **"+ Tambah orang tua / wali"** untuk menambah yang kedua (atau lebih) bila perlu. Tiap baris boleh diberi keterangan hubungan opsional (mis. "ibu", "ayah", "wali"). Semua orang tua/wali yang tertaut memperoleh akses **yang sama**: melihat perkembangan, menerima notifikasi, dan mengonfirmasi latihan di rumah — tidak ada orang tua "utama". Tombol hapus **−** nonaktif selama baris tinggal satu; seorang anak harus selalu punya minimal satu orang tua/wali. Melepas tautan orang tua/wali langsung mengakhiri aksesnya; catatan bahwa tautan itu pernah ada tetap disimpan untuk audit. |
| **Grup** | Opsional — bisa dikosongkan jika belum ditempatkan di grup. |
| **Tautkan Akun Login Mandiri** | Opsional — hanya muncul jika ada akun bertipe "santri" yang belum tertaut ke santri manapun. Ini cara untuk menghubungkan login Google milik santri (biasanya yang sudah 16+) ke data santri yang sudah ada, misalnya saat santri baru saja membuat akunnya sendiri. |
| **Simpan** / **Batal** | Menyimpan atau membatalkan. |

> Tidak ada tombol hapus santri di aplikasi ini.

### 12.4 Kehadiran Guru

Layar untuk meninjau kehadiran seorang guru secara berkala. Kehadiran guru dicatat oleh guru atau admin di layar **Kehadiran** biasa (lihat [§5.1](#51-tampilan-guru--mencatat-kehadiran) → "Kehadiran guru").

| Elemen | Fungsi |
|---|---|
| **Pilih guru** | Daftar guru yang sudah pernah tercatat kehadirannya. Guru yang belum pernah dicatat tidak muncul; jika belum ada satu pun, muncul keterangan "Belum ada kehadiran guru yang tercatat." |
| **Pilih grup** *(muncul bila guru mengampu lebih dari satu grup)* | Menyaring daftar ke satu grup, atau **"Semua grup"**. |
| **Dari** / **Sampai** | Rentang tanggal. Standar: 1 Agustus tahun ajaran berjalan sampai hari ini. |
| Kartu persentase | Persentase kehadiran pada rentang terpilih (Terlambat dihitung hadir; hanya Absen yang mengurangi), diikuti rincian **{n} hadir · {n} terlambat · {n} absen**. |
| **Riwayat Kehadiran** | Daftar per tanggal: tanggal, nama grup, dan status **Hadir / Terlambat / Tidak Hadir** (beserta alasan jika tidak hadir). |

Layar ini **hanya untuk melihat** — koreksi kehadiran dilakukan di layar Kehadiran grup yang bersangkutan. Orang tua dan santri tidak pernah melihat kehadiran guru.

### 12.5 Pengguna

Daftar semua akun yang sudah terdaftar, untuk memperbaiki **nama** atau **peran** seseorang. Pembuatan akun tetap dilakukan di [§12.1 Pendaftaran](#121-pendaftaran).

| Elemen | Fungsi |
|---|---|
| **Cari nama atau email** | Menyaring daftar berdasarkan potongan nama atau alamat email. |
| Penyaring peran | **Semua peran** / Admin / Guru / Orang Tua / Santri. |
| **Ubah** | Membuka formulir baris: kolom **Nama Lengkap** dan pilihan **Peran**. Tekan **Simpan** atau **Batal**. |
| **Hapus** | Hanya muncul pada baris akun **Orang Tua** atau **Santri** (bukan Guru/Admin, dan bukan akun Anda sendiri). Menghapus akun **secara permanen** beserta data terkaitnya, setelah pertanyaan konfirmasi. Dipakai untuk membersihkan akun palsu dari pengiriman formulir pendaftaran yang tidak sah. Jika akun masih tertaut sebagai wali santri, hapus dulu data santrinya di [§12.3 Santri](#123-santri); selama masih tertaut, penghapusan ditolak dengan pesan yang menjelaskan hal itu. |

Beberapa aturan pengaman:

- Pada baris akun Anda sendiri, pilihan **Peran** dinonaktifkan — Anda tidak dapat mengubah peran sendiri. Namanya tetap bisa diubah.
- **Admin terakhir** tidak dapat diturunkan perannya. Beri peran Admin ke orang lain dulu.
- Menurunkan peran seorang **guru** yang masih terdaftar di satu atau beberapa grup akan memunculkan konfirmasi yang menyebutkan grup-grup itu; jika Anda lanjutkan, guru tersebut sekaligus dikeluarkan dari daftar guru grup-grup itu.
- Menurunkan peran seorang **orang tua** atau **santri 16+ dengan login** hanya memberi peringatan bahwa tautan wali / login mandiri mereka tetap ada — tautan itu **tidak** diputus (itu hubungan, bukan peran).

Setiap perubahan peran dicatat (siapa, dari peran apa ke apa, kapan) di log internal yang hanya dapat dilihat admin; perbaikan nama saja tidak dicatat. Log itu belum ditampilkan di aplikasi.

---

## 13. Akun dengan Peran Ganda

Sebagian akun memegang lebih dari satu hubungan — misalnya seorang guru yang juga orang tua dari santri di grup lain (bukan grup yang ia ajar). Akun seperti ini melihat **saklar tampilan** di atas layar Kehadiran, Tugas, Yanbu'a, Al-Quran, Murajaah, dan Rapor:

<img src="./screenshots/id/dualrole-scope-class.png" width="360" alt="Saklar tampilan — Grup saya" style="margin-right:12px">
<img src="./screenshots/id/dualrole-scope-family.png" width="360" alt="Saklar tampilan — Anak saya">

| Tombol | Fungsi |
|---|---|
| **Grup saya** | Menampilkan tampilan guru — grup yang diampu. |
| **Anak saya** *(atau "Saya" untuk santri 16+, atau "Keluarga saya" jika keduanya)* | Menampilkan tampilan keluarga — anak yang terkait dengan akun ini. |

Layar yang sedang dibuka **tidak berpindah** saat menekan saklar ini — hanya isinya yang berganti antara tampilan grup dan tampilan keluarga. Akun dengan satu hubungan saja (murni guru, murni orang tua, atau murni admin) tidak akan pernah melihat saklar ini sama sekali.

---

## 14. Elemen & Istilah Umum

Elemen berikut muncul berulang di banyak layar dan dijelaskan sekali di sini agar tidak diulang-ulang.

| Elemen | Kapan muncul | Fungsi |
|---|---|---|
| **Pilih Grup** | Layar guru manapun | Muncul hanya jika guru mengampu lebih dari satu grup. |
| **Pilih Anak** | Layar keluarga manapun | Muncul hanya jika akun memiliki lebih dari satu anak terkait. |
| *"Memuat…"* | Semua layar | Data sedang diambil dari server. |
| *"Belum ada data"* | Semua layar | Tidak ada data untuk ditampilkan pada kondisi saat ini. |
| *"Anda belum ditugaskan ke grup manapun"* | Layar guru | Akun guru belum diberi grup oleh admin. |
| *"Anda sedang offline. Data akan dikirim saat kembali online."* | Kehadiran, Yanbu'a, Al-Quran, Murajaah | Aksi Anda tersimpan di perangkat dan **akan otomatis terkirim** begitu koneksi internet kembali — tidak perlu mengulang. |
| Pesan galat (kotak merah) | Semua layar | Terjadi kesalahan saat memuat atau menyimpan data — coba lagi atau hubungi admin jika berulang. |

---

## 15. Lampiran: Istilah Indonesia ⟷ Belanda

Untuk memudahkan komunikasi dua bahasa di lingkungan TPA, berikut padanan istilah utama yang digunakan aplikasi:

| Indonesia | Belanda | Keterangan |
|---|---|---|
| Grup | Groep | Sebelumnya disebut "Kelas"/"Klas" — istilah resmi sekarang adalah "Grup"/"Groep". |
| Santri | Leerling | — |
| Guru | Docent | Istilah netral untuk pengajar; menggantikan "Ustadz/Ustadzah". |
| Orang Tua | Ouder | — |
| Hadir | Aanwezig | — |
| Tugas | Huiswerk | Sebelumnya disebut "Opdrachten" — istilah resmi sekarang adalah "Huiswerk" (PR/pekerjaan rumah). |
| Rapor | Rapport | — |
| Kelola | Beheer | Menu khusus admin. |
| Pendaftaran | Registraties | — |
| Pengguna | Gebruikers | Sub-halaman admin untuk mengubah nama dan peran akun. |

---

*Dokumen ini dibuat berdasarkan tangkapan layar aplikasi versi Agustus 2026, tampilan ponsel (mobile), dengan layar untuk **5. Kehadiran** dan **12.2 Grup** diambil ulang untuk hari pertemuan grup dan daftar hadir yang mengikuti jadwal (ADR-037, September 2026), serta **§5.1 dilengkapi dengan bagian "Kehadiran guru"** dan **§12.4 ditambahkan untuk layar peninjauan "Kehadiran Guru" admin** (ADR-041, September 2026), dan **§12.5 ditambahkan untuk layar "Pengguna" admin** (ADR-042, September 2026). Tata letak dapat sedikit berbeda pada versi aplikasi yang lebih baru. Versi PDF dibuat ulang dari teks ini dengan `scripts/gen-manual-pdf.mjs`; layar §12.4 dan §12.5 belum memiliki tangkapan layar.*
