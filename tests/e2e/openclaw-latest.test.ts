// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// End-to-end test that installs the latest `openclaw`, loads the locally-built
// plugin into it, starts the gateway, and exercises the A2A protocol surface
// over HTTP. The goal is to catch breakage from openclaw updates (plugin SDK,
// HTTP route registration, config schema, etc.) without needing an LLM in the
// loop — we assert on JSON-RPC envelope shape, not on agent reply content.
//
// Skipped unless `RUN_E2E=1` is set so it stays out of normal `bun test`. The
// nightly workflow at `.github/workflows/e2e-nightly.yml` runs it against
// `openclaw@latest`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Gateway, postJsonRpc, startGateway } from "./helpers.js";

const RUN = process.env.RUN_E2E === "1";
const describeE2E = RUN ? describe : describe.skip;

const PORT = 18789;

describeE2E("openclaw@latest + plugin — single-agent inbound (unauthenticated)", () => {
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port: PORT,
            pluginConfig: {
                inbound: {
                    allowUnauthenticated: true,
                    agentCard: {
                        name: "E2E Test Agent",
                        description: "Used by openclaw-a2a-plugin e2e tests",
                    },
                },
            },
        });
    }, 180_000);

    afterAll(async () => {
        await gateway?.stop();
    }, 30_000);

    test("GET /.well-known/agent-card.json returns a well-formed Agent Card with url pointing at /a2a", async () => {
        const res = await fetch(`${gateway.base}/.well-known/agent-card.json`);
        expect(res.status).toBe(200);
        const card = (await res.json()) as Record<string, unknown>;
        expect(typeof card.name).toBe("string");
        expect(typeof card.description).toBe("string");
        expect(card.url).toBe(`http://127.0.0.1:${PORT}/a2a`);
        expect(typeof card.version).toBe("string");
        expect(card.capabilities).toBeDefined();
        expect(Array.isArray(card.skills)).toBe(true);
    });

    // The contract we want clients to be able to rely on: discover the agent
    // by fetching its card, then send messages to the `url` field as-is — no
    // path rewriting on the client side. This test proves that contract by
    // routing a `message/send` through whatever the card claims its URL is.
    test("message/send addressed to the URL from the Agent Card reaches the agent", async () => {
        const cardRes = await fetch(`${gateway.base}/.well-known/agent-card.json`);
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
        // No LLM in the test env, so the lane settles either as a task
        // (which would then fail) or surfaces an error. Either is a valid
        // envelope.
        if (body.result) {
            expect(["task", "message"]).toContain(body.result.kind);
        } else {
            expect(body.error).toBeDefined();
        }
    }, 30_000);

    test("POST /a2a rejects malformed JSON with a JSON-RPC parse error", async () => {
        const res = await fetch(`${gateway.base}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{not json",
        });
        const body = (await res.json()) as { error?: { code?: number } };
        expect(body.error?.code).toBe(-32700);
    });

    // `message/send` blocks until the embedded agent settles — without an LLM
    // configured the lane fails after a few seconds, so allow generous headroom
    // and assert only on envelope shape.
    test("POST /a2a message/send returns a valid JSON-RPC envelope", async () => {
        const { status, json } = await postJsonRpc<{
            jsonrpc?: string;
            id?: string;
            result?: { kind?: string; id?: string };
            error?: unknown;
        }>(gateway.base, "/a2a", {
            jsonrpc: "2.0",
            id: "1",
            method: "message/send",
            params: {
                message: {
                    messageId: crypto.randomUUID(),
                    role: "user",
                    parts: [{ kind: "text", text: "ping" }],
                },
            },
        });
        expect(status).toBe(200);
        expect(json.jsonrpc).toBe("2.0");
        expect(json.id).toBe("1");
        if (json.result) {
            expect(["task", "message"]).toContain(json.result.kind);
        } else {
            expect(json.error).toBeDefined();
        }
    }, 30_000);

    test("POST /a2a tasks/get returns a JSON-RPC response for a non-existent task", async () => {
        const { status, json } = await postJsonRpc<{
            jsonrpc?: string;
            error?: unknown;
            result?: unknown;
        }>(gateway.base, "/a2a", {
            jsonrpc: "2.0",
            id: "2",
            method: "tasks/get",
            params: { id: "does-not-exist" },
        });
        expect(status).toBe(200);
        expect(json.jsonrpc).toBe("2.0");
        expect(json.error !== undefined || json.result !== undefined).toBe(true);
    });

    test("POST /a2a message/stream opens an SSE stream", async () => {
        const res = await fetch(`${gateway.base}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "3",
                method: "message/stream",
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
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no stream body");
        const { value } = await reader.read();
        await reader.cancel();
        const chunk = new TextDecoder().decode(value ?? new Uint8Array());
        expect(chunk).toContain("data:");
    }, 30_000);
});
