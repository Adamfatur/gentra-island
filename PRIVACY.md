# Privacy Policy

**Gentra Island**, by Adam Faturahman
Effective 26 October 2026

[Bahasa Indonesia](#kebijakan-privasi-bahasa-indonesia) is below.

## The short version

Gentra Island runs on your computer and keeps what it knows there. There are no accounts, no analytics, no telemetry, no ads, and no tracking. The developer receives nothing from your use of the app.

## What stays on your computer

Gentra Island stores these things in your user's app data folder, so that it still has them after a restart:

| What | Why | You can remove it by |
|---|---|---|
| Clipboard history: text, links, and small thumbnails of copied images | So you can find and paste earlier copies | **Clear history** in the Clipboard tab, or deleting single items |
| Reminders: the text you chose (up to 500 characters), the time, and the app it was copied from | So the reminder can show at that time | **Done** or **×** on the reminder |
| Shelf: the file paths you dropped on the island, not the files | So the shelf lists them again | Removing them from the Shelf |
| Settings: theme, accent color, language, mode, and similar choices | So the app looks and behaves the way you set it | Uninstalling and deleting the folders below |
| Command alert scripts, plus a random local port and token | So your terminal can report finished commands to the island | Deleting the `hook` folder |

**Secrets are never stored.** Text that looks like an API key or a private key is kept in memory only, shown masked, and removed from history and the clipboard after 60 seconds.

The folders are:

- **macOS:** `~/Library/Application Support/app.gentra.island`, `~/Library/WebKit/app.gentra.island`, and `~/Library/Caches/app.gentra.island`
- **Windows:** `%APPDATA%\app.gentra.island` and `%LOCALAPPDATA%\app.gentra.island`
- **Linux:** `~/.local/share/app.gentra.island` and `~/.cache/app.gentra.island`

## What it reads but doesn't keep

- **System information** (memory, CPU, network speed, the apps using the most memory) is read while the feature is on and shown on screen. It isn't saved or sent anywhere.
- **What's playing** (title, artist, artwork, which app) is read from the system to show and control it. It isn't saved.
- **Microphone use.** The meeting guard asks the system whether an app is using the mic, and which one. It never opens the microphone and never hears audio.
- **Local servers.** The port watcher lists processes listening on your computer, only while the Dev tab is open.

## Permissions

- **Camera** is used only while the camera mirror is visible in the Calls tab. Nothing is recorded or saved.
- **Automation (macOS)** is used only if you switch on **Show thumbnails** in the Media tab. Gentra Island then asks your browser for the titles and addresses of its open tabs, finds the YouTube video that is playing, and forgets the rest straight away.

## When it uses the internet

Gentra Island makes no network requests of its own, with one optional exception:

- **YouTube thumbnails**, only if you switch them on: the app downloads the thumbnail of the playing video from `i.ytimg.com`. As with any download, Google receives your IP address and the video ID under [Google's Privacy Policy](https://policies.google.com/privacy).

Links you click in the app (opening a local server, the PayPal page in About, these documents) open in your browser and are then governed by that site's own policy.

## The website

This policy is about the app. The website at [adamfatur.github.io/gentra-island](https://adamfatur.github.io/gentra-island/) counts visits with [GoatCounter](https://www.goatcounter.com), which uses no cookies and stores no personal information: it records the page, where the visit came from (for example a search engine), the browser and screen size, the country, and which download button was clicked. The counts are [public](https://gentra-island.goatcounter.com) for anyone to see. The site is hosted by GitHub Pages under [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Children

Gentra Island doesn't collect personal information from anyone, including children.

## Changes

If this policy changes, the new version will be published in this file with a new effective date, and noted in the [changelog](CHANGELOG.md).

## Contact

Questions about privacy: open an issue on [GitHub](https://github.com/Adamfatur/gentra-island/issues). For anything sensitive, use the private **Report a vulnerability** form described in [SECURITY.md](SECURITY.md).

---

## Kebijakan Privasi (Bahasa Indonesia)

**Gentra Island**, oleh Adam Faturahman
Berlaku sejak 26 Oktober 2026

### Ringkasnya

Gentra Island berjalan di komputermu dan menyimpan semuanya di sana. Tidak ada akun, analitik, telemetri, iklan, maupun pelacakan. Pengembang tidak menerima apa pun dari pemakaianmu.

### Yang disimpan di komputermu

| Apa | Untuk apa | Cara menghapusnya |
|---|---|---|
| Riwayat clipboard: teks, tautan, dan thumbnail kecil gambar yang disalin | Supaya kamu bisa mencari dan menempel salinan sebelumnya | **Hapus riwayat** di tab Clipboard, atau hapus satu per satu |
| Pengingat: teks yang kamu pilih (maksimal 500 karakter), waktunya, dan aplikasi asalnya | Supaya pengingat muncul tepat waktu | **Selesai** atau **×** pada pengingat |
| Rak: lokasi file yang kamu seret ke pulau, bukan file-nya | Supaya rak tetap menampilkannya | Hapus dari Rak |
| Pengaturan: tema, warna aksen, bahasa, mode, dan pilihan serupa | Supaya aplikasi tampil seperti yang kamu atur | Uninstall lalu hapus folder di bawah |
| Skrip notifikasi perintah, plus port dan token lokal acak | Supaya terminal bisa mengabari pulau saat perintah selesai | Hapus folder `hook` |

**Rahasia tidak pernah disimpan.** Teks yang terlihat seperti kunci API atau kunci privat hanya ada di memori, tampil tersamar, dan hilang dari riwayat serta clipboard setelah 60 detik.

Lokasi foldernya:

- **macOS:** `~/Library/Application Support/app.gentra.island`, `~/Library/WebKit/app.gentra.island`, dan `~/Library/Caches/app.gentra.island`
- **Windows:** `%APPDATA%\app.gentra.island` dan `%LOCALAPPDATA%\app.gentra.island`
- **Linux:** `~/.local/share/app.gentra.island` dan `~/.cache/app.gentra.island`

### Yang dibaca tapi tidak disimpan

- **Informasi sistem** (memori, CPU, kecepatan jaringan, aplikasi yang paling banyak memakai memori) dibaca selama fiturnya menyala dan hanya ditampilkan di layar.
- **Yang sedang diputar** (judul, artis, gambar, aplikasinya) dibaca untuk ditampilkan dan dikendalikan, tidak disimpan.
- **Pemakaian mikrofon.** Penjaga meeting hanya bertanya ke sistem apakah ada aplikasi yang memakai mic, dan aplikasi mana. Mikrofon tidak pernah dibuka dan suara tidak pernah didengar.
- **Server lokal.** Pengawas port mendaftar proses yang mendengarkan port di komputermu, hanya selama tab Dev terbuka.

### Izin

- **Kamera** hanya dipakai selama cermin kamera tampil di tab Rapat. Tidak ada yang direkam atau disimpan.
- **Automation (macOS)** hanya dipakai kalau kamu menyalakan **Tampilkan thumbnail** di tab Media. Gentra Island lalu bertanya ke browser judul dan alamat tab yang terbuka, mencari video YouTube yang sedang diputar, dan langsung melupakan sisanya.

### Kapan memakai internet

Gentra Island tidak membuat permintaan jaringan sendiri, kecuali satu yang opsional:

- **Thumbnail YouTube**, hanya kalau kamu menyalakannya: aplikasi mengunduh thumbnail video yang diputar dari `i.ytimg.com`. Seperti unduhan lain, Google menerima alamat IP dan ID videonya sesuai [Kebijakan Privasi Google](https://policies.google.com/privacy?hl=id).

Tautan yang kamu klik di aplikasi (membuka server lokal, halaman PayPal di Tentang, dokumen ini) terbuka di browser dan mengikuti kebijakan situs tersebut.

### Website

Kebijakan ini tentang aplikasinya. Website di [adamfatur.github.io/gentra-island](https://adamfatur.github.io/gentra-island/) menghitung kunjungan dengan [GoatCounter](https://www.goatcounter.com), tanpa cookie dan tanpa menyimpan informasi pribadi: yang dicatat hanya halaman, asal kunjungan (misalnya mesin pencari), browser dan ukuran layar, negara, dan tombol unduh mana yang diklik. Hitungannya [terbuka untuk umum](https://gentra-island.goatcounter.com). Website di-hosting GitHub Pages sesuai [pernyataan privasi GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

### Anak-anak

Gentra Island tidak mengumpulkan informasi pribadi dari siapa pun, termasuk anak-anak.

### Perubahan

Kalau kebijakan ini berubah, versi barunya diterbitkan di file ini dengan tanggal berlaku baru, dan dicatat di [changelog](CHANGELOG.md).

### Kontak

Pertanyaan soal privasi: buka issue di [GitHub](https://github.com/Adamfatur/gentra-island/issues). Untuk hal yang sensitif, gunakan formulir pribadi **Report a vulnerability** seperti dijelaskan di [SECURITY.md](SECURITY.md).
