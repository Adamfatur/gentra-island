# Privacy Policy

**Gentra Island**, by Adam Faturahman
Effective 27 October 2026

[Bahasa Indonesia](#kebijakan-privasi-bahasa-indonesia) is below.

## The short version

Gentra Island runs on your computer and keeps what it knows there. There are no accounts, no analytics, no telemetry, no ads, and no tracking. The developer receives nothing from your use of the app.

## What stays on your computer

Gentra Island stores these things in your user's app data folder, so that it still has them after a restart:

| What | Why | You can remove it by |
|---|---|---|
| Clipboard history: text, links, and copied images (as PNG files, at most 60) | So you can find and paste earlier copies | It removes itself after the time you pick in Settings (30 days by default); **Clear history** in Settings, or deleting single items |
| Reminders: the text you chose (up to 500 characters), the time, and the app it was copied from | So the reminder can show at that time | **Done** or **×** on the reminder |
| Shelf: the file paths you dropped on the island, not the files | So the shelf lists them again | Removing them from the Shelf |
| Gentle care: today's count of reminders, which ones you answered, and when the last one showed | So it doesn't repeat itself or spam you after a restart | It resets every day; switching the feature off stops it |
| Settings: theme, accent color, language, mode, and similar choices | So the app looks and behaves the way you set it | Uninstalling and deleting the folders below |
| Command alert scripts, plus a random local port and token | So your terminal can report finished commands to the island | Deleting the `hook` folder |
| Agent hook script (only if you connect Claude Code or Codex) | So the agent can tell the island it is working, needs you, or is done | **Disconnect** in the AI tab, then deleting the `hook` folder |

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
- **New screenshots and downloads.** With smart screenshots on, Gentra Island checks the folder your screenshots go to for new ones and shows a small preview. **Copy text** reads the text on your computer: Vision on macOS, Windows' built-in OCR, or tesseract on Linux. With download progress on, it reads the names and sizes of files your browser is still downloading in your Downloads folder. Nothing is saved or sent.
- **Permission requests.** If you connect Claude Code, its permission requests (the tool and its input, such as a command) come to the island so you can answer. They are shown, then forgotten.
- **Where windows are (macOS).** To step aside for full-screen apps, Gentra Island asks the system once a second for the size and position of the windows on screen, and which layer they sit in. It doesn't read their titles or contents, and needs no screen recording permission. Nothing is saved.
- **Idle time.** While gentle care is on, Gentra Island asks the system once a minute how many seconds have passed since the last keyboard or mouse input. It doesn't see which keys or where you clicked.
- **AI agent logs.** While the AI agents feature is on, Gentra Island reads the session logs Claude Code and Codex keep on your computer (`~/.claude/projects` and `~/.codex/sessions`) and keeps only token counts, times, and the rate limits Codex reports, in memory. It doesn't read their login files or keys.
- **AI agent events.** If you connect an agent, its hook sends the island the name of the project folder, the session ID, and, when the agent asks you something, its question. The agent hands its hook the whole event, your prompt included; the hook passes it only to the island on your own computer (`127.0.0.1`), which takes those fields and drops the rest straight away. Nothing is saved.

## Files it changes outside its own folder

Only when you click **Connect** in the AI tab: Gentra Island adds one hook entry per event to `~/.claude/settings.json` (Claude Code) or `~/.codex/hooks.json` (Codex). Before changing the file it saves a copy next to it, named `settings.json.gentra-backup-<time>` or `hooks.json.gentra-backup-<time>`. **Disconnect** removes exactly those entries and leaves the rest of the file as it was.

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
Berlaku sejak 27 Oktober 2026

### Ringkasnya

Gentra Island berjalan di komputermu dan menyimpan semuanya di sana. Tidak ada akun, analitik, telemetri, iklan, maupun pelacakan. Pengembang tidak menerima apa pun dari pemakaianmu.

### Yang disimpan di komputermu

| Apa | Untuk apa | Cara menghapusnya |
|---|---|---|
| Riwayat clipboard: teks, tautan, dan gambar yang disalin (sebagai file PNG, maksimal 60) | Supaya kamu bisa mencari dan menempel salinan sebelumnya | Terhapus sendiri setelah waktu yang kamu pilih di Pengaturan (bawaannya 30 hari); **Hapus riwayat** di Pengaturan, atau hapus satu per satu |
| Pengingat: teks yang kamu pilih (maksimal 500 karakter), waktunya, dan aplikasi asalnya | Supaya pengingat muncul tepat waktu | **Selesai** atau **×** pada pengingat |
| Rak: lokasi file yang kamu seret ke pulau, bukan file-nya | Supaya rak tetap menampilkannya | Hapus dari Rak |
| Pengingat sehat: jumlah pengingat hari ini, mana yang kamu jawab, dan kapan terakhir muncul | Supaya tidak berulang atau jadi spam setelah aplikasi dibuka ulang | Ter-reset tiap hari; mematikan fiturnya menghentikannya |
| Pengaturan: tema, warna aksen, bahasa, mode, dan pilihan serupa | Supaya aplikasi tampil seperti yang kamu atur | Uninstall lalu hapus folder di bawah |
| Skrip notifikasi perintah, plus port dan token lokal acak | Supaya terminal bisa mengabari pulau saat perintah selesai | Hapus folder `hook` |
| Skrip hook agen (hanya kalau kamu menyambungkan Claude Code atau Codex) | Supaya agen bisa mengabari pulau saat bekerja, butuh kamu, atau selesai | **Putuskan** di tab AI, lalu hapus folder `hook` |

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
- **Screenshot dan unduhan baru.** Kalau screenshot pintar menyala, Gentra Island memeriksa folder tempat screenshot disimpan dan menampilkan pratinjau kecil. **Salin teks** membaca teksnya di komputermu: Vision di macOS, OCR bawaan Windows, atau tesseract di Linux. Kalau progres unduhan menyala, yang dibaca hanya nama dan ukuran file yang masih diunduh browser di folder Downloads. Tidak ada yang disimpan atau dikirim.
- **Permintaan izin.** Kalau kamu menyambungkan Claude Code, permintaan izinnya (alat dan isinya, misalnya sebuah perintah) dikirim ke pulau supaya bisa kamu jawab. Ditampilkan, lalu dilupakan.
- **Letak jendela (macOS).** Supaya bisa menyingkir saat ada aplikasi layar penuh, Gentra Island bertanya ke sistem sekali sedetik ukuran dan posisi jendela di layar, serta lapisannya. Judul dan isinya tidak dibaca, dan tidak perlu izin rekam layar. Tidak ada yang disimpan.
- **Waktu diam.** Selama pengingat sehat menyala, Gentra Island bertanya ke sistem sekali semenit sudah berapa detik sejak keyboard atau mouse terakhir disentuh. Tombol apa yang ditekan atau di mana kamu mengeklik tidak terlihat.
- **Log agen AI.** Selama fitur agen AI menyala, Gentra Island membaca log sesi yang disimpan Claude Code dan Codex di komputermu (`~/.claude/projects` dan `~/.codex/sessions`) dan hanya menyimpan jumlah token, waktu, dan batas pemakaian yang dilaporkan Codex, di memori. File login dan kuncinya tidak dibaca.
- **Kejadian agen AI.** Kalau kamu menyambungkan agen, hook-nya mengirim ke pulau nama folder proyek, ID sesi, dan, saat agen bertanya, pertanyaannya. Agen memberi hook-nya seluruh data kejadian, termasuk prompt-mu; hook hanya meneruskannya ke pulau di komputermu sendiri (`127.0.0.1`), yang mengambil isian tadi dan langsung membuang sisanya. Tidak ada yang disimpan.

### File di luar foldernya yang diubah

Hanya saat kamu menekan **Sambungkan** di tab AI: Gentra Island menambahkan satu entri hook per kejadian ke `~/.claude/settings.json` (Claude Code) atau `~/.codex/hooks.json` (Codex). Sebelum mengubahnya, salinan file disimpan di sebelahnya dengan nama `settings.json.gentra-backup-<waktu>` atau `hooks.json.gentra-backup-<waktu>`. **Putuskan** menghapus entri itu saja, sisanya tetap seperti semula.

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
