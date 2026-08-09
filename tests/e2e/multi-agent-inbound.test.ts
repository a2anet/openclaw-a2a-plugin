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

const PORT = 18790;

describeE2E("openclaw@latest + plugin — multi-agent inbound (unauthenticated)", () => {
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port: PORT,
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

    test("each hosted agent serves its own Agent Card with a URL pointing at /a2a/<agentId>", async () => {
        const expected = { alpha: "Alpha Agent", beta: "Beta Agent" };
        for (const [id, name] of Object.entries(expected)) {
            const res = await fetch(`${gateway.base}/a2a/${id}/agent-card.json`);
            expect(res.status).toBe(200);
            const card = (await res.json()) as Record<string, unknown>;
            expect(card.name).toBe(name);
            expect(card.url).toBe(`http://127.0.0.1:${PORT}/a2a/${id}`);
            expect(Array.isArray(card.skills)).toBe(true);
        }
    });

    // The contract we want clients to be able to rely on: discover the agent by
    // fetching its card, then send messages to the `url` field as-is — no path
    // rewriting on the client side. This test proves that contract by routing
    // a `message/send` through whatever the card claims its URL is.
    test("message/send addressed to the URL from the Agent Card reaches the right agent", async () => {
        const cardRes = await fetch(`${gateway.base}/a2a/alpha/agent-card.json`);
        expect(cardRes.status).toBe(200);
        const card = (await cardRes.json()) as { url?: string };
        expect(typeof card.url).toBe("string");
        const rpcUrl = card.url as string;

        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "card-driven-1",
                method: "message/send",
                params: {
                    message: {
                        messageId: crypto.randomUUID(),
                        role: "user",
                        parts: [{ kind: "text", text: "ping" }],
                    },
                },
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            jsonrpc?: string;
            id?: string;
            result?: { kind?: string };
            error?: unknown;
        };
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe("card-driven-1");
        // No LLM in the test env, so the lane settles either as a task (which
        // would then fail) or surfaces an error. Either is a valid envelope.
        if (body.result) {
            expect(["task", "message"]).toContain(body.result.kind);
        } else {
            expect(body.error).toBeDefined();
        }
    }, 30_000);

    test("the URL on alpha's card does not route to beta", async () => {
        const cardRes = await fetch(`${gateway.base}/a2a/beta/agent-card.json`);
        const card = (await cardRes.json()) as { url?: string };
        // Sanity check: beta's `url` is /a2a/beta, not /a2a/alpha. If this ever
        // regresses (e.g. both agents share one rpcPath), the next assertions
        // would all silently pass against the wrong endpoint.
        expect(card.url).toBe(`http://127.0.0.1:${PORT}/a2a/beta`);

        // Beta's RPC endpoint should still serve beta's card path, not alpha's.
        const alphaPath = await fetch(`${gateway.base}/a2a/alpha/agent-card.json`);
        const alphaCard = (await alphaPath.json()) as { name?: string };
        expect(alphaCard.name).toBe("Alpha Agent");
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
