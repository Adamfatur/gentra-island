<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/gentra-island-wordmark-white.svg">
    <img src="assets/brand/gentra-island-wordmark-black.svg" alt="Gentra Island" width="420">
  </picture>
</p>

<p align="center">
  A Dynamic Island for your desktop. macOS, Windows, and Linux.<br>
  Small at the top of your screen; open it when you need it.
</p>

<p align="center">
  <a href="../../releases/latest">Download</a> |
  <a href="INSTALL.md">Install guide</a> |
  <a href="#system-requirements">Requirements</a> |
  <a href="#privacy">Privacy</a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.gif" alt="Gentra Island opening from the notch: now playing, Home, Media, Clipboard, and Dev tabs, then a build-finished alert" width="720">
</p>

---

Gentra Island sits at the top of your screen. On a Mac with a notch it grows out of the camera housing; elsewhere it floats as a small pill. Hover, click, or press **⌥⌘G** (**Ctrl+Alt+G** on Windows and Linux) to open it. It opens by itself only when something is worth seeing, like a long build that just finished or a call that started.

## Screenshots

| | |
|---|---|
| ![Home: what's playing, memory, focus, last copied, and shelf](docs/screenshots/home.png) | ![Media: artwork-tinted player with a timeline and controls](docs/screenshots/media.png) |
| **Home** shows what matters right now | **Media** controls whatever is playing |
| ![Clipboard history with a decoded JWT, a tracked link, and an image](docs/screenshots/clipboard.png) | ![Dev: local servers and terminal command alerts](docs/screenshots/dev.png) |
| **Clipboard** remembers and understands what you copy | **Dev** watches your local servers and long commands |
| ![Calls: which app uses the mic, with the call time](docs/screenshots/calls.png) | ![Settings: theme, accent color, language, startup, and About](docs/screenshots/settings.png) |
| **Calls** shows who has your mic | **Settings** with themes and languages |
| ![The small island with album artwork and a level meter](docs/screenshots/compact.png) | ![Home in the light theme](docs/screenshots/home-light.png) |
| The small island while music plays | Light theme |

A higher-quality version of the video is in [docs/screenshots/demo.mp4](docs/screenshots/demo.mp4).

## What it does

| | |
|---|---|
| **Home** | One glance: what's playing, memory, a focus timer, what you copied last, files on your shelf, and a call if one is live. |
| **Now playing** | Music or video from Spotify, Apple Music, YouTube, and other players. Play, pause, skip, and drag to seek. Artwork and a level meter on the small island. |
| **Clipboard** | History of text, links, code, colors, and screenshots. Search, pin, filter. Press **⌥⌘V** (**Ctrl+Alt+V**). |
| **Smart paste** | Decodes JWTs, timestamps, base64, JSON, URL encoding, and cron. Strips link trackers. Masks ID and card numbers on request. |
| **Secret guard** | API keys and private keys are never written to disk, shown only masked, and leave history and the clipboard after 60 seconds. |
| **Shelf** | Drop files on the island to hold them, drag them out to any app, or send them with AirDrop on macOS. |
| **Focus** | 5, 15, 25, or 50 minute sessions with the countdown on the small island. |
| **System** | Memory (with real memory pressure on macOS), CPU, network, swap, and the apps using the most memory. |
| **Cleaner** | Moves safe-to-delete caches, old logs, and old installers to the Trash or Recycle Bin. Never touches documents, photos, or settings. |
| **Dev** | Local servers by port, with their folder: open or stop them. Alerts when a terminal command of 10 seconds or more finishes. |
| **Calls** | Which app is using your mic, the call time on the small island, a system mute button on macOS, and a camera mirror. |

**Modes** keep it as small as you want. Compact, Everyday, Dev, Meetings, and Focus are presets; switch any feature on or off. A switched-off feature stops its background work, not just its tab.

The interface is in **English** and **Bahasa Indonesia**, with more languages coming. See [docs/TRANSLATING.md](docs/TRANSLATING.md) to help.

## System requirements

| | Minimum | Recommended |
|---|---|---|
| **macOS** | macOS 11 Big Sur, Intel or Apple silicon | macOS 15 Sequoia or newer |
| **Windows** | Windows 10 version 1809, 64-bit (x64) | Windows 11 |
| **Linux** | 64-bit (x86_64) with WebKitGTK 4.1: Ubuntu 22.04, Debian 12, Fedora 37, Linux Mint 21, or newer | An X11 session |
| **Memory** | 4 GB RAM | 8 GB RAM |
| **Disk** | 30 MB free | |

### Tested so far

Being clear about what has and hasn't been tried on real machines:

| System | Status |
|---|---|
| macOS 27 on Apple silicon | Used daily during development |
| macOS 11 to 26, Intel Macs | Builds for them; not yet run on them |
| Windows 10 and 11 | Builds in CI; not yet run on a real machine |
| Linux | Builds in CI; not yet run on a real machine |

If you run it on something not marked as tested, an issue saying how it went helps a lot.

## Install

Get the file for your system from the [latest release](../../releases/latest). No terminal needed.

### macOS

1. Download the file ending in `.dmg`. It runs on Intel and Apple silicon Macs.
2. Open it and drag **Gentra Island** into **Applications**.
3. Open Gentra Island from Applications.
4. If the Mac says it can't check the app for malware: open **System Settings**, go to **Privacy & Security**, scroll down, and click **Open Anyway**. This happens once, because the app isn't notarized by Apple yet.

### Windows

1. Download the file ending in `-setup.exe`.
2. Double-click it and click **Install**. No admin password needed.
3. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. This happens once, because the app isn't code-signed yet.

### Linux

- **Any distro**: download the `.AppImage`, right-click it, open **Properties**, switch on **Allow executing as program**, then double-click it.
- **Ubuntu, Debian, Mint**: download the `.deb` and double-click it to open it in your software center.
- **Fedora, openSUSE**: download the `.rpm` and double-click it.

To check your download, compare it with `SHA256SUMS.txt` on the release page. More detail, including uninstalling, is in [INSTALL.md](INSTALL.md).

## How to use

**The basics**

1. After you open it, the island sits at the top center of your screen, small. A short guide shows up the first time.
2. **Hover** over it, **click** it, or press **⌥⌘G** (**Ctrl+Alt+G**) to open it. Move away, press **Esc**, or press the shortcut again to close it.
3. The tabs along the top switch sections. **⌘1** to **⌘9** (**Ctrl+1** to **Ctrl+9**) jump straight to one.
4. The **mode** button at the top right picks which features are on. Choose **Compact** if you only want memory and the clipboard, or switch features one by one.
5. The **gear** opens Settings: theme, accent color, language, open at login, and About.

**Everyday things**

- **Paste something you copied earlier**: press **⌥⌘V** (**Ctrl+Alt+V**), type to search, use the arrow keys, and press **Enter** to copy it back. **P** pins an item so it stays.
- **Understand what you copied**: hover a clipboard card. A JWT shows who it's for and when it expires, a timestamp shows the date, a tracking link offers a clean copy.
- **Control music or a video**: open **Media**, or use the buttons on **Home**. Drag the bar to jump; **Space** plays and pauses.
- **Hold files for later**: drag files onto the island. They wait on the **Shelf** until you drag them out to another app, or send them with **AirDrop** on a Mac.
- **Focus for a while**: on **Home**, click **Start 25 min**, or pick a length in **Focus**. The countdown stays on the small island.
- **Free up space**: open **Cleaner**, review what it found, and click the button to move it to the Trash. Nothing outside the safe list is touched.

**For developers**

- **See and stop local servers**: open **Dev**. Each server shows its port, folder, and how long it has run; **Open** opens it in your browser, **Stop** asks once more, then stops it.
- **Get told when a long command finishes**: in **Dev**, pick your shell, click **Copy line**, paste it at the end of your shell config, and open a new terminal. Commands of 10 seconds or more show up on the island when they finish.

**In calls**

- When an app starts using your mic, the small island shows the call time. Open **Calls** to see which app it is, and on a Mac, mute the mic for every app at once.
- **Check camera** in **Calls** shows a mirror before you join. If the camera is blocked, the island walks you through allowing it.

## Permissions

Gentra Island asks for as little as possible. When something needs your OK, the island shows numbered steps for your system and a button that opens the right settings page.

| Permission | Used for | When it's asked |
|---|---|---|
| Camera | The camera mirror in the Calls tab | Only when you click **Check camera** |
| Automation (macOS) | Asking your browser which tab is playing, to show a YouTube thumbnail | Only if you switch on **Show thumbnails** in the Media tab |

Nothing else needs a permission prompt. Seeing which app uses the mic doesn't record audio, and the clipboard, shelf, and system monitor use access every app already has.

## Privacy

- **Everything stays on your computer.** No accounts, no analytics, no telemetry, no update pings.
- **No network calls of its own by default.** It reaches the network when you click a link it shows, such as opening a local server in your browser, and, only if you switch on **Show thumbnails** in the Media tab, to load a YouTube video's thumbnail from `i.ytimg.com`.
- **Clipboard history** is stored in your user's app data folder. Secrets are never written there. Clear it any time from the Clipboard tab.
- **The mic is never opened.** The meeting guard only asks the system whether an app is using it.
- **The camera** is on only while the mirror is visible, and nothing is recorded.

## How light it is

Measured on a Mac with the release build:

- **CPU:** about 1% of one core while you work with the island closed, less when the mouse rests. While music plays, the level meter steps at 4 frames a second instead of animating continuously.
- **Memory:** about 160 MB in total after start-up, as Activity Monitor counts it: 30 MB for the app, 37 MB for the web view, 63 MB for the system's graphics process, and 23 MB for the now-playing helper (only while that feature is on). The web view briefly uses more while starting.
- **Download:** about 7 MB on macOS.
- **Battery:** the window never resizes, nothing animates while the island is still, and background checks slow down when nothing is changing. Features you switch off stop their work.

## Known limitations

- **Artwork from browsers on macOS.** Since macOS 15.4, apps other than Apple's may not read what's playing; Gentra Island reads it through a small built-in `osascript` helper. Titles, artists, and controls work, including YouTube in Chrome, but browsers don't share their artwork. For YouTube, you can switch on **Show thumbnails** in the Media tab: Gentra Island then asks your browser (Chrome, Safari, Brave, Edge, Arc, Vivaldi, Opera) which tab is playing and loads the video's thumbnail. Other sites stay without artwork.
- **Now playing on older macOS.** The reader relies on parts of macOS that may not exist before macOS 15. On macOS 11 to 14 the Media tab may stay empty.
- **Muting the mic** from the island works on macOS only for now.
- **Linux on Wayland** decides window positions itself, so the island may not sit exactly at the top. X11 works fully.
- **Camera mirror on Linux** depends on the system's web view and may not be available.

## Build from source

Requirements: [Rust](https://rustup.rs), Node 20 or newer, pnpm, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```bash
pnpm install
pnpm tauri dev
```

Build an installer for your own machine:

```bash
pnpm tauri build
```

Run the tests:

```bash
pnpm test:all
```

Work on the interface without Rust: run `pnpm dev` and open `http://localhost:1420/preview.html`. It runs the real UI with the backend mocked, plus buttons that simulate copies, calls, music, and more.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Support

Gentra Island is free. If it saves you time and you'd like to buy me a coffee: [paypal.me/adamfaturahman](https://paypal.me/adamfaturahman). There's also a link in Settings, under About.

## Credits

Created by **Adam Faturahman**.

Built with [Tauri](https://tauri.app). Icons by [Phosphor](https://phosphoricons.com) (MIT). Interface font [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (SIL Open Font License). Logo lettering in Marow Block by Ramandhani, converted to outlines; the font itself is not included.

## License

Gentra Island is free software under the **GNU General Public License v3.0 or later**. You may use, study, change, and share it; if you distribute a changed version, it must stay under the same license with its source available. See [LICENSE](LICENSE).

The name "Gentra Island" and its logo are not covered by the license. See [TRADEMARKS.md](TRADEMARKS.md).

Copyright © 2026 Adam Faturahman.
