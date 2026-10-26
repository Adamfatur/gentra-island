# Changelog

## Unreleased

- **Pixel eyes.** The eyes are now small rounded squares that glow in your accent color, like a tiny friendly robot. Change the accent in Settings and they follow.
- **Fixed:** the selected mode's outline was cut off at the top of the Modes panel. Card descriptions now line up across the row.

## 0.9.2

- **The eyes sit beside the camera.** On a Mac with a notch, one eye now sits either side of the camera, in the menu bar, so they stay visible at rest without covering the windows below. Pointing at the notch shows memory and CPU as before. Always is now the default; Moments shows them only when something happens.

## 0.9.1

- **Eyes in the notch.** Point at the notch and two eyes peek out, follow your pointer, blink, smile when a task is done, look up when something needs you, and nap while you're away. On a Mac with a notch they sit just below the camera, since the notch itself has no pixels. Settings has Off, Moments (the default, so nothing is covered), and Always.
- **Smart screenshots work with ⌃⇧⌘4 too.** A screenshot copied straight to the clipboard, or any copied image, gets Copy text. Before, only screenshots saved as files did.

## 0.9.0

- **Approve from the notch.** When Claude Code asks for permission, the notch shows the command in full with Allow, Deny, and In terminal. Only your click decides; unanswered after 30 seconds, Claude Code asks in its own window. Connected before? Click Connect again in the AI tab once.
- **Smart screenshots.** A new screenshot shows on the island with Copy text, Copy image, and Shelf. The text is read on your computer, with no upload.
- **Download progress.** Files your browser is downloading show in the notch, with Open, Show in Finder, and Shelf when they finish.
- Both new features are on in the Everyday and Dev modes.
- **Fixed: buttons in the small island's messages could do nothing,** or something else. The last tab you had open stayed clickable underneath, even while the island was closed.
- Messages after a click ("Text copied", errors) now show on the small island too, instead of only when it's open.

## 0.8.1

- **Fixed: a browser video stuck on the island.** After you close the tab that was playing, a paused video on another open page (a Threads or Instagram post, say) no longer shows as now playing. Browser videos show once they have actually played, and a player that doesn't respond to Play within 3 seconds is hidden until it plays again.
- **Fixed: a large, empty island.** If macOS paused the island's animation (it does that to windows it thinks are hidden), the island could freeze at the open size while showing a small message. It now jumps to the right size instead.

## 0.8.0

- **AI agents.** See what Claude Code and Codex are doing from the island: a clock while they work, a peek when they need you (even in Focus mode), and a note when a task of 15 seconds or more is done. Connecting is one click in the new AI tab. It explains the change first, keeps a backup of the agent's settings file, and Disconnect undoes it.
- **AI usage** from the agents' local logs: tokens in the current 5-hour window, today, and the last 7 days. Codex's own 5-hour and weekly limits show as bars, with a heads-up at 80% and 95%.
- **Gentle care.** Warm, automatic reminders for your body: a break after about 50 minutes of real activity, water every 90 minutes, lunch and dinner once each, and a nudge to rest after 11 pm. Time away from the keyboard counts as a break. They wait while you're on a call or focusing, keep at least 20 minutes apart, stop at 8 a day, and each has Later and Not today. On in every mode except Focus.
- **The small island hides in the notch** when nothing is live, so app menus beside the notch stay visible. While something plays or runs it shows icons only, and everything when you point at it. Settings has Hide in notch, Compact, and Wide.
- The Dev mode now includes AI agents.
- Every feature switch in Modes fits on screen, in three columns.
- Messages in peeks wrap onto a second line instead of being cut off.

## 0.7.0

- **Reminders from what you copy.** Copy text with a time in it ("rapat Jumat jam 14.00", "meeting moved to 3 pm") and the island offers to remind you in one click. Any clipboard item gets a bell: in an hour, tonight, tomorrow morning, or any time. When it's due: Copy again, In 10 min, or Done. Upcoming reminders show on Home. Times are read in English and Indonesian, on your computer, with no network.
- Wider peeks for messages with buttons.
- Copied screenshots show whole in the clipboard, instead of cropped.
- A [Privacy Policy](PRIVACY.md) and [Terms of Use](TERMS.md), in English and Bahasa Indonesia, linked from Settings, About.

## 0.6.0, first public release

The first version published on GitHub.

- **Home**: a simple first screen with what's playing, memory, focus, the last thing you copied, your shelf, and a live call.
- **Now playing**: see and control music and video from any app, with artwork-tinted controls and a draggable timeline. On macOS, YouTube thumbnails for browser playback, when you switch them on.
- **Clipboard history** with search, pins, image support, decoders, clean paste, and a secret guard that never writes keys to disk.
- **Shelf** for holding files, with drag out and AirDrop on macOS.
- **Focus timer** with the countdown on the small island.
- **System monitor** with real memory pressure on macOS.
- **Safe cleaner** that only moves allow-listed caches, logs, and installers to the Trash or Recycle Bin.
- **Dev tools**: a port watcher and terminal command alerts for zsh, bash, fish, and PowerShell.
- **Calls**: which app uses the mic, call time, system mute on macOS, and a camera mirror with step-by-step permission help.
- **Modes**: Compact, Everyday, Dev, Meetings, and Focus, or your own mix. Switched-off features stop their background work.
- **English and Bahasa Indonesia.**
- Themes that follow the system, plus a custom accent color.
- An app icon and a menu bar icon drawn from the Gentra Island lettering.
- Installers for macOS (universal), Windows, and Linux (AppImage, deb, rpm), with SHA-256 checksums.
