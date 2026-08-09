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

const PORT = 18791;

describeE2E("openclaw@latest + plugin — single-agent inbound (API key auth)", () => {
    const apiKey = "e2e-test-key-OVuU9p7eC0fMRGAh";
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port: PORT,
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

    // Under auth, the Agent Card stays publicly readable so clients can
    // discover that auth is required and which scheme to use. If we ever
    // accidentally gate the card endpoint behind auth, discovery breaks.
    test("GET /.well-known/agent-card.json is reachable without Authorization", async () => {
        const res = await fetch(`${gateway.base}/.well-known/agent-card.json`);
        expect(res.status).toBe(200);
        const card = (await res.json()) as Record<string, unknown>;
        expect(card.url).toBe(`http://127.0.0.1:${PORT}/a2a`);
        // The card must advertise the API-key scheme so SDK clients know
        // to attach `Authorization: Bearer <key>` to their RPC calls.
        const schemes = card.securitySchemes as Record<string, { type?: string }> | undefined;
        expect(schemes?.a2aApiKey?.type).toBe("apiKey");
        expect(Array.isArray(card.security)).toBe(true);
    });

    // End-to-end discovery contract under auth: fetch the card publicly,
    // send `message/send` to whatever URL the card claims, with a valid
    // bearer token. This is the flow a real A2A client would follow.
    test("card-driven round-trip: discover publicly, then call with Bearer auth", async () => {
        const cardRes = await fetch(`${gateway.base}/.well-known/agent-card.json`);
        expect(cardRes.status).toBe(200);
        const card = (await cardRes.json()) as { url?: string };
        const rpcUrl = card.url as string;

        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "auth-card-driven-1",
                method: "tasks/get",
                params: { id: "does-not-exist" },
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            jsonrpc?: string;
            id?: string;
            error?: unknown;
            result?: unknown;
        };
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe("auth-card-driven-1");
        expect(body.error !== undefined || body.result !== undefined).toBe(true);
    }, 30_000);

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
