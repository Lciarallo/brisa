// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

import {ThinQProvider} from './thinq.js';
import {HomeAssistantProvider} from './homeassistant.js';

const N_ = s => s;

export const PROVIDERS = [
    {id: 'thinq', name: N_('LG ThinQ'), tokenLabel: 'Brisa: LG ThinQ token'},
    {id: 'homeassistant', name: N_('Home Assistant (any brand)'), tokenLabel: 'Brisa: Home Assistant token'},
];

export function createProvider(settings, token) {
    switch (settings.get_string('provider')) {
    case 'homeassistant':
        return new HomeAssistantProvider({token, url: settings.get_string('ha-url')});
    default:
        return new ThinQProvider({
            token,
            country: settings.get_string('thinq-country').trim().toUpperCase(),
            clientId: settings.get_string('thinq-client-id'),
        });
    }
}
