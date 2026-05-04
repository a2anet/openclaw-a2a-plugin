// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { A2AInboundKey } from "../config.js";
import { JSON_CONTENT_TYPE } from "../constants.js";
import { isValidA2AInboundKeyLabel } from "../utils/inbound-key-label.js";

export function generateApiKey(): string {
    return randomBytes(32).toString("base64url");
}

const HMAC_KEY = randomBytes(32);

function safeEqual(a: string, b: string): boolean {
    const ha = createHmac("sha256", HMAC_KEY).update(a).digest();
    const hb = createHmac("sha256", HMAC_KEY).update(b).digest();
    return timingSafeEqual(ha, hb);
}

function extractKey(req: IncomingMessage): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

export type ValidateResult = { ok: true; label: string } | { ok: false; reason: string };

export function validateApiKey(req: IncomingMessage, validKeys: A2AInboundKey[]): ValidateResult {
    const key = extractKey(req);
    if (!key) {
        return { ok: false, reason: "missing_key" };
    }
    for (const entry of validKeys) {
        if (safeEqual(key, entry.key) && isValidA2AInboundKeyLabel(entry.label)) {
            return { ok: true, label: entry.label };
        }
    }
    return { ok: false, reason: "invalid_key" };
}

export function sendAuthError(res: ServerResponse, message: string): void {
    res.statusCode = 401;
    res.setHeader("Content-Type", JSON_CONTENT_TYPE);
    res.setHeader("WWW-Authenticate", 'Bearer realm="a2a"');
    res.end(
        JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message },
        }),
    );
}
