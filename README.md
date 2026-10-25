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

---

Gentra Island sits at the top of your screen. On a Mac with a notch it grows out of the camera housing; elsewhere it floats as a small pill. Hover, click, or press **⌥⌘G** (**Ctrl+Alt+G** on Windows and Linux) to open it. It opens by itself only when something is worth seeing, like a long build that just finished or a call that started.

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

Download the file for your system from the [latest release](../../releases/latest):

| System | File |
|---|---|
| macOS (Intel and Apple silicon) | `.dmg` |
| Windows | `-setup.exe` |
| Linux, any distro | `.AppImage` |
| Ubuntu, Debian, Mint | `.deb` |
| Fedora, openSUSE | `.rpm` |

Step-by-step instructions, including the first-open security prompts on macOS and Windows, are in [INSTALL.md](INSTALL.md). Each release lists SHA-256 checksums so you can check your download.

## Permissions

Gentra Island asks for as little as possible. When something needs your OK, the island shows numbered steps for your system and a button that opens the right settings page.

| Permission | Used for | When it's asked |
|---|---|---|
| Camera | The camera mirror in the Calls tab | Only when you click **Check camera** |

Nothing else needs a permission prompt. Seeing which app uses the mic doesn't record audio, and the clipboard, shelf, and system monitor use access every app already has.

## Privacy

- **Everything stays on your computer.** No accounts, no analytics, no telemetry, no update pings.
- **No network calls of its own.** It only reaches the network when you click a link it shows, such as opening a local server in your browser.
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

- **Artwork from browsers on macOS.** Since macOS 15.4, apps other than Apple's may not read what's playing; Gentra Island reads it through a small built-in `osascript` helper. Titles, artists, and controls work, including YouTube in Chrome, but browser artwork doesn't come through yet.
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
