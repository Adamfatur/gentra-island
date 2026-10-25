# Security

## Reporting a problem

Please don't report security problems in public issues.

Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. Describe what you found, how to reproduce it, and which version and system you used.

You'll get a reply within 7 days. Once a fix is out, the report is published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes.

## What Gentra Island does that matters for security

- Clipboard history is stored locally in the user's app data folder. Detected secrets (API keys, private keys) are never written to disk and leave memory and the clipboard after 60 seconds.
- Command alerts listen on a random port on `127.0.0.1` only, and accept a request only with a random token stored in the user's app data folder.
- The cleaner moves files only from a fixed allow-list of cache, log, and installer locations, and only to the Trash or Recycle Bin.
- Stopping a local server checks that the process is still the one listening on that port before it is stopped.
- The app makes no network requests of its own, except loading YouTube thumbnails from `i.ytimg.com` when the user switches that on. Video IDs are checked to be 11 safe characters before they are used in a URL, and only HTTPS is allowed.
