// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const COMMIT_DELAY_MS = 700;

// Rows that are only containers for their own buttons. GNOME treats a
// non-activatable row as insensitive and greys it out, so these rows report
// themselves sensitive and simply never highlight or take focus.
function keepReadable(item) {
    item.remove_style_class_name('popup-inactive-menu-item');
    item.track_hover = false;
    item.can_focus = false;
}


function iconButton(iconName, accessibleName, cb) {
    const btn = new St.Button({
        style_class: 'icon-button brisa-step-button',
        can_focus: true,
        accessible_name: accessibleName,
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
    });
    btn.connect('clicked', cb);
    return btn;
}

// "Label   [−] value [+]": walks a list of values and only commits once the
// user stops clicking, so several clicks become a single request.
export {keepReadable};

export const StepperItem = GObject.registerClass(
class StepperItem extends PopupMenu.PopupBaseMenuItem {
    _init(label, {values, format = String, onCommit, big = false, decrease, increase}) {
        super._init({reactive: false, can_focus: false, style_class: big ? 'brisa-stepper-big' : 'brisa-stepper'});
        this.syncSensitive();
        this._values = values;
        this._format = format;
        this._onCommit = onCommit;
        this._index = -1;
        this._timeoutId = 0;

        if (label) {
            this.add_child(new St.Label({text: label, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        }
        const box = new St.BoxLayout({
            x_expand: !label,
            x_align: label ? Clutter.ActorAlign.END : Clutter.ActorAlign.CENTER,
            style_class: 'brisa-stepper-box',
        });
        this._minus = iconButton('list-remove-symbolic', decrease, () => this._step(-1));
        this._plus = iconButton('list-add-symbolic', increase, () => this._step(+1));
        this._valueLabel = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: big ? 'brisa-value-big' : 'brisa-value',
        });
        box.add_child(this._minus);
        box.add_child(this._valueLabel);
        box.add_child(this._plus);
        this.add_child(box);

        this.connect('destroy', () => {
            if (this._timeoutId)
                GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        });
    }

    getSensitive() {
        return true;
    }

    syncSensitive() {
        const sensitive = super.syncSensitive();
        keepReadable(this);
        return sensitive;
    }

    setValues(values) {
        this._values = values;
    }

    // The row itself is never reactive (only its buttons are), so the base
    // class would always report it insensitive; track the state ourselves.
    setSensitive(sensitive) {
        this._minus.reactive = this._plus.reactive = sensitive;
        this._minus.can_focus = this._plus.can_focus = sensitive;
        if (sensitive)
            this.remove_style_class_name('brisa-disabled');
        else
            this.add_style_class_name('brisa-disabled');
    }

    // Ignores server updates while an edit is pending.
    setValue(value) {
        if (this._timeoutId)
            return;
        let idx = this._values.indexOf(value);
        if (idx < 0 && typeof value === 'number' && this._values.length) {
            idx = this._values.reduce((best, v, i) =>
                Math.abs(v - value) < Math.abs(this._values[best] - value) ? i : best, 0);
        }
        this._index = idx;
        this._valueLabel.text = idx >= 0 ? this._format(this._values[idx]) : '--';
    }

    _step(dir) {
        if (!this._values.length)
            return;
        this._index = this._index < 0 ? 0 : Math.max(0, Math.min(this._values.length - 1, this._index + dir));
        this._valueLabel.text = this._format(this._values[this._index]);

        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COMMIT_DELAY_MS, () => {
            this._timeoutId = 0;
            this._onCommit(this._values[this._index]);
            return GLib.SOURCE_REMOVE;
        });
    }
});

// Submenu with mutually exclusive options; the current one gets a check mark.
export class ChoiceSubMenu {
    constructor(title, values, label, onSelect) {
        this._title = title;
        this._label = label;
        this.item = new PopupMenu.PopupSubMenuMenuItem(title);
        this._choices = new Map();
        for (const v of values) {
            const choice = new PopupMenu.PopupMenuItem(label(v));
            choice.connect('activate', () => onSelect(v));
            this.item.menu.addMenuItem(choice);
            this._choices.set(v, choice);
        }
    }

    setValue(value) {
        this.item.label.text = value !== undefined && value !== null
            ? `${this._title}: ${this._label(value)}`
            : this._title;
        for (const [v, choice] of this._choices)
            choice.setOrnament(v === value ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }

    setSensitive(sensitive) {
        if (!sensitive)
            this.item.setSubmenuShown(false);
        this.item.setSensitive(sensitive);
    }
}

export const SwitchItem = GObject.registerClass(
class SwitchItem extends PopupMenu.PopupSwitchMenuItem {
    _init(label, onToggle) {
        super._init(label, false);
        this._syncing = false;
        this.connect('toggled', (_item, state) => {
            if (!this._syncing)
                onToggle(state);
        });
    }

    // setToggleState also emits "toggled"; never echo device state back.
    setValue(on) {
        this._syncing = true;
        this.setToggleState(!!on);
        this._syncing = false;
    }
});

export const InfoItem = GObject.registerClass(
class InfoItem extends PopupMenu.PopupBaseMenuItem {
    _init(label) {
        super._init({reactive: false, can_focus: false});
        this.add_child(new St.Label({text: label, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        this._value = new St.Label({text: '--', y_align: Clutter.ActorAlign.CENTER, style_class: 'brisa-info-value'});
        this.add_child(this._value);
    }

    setValue(text) {
        this._value.text = text;
    }
});

// Row of round mode buttons (icon + caption).
export const ModeChips = GObject.registerClass(
class ModeChips extends PopupMenu.PopupBaseMenuItem {
    _init(modes, {label, icon, onSelect}) {
        super._init({reactive: false, can_focus: false, style_class: 'brisa-chips-item'});
        this.syncSensitive();
        const box = new St.BoxLayout({x_expand: true, style_class: 'brisa-chips'});
        this._buttons = new Map();
        for (const mode of modes) {
            const content = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
            content.add_child(new St.Icon({icon_name: icon(mode), icon_size: 18, x_align: Clutter.ActorAlign.CENTER}));
            content.add_child(new St.Label({text: label(mode), style_class: 'brisa-chip-label', x_align: Clutter.ActorAlign.CENTER}));
            const btn = new St.Button({
                style_class: 'brisa-chip',
                x_expand: true,
                can_focus: true,
                toggle_mode: false,
                accessible_name: label(mode),
                child: content,
            });
            btn.connect('clicked', () => onSelect(mode));
            box.add_child(btn);
            this._buttons.set(mode, btn);
        }
        this.add_child(box);
    }

    getSensitive() {
        return true;
    }

    syncSensitive() {
        const sensitive = super.syncSensitive();
        keepReadable(this);
        return sensitive;
    }

    setValue(mode, active) {
        for (const [m, btn] of this._buttons) {
            btn.checked = active && m === mode;
            if (m === mode)
                btn.add_style_pseudo_class('current');
            else
                btn.remove_style_pseudo_class('current');
        }
    }
});
