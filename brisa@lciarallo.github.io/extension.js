// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {createProvider} from './providers/index.js';
import {lookupToken} from './lib/secret.js';
import {BrisaIndicator} from './ui/indicator.js';

const REFRESH_AFTER_CONTROL_S = 4;
const REDETECT_EVERY_S = 6 * 3600;
const KEYRING_RETRY_FIRST_S = 5;
const KEYRING_RETRY_MAX_S = 60;
// LG ThinQ codes meaning the model or feature is not what the profile said.
const UNSUPPORTED_CODES = ['1219', '1220', '2101', '2201', '2202', '2203'];

function merge(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v))
            target[k] = merge({...target[k] ?? {}}, v);
        else
            target[k] = v;
    }
    return target;
}

export default class BrisaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this.icon = Gio.FileIcon.new(this.dir.resolve_relative_path('icons/brisa-symbolic.svg'));
        if (!this._settings.get_string('thinq-client-id'))
            this._settings.set_string('thinq-client-id', `thinq-open-${GLib.uuid_string_random()}`);

        this._state = null;
        this._caps = null;
        this._lastRefresh = 0;
        this._generation = 0;

        this._indicator = new BrisaIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (['show-panel-temperature', 'animate'].includes(key))
                this._indicator.update(this._state);
            else if (key !== 'device-name')
                this._restart();
        });
        this._restart();
    }

    disable() {
        this._generation++;
        this._stop();
        this._settings.disconnect(this._settingsId);
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
        this._state = null;
        this._caps = null;
        this.icon = null;
    }

    get animate() {
        return this._settings.get_boolean('animate');
    }

    get showPanelTemperature() {
        return this._settings.get_boolean('show-panel-temperature');
    }

    // True when the current mode takes a target temperature on this unit.
    usesSetpoint(s) {
        const t = this._caps?.temperature;
        return !!t && s?.setpoint !== false && (!t.modes || t.modes.includes(s?.mode));
    }

    get connected() {
        return !!this._state;
    }

    get deviceName() {
        return this._settings.get_string('device-name');
    }

    _stop() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._delayId) {
            GLib.source_remove(this._delayId);
            this._delayId = 0;
        }
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        this._provider?.destroy();
        this._provider = null;
    }

    _retryLater() {
        if (this._retryId)
            return;
        const delay = this._retryDelay ?? KEYRING_RETRY_FIRST_S;
        this._retryDelay = Math.min(delay * 2, KEYRING_RETRY_MAX_S);
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._retryId = 0;
            this._restart();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Opening the menu or clicking the toggle retries at once.
    retryNow() {
        if (this._provider)
            this.refresh({redetect: !this._caps});
        else
            this._restart();
    }

    // Each restart gets a generation number so late replies from an old
    // provider (or after disable) are dropped.
    async _restart() {
        this._stop();
        const gen = ++this._generation;
        this._cancellable = new Gio.Cancellable();
        this._caps = null;
        this._state = null;

        const providerId = this._settings.get_string('provider');
        let token = null;
        try {
            token = await lookupToken(providerId, this._cancellable);
        } catch (e) {
            if (gen !== this._generation)
                return;
            this._indicator.toggle.showMessage(_('Could not read the keyring: %s').format(e.message));
            this._retryLater();
            return;
        }
        if (gen !== this._generation)
            return;
        if (!token) {
            // At login the keyring may still be locked when the extension
            // starts, which looks exactly like a missing token: keep retrying.
            this._indicator.toggle.showMessage(_('Add your access token in the settings'), {setup: true});
            this._retryLater();
            return;
        }
        this._retryDelay = KEYRING_RETRY_FIRST_S;
        try {
            this._provider = createProvider(this._settings, token);
        } catch (e) {
            this._indicator.toggle.showMessage(_(e.message), {setup: true});
            return;
        }
        this.refresh();
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_uint('poll-interval'), () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    async _ensureDevice(gen) {
        if (this._caps)
            return;
        let id = this._settings.get_string('device-id');
        if (!id) {
            const devices = await this._provider.listDevices(this._cancellable);
            if (!devices.length)
                throw new Error(_('No air conditioner found in this account'));
            id = devices[0].id;
        }
        const caps = await this._provider.open(id, this._cancellable);
        if (gen !== this._generation)
            return;
        this._useCaps(caps);
        this._detectedAt = GLib.get_monotonic_time();
    }

    _useCaps(caps) {
        this._caps = caps;
        this._capsVersion = this._provider.capsVersion;
        this._indicator.toggle.build(caps);
    }

    refreshIfStale(seconds) {
        if (GLib.get_monotonic_time() - this._lastRefresh > seconds * 1e6)
            this.refresh();
    }

    // Capabilities are re-detected on a manual refresh, every few hours, and
    // after the device rejects a command as unsupported (e.g. new firmware).
    async refresh({redetect = false} = {}) {
        const gen = this._generation;
        if (!this._provider)
            return;
        if (redetect || this._redetect ||
            GLib.get_monotonic_time() - (this._detectedAt ?? 0) > REDETECT_EVERY_S * 1e6) {
            this._redetect = false;
            this._caps = null;
        }
        try {
            await this._ensureDevice(gen);
            if (gen !== this._generation)
                return;
            const state = await this._provider.getState(this._cancellable);
            if (gen !== this._generation || !this._caps)
                return;
            // Providers that read capabilities from every state reply (Home
            // Assistant) bump capsVersion when the entity changes.
            if (this._provider.capsVersion !== this._capsVersion)
                this._useCaps(this._provider.caps);
            this._lastRefresh = GLib.get_monotonic_time();
            this._state = state;
            this._indicator.update(state);
        } catch (e) {
            if (gen !== this._generation || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this._indicator.toggle.showMessage(_(e.message));
        }
    }

    _refreshSoon() {
        if (this._delayId)
            GLib.source_remove(this._delayId);
        this._delayId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_AFTER_CONTROL_S, () => {
            this._delayId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Applies the change locally right away, sends it, and rolls back on error.
    async send(method, args, patch) {
        const gen = this._generation;
        if (!this._provider || !this._state)
            return;
        const previous = this._state;
        this._state = merge({...previous}, patch);
        this._indicator.update(this._state);
        this._indicator.toggle.setBusy(true);
        try {
            await this._provider[method](...(Array.isArray(args) ? args : [args]), previous);
            if (gen === this._generation)
                this._refreshSoon();
        } catch (e) {
            if (gen !== this._generation || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this._state = previous;
            this._indicator.update(previous);
            this._indicator.toggle.showMessage(_(e.message));
            if (UNSUPPORTED_CODES.includes(String(e.code)))
                this._redetect = true;
        }
    }

    togglePower() {
        // Not connected yet: try again instead of jumping to the settings
        // (the menu offers "Set up connection…" when a token is really missing).
        if (!this._state) {
            this._indicator.toggle.subtitle = _('Connecting…');
            this.retryNow();
            return;
        }
        const on = !this._state.power;
        this.send('setPower', on, {power: on});
    }

    // Picking a mode while the unit is off turns it on in that mode. Whether
    // the new mode takes a setpoint is unknown until the next state reply,
    // so the per-mode capability list decides meanwhile.
    async setMode(mode) {
        if (this._state && !this._state.power && this._provider.modeTurnsOn) {
            this.send('setMode', mode, {power: true, mode, setpoint: undefined});
            return;
        }
        if (this._state && !this._state.power) {
            await this.send('setPower', true, {power: true, mode, setpoint: undefined});
            // A restart during the await resets the state and capabilities.
            if (this._state?.mode === mode && this._caps?.modes.length > 1)
                await this.send('setMode', mode, {mode, setpoint: undefined});
            return;
        }
        this.send('setMode', mode, {mode, setpoint: undefined});
    }

    setTarget(value) {
        this.send('setTarget', value, {target: value});
    }
}
