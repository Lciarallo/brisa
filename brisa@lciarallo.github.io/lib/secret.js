// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Access tokens live in the user's keyring (libsecret), never in GSettings.

import Secret from 'gi://Secret';

// Built on first use, never at import time (extensions must not create
// objects before enable()).
function schema() {
    return new Secret.Schema('io.github.lciarallo.Brisa', Secret.SchemaFlags.NONE, {
        provider: Secret.SchemaAttributeType.STRING,
    });
}

export function lookupToken(provider, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(schema(), {provider}, cancellable, (_src, res) => {
            try {
                resolve(Secret.password_lookup_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storeToken(provider, label, token, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(schema(), {provider}, Secret.COLLECTION_DEFAULT, label, token,
            cancellable, (_src, res) => {
                try {
                    resolve(Secret.password_store_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export function clearToken(provider, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(schema(), {provider}, cancellable, (_src, res) => {
            try {
                resolve(Secret.password_clear_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}
