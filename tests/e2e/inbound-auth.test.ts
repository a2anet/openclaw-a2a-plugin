// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// Inbound API-key auth e2e: configure a single API key with no
// `allowUnauthenticated`, and verify that the inbound endpoint rejects
// unauthenticated calls (401 + JSON-RPC error envelope + WWW-Authenticate)
// and accepts valid `Authorization: Bearer <key>` headers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Gateway, startGateway } from "./helpers.js";

const RUN = process.env.RUN_E2E === "1";
const describeE2E = RUN ? describe : describe.skip;

describeE2E("openclaw@latest + plugin — single-agent inbound (API key auth)", () => {
    const apiKey = "e2e-test-key-OVuU9p7eC0fMRGAh";
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port: 18791,
            pluginConfig: {
                inbound: {
                    agentCard: {
                        name: "Auth Test Agent",
                        description: "Used by openclaw-a2a-plugin e2e auth tests",
                    },
                    apiKeys: [{ label: "e2e", key: apiKey }],
                },
            },
        });
    }, 180_000);

    afterAll(async () => {
        await gateway?.stop();
    }, 30_000);

    test("POST /a2a without Authorization is rejected with 401", async () => {
        const res = await fetch(`${gateway.base}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "1",
                method: "tasks/get",
                params: { id: "x" },
            }),
        });
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate") ?? "").toContain("Bearer");
        const body = (await res.json()) as { error?: { code?: number } };
        expect(body.error?.code).toBe(-32001);
    });

    test("POST /a2a with an invalid Bearer key is rejected with 401", async () => {
        const res = await fetch(`${gateway.base}/a2a`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: "Bearer not-the-real-key",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "1",
                method: "tasks/get",
                params: { id: "x" },
            }),
        });
        expect(res.status).toBe(401);
    });

    test("POST /a2a with a valid Bearer key is accepted", async () => {
        const res = await fetch(`${gateway.base}/a2a`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "1",
                method: "tasks/get",
                params: { id: "does-not-exist" },
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            jsonrpc?: string;
            error?: unknown;
            result?: unknown;
        };
        expect(body.jsonrpc).toBe("2.0");
        expect(body.error !== undefined || body.result !== undefined).toBe(true);
    });
});
