// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Home Assistant REST API (long-lived access token). Any climate entity works,
// so this covers Samsung, Midea, Gree, Daikin, Tuya, Fujitsu, Sensibo, etc.

import GLib from 'gi://GLib';

import {JsonSession, HttpError} from '../lib/http.js';
import {ProviderError} from './thinq.js';

const N_ = s => s;

const PRIVATE_HOST = [
    /^localhost$/, /^127\./, /^::1$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./, /^f[cd][0-9a-f]{2}:/, /^fe80:/, /\.local$/, /\.lan$/, /\.home\.arpa$/, /\.internal$/,
];

// Returns {url, insecure} or throws. Plain http is only accepted for hosts on
// the local network; the token would otherwise cross the internet in clear text.
export function parseServerUrl(text) {
    let uri;
    try {
        uri = GLib.Uri.parse(text.trim(), GLib.UriFlags.NONE);
    } catch {
        throw new ProviderError(N_('Invalid server address'));
    }
    const scheme = uri.get_scheme()?.toLowerCase();
    const host = uri.get_host()?.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['http', 'https'].includes(scheme) || !host)
        throw new ProviderError(N_('Use an http:// or https:// address'));
    if (uri.get_userinfo() || uri.get_query() || uri.get_fragment())
        throw new ProviderError(N_('The address must not contain credentials, query or fragment'));
    const local = PRIVATE_HOST.some(re => re.test(host));
    if (scheme === 'http' && !local)
        throw new ProviderError(N_('Use https:// for servers outside your local network'));
    const port = uri.get_port() > 0 ? `:${uri.get_port()}` : '';
    const path = uri.get_path().replace(/\/+$/, '');
    const h = host.includes(':') ? `[${host}]` : host;
    return {url: `${scheme}://${h}${port}${path}`, insecure: scheme === 'http'};
}

const ENTITY_RE = /^climate\.[a-z0-9_]{1,255}$/;
const MAX_VALUES = 100;
const strings = list => (Array.isArray(list) ? list.filter(v => typeof v === 'string').slice(0, MAX_VALUES) : []);

const MODES = {fan_only: 'fan'};
const toMode = m => MODES[m] ?? m;
const fromMode = m => Object.keys(MODES).find(k => MODES[k] === m) ?? m;

const ACTIONS = {cooling: 'cooling', heating: 'heating', drying: 'drying', fan: 'fan', idle: 'idle',
    off: 'off', preheating: 'heating', defrosting: 'heating'};

export class HomeAssistantProvider {
    static id = 'homeassistant';

    // set_hvac_mode with a real mode also switches the unit on.
    modeTurnsOn = true;

    constructor({token, url}) {
        this._token = token;
        this._base = parseServerUrl(url).url;
        this._http = new JsonSession();
    }

    destroy() {
        this._http.destroy();
        this._token = null;
    }

    async _call(method, path, body = null, cancellable = null) {
        try {
            return await this._http.request(method, `${this._base}/api/${path}`, {
                headers: {Authorization: `Bearer ${this._token}`},
                body,
                cancellable,
            });
        } catch (e) {
            if (!(e instanceof HttpError))
                throw e;
            if (e.status === 401 || e.status === 403)
                throw new ProviderError(N_('The access token is invalid or expired'), e.status);
            if (e.status === 404)
                throw new ProviderError(N_('Device not found in this account'), e.status);
            throw new ProviderError(N_('Home Assistant request failed'), e.status);
        }
    }

    async listDevices(cancellable = null) {
        const states = await this._call('GET', 'states', null, cancellable) ?? [];
        return states
            .filter(s => ENTITY_RE.test(s.entity_id ?? ''))
            .map(s => ({id: s.entity_id, name: s.attributes?.friendly_name ?? s.entity_id, model: s.entity_id}));
    }

    async open(id, cancellable = null) {
        if (!ENTITY_RE.test(id))
            throw new ProviderError(N_('Invalid device id'));
        this._id = id;
        const config = await this._call('GET', 'config', null, cancellable);
        this._unit = config?.unit_system?.temperature ?? '°C';
        const s = await this._fetch(cancellable);
        const a = s.attributes ?? {};
        const step = a.target_temp_step ?? (this._unit === '°F' ? 1 : 0.5);
        const caps = {
            modes: strings(a.hvac_modes).filter(m => m !== 'off').map(toMode),
            temperature: Number.isFinite(a.min_temp) && Number.isFinite(a.max_temp)
                ? {min: a.min_temp, max: a.max_temp, step} : null,
            unit: this._unit,
            fans: strings(a.fan_modes),
            swings: strings(a.swing_modes),
            presets: strings(a.preset_modes),
            extras: [],
        };
        if (strings(a.swing_horizontal_modes).length) {
            caps.extras.push({id: 'swing_horizontal_mode', label: N_('Horizontal swing'), kind: 'choice',
                group: N_('Air direction'), values: strings(a.swing_horizontal_modes)});
        }
        if (Number.isFinite(a.target_humidity)) {
            const min = a.min_humidity ?? 30, max = a.max_humidity ?? 99;
            caps.extras.push({id: 'humidity', label: N_('Target humidity'), kind: 'range', group: N_('Features'),
                unit: '%', values: Array.from({length: Math.floor((max - min) / 5) + 1}, (_, i) => min + i * 5)});
        }
        return caps;
    }

    async _fetch(cancellable) {
        const s = await this._call('GET', `states/${this._id}`, null, cancellable);
        if (!s || s.entity_id !== this._id)
            throw new ProviderError(N_('Device not found in this account'));
        if (s.state === 'unavailable')
            throw new ProviderError(N_('The air conditioner is offline'));
        return s;
    }

    async getState(cancellable = null) {
        const s = await this._fetch(cancellable);
        const a = s.attributes ?? {};
        const power = s.state !== 'off';
        if (power)
            this._lastMode = s.state;
        return {
            power,
            mode: power ? toMode(s.state) : toMode(this._lastMode ?? null),
            target: a.temperature ?? null,
            current: a.current_temperature ?? null,
            humidity: a.current_humidity ?? null,
            fan: a.fan_mode ?? null,
            swing: a.swing_mode ?? null,
            preset: a.preset_mode ?? null,
            oscillating: !!a.swing_mode && !['off', 'stop', 'fixed'].includes(String(a.swing_mode).toLowerCase()),
            action: ACTIONS[a.hvac_action] ?? null,
            extras: {swing_horizontal_mode: a.swing_horizontal_mode, humidity: a.target_humidity},
        };
    }

    _service(service, data) {
        return this._call('POST', `services/climate/${service}`, {entity_id: this._id, ...data});
    }

    setPower(on, state) {
        if (!on)
            return this._service('set_hvac_mode', {hvac_mode: 'off'});
        return this._service('set_hvac_mode', {hvac_mode: fromMode(state?.mode ?? this._lastMode ?? 'auto')});
    }

    setMode(mode) {
        return this._service('set_hvac_mode', {hvac_mode: fromMode(mode)});
    }

    setTarget(value) {
        return this._service('set_temperature', {temperature: value});
    }

    setFan(value) {
        return this._service('set_fan_mode', {fan_mode: value});
    }

    setSwing(value) {
        return this._service('set_swing_mode', {swing_mode: value});
    }

    setPreset(value) {
        return this._service('set_preset_mode', {preset_mode: value});
    }

    setExtra(id, value) {
        if (id === 'swing_horizontal_mode')
            return this._service('set_swing_horizontal_mode', {swing_horizontal_mode: value});
        if (id === 'humidity')
            return this._service('set_humidity', {humidity: value});
        return Promise.reject(new ProviderError(N_('Not supported')));
    }
}
