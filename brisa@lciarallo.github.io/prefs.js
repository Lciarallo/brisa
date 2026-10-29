// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PROVIDERS, createProvider} from './providers/index.js';
import {isValidCountry} from './providers/thinq.js';
import {parseServerUrl} from './providers/homeassistant.js';
import {lookupToken, storeToken, clearToken} from './lib/secret.js';

const THINQ_PAT_URL = 'https://connect-pat.lgthinq.com';
const HA_TOKEN_DOCS = 'https://www.home-assistant.io/docs/authentication/#your-account-profile';

export default class BrisaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        if (!settings.get_string('thinq-client-id'))
            settings.set_string('thinq-client-id', `thinq-open-${GLib.uuid_string_random()}`);
        // Toast titles are markup by default; device names come from the network.
        const toast = title => window.add_toast(new Adw.Toast({title, timeout: 3, use_markup: false}));
        const providerId = () => settings.get_string('provider');
        const providerInfo = () => PROVIDERS.find(p => p.id === providerId()) ?? PROVIDERS[0];

        window.set_default_size(620, 760);
        window.search_enabled = false;

        // ---- Connection page ------------------------------------------------
        const page = new Adw.PreferencesPage({title: _('Connection'), icon_name: 'network-wireless-symbolic'});
        window.add(page);

        const sourceGroup = new Adw.PreferencesGroup({
            title: _('Air conditioner source'),
            description: _('LG units connect straight to the LG ThinQ cloud. Other brands work through a Home Assistant server.'),
        });
        page.add(sourceGroup);
        const providerRow = new Adw.ComboRow({
            title: _('Connect with'),
            model: Gtk.StringList.new(PROVIDERS.map(p => _(p.name))),
            selected: Math.max(0, PROVIDERS.findIndex(p => p.id === providerId())),
        });
        sourceGroup.add(providerRow);

        // LG ThinQ
        const thinqGroup = new Adw.PreferencesGroup({
            title: _('LG ThinQ'),
            description: _('Create a Personal Access Token with the same account used in the ThinQ app, allowing it to list devices, read their status and control them.'),
        });
        page.add(thinqGroup);
        const patRow = new Adw.ActionRow({title: _('Create a token on the LG ThinQ website'), activatable: true});
        patRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        patRow.connect('activated', () => Gtk.show_uri(window, THINQ_PAT_URL, 0));
        thinqGroup.add(patRow);
        const countryRow = new Adw.EntryRow({title: _('Account country (two letters, e.g. BR)'), show_apply_button: true});
        countryRow.text = settings.get_string('thinq-country');
        countryRow.connect('apply', () => {
            const c = countryRow.text.trim().toUpperCase();
            if (!isValidCountry(c)) {
                countryRow.add_css_class('error');
                toast(_('Invalid country code'));
                return;
            }
            countryRow.remove_css_class('error');
            countryRow.text = c;
            settings.set_string('thinq-country', c);
        });
        thinqGroup.add(countryRow);

        // Home Assistant
        const haGroup = new Adw.PreferencesGroup({
            title: _('Home Assistant'),
            description: _('Any climate entity works. Create a long-lived access token in your Home Assistant profile, under Security.'),
        });
        page.add(haGroup);
        const haDocsRow = new Adw.ActionRow({title: _('How to create a long-lived token'), activatable: true});
        haDocsRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        haDocsRow.connect('activated', () => Gtk.show_uri(window, HA_TOKEN_DOCS, 0));
        haGroup.add(haDocsRow);
        const urlRow = new Adw.EntryRow({title: _('Server address, e.g. homeassistant.local:8123 with https'), show_apply_button: true});
        urlRow.text = settings.get_string('ha-url');
        const insecureRow = new Adw.ActionRow({
            title: _('Unencrypted connection'),
            subtitle: _('With http:// the token travels in clear text on your local network. Prefer https://.'),
            icon_name: 'dialog-warning-symbolic',
        });
        insecureRow.add_css_class('warning');
        const syncInsecure = () => {
            try {
                insecureRow.visible = !!settings.get_string('ha-url') && parseServerUrl(settings.get_string('ha-url')).insecure;
            } catch {
                insecureRow.visible = false;
            }
        };
        urlRow.connect('apply', () => {
            try {
                const {url} = parseServerUrl(urlRow.text);
                urlRow.remove_css_class('error');
                urlRow.text = url;
                settings.set_string('ha-url', url);
            } catch (e) {
                urlRow.add_css_class('error');
                toast(_(e.message));
            }
            syncInsecure();
        });
        haGroup.add(urlRow);
        haGroup.add(insecureRow);
        syncInsecure();

        // Token (shared, stored in the keyring)
        const tokenGroup = new Adw.PreferencesGroup({
            title: _('Access token'),
            description: _('The token is stored in the GNOME Keyring, never in plain-text settings.'),
        });
        page.add(tokenGroup);
        const tokenStatus = new Adw.ActionRow({title: _('Saved token')});
        const removeButton = new Gtk.Button({label: _('Remove'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        tokenStatus.add_suffix(removeButton);
        tokenGroup.add(tokenStatus);
        const tokenRow = new Adw.PasswordEntryRow({title: _('Paste a new token'), show_apply_button: true});
        tokenGroup.add(tokenRow);

        // Tells the running extension to reload the token from the keyring.
        const bumpRevision = () => settings.set_uint('token-revision', settings.get_uint('token-revision') + 1);
        const refreshTokenStatus = async () => {
            try {
                const token = await lookupToken(providerId());
                tokenStatus.subtitle = token ? _('Stored in the keyring') : _('Not set');
                removeButton.sensitive = !!token;
            } catch (e) {
                tokenStatus.subtitle = _('Could not read the keyring: %s').format(e.message);
                removeButton.sensitive = false;
            }
        };
        tokenRow.connect('apply', async () => {
            const token = tokenRow.text.trim();
            tokenRow.text = '';
            if (!token || /\s/.test(token) || token.length > 4096) {
                toast(_('That does not look like a valid token'));
                return;
            }
            try {
                await storeToken(providerId(), providerInfo().tokenLabel, token);
                toast(_('Token saved in the keyring'));
                bumpRevision();
            } catch (e) {
                toast(_('Could not save the token: %s').format(e.message));
            }
            refreshTokenStatus();
        });
        removeButton.connect('clicked', async () => {
            try {
                await clearToken(providerId());
                bumpRevision();
                toast(_('Token removed'));
            } catch (e) {
                toast(e.message);
            }
            refreshTokenStatus();
        });

        // Device picker
        const deviceGroup = new Adw.PreferencesGroup({
            title: _('Air conditioner'),
            description: _('Search the account and pick the unit to control.'),
        });
        const searchButton = new Gtk.Button({
            label: _('Search'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        deviceGroup.set_header_suffix(searchButton);
        page.add(deviceGroup);
        const currentRow = new Adw.ActionRow({title: _('Selected'), use_markup: false});
        deviceGroup.add(currentRow);
        const syncCurrent = () => {
            currentRow.subtitle = settings.get_string('device-id')
                ? settings.get_string('device-name') || settings.get_string('device-id')
                : _('Automatic (first one found)');
        };
        syncCurrent();
        let found = [];

        searchButton.connect('clicked', async () => {
            found.forEach(r => deviceGroup.remove(r));
            found = [];
            const addRow = row => {
                deviceGroup.add(row);
                found.push(row);
            };
            searchButton.sensitive = false;
            let provider = null;
            try {
                const token = await lookupToken(providerId());
                if (!token)
                    throw new Error(_('Save an access token first'));
                provider = createProvider(settings, token);
                const devices = await provider.listDevices();
                if (!devices.length)
                    addRow(new Adw.ActionRow({title: _('No air conditioner found in this account')}));
                for (const d of devices) {
                    const row = new Adw.ActionRow({
                        title: d.name,
                        subtitle: d.model,
                        use_markup: false,
                        activatable: true,
                    });
                    row.add_prefix(new Gtk.Image({icon_name: 'weather-snow-symbolic'}));
                    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
                    row.connect('activated', () => {
                        settings.set_string('device-name', d.name);
                        settings.set_string('device-id', d.id);
                        syncCurrent();
                        toast(_('Selected: %s').format(d.name));
                    });
                    addRow(row);
                }
            } catch (e) {
                const row = new Adw.ActionRow({title: _('Connection failed'), subtitle: _(e.message), use_markup: false});
                row.add_prefix(new Gtk.Image({icon_name: 'dialog-error-symbolic'}));
                addRow(row);
            } finally {
                provider?.destroy();
                searchButton.sensitive = true;
            }
        });
        const autoRow = new Adw.ActionRow({title: _('Use the first one found'), activatable: true});
        autoRow.connect('activated', () => {
            settings.set_string('device-name', '');
            settings.set_string('device-id', '');
            syncCurrent();
        });
        deviceGroup.add(autoRow);

        const syncProvider = () => {
            const isThinq = providerId() === 'thinq';
            thinqGroup.visible = isThinq;
            haGroup.visible = !isThinq;
            found.forEach(r => deviceGroup.remove(r));
            found = [];
            syncCurrent();
            refreshTokenStatus();
        };
        providerRow.connect('notify::selected', () => {
            const id = PROVIDERS[providerRow.selected]?.id ?? 'thinq';
            if (id === providerId())
                return;
            settings.set_string('device-id', '');
            settings.set_string('device-name', '');
            settings.set_string('provider', id);
            syncProvider();
        });
        syncProvider();

        // ---- Behaviour page -------------------------------------------------
        const behaviour = new Adw.PreferencesPage({title: _('Behavior'), icon_name: 'preferences-system-symbolic'});
        window.add(behaviour);
        const look = new Adw.PreferencesGroup({title: _('Appearance')});
        behaviour.add(look);
        const animateRow = new Adw.SwitchRow({
            title: _('Live animation'),
            subtitle: _('Shows what the unit is doing while the menu is open'),
        });
        settings.bind('animate', animateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(animateRow);
        const panelRow = new Adw.SwitchRow({
            title: _('Temperature in the top bar'),
            subtitle: _('Shown next to the icon while the unit is on'),
        });
        settings.bind('show-panel-temperature', panelRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(panelRow);

        const update = new Adw.PreferencesGroup({
            title: _('Updates'),
            description: _('Cloud APIs have rate limits; very short intervals may get the token blocked for a while.'),
        });
        behaviour.add(update);
        const pollRow = new Adw.SpinRow({
            title: _('Refresh every (seconds)'),
            adjustment: new Gtk.Adjustment({lower: 15, upper: 3600, step_increment: 15}),
        });
        settings.bind('poll-interval', pollRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        update.add(pollRow);

        const privacy = new Adw.PreferencesGroup({
            title: _('Privacy'),
            description: _('Brisa only talks to the LG ThinQ cloud or to your Home Assistant server. It has no telemetry and keeps no logs of your device.'),
        });
        behaviour.add(privacy);
        const repoRow = new Adw.ActionRow({title: _('Project page and source code'), activatable: true});
        repoRow.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        repoRow.connect('activated', () => Gtk.show_uri(window, this.metadata.url, 0));
        privacy.add(repoRow);
    }
}
