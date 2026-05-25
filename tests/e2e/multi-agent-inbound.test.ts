// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// Multi-agent inbound e2e: configure two hosted agents (`alpha` and `beta`),
// verify each is served at its own `/a2a/<agentId>` endpoint with a distinct
// Agent Card, and confirm that the single-agent `/.well-known/` path is *not*
// served (multi-agent mode disables the global card).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Gateway, postJsonRpc, startGateway } from "./helpers.js";

const RUN = process.env.RUN_E2E === "1";
const describeE2E = RUN ? describe : describe.skip;

describeE2E("openclaw@latest + plugin — multi-agent inbound (unauthenticated)", () => {
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port: 18790,
            readinessPath: "/a2a/alpha/agent-card.json",
            pluginConfig: {
                inbound: {
                    allowUnauthenticated: true,
                    agents: {
                        alpha: {
                            agentCard: {
                                name: "Alpha Agent",
                                description: "First multi-agent inbound test agent",
                            },
                        },
                        beta: {
                            agentCard: {
                                name: "Beta Agent",
                                description: "Second multi-agent inbound test agent",
                            },
                        },
                    },
                },
            },
        });
    }, 180_000);

    afterAll(async () => {
        await gateway?.stop();
    }, 30_000);

    test("each hosted agent serves its own Agent Card", async () => {
        const expected = { alpha: "Alpha Agent", beta: "Beta Agent" };
        for (const [id, name] of Object.entries(expected)) {
            const res = await fetch(`${gateway.base}/a2a/${id}/agent-card.json`);
            expect(res.status).toBe(200);
            const card = (await res.json()) as Record<string, unknown>;
            expect(card.name).toBe(name);
            expect(typeof card.url).toBe("string");
            expect(Array.isArray(card.skills)).toBe(true);
        }
    });

    test("GET /.well-known/agent-card.json is not served in multi-agent mode", async () => {
        const res = await fetch(`${gateway.base}/.well-known/agent-card.json`);
        expect(res.status).toBe(404);
    });

    test("POST /a2a/alpha tasks/get returns a JSON-RPC response", async () => {
        const { status, json } = await postJsonRpc<{
            jsonrpc?: string;
            error?: unknown;
            result?: unknown;
        }>(gateway.base, "/a2a/alpha", {
            jsonrpc: "2.0",
            id: "1",
            method: "tasks/get",
            params: { id: "does-not-exist" },
        });
        expect(status).toBe(200);
        expect(json.jsonrpc).toBe("2.0");
        expect(json.error !== undefined || json.result !== undefined).toBe(true);
    });

    test("POST /a2a/beta rejects malformed JSON with a JSON-RPC parse error", async () => {
        const res = await fetch(`${gateway.base}/a2a/beta`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{not json",
        });
        const body = (await res.json()) as { error?: { code?: number } };
        expect(body.error?.code).toBe(-32700);
    });
});
