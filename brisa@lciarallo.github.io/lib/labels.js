// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Human labels for the raw values devices report. Shared by the Shell
// process and the preferences, which each pass in their own gettext.

const N_ = s => s;

export const VALUE_LABELS = {
    cool: N_('Cool'),
    heat: N_('Heat'),
    dry: N_('Dry'),
    fan: N_('Fan'),
    auto: N_('Auto'),
    heat_cool: N_('Heat/Cool'),
    energy_saving: N_('Eco'),
    air_clean: N_('Purify'),
    aroma: N_('Aroma'),
    slow: N_('Very low'),
    quiet: N_('Quiet'),
    silent: N_('Quiet'),
    low: N_('Low'),
    low_mid: N_('Medium-low'),
    mid: N_('Medium'),
    medium: N_('Medium'),
    middle: N_('Medium'),
    mid_high: N_('Medium-high'),
    high: N_('High'),
    power: N_('Turbo'),
    turbo: N_('Turbo'),
    nature: N_('Natural'),
    on: N_('On'),
    off: N_('Off'),
    start: N_('On'),
    stop: N_('Off'),
    always: N_('Always'),
    on_working: N_('While running'),
    good: N_('Good'),
    normal: N_('Normal'),
    error: N_('Error'),
    bad: N_('Poor'),
    very_bad: N_('Very poor'),
    invalid: '--',
    vertical: N_('Vertical'),
    horizontal: N_('Horizontal'),
    both: N_('Both'),
    swing: N_('Swing'),
    eco: N_('Eco'),
    boost: N_('Boost'),
    sleep: N_('Sleep'),
    comfort: N_('Comfort'),
    away: N_('Away'),
    home: N_('Home'),
    none: N_('None'),
};

// Locale-aware number ("22,5" in pt_BR, "22.5" in en).
export const formatNumber = v => (typeof v === 'number'
    ? v.toLocaleString(undefined, {maximumFractionDigits: 1}) : String(v ?? '--'));

export const makeValueLabel = _ => function valueLabel(v) {
    if (typeof v === 'boolean')
        return v ? _('Yes') : _('No');
    if (typeof v !== 'string')
        return formatNumber(v);
    const known = VALUE_LABELS[v.toLowerCase()];
    if (known)
        return _(known);
    const s = v.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
};
