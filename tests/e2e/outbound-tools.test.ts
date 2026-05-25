// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// Outbound + tools e2e: configure outbound to point at our own inbound (a
// self-loop) and exercise the LLM-free tools through openclaw's
// `POST /tools/invoke` HTTP endpoint. This verifies that:
//   1. The plugin registers tools with openclaw's tool registry (we can list
//      and invoke them by name).
//   2. The outbound `A2AAgents` client can fetch a remote Agent Card —
//      because the remote here is us, it round-trips through both sides of
//      the plugin.
//
// We don't drive `a2a_send_message` because that would block on a reply from
// the embedded agent, which has no LLM configured in the test env.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Gateway, postJsonRpc, startGateway } from "./helpers.js";

const RUN = process.env.RUN_E2E === "1";
const describeE2E = RUN ? describe : describe.skip;

type ToolInvokeResult = {
    ok: boolean;
    result?: unknown;
    error?: { type?: string; message?: string };
};

describeE2E("openclaw@latest + plugin — outbound tools via /tools/invoke (self-loop)", () => {
    const port = 18792;
    let gateway: Gateway;

    beforeAll(async () => {
        gateway = await startGateway({
            port,
            pluginConfig: {
                inbound: {
                    allowUnauthenticated: true,
                    agentCard: {
                        name: "Self-Loop Agent",
                        description:
                            "Both the inbound target and the outbound destination for tool tests",
                    },
                },
                outbound: {
                    agents: {
                        self: {
                            url: `http://127.0.0.1:${port}/.well-known/agent-card.json`,
                        },
                    },
                    // Disable persistent stores so the test doesn't litter $HOME.
                    taskStore: false,
                    fileStore: false,
                },
            },
        });
    }, 180_000);

    afterAll(async () => {
        await gateway?.stop();
    }, 30_000);

    test("a2a_get_agents lists the configured self-loop agent", async () => {
        const { status, json } = await postJsonRpc<ToolInvokeResult>(
            gateway.base,
            "/tools/invoke",
            { name: "a2a_get_agents", args: {} },
        );
        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        // a2a-utils returns either an agent map or `{ agents, errors }` on
        // partial failure. Accept either shape; just assert "self" is mentioned.
        const serialized = JSON.stringify(json.result);
        expect(serialized).toContain("self");
    });

    test("a2a_get_agent fetches the self-loop agent's card", async () => {
        const { status, json } = await postJsonRpc<ToolInvokeResult>(
            gateway.base,
            "/tools/invoke",
            { name: "a2a_get_agent", args: { agentId: "self" } },
        );
        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        const serialized = JSON.stringify(json.result);
        expect(serialized).toContain("Self-Loop Agent");
    });

    test("a2a_get_agent for an unknown agent returns a structured error", async () => {
        const { status, json } = await postJsonRpc<ToolInvokeResult>(
            gateway.base,
            "/tools/invoke",
            { name: "a2a_get_agent", args: { agentId: "nope" } },
        );
        // Tools handle their own "not found" by returning an error object in
        // `result`, not by surfacing it as a transport error.
        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        const serialized = JSON.stringify(json.result);
        expect(serialized).toMatch(/not found|error/i);
    });

    test("invoking an unknown tool returns 404", async () => {
        const { status, json } = await postJsonRpc<ToolInvokeResult>(
            gateway.base,
            "/tools/invoke",
            { name: "a2a_does_not_exist", args: {} },
        );
        expect(status).toBe(404);
        expect(json.ok).toBe(false);
        expect(json.error?.type).toBe("not_found");
    });
});
