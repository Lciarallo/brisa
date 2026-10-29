# Security

## Reporting a vulnerability

Please open a private report through **GitHub → Security → Report a vulnerability** on this repository instead of a public issue. You should get an answer within 7 days.

## Threat model

Brisa runs inside the GNOME Shell process. That process has access to the whole desktop session, so the main goals are:

1. **Do not leak the access token.** It can control the user's air conditioners and read their LG or Home Assistant account.
2. **Do not let a remote server harm the desktop**: no injection into the UI and no unbounded memory or CPU use.
3. **Do not track the user.**

Out of scope: malware already running as the same user. It can read the unlocked keyring and dconf no matter what an extension does.

## Controls

| Risk | Control | Where |
|---|---|---|
| Token stored in clear text | The token lives only in the GNOME Keyring (libsecret, schema `io.github.lciarallo.Brisa`). GSettings holds no secret. The settings field is cleared right after saving, and the stored value is never shown again. | `lib/secret.js`, `prefs.js` |
| Token sent to a third party | Redirects are never followed (`Soup.MessageFlags.NO_REDIRECT`), so a 3xx answer cannot replay the `Authorization` header to another host. LG hosts are fixed (`api-{kic,aic,eic}.lgthinq.com`), and the region is chosen from an allow-list. | `lib/http.js`, `providers/thinq.js` |
| Eavesdropping | HTTPS with libsoup's default certificate checks; invalid certificates are rejected. For Home Assistant, plain `http://` is accepted only for loopback, private (RFC 1918 / ULA / link-local) and `.local`/`.lan`/`.home.arpa`/`.internal` hosts, and the settings show a warning. | `providers/homeassistant.js` |
| Malformed URLs and path injection | Server addresses are parsed with `GLib.Uri`; user-info, query and fragment are rejected. Device ids must match `^[A-Za-z0-9_-]{1,128}$` (LG) or `^climate\.[a-z0-9_]{1,255}$` (HA) and are URL-encoded. The country must be `^[A-Z]{2}$`. | providers |
| Memory exhaustion | Response bodies are read in 64 KiB chunks and aborted past 8 MiB. Requests time out after 20 s. Lists from the device profile are capped at 100 values and 64 extra controls. | `lib/http.js`, providers |
| UI injection | Remote strings go to `St.Label`/`PopupMenuItem` text, which is not markup. Settings rows and toasts that show remote text set `use_markup: false`. | `ui/`, `prefs.js` |
| API abuse and rate limits | Refresh interval of at least 15 s. A refresh when the menu opens is throttled to once every 10 s. Temperature clicks are combined into one request. | `extension.js` |
| Stale callbacks after disable | Each (re)start gets a generation number, and late replies are dropped. All main-loop sources, signals, actors and the animation timeline are removed in `disable()`. | `extension.js`, `ui/` |
| Privacy | No telemetry, no analytics, no log files. The LG client id is a random UUID per installation. | — |
| Supply chain | No dependencies beyond GNOME platform libraries (GJS, libsoup 3, libsecret). No binaries, no minified code. | — |

## About the embedded LG API key

`providers/thinq.js` contains `x-api-key: v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3`. It is the public application key that LG ships in its own Apache-2.0 client `thinqconnect` (`const.py`). Every ThinQ Connect client uses it. It is not a user secret and does not grant access to any account; the user's Personal Access Token does.

## Verified behaviour

Tested on GNOME Shell 50 with GJS:

- a 9.5 MB response is refused, and a 302 redirect is refused;
- `https://self-signed.badssl.com` is rejected (invalid TLS certificate);
- `http://8.8.8.8`, `https://user:pw@host`, `?query`, `ftp://` and `javascript:` addresses are refused, while `http://192.168.x.x` and `http://[fd00::]` are accepted with a warning;
- a device id like `../../devices?x` is refused;
- keyring store, lookup and clear work;
- a fake LG token gets the structured error `1309`, shown as "The token lacks permission".
