#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Prints the LG ThinQ capability profile of your air conditioners so it can
// be attached to a "New device" issue. The token is read from the keyring
// (saved by Brisa's settings) and is never printed; device ids are redacted.
//
// Usage, from the repository root:  gjs -m tools/dump-profile.js [COUNTRY]

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const root = Gio.File.new_for_path(GLib.get_current_dir()).get_child('brisa@lciarallo.github.io');
const {ThinQProvider} = await import(root.get_child('providers').get_child('thinq.js').get_uri());
const {lookupToken} = await import(root.get_child('lib').get_child('secret.js').get_uri());

const country = (ARGV[0] ?? 'BR').toUpperCase();
const token = await lookupToken('thinq');
if (!token) {
    printerr('No LG ThinQ token in the keyring. Save one in Brisa → Settings first.');
    imports.system.exit(1);
}

const provider = new ThinQProvider({token, country, clientId: `thinq-open-${GLib.uuid_string_random()}`});
try {
    const devices = await provider.listDevices();
    const report = [];
    for (const d of devices) {
        await provider.open(d.id);
        report.push({model: d.model, profile: provider._profile});
    }
    print(JSON.stringify(report, null, 2));
} catch (e) {
    printerr(`Failed: ${e.message}`);
} finally {
    provider.destroy();
}
