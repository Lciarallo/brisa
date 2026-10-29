# Contributing to Brisa

Thanks for helping! Pull requests are welcome, from typo fixes to new providers.
*Contribuições em português também são bem-vindas.*

## Ways to help

- **Report your air conditioner.** Open a *New device* issue with the list from **Settings → Detected functions**. That shows which LG or Home Assistant models still lack labels or controls.
- **Translate.** Copy `po/brisa@lciarallo.github.io.pot` to `po/<lang>.po`, translate it, and open a PR.
- **Fix bugs and add features.** For anything larger than a small fix, open an issue first so we can agree on the approach.
- **Add a provider.** See [Adding a provider](#adding-a-provider).

## Development setup

You need GNOME 47–50 (Shell 47 or later), `make`, `glib-compile-schemas` and `gettext`.

```bash
git clone https://github.com/<you>/brisa.git
cd brisa
make install        # links the folder into ~/.local/share/gnome-shell/extensions
```

On Wayland, log out and back in to load code changes. You can also run a nested shell, which needs the `mutter-devkit` package:

```bash
dbus-run-session gnome-shell --devkit --wayland
```

Logs: `journalctl --user -f -o cat /usr/bin/gnome-shell` (Shell) and `journalctl --user -f -o cat /usr/bin/gjs` (preferences).

## Rules the code must keep

These come from the [extensions.gnome.org review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and from [SECURITY.md](SECURITY.md). Pull requests that break them cannot be merged.

- **Lifecycle:** create everything in `enable()` and destroy it in `disable()`: actors, signals, main-loop sources and timelines. Never create GObjects at module scope or in a constructor.
- **Process boundaries:** the Shell process never imports `Gtk`, `Gdk` or `Adw`. `prefs.js` never imports `St`, `Clutter`, `Meta` or `Shell`.
- **Dependencies:** no deprecated modules (`Lang`, `Mainloop`, `ByteArray`), no binaries, no minified code, no new runtime dependencies.
- **Logging and privacy:** no telemetry. Log only real errors and never log tokens or device ids.
- **Secrets:** they live only in the keyring (`lib/secret.js`). Never put a token in GSettings, files or URLs.
- **Network:** all HTTP goes through `lib/http.js`, which refuses redirects and caps response size. Validate every value that reaches a URL.
- **Remote text:** show it as plain text. Set `use_markup: false` on Adw rows and toasts that display it.
- **Translations:** user-visible strings use `_()`, or `N_()` in shared modules.

## Adding a provider

1. Create `brisa@lciarallo.github.io/providers/<name>.js` exporting a class with:
   - `listDevices()` returning `[{id, name, model}]`;
   - `open(id)` returning capabilities: `{modes, temperature: {min, max, step, modes|null} | null, unit, fans, swings, presets, extras}`;
   - `getState()` returning the normalized state: `{power, mode, target, current, humidity, fan, swing, preset, oscillating, action, setpoint, extras}`;
   - `setPower`, `setMode`, `setTarget`, `setFan`, `setSwing`, `setPreset` and `setExtra(id, value, state)`. Implement only what the device supports.
   - `destroy()`.
2. Detect capabilities from the device or service itself. Never hard-code what a model "probably" supports.
3. Register the provider in `providers/index.js` and add its settings to `prefs.js` and the schema.
4. Document the API in the README and the threat model in `SECURITY.md`.

## Before opening a pull request

```bash
make            # schemas and translations compile
make pot        # if you changed user-visible strings
make pack       # the store zip builds
```

Then test on a real GNOME session if you can. On every PR, CI checks JavaScript syntax, the import rules above, the schema, translations, metadata, and that no secret was committed.

Keep each PR focused on one change, and describe how you tested it. A screenshot helps for UI changes.

## Code of conduct

This project follows the [GNOME Code of Conduct](https://conduct.gnome.org/). Be kind and assume good intent.

## License

By contributing, you agree that your contributions are licensed under the **GPL-3.0-or-later**, like the rest of the project.
