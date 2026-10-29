// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Human labels for the raw values devices report. Shared by the Shell
// process and the preferences, which each pass in their own gettext.

// Marks a string for extraction (xgettext keyword) without translating it yet.
const translatable = text => text;

// Raw value reported by the device (lower-cased) -> English label.
export const VALUE_LABELS = {
    'cool': translatable('Cool'),
    'heat': translatable('Heat'),
    'dry': translatable('Dry'),
    'fan': translatable('Fan'),
    'auto': translatable('Auto'),
    'heat_cool': translatable('Heat/Cool'),
    'energy_saving': translatable('Eco'),
    'air_clean': translatable('Purify'),
    'aroma': translatable('Aroma'),
    'slow': translatable('Very low'),
    'quiet': translatable('Quiet'),
    'silent': translatable('Quiet'),
    'low': translatable('Low'),
    'low_mid': translatable('Medium-low'),
    'mid': translatable('Medium'),
    'medium': translatable('Medium'),
    'middle': translatable('Medium'),
    'mid_high': translatable('Medium-high'),
    'high': translatable('High'),
    'power': translatable('Turbo'),
    'turbo': translatable('Turbo'),
    'nature': translatable('Natural'),
    'on': translatable('On'),
    'off': translatable('Off'),
    'start': translatable('On'),
    'stop': translatable('Off'),
    'always': translatable('Always'),
    'on_working': translatable('While running'),
    'good': translatable('Good'),
    'normal': translatable('Normal'),
    'error': translatable('Error'),
    'bad': translatable('Poor'),
    'very_bad': translatable('Very poor'),
    'invalid': '--',
    'vertical': translatable('Vertical'),
    'horizontal': translatable('Horizontal'),
    'both': translatable('Both'),
    'swing': translatable('Swing'),
    'eco': translatable('Eco'),
    'boost': translatable('Boost'),
    'sleep': translatable('Sleep'),
    'comfort': translatable('Comfort'),
    'away': translatable('Away'),
    'home': translatable('Home'),
    'none': translatable('None'),
};

// Locale-aware number ("22,5" in pt_BR, "22.5" in en).
export function formatNumber(value) {
    if (typeof value === 'number')
        return value.toLocaleString(undefined, {maximumFractionDigits: 1});
    return String(value ?? '--');
}

// Returns a function that turns a raw device value into a translated label.
export function makeValueLabel(gettext) {
    return function valueLabel(value) {
        if (typeof value === 'boolean')
            return value ? gettext('Yes') : gettext('No');
        if (typeof value !== 'string')
            return formatNumber(value);
        const known = VALUE_LABELS[value.toLowerCase()];
        if (known)
            return gettext(known);
        const words = value.replace(/_/g, ' ').toLowerCase();
        return words.charAt(0).toUpperCase() + words.slice(1);
    };
}
