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

// homeassistant.components.climate.ClimateEntityFeature
const FEATURE = {
    TARGET_TEMPERATURE: 1,
    TARGET_TEMPERATURE_RANGE: 2,
    TARGET_HUMIDITY: 4,
    FAN_MODE: 8,
    PRESET_MODE: 16,
    SWING_MODE: 32,
    SWING_HORIZONTAL_MODE: 512,
};

// Attributes that describe what the entity can do (not its current state).
const SIGNATURE_KEYS = ['supported_features', 'hvac_modes', 'fan_modes', 'swing_modes', 'preset_modes',
    'swing_horizontal_modes', 'min_temp', 'max_temp', 'target_temp_step', 'min_humidity', 'max_humidity'];

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
        this._detect(s.attributes ?? {});
        return this.caps;
    }

    // Builds capabilities from supported_features (the entity's own
    // declaration), falling back to attribute presence for old integrations.
    _detect(a) {
        const sig = JSON.stringify(SIGNATURE_KEYS.map(k => a[k] ?? null));
        if (sig === this._signature)
            return;
        this._signature = sig;
        this.capsVersion = (this.capsVersion ?? 0) + 1;

        const f = Number.isInteger(a.supported_features) ? a.supported_features : null;
        const has = (bit, fallback) => (f === null ? fallback : (f & bit) !== 0);
        const step = a.target_temp_step ?? (this._unit === '°F' ? 1 : 0.5);
        const bounds = Number.isFinite(a.min_temp) && Number.isFinite(a.max_temp);
        const steps = (min, max, by) => {
            const out = [];
            for (let v = min; v <= max + 1e-9 && out.length < MAX_VALUES; v += by)
                out.push(Math.round(v * 10) / 10);
            return out;
        };

        const caps = {
            modes: strings(a.hvac_modes).filter(m => m !== 'off').map(toMode),
            temperature: bounds && has(FEATURE.TARGET_TEMPERATURE, 'temperature' in a)
                ? {min: a.min_temp, max: a.max_temp, step, modes: null} : null,
            unit: this._unit,
            fans: has(FEATURE.FAN_MODE, true) ? strings(a.fan_modes) : [],
            swings: has(FEATURE.SWING_MODE, true) ? strings(a.swing_modes) : [],
            presets: has(FEATURE.PRESET_MODE, true) ? strings(a.preset_modes) : [],
            extras: [],
        };
        if (bounds && has(FEATURE.TARGET_TEMPERATURE_RANGE, 'target_temp_low' in a)) {
            const values = steps(a.min_temp, a.max_temp, step);
            const group = N_('Temperature range');
            caps.extras.push({id: 'target_temp_low', label: N_('Lowest'), kind: 'range', group, unit: ` ${this._unit}`, values});
            caps.extras.push({id: 'target_temp_high', label: N_('Highest'), kind: 'range', group, unit: ` ${this._unit}`, values});
        }
        if (has(FEATURE.SWING_HORIZONTAL_MODE, true) && strings(a.swing_horizontal_modes).length) {
            caps.extras.push({id: 'swing_horizontal_mode', label: N_('Horizontal swing'), kind: 'choice',
                group: N_('Air direction'), values: strings(a.swing_horizontal_modes)});
        }
        if (has(FEATURE.TARGET_HUMIDITY, Number.isFinite(a.target_humidity))) {
            const min = a.min_humidity ?? 30, max = a.max_humidity ?? 99;
            caps.extras.push({id: 'humidity', label: N_('Target humidity'), kind: 'range', group: N_('Features'),
                unit: '%', values: steps(min, max, 5)});
        }
        this.caps = caps;
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
        this._detect(a);
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
            // The entity reports no setpoint in modes that take none (fan, dry…).
            setpoint: a.temperature !== null && a.temperature !== undefined,
            extras: {
                swing_horizontal_mode: a.swing_horizontal_mode,
                humidity: a.target_humidity,
                target_temp_low: a.target_temp_low,
                target_temp_high: a.target_temp_high,
            },
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

    setExtra(id, value, state) {
        if (id === 'target_temp_low' || id === 'target_temp_high') {
            // set_temperature needs both ends of the range together.
            const range = {
                target_temp_low: state?.extras?.target_temp_low,
                target_temp_high: state?.extras?.target_temp_high,
                [id]: value,
            };
            return this._service('set_temperature', range);
        }
        if (id === 'swing_horizontal_mode')
            return this._service('set_swing_horizontal_mode', {swing_horizontal_mode: value});
        if (id === 'humidity')
            return this._service('set_humidity', {humidity: value});
        return Promise.reject(new ProviderError(N_('Not supported')));
    }
}
