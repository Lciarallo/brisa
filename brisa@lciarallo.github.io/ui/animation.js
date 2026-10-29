// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Live drawing of the indoor unit: airflow colour follows the mode, speed
// follows the fan setting, the vanes sweep while swing is on, and the flow
// fades when the unit is idle or off. It only animates while the menu is open.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {keepReadable} from './widgets.js';
import {formatNumber} from '../lib/labels.js';

const COLORS = {
    cool: [0.38, 0.63, 0.92],
    heat: [1.0, 0.47, 0.0],
    dry: [0.2, 0.78, 0.87],
    auto: [0.34, 0.89, 0.54],
    heat_cool: [0.34, 0.89, 0.54],
};

const STREAMS = 18;

function fanSpeed(fan) {
    const f = String(fan ?? '').toLowerCase();
    if (/quiet|silent|slow|sleep|night/.test(f))
        return 0.35;
    if (/turbo|power|strong|max|boost|focus/.test(f))
        return 1.5;
    if (f === 'low_mid')
        return 0.65;
    if (f === 'mid_high')
        return 0.95;
    if (/low/.test(f))
        return 0.5;
    if (/high/.test(f))
        return 1.15;
    if (/mid|medium|middle/.test(f))
        return 0.8;
    const level = f.match(/\d+/);
    if (level)
        return Math.min(1.6, 0.35 + 0.2 * Number(level[0]));
    return 0.8;
}

// Deterministic per-stream jitter in [0, 1).
const jitter = i => {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
};

export const AcAnimation = GObject.registerClass(
class AcAnimation extends PopupMenu.PopupBaseMenuItem {
    _init() {
        super._init({reactive: false, can_focus: false, style_class: 'brisa-animation-item'});
        this.syncSensitive();
        const box = new St.BoxLayout({vertical: true, x_expand: true});
        this._area = new St.DrawingArea({x_expand: true, style_class: 'brisa-animation'});
        this._area.connect('repaint', area => this._repaint(area));
        this._caption = new St.Label({style_class: 'brisa-caption', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._area);
        box.add_child(this._caption);
        this.add_child(box);

        this._state = null;
        this._unit = '°C';
        this._timeline = new Clutter.Timeline({actor: this._area, duration: 1000, repeat_count: -1});
        this._frameId = this._timeline.connect('new-frame', () => this._area.queue_repaint());
        this.connect('destroy', () => {
            this._timeline.disconnect(this._frameId);
            this._timeline.stop();
            this._timeline = null;
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

    setState(state, unit, caption) {
        this._state = state;
        this._unit = unit;
        this._caption.text = caption;
        this._syncRunning();
        this._area.queue_repaint();
    }

    setActive(active) {
        this._active = active;
        this._syncRunning();
    }

    _syncRunning() {
        if (!this._timeline)
            return;
        if (this._active && this._state?.power)
            this._timeline.start();
        else
            this._timeline.stop();
    }

    _repaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const [fr, fgc, fb] = fg ? [fg.red / 255, fg.green / 255, fg.blue / 255] : [1, 1, 1];
        const s = this._state;
        const on = !!s?.power;
        const t = GLib.get_monotonic_time() / 1e6;
        const color = COLORS[s?.mode] ?? [fr, fgc, fb];

        // Indoor unit.
        const uw = Math.min(w * 0.72, 300), uh = 38;
        const ux = (w - uw) / 2, uy = 6;
        const r = 12;
        cr.newSubPath();
        cr.arc(ux + uw - r, uy + r, r, -Math.PI / 2, 0);
        cr.arc(ux + uw - r, uy + uh - r, r, 0, Math.PI / 2);
        cr.arc(ux + r, uy + uh - r, r, Math.PI / 2, Math.PI);
        cr.arc(ux + r, uy + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
        cr.setSourceRGBA(fr, fgc, fb, 0.08);
        cr.fillPreserve();
        cr.setSourceRGBA(fr, fgc, fb, on ? 0.5 : 0.25);
        cr.setLineWidth(1.5);
        cr.stroke();

        // Status LED and small display.
        cr.arc(ux + 16, uy + 14, 3, 0, 2 * Math.PI);
        if (on)
            cr.setSourceRGBA(...color, 0.6 + 0.4 * Math.abs(Math.sin(t * 1.5)));
        else
            cr.setSourceRGBA(fr, fgc, fb, 0.2);
        cr.fill();
        if (on && s.target !== null && s.target !== undefined) {
            cr.selectFontFace('Sans', 0, 1);
            cr.setFontSize(12);
            cr.setSourceRGBA(...color, 0.95);
            const text = `${formatNumber(s.target)}°`;
            const ext = cr.textExtents(text);
            cr.moveTo(ux + uw - 14 - ext.width, uy + 19);
            cr.showText(text);
        }

        // Vanes: closed when off, sweeping while swing is on.
        const ventY = uy + uh - 7;
        const vx1 = ux + 26, vx2 = ux + uw - 26;
        let angle = 0;
        if (on)
            angle = s.oscillating ? Math.sin(t * 1.1) * 0.55 : 0.12;
        cr.setSourceRGBA(fr, fgc, fb, on ? 0.55 : 0.3);
        cr.setLineWidth(2);
        if (!on) {
            cr.moveTo(vx1, ventY);
            cr.lineTo(vx2, ventY);
            cr.stroke();
        } else {
            for (let i = 0; i <= 7; i++) {
                const x = vx1 + (vx2 - vx1) * i / 7;
                cr.moveTo(x - Math.sin(angle) * 4, ventY - Math.cos(angle) * 3);
                cr.lineTo(x + Math.sin(angle) * 4, ventY + Math.cos(angle) * 3);
                cr.stroke();
            }
        }

        if (on) {
            const idle = s.action === 'idle' || s.action === 'off';
            const speed = idle ? 0.25 : fanSpeed(s.fan);
            const strength = idle ? 0.3 : 1;
            const mode = s.mode;
            const span = h - ventY - 8;
            cr.setLineCap(1);
            for (let i = 0; i < STREAMS; i++) {
                const j = jitter(i);
                const rate = mode === 'dry' ? speed * 0.45 : speed * 0.7;
                const phase = (t * rate + j) % 1;
                const dist = phase * span;
                const x0 = vx1 + (vx2 - vx1) * (i + 0.5) / STREAMS;
                const sway = Math.sin(t * 2 + i) * 2;
                const x = x0 + Math.sin(angle) * dist * 0.9 + sway;
                const y = ventY + 6 + dist;
                const alpha = Math.pow(1 - phase, 1.3) * 0.85 * strength;
                cr.setSourceRGBA(...color, alpha);
                if (mode === 'dry') {
                    // Droplet.
                    cr.moveTo(x, y - 4);
                    cr.curveTo(x + 3, y, x + 3, y + 3, x, y + 3);
                    cr.curveTo(x - 3, y + 3, x - 3, y, x, y - 4);
                    cr.fill();
                } else if (mode === 'heat') {
                    // Warm ripple.
                    cr.setLineWidth(2);
                    cr.moveTo(x - 4, y);
                    cr.curveTo(x - 2, y - 3, x + 2, y + 3, x + 4, y);
                    cr.stroke();
                } else {
                    const len = 6 + 8 * speed;
                    cr.setLineWidth(2);
                    cr.moveTo(x, y);
                    cr.lineTo(x + Math.sin(angle) * len * 0.9, y + len);
                    cr.stroke();
                    if (mode === 'cool' && i % 3 === 0) {
                        // Tiny snowflake.
                        cr.setLineWidth(1);
                        for (let k = 0; k < 3; k++) {
                            const a = k * Math.PI / 3 + t;
                            cr.moveTo(x + 6 - Math.cos(a) * 3, y + 4 - Math.sin(a) * 3);
                            cr.lineTo(x + 6 + Math.cos(a) * 3, y + 4 + Math.sin(a) * 3);
                        }
                        cr.stroke();
                    }
                }
            }
        }
        cr.$dispose();
    }
});
