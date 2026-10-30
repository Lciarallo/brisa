// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {createProvider} from './providers/index.js';
import {lookupToken} from './lib/secret.js';
import {StepperItem, ChoiceSubMenu, SwitchItem, InfoItem, ModeChips} from './ui/widgets.js';
import {AcAnimation} from './ui/animation.js';
import {makeValueLabel, formatNumber} from './lib/labels.js';

const N_ = s => s;
const REFRESH_AFTER_CONTROL_S = 4;
const REFRESH_ON_OPEN_S = 10;
const REDETECT_EVERY_S = 6 * 3600;
const KEYRING_RETRY_FIRST_S = 5;
const KEYRING_RETRY_MAX_S = 60;
// LG ThinQ codes meaning the model or feature is not what the profile said.
const UNSUPPORTED_CODES = ['1219', '1220', '2101', '2201', '2202', '2203'];

const MODE_ICONS = {
    cool: 'weather-snow-symbolic',
    heat: 'weather-clear-symbolic',
    dry: 'weather-showers-symbolic',
    fan: 'weather-windy-symbolic',
    auto: 'emblem-synchronizing-symbolic',
    heat_cool: 'emblem-synchronizing-symbolic',
};

const valueLabel = makeValueLabel(_);

const formatHours = h => (h <= 0 ? _('Off') : _('%d h').format(h));
const formatClock = v => (v < 0 ? _('Off')
    : `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`);

const BrisaToggle = GObject.registerClass(
class BrisaToggle extends QuickMenuToggle {
    _init(ext) {
        super._init({
            title: ext.deviceName || _('A/C'),
            subtitle: _('Loading…'),
            gicon: ext.icon,
            toggleMode: false,
        });
        this._ext = ext;
        this._updaters = [];
        this._sensitives = [];
        this.menu.setHeader(ext.icon, _('Air conditioner'));

        this._animation = new AcAnimation();
        this.menu.addMenuItem(this._animation);

        this._message = new PopupMenu.PopupMenuItem('', {reactive: false, style_class: 'brisa-message'});
        this._message.visible = false;
        this.menu.addMenuItem(this._message);
        this._setupItem = new PopupMenu.PopupMenuItem(_('Set up connection…'));
        this._setupItem.connect('activate', () => ext.openPreferences());
        this._setupItem.visible = false;
        this.menu.addMenuItem(this._setupItem);

        this._dynamic = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._dynamic);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Refresh'), () => ext.refresh({redetect: true}));
        this.menu.addAction(_('Settings'), () => ext.openPreferences());

        this.connect('clicked', () => ext.togglePower());
        this._openId = this.menu.connect('open-state-changed', (_m, open) => {
            this._animation.setActive(open && ext.animate);
            if (open && !ext.connected)
                ext.retryNow();
            else if (open)
                ext.refreshIfStale(REFRESH_ON_OPEN_S);
        });
    }

    showMessage(text, {setup = false} = {}) {
        this._message.label.text = text ?? '';
        this._message.visible = !!text;
        this._setupItem.visible = setup;
        if (text)
            this.subtitle = setup ? _('Not configured') : _('Error');
        if (setup)
            this.checked = false;
    }

    // Builds every control the device reports.
    build(caps) {
        this._dynamic.removeAll();
        this._updaters = [];
        this._sensitives = [];
        this._caps = caps;
        const ext = this._ext;
        const unit = caps.unit ?? '°C';
        const add = (item, update, {section = this._dynamic, needsPower = true} = {}) => {
            section.addMenuItem(item.item ?? item);
            this._updaters.push(update);
            if (needsPower)
                this._sensitives.push(item);
        };
        const menuFor = new Map();
        const group = title => {
            if (!menuFor.has(title))
                menuFor.set(title, new PopupMenu.PopupSubMenuMenuItem(_(title)));
            return menuFor.get(title).menu;
        };

        if (caps.modes.length) {
            const chips = new ModeChips(caps.modes, {
                label: valueLabel,
                icon: m => MODE_ICONS[m] ?? 'weather-few-clouds-symbolic',
                onSelect: m => ext.setMode(m),
            });
            add(chips, s => chips.setValue(s.mode, s.power), {needsPower: false});
        }

        if (caps.temperature) {
            const {min, max, step} = caps.temperature;
            const values = [];
            for (let v = min; v <= max + 1e-9 && values.length < 500; v += step)
                values.push(Math.round(v * 10) / 10);
            const stepper = new StepperItem(null, {
                values,
                big: true,
                format: v => `${formatNumber(v)} ${unit}`,
                onCommit: v => ext.setTarget(v),
                decrease: _('Lower temperature'),
                increase: _('Raise temperature'),
            });
            // Some units accept a setpoint only in certain modes (e.g. cool).
            add(stepper, s => {
                stepper.setValue(s.target);
                stepper.setSensitive(s.power && ext.usesSetpoint(s));
            }, {needsPower: false});
        }

        for (const [key, title, setter] of [
            ['fans', N_('Fan speed'), v => ext.send('setFan', v, {fan: v})],
            ['swings', N_('Swing'), v => ext.send('setSwing', v, {swing: v})],
            ['presets', N_('Preset'), v => ext.send('setPreset', v, {preset: v})],
        ]) {
            if (!caps[key]?.length)
                continue;
            const field = {fans: 'fan', swings: 'swing', presets: 'preset'}[key];
            const menu = new ChoiceSubMenu(_(title), caps[key], valueLabel, setter);
            add(menu, s => menu.setValue(s[field]));
        }

        const info = [];
        for (const extra of caps.extras) {
            const label = _(extra.label);
            const set = v => ext.send('setExtra', [extra.id, v], {extras: {[extra.id]: v}});
            const get = s => s.extras?.[extra.id];
            // Timers can be scheduled while the unit is off.
            const needsPower = extra.group !== N_('Timers');
            switch (extra.kind) {
            case 'switch': {
                const sw = new SwitchItem(label, set);
                add(sw, s => sw.setValue(get(s)), {section: group(extra.group), needsPower});
                break;
            }
            case 'hours':
            case 'clock':
            case 'range':
            case 'choice': {
                const format = extra.kind === 'hours' ? formatHours
                    : extra.kind === 'clock' ? formatClock
                        : v => `${valueLabel(v)}${typeof v === 'number' ? extra.unit ?? '' : ''}`;
                const stepper = new StepperItem(label, {
                    values: extra.values,
                    format,
                    onCommit: set,
                    decrease: _('Previous'),
                    increase: _('Next'),
                });
                add(stepper, s => stepper.setValue(get(s)), {section: group(extra.group), needsPower});
                break;
            }
            default:
                info.push(extra);
            }
        }

        for (const item of menuFor.values())
            this._dynamic.addMenuItem(item);

        const sensors = new PopupMenu.PopupSubMenuMenuItem(_('Sensors'));
        const readings = [
            {label: N_('Room temperature'), get: s => s.current, unit: ` ${unit}`},
            {label: N_('Humidity'), get: s => s.humidity, unit: '%'},
            ...info.map(e => ({label: e.label, get: s => s.extras?.[e.id], unit: e.unit ?? ''})),
        ];
        for (const r of readings) {
            const item = new InfoItem(_(r.label));
            sensors.menu.addMenuItem(item);
            this._updaters.push(s => {
                const v = r.get(s);
                item.visible = v !== null && v !== undefined;
                if (item.visible)
                    item.setValue(`${valueLabel(v)}${typeof v === 'number' ? r.unit : ''}`);
            });
        }
        this._dynamic.addMenuItem(sensors);
    }

    _caption(s, unit) {
        if (!s.power)
            return _('Off');
        const target = formatNumber(s.target);
        switch (s.action ?? `mode:${s.mode}`) {
        case 'idle':
            return _('Idle — room is at %s %s').format(target, unit);
        case 'cooling':
        case 'mode:cool':
            return _('Cooling to %s %s').format(target, unit);
        case 'heating':
        case 'mode:heat':
            return _('Heating to %s %s').format(target, unit);
        case 'drying':
        case 'mode:dry':
            return _('Removing humidity');
        case 'fan':
        case 'mode:fan':
            return _('Circulating air');
        default:
            return _('Keeping %s %s').format(target, unit);
        }
    }

    update(s) {
        if (!s || !this._caps)
            return;
        const unit = this._caps.unit ?? '°C';
        this.showMessage(null);
        this.checked = s.power;
        this.gicon = s.power && MODE_ICONS[s.mode]
            ? Gio.ThemedIcon.new(MODE_ICONS[s.mode]) : this._ext.icon;
        const setpoint = this._ext.usesSetpoint(s);
        const modeText = s.mode ? valueLabel(s.mode) : '';
        if (!s.power)
            this.subtitle = _('Off');
        else
            this.subtitle = setpoint ? `${modeText} · ${formatNumber(s.target)} ${unit}` : modeText;
        const name = this._ext.deviceName;
        this.title = name || _('A/C');
        this.menu.setHeader(this.gicon, name || _('Air conditioner'),
            s.current !== null ? _('Room: %s %s').format(formatNumber(s.current), unit) : '');
        this._animation.setState(setpoint ? s : {...s, target: null}, unit, this._caption(s, unit));
        for (const u of this._updaters)
            u(s);
        for (const item of this._sensitives)
            item.setSensitive(s.power);
    }

    setBusy(busy) {
        if (busy)
            this.subtitle = _('Sending…');
    }

    destroy() {
        this.menu.disconnect(this._openId);
        // The menu would destroy these with itself; done explicitly for clarity.
        this._dynamic.destroy();
        this._message.destroy();
        this._setupItem.destroy();
        this._dynamic = null;
        this._message = null;
        this._setupItem = null;
        this._updaters = [];
        this._sensitives = [];
        super.destroy();
    }
});

const BrisaIndicator = GObject.registerClass(
class BrisaIndicator extends SystemIndicator {
    _init(ext) {
        super._init();
        this._ext = ext;
        this._icon = this._addIndicator();
        this._icon.gicon = ext.icon;
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'brisa-panel-label'});
        this.add_child(this._label);
        this.visible = false;

        this.toggle = new BrisaToggle(ext);
        this.quickSettingsItems.push(this.toggle);
    }

    update(s) {
        this.toggle.update(s);
        this.visible = !!s?.power;
        const showTemp = this._ext.showPanelTemperature && this._ext.usesSetpoint(s) &&
            s?.target !== null && s?.target !== undefined;
        this._label.visible = showTemp;
        this._label.text = showTemp ? `${formatNumber(s.target)}°` : '';
        this._icon.gicon = s?.power && MODE_ICONS[s.mode] ? Gio.ThemedIcon.new(MODE_ICONS[s.mode]) : this._ext.icon;
    }

    destroy() {
        this.quickSettingsItems.forEach(i => i.destroy());
        super.destroy();
    }
});

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
        return this._settings?.get_boolean('animate') ?? false;
    }

    get showPanelTemperature() {
        return this._settings?.get_boolean('show-panel-temperature') ?? false;
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
        return this._settings?.get_string('device-name') ?? '';
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
        this._capsVersion = this._provider.capsVersion ?? 0;
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
            const state = await this._provider.getState(this._cancellable);
            if (gen !== this._generation || !this._caps)
                return;
            // Providers that read capabilities from every state reply (Home
            // Assistant) bump capsVersion when the entity changes.
            if ((this._provider.capsVersion ?? 0) !== this._capsVersion)
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
        if (!this._provider || !this._state || !this._provider[method])
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
        if (this._state && !this._state.power && this._provider?.modeTurnsOn) {
            this.send('setMode', mode, {power: true, mode, setpoint: undefined});
            return;
        }
        if (this._state && !this._state.power) {
            await this.send('setPower', true, {power: true, mode, setpoint: undefined});
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
