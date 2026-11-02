// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Quick Settings toggle, its menu and the top bar indicator.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StepperItem, ChoiceSubMenu, SwitchItem, InfoItem, ModeChips} from './widgets.js';
import {AcAnimation} from './animation.js';
import {makeValueLabel, formatNumber, stepValues} from '../lib/labels.js';

const N_ = s => s;
const REFRESH_ON_OPEN_S = 10;

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

function modeIcon(s, fallback) {
    return s?.power && MODE_ICONS[s.mode] ? Gio.ThemedIcon.new(MODE_ICONS[s.mode]) : fallback;
}

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
            const stepper = new StepperItem(null, {
                values: stepValues(min, max, step),
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
            if (!caps[key].length)
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
        this.gicon = modeIcon(s, this._ext.icon);
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
        this._animation.setState(setpoint ? s : {...s, target: null}, this._caption(s, unit));
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

export const BrisaIndicator = GObject.registerClass(
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
        this._icon.gicon = modeIcon(s, this._ext.icon);
    }

    destroy() {
        this.quickSettingsItems.forEach(i => i.destroy());
        super.destroy();
    }
});
