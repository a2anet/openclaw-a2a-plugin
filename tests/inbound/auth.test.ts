// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { generateApiKey, sendAuthError, validateApiKey } from "../../src/inbound/auth.js";

function fakeReq(authorization?: string): IncomingMessage {
    return { headers: { authorization } } as unknown as IncomingMessage;
}

describe("generateApiKey", () => {
    test("generates base64url key", () => {
        const key = generateApiKey();
        expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(key.length).toBe(43); // 32 bytes in base64url
    });

    test("generates unique keys", () => {
        const keys = new Set(Array.from({ length: 10 }, () => generateApiKey()));
        expect(keys.size).toBe(10);
    });
});

describe("validateApiKey", () => {
    const validKeys = [
        { label: "key1", key: "abc123" },
        { label: "key2", key: "def456" },
    ];

    test("validates correct key", () => {
        const result = validateApiKey(fakeReq("Bearer abc123"), validKeys);
        expect(result).toEqual({ ok: true, label: "key1" });
    });

    test("validates second key", () => {
        const result = validateApiKey(fakeReq("Bearer def456"), validKeys);
        expect(result).toEqual({ ok: true, label: "key2" });
    });

    test("rejects invalid key", () => {
        const result = validateApiKey(fakeReq("Bearer wrong"), validKeys);
        expect(result).toEqual({ ok: false, reason: "invalid_key" });
    });

    test("rejects missing key", () => {
        const result = validateApiKey(fakeReq(undefined), validKeys);
        expect(result).toEqual({ ok: false, reason: "missing_key" });
    });

    test("handles case-insensitive Bearer prefix", () => {
        const result = validateApiKey(fakeReq("bearer abc123"), validKeys);
        expect(result).toEqual({ ok: true, label: "key1" });
    });
});

describe("sendAuthError", () => {
    test("sends 401 with JSON-RPC error", () => {
        let statusCode = 0;
        const headers: Record<string, string> = {};
        let body = "";
        const res = {
            set statusCode(code: number) {
                statusCode = code;
            },
            setHeader(name: string, value: string) {
                headers[name] = value;
            },
            end(data: string) {
                body = data;
            },
        } as unknown as ServerResponse;

        sendAuthError(res, "Auth required");
        expect(statusCode).toBe(401);
        expect(headers["WWW-Authenticate"]).toBe('Bearer realm="a2a"');
        const parsed = JSON.parse(body);
        expect(parsed.error.code).toBe(-32001);
        expect(parsed.error.message).toBe("Auth required");
    });
});
