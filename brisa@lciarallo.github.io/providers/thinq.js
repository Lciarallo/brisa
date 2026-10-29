// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// LG ThinQ Connect (official LG cloud API, personal access token).
//
// Endpoints, headers and payload shapes follow LG's own Apache-2.0 client
// "thinqconnect" 1.0.14 (thinq_api.py, devices/air_conditioner.py).

import GLib from 'gi://GLib';

import {JsonSession, HttpError} from '../lib/http.js';

const N_ = s => s;

// Public application key of the "thinq-open" client (thinqconnect const.py).
const API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3';
const AC_DEVICE_TYPE = 'DEVICE_AIR_CONDITIONER';

// country.py: country -> API region.
const KIC = ['AU', 'BD', 'CN', 'HK', 'ID', 'IN', 'JP', 'KH', 'KR', 'LA', 'LK', 'MM',
    'MY', 'NP', 'NZ', 'PH', 'SG', 'TH', 'TW', 'VN'];
const AIC = ['AG', 'AR', 'AW', 'BB', 'BO', 'BR', 'BS', 'BZ', 'CA', 'CL', 'CO', 'CR',
    'CU', 'DM', 'DO', 'EC', 'GD', 'GT', 'GY', 'HN', 'HT', 'JM', 'KN', 'LC', 'MX',
    'NI', 'PA', 'PE', 'PR', 'PY', 'SR', 'SV', 'TT', 'US', 'UY', 'VC', 'VE'];

export const isValidCountry = c => /^[A-Z]{2}$/.test(c);

function regionFor(country) {
    if (KIC.includes(country))
        return 'kic';
    if (AIC.includes(country))
        return 'aic';
    return 'eic';
}

const ERRORS = {
    1103: N_('The access token is invalid or expired'),
    1218: N_('The access token is invalid or expired'),
    1302: N_('The access token is invalid or expired'),
    1305: N_('The token lacks permission for this action'),
    1309: N_('The token lacks permission for this action'),
    1306: N_('Too many requests, try again later'),
    1307: N_('Country not supported by LG ThinQ'),
    1205: N_('Device not found in this account'),
    1222: N_('The air conditioner is offline'),
    2209: N_('The air conditioner did not respond'),
    2301: N_('Remote control is disabled on the unit'),
    2304: N_('Turn the air conditioner on first'),
    2305: N_('Not available in the current mode'),
    2302: N_('Not available in the current state'),
};

export class ProviderError extends Error {
    constructor(message, code = null) {
        super(message);
        this.code = code;
    }
}

// thinqconnect: base64.urlsafe_b64encode(uuid4().bytes)[:-2]
function messageId() {
    const hex = GLib.uuid_string_random().replace(/-/g, '');
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return GLib.base64_encode(bytes).slice(0, -2).replace(/\+/g, '-').replace(/\//g, '_');
}

const MODES = {COOL: 'cool', HEAT: 'heat', AIR_DRY: 'dry', FAN: 'fan', AUTO: 'auto'};
const toMode = v => MODES[v] ?? v?.toLowerCase();
const fromMode = (m, raw) => raw.find(v => toMode(v) === m) ?? m.toUpperCase();

const isWritable = p => !!p && typeof p === 'object' && (p.mode ?? []).includes('w');
const isReadable = p => !!p && (typeof p !== 'object' || (p.mode ?? []).includes('r'));

// Upper bounds so a malformed profile cannot flood the menu.
const MAX_VALUES = 100;
const MAX_EXTRAS = 64;
const isScalar = v => ['string', 'number', 'boolean'].includes(typeof v);

function writableValues(prop) {
    const w = prop?.value?.w;
    if (Array.isArray(w))
        return w.filter(isScalar).slice(0, MAX_VALUES);
    if (w && typeof w === 'object' && Number.isFinite(w.max)) {
        const step = w.step > 0 ? w.step : 1;
        const values = [];
        for (let v = w.min ?? 0; v <= w.max + 1e-9 && values.length < MAX_VALUES; v += step)
            values.push(Math.round(v * 10) / 10);
        return values;
    }
    return prop?.type === 'boolean' ? [true, false] : [];
}

const celsius = list => (Array.isArray(list) ? list.find(u => u.unit === 'C') ?? list[0] ?? null : null);

const LABELS = {
    'operation.airCleanOperationMode': N_('Air purification'),
    'powerSave.powerSaveEnabled': N_('Energy saving'),
    'display.light': N_('Display light'),
    'airFlow.windStep': N_('Wind strength'),
    'windDirection.rotateUpDown': N_('Vertical swing'),
    'windDirection.rotateLeftRight': N_('Horizontal swing'),
    'windDirection.airGuideWind': N_('Air guide'),
    'windDirection.autoFitWind': N_('Auto fit'),
    'windDirection.concentrationWind': N_('Concentrated wind'),
    'windDirection.forestWind': N_('Forest wind'),
    'windDirection.highCeilingWind': N_('High ceiling'),
    'windDirection.longPowerWind': N_('Long reach'),
    'windDirection.mannerWind': N_('Gentle wind'),
    'windDirection.swirlWind': N_('Swirl wind'),
    'airQualitySensor.monitoringEnabled': N_('Air monitoring'),
    'airQualitySensor.PM1': N_('PM1'),
    'airQualitySensor.PM2': N_('PM2.5'),
    'airQualitySensor.PM10': N_('PM10'),
    'airQualitySensor.odor': N_('Odor'),
    'airQualitySensor.odorLevel': N_('Odor level'),
    'airQualitySensor.totalPollution': N_('Total pollution'),
    'airQualitySensor.totalPollutionLevel': N_('Air quality'),
    'filterInfo.usedTime': N_('Filter usage'),
    'filterInfo.filterLifetime': N_('Filter lifetime'),
    'filterInfo.filterRemainPercent': N_('Filter remaining'),
    'twoSetTemperature.twoSetEnabled': N_('Dual setpoint'),
};

const UNITS = {
    'airQualitySensor.PM1': ' µg/m³',
    'airQualitySensor.PM2': ' µg/m³',
    'airQualitySensor.PM10': ' µg/m³',
    'filterInfo.usedTime': ' h',
    'filterInfo.filterLifetime': ' h',
    'filterInfo.filterRemainPercent': '%',
};

const GROUPS = {windDirection: N_('Air direction')};

// Handled through the normalized controls instead of generic extras.
const HANDLED = new Set(['operation.airConOperationMode', 'airConJobMode.currentJobMode',
    'airFlow.windStrength', 'airFlow.windStrengthDetail', 'airQualitySensor.humidity']);
const SKIP_RESOURCES = new Set(['temperature', 'temperatureInUnits', 'twoSetTemperatureInUnits',
    'timer', 'sleepTimer']);

const prettyKey = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export class ThinQProvider {
    static id = 'thinq';

    constructor({token, country, clientId}) {
        if (!isValidCountry(country))
            throw new ProviderError(N_('Invalid country code'));
        this._token = token;
        this._country = country;
        this._clientId = clientId;
        this._base = `https://api-${regionFor(country)}.lgthinq.com/`;
        this._http = new JsonSession();
        this._extras = new Map();
    }

    destroy() {
        this._http.destroy();
        this._token = null;
    }

    async _call(method, endpoint, body = null, cancellable = null) {
        const headers = {
            'Authorization': `Bearer ${this._token}`,
            'x-country': this._country,
            'x-message-id': messageId(),
            'x-client-id': this._clientId,
            'x-api-key': API_KEY,
            'x-service-phase': 'OP',
        };
        if (method === 'POST')
            headers['x-conditional-control'] = 'true';
        try {
            const json = await this._http.request(method, this._base + endpoint, {headers, body, cancellable});
            return json?.response;
        } catch (e) {
            if (!(e instanceof HttpError))
                throw e;
            const code = e.body?.error?.code;
            throw new ProviderError(ERRORS[code] ?? N_('LG ThinQ request failed'), code ?? e.status);
        }
    }

    async listDevices(cancellable = null) {
        const devices = await this._call('GET', 'devices', null, cancellable) ?? [];
        return devices
            .filter(d => d.deviceInfo?.deviceType === AC_DEVICE_TYPE)
            .map(d => ({id: d.deviceId, name: d.deviceInfo?.alias ?? 'LG', model: d.deviceInfo?.modelName ?? ''}));
    }

    async open(id, cancellable = null) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
            throw new ProviderError(N_('Invalid device id'));
        this._id = id;
        this._profile = await this._call('GET', `devices/${encodeURIComponent(id)}/profile`, null, cancellable);
        return this._buildCaps(this._profile?.property ?? {});
    }

    _buildCaps(p) {
        this._rawModes = writableValues(p.airConJobMode?.currentJobMode);
        this._fanKey = isWritable(p.airFlow?.windStrengthDetail) ? 'windStrengthDetail' : 'windStrength';
        this._tempProfile = celsius(p.temperatureInUnits) ?? p.temperature ?? {};
        this._tempResource = p.temperatureInUnits ? 'temperatureInUnits' : 'temperature';
        this._extras.clear();

        const range = writableValues(this._tempProfile.targetTemperature ?? this._tempProfile.coolTargetTemperature);
        const caps = {
            modes: this._rawModes.map(toMode),
            temperature: range.length ? {min: range[0], max: range.at(-1), step: range[1] - range[0] || 1} : null,
            unit: '°C',
            fans: isWritable(p.airFlow?.[this._fanKey]) ? writableValues(p.airFlow[this._fanKey]) : [],
            swings: [],
            presets: [],
            extras: [],
        };

        const addExtra = (extra, read, write) => {
            if (caps.extras.length >= MAX_EXTRAS)
                return;
            this._extras.set(extra.id, {read, write});
            caps.extras.push(extra);
        };

        // Timers (setters mirror air_conditioner.py; -1/-1 clears an absolute timer).
        const timer = p.timer ?? {};
        const hourValues = prop => [0, ...writableValues(prop).filter(h => h > 0)];
        if (isWritable(p.sleepTimer?.relativeHourToStop)) {
            addExtra({id: 'sleep', label: N_('Sleep timer'), kind: 'hours', group: N_('Timers'),
                values: hourValues(p.sleepTimer.relativeHourToStop)},
            s => s?.sleepTimer?.relativeHourToStop ?? 0,
            h => ({sleepTimer: {relativeHourToStop: h, relativeMinuteToStop: 0}}));
        }
        if (isWritable(timer.relativeHourToStop)) {
            addExtra({id: 'stop-in', label: N_('Turn off in'), kind: 'hours', group: N_('Timers'),
                values: hourValues(timer.relativeHourToStop)},
            s => s?.timer?.relativeHourToStop ?? 0,
            h => ({timer: {relativeHourToStop: h}}));
        }
        if (isWritable(timer.relativeHourToStart)) {
            addExtra({id: 'start-in', label: N_('Turn on in'), kind: 'hours', group: N_('Timers'),
                values: hourValues(timer.relativeHourToStart)},
            s => s?.timer?.relativeHourToStart ?? 0,
            h => ({timer: {relativeHourToStart: h, relativeMinuteToStart: 0}}));
        }
        for (const [what, label] of [['Start', N_('Turn on at')], ['Stop', N_('Turn off at')]]) {
            const hk = `absoluteHourTo${what}`;
            const mk = `absoluteMinuteTo${what}`;
            if (!isWritable(timer[hk]))
                continue;
            addExtra({id: `at-${what}`, label, kind: 'clock', group: N_('Timers'),
                values: [-1, ...Array.from({length: 48}, (_, i) => i * 30)]},
            s => {
                const h = s?.timer?.[hk];
                return Number.isInteger(h) && h >= 0 ? h * 60 + (s.timer[mk] ?? 0) : -1;
            },
            v => ({timer: {[hk]: v < 0 ? -1 : Math.floor(v / 60), [mk]: v < 0 ? -1 : v % 60}}));
        }

        // Everything else the profile declares.
        for (const [res, props] of Object.entries(p)) {
            if (SKIP_RESOURCES.has(res) || !props || typeof props !== 'object' || Array.isArray(props))
                continue;
            for (const [key, prop] of Object.entries(props)) {
                const id = `${res}.${key}`;
                if (HANDLED.has(id))
                    continue;
                const label = LABELS[id] ?? prettyKey(key);
                const group = GROUPS[res] ?? N_('Features');
                const read = s => s?.[res]?.[key];
                if (isWritable(prop)) {
                    const values = writableValues(prop);
                    if (!values.length)
                        continue;
                    const pair = values.length === 2 && [['ON', 'OFF'], ['START', 'STOP'], [true, false]]
                        .find(([on, off]) => values.includes(on) && values.includes(off));
                    if (pair) {
                        addExtra({id, label, kind: 'switch', group},
                            s => read(s) === pair[0],
                            on => ({[res]: {[key]: on ? pair[0] : pair[1]}}));
                    } else {
                        addExtra({id, label, kind: prop.type === 'range' ? 'range' : 'choice', group,
                            values, unit: UNITS[id] ?? ''},
                        read, v => ({[res]: {[key]: v}}));
                    }
                } else if (isReadable(prop)) {
                    addExtra({id, label, kind: 'info', group: N_('Sensors'), unit: UNITS[id] ?? ''}, read, null);
                }
            }
        }
        return caps;
    }

    _targetKey(mode) {
        const byMode = {cool: 'coolTargetTemperature', heat: 'heatTargetTemperature', auto: 'autoTargetTemperature'};
        const key = byMode[mode];
        return key && isWritable(this._tempProfile[key]) ? key : 'targetTemperature';
    }

    async getState(cancellable = null) {
        const raw = await this._call('GET', `devices/${encodeURIComponent(this._id)}/state`, null, cancellable);
        const mode = toMode(raw?.airConJobMode?.currentJobMode);
        const t = celsius(raw?.temperatureInUnits) ?? raw?.temperature ?? {};
        const dir = raw?.windDirection ?? {};
        const extras = {};
        for (const [id, {read}] of this._extras)
            extras[id] = read(raw);
        return {
            power: raw?.operation?.airConOperationMode === 'POWER_ON',
            mode,
            target: t[this._targetKey(mode)] ?? t.targetTemperature ?? null,
            current: t.currentTemperature ?? null,
            humidity: raw?.airQualitySensor?.humidity ?? null,
            fan: raw?.airFlow?.[this._fanKey] ?? null,
            swing: null,
            preset: null,
            oscillating: !!(dir.rotateUpDown || dir.rotateLeftRight || dir.swirlWind),
            action: null,
            extras,
        };
    }

    _control(payload) {
        return this._call('POST', `devices/${encodeURIComponent(this._id)}/control`, payload);
    }

    setPower(on) {
        return this._control({operation: {airConOperationMode: on ? 'POWER_ON' : 'POWER_OFF'}});
    }

    setMode(mode) {
        return this._control({airConJobMode: {currentJobMode: fromMode(mode, this._rawModes)}});
    }

    setTarget(value, state) {
        return this._control({[this._tempResource]: {[this._targetKey(state?.mode)]: value, unit: 'C'}});
    }

    setFan(value) {
        return this._control({airFlow: {[this._fanKey]: value}});
    }

    setExtra(id, value) {
        const extra = this._extras.get(id);
        if (!extra?.write)
            return Promise.reject(new ProviderError(N_('Not supported')));
        return this._control(extra.write(value));
    }
}
