// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Luiz Eduardo Ciarallo

// Small JSON-over-HTTPS helper shared by every provider.
//
// Hardening: redirects are never followed (the bearer token must not be
// replayed to another host), TLS validation stays at libsoup defaults,
// responses are size-capped and requests time out.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

export class HttpError extends Error {
    constructor(status, message, body = null) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

export class JsonSession {
    constructor() {
        this._session = new Soup.Session({timeout: 20, user_agent: 'Brisa-GNOME/1'});
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }

    // Reads the body in chunks and gives up as soon as it exceeds the cap.
    async _readCapped(stream, cancellable) {
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const bytes = await stream.read_bytes_async(CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable);
                const size = bytes.get_size();
                if (size === 0)
                    break;
                total += size;
                if (total > MAX_RESPONSE_BYTES)
                    throw new HttpError(0, 'Response too large');
                chunks.push(bytes.get_data());
            }
        } finally {
            stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
        }
        return out;
    }

    async request(method, url, {headers = {}, body = null, cancellable = null} = {}) {
        if (!this._session)
            throw new HttpError(0, 'Session closed');
        const msg = Soup.Message.new(method, url);
        if (!msg)
            throw new HttpError(0, 'Invalid URL');
        msg.set_flags(Soup.MessageFlags.NO_REDIRECT);
        for (const [k, v] of Object.entries(headers))
            msg.request_headers.append(k, v);
        if (body !== null) {
            msg.set_request_body_from_bytes('application/json',
                new GLib.Bytes(this._encoder.encode(JSON.stringify(body))));
        }

        const stream = await this._session.send_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        const status = msg.get_status();
        const text = this._decoder.decode(await this._readCapped(stream, cancellable));
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        if (status >= 300 && status < 400)
            throw new HttpError(status, 'Unexpected redirect refused');
        if (status < 200 || status >= 300)
            throw new HttpError(status, msg.get_reason_phrase() || `HTTP ${status}`, json);
        return json;
    }
}
