// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import type { DefaultRequestHandler } from "@a2a-js/sdk/server";

import { createA2AHttpHandlers } from "../../src/inbound/http-adapter.js";

function makeAgentCard(): AgentCard {
    return {
        name: "Test Agent",
        description: "A test agent",
        url: "https://example.com/a2a",
        protocolVersion: "0.3.0",
        version: "1.0.0",
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
        skills: [],
    };
}

function makeMockRequestHandler() {
    return {
        sendMessage: mock(async () => ({ id: "task-1", status: { state: "completed" } })),
        sendMessageStream: mock(async function* () {
            yield { kind: "status-update", status: { state: "completed" } };
        }),
        getTask: mock(async () => ({ id: "task-1", status: { state: "completed" } })),
        cancelTask: mock(async () => ({ id: "task-1", status: { state: "canceled" } })),
    } as unknown as DefaultRequestHandler;
}

function makeReq(
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    emitter.method = method;
    emitter.headers = headers ?? {};
    // Simulate body streaming
    if (body !== undefined) {
        process.nextTick(() => {
            const data = Buffer.from(JSON.stringify(body));
            emitter.emit("data", data);
            emitter.emit("end");
        });
    } else {
        process.nextTick(() => {
            emitter.emit("end");
        });
    }
    return emitter;
}

function makeRes() {
    let statusCode = 200;
    const headers: Record<string, string> = {};
    const chunks: string[] = [];
    let ended = false;

    const res = {
        get statusCode() {
            return statusCode;
        },
        set statusCode(code: number) {
            statusCode = code;
        },
        setHeader(name: string, value: string) {
            headers[name] = value;
        },
        flushHeaders() {},
        write(data: string) {
            chunks.push(data);
            return true;
        },
        end(data?: string) {
            if (data) {
                chunks.push(data);
            }
            ended = true;
        },
        getStatusCode: () => statusCode,
        getHeaders: () => headers,
        getBody: () => chunks.join(""),
        getJson: () => JSON.parse(chunks.join("")),
        isEnded: () => ended,
    } as unknown as ServerResponse & {
        getStatusCode: () => number;
        getHeaders: () => Record<string, string>;
        getBody: () => string;
        getJson: () => unknown;
        isEnded: () => boolean;
    };
    return res;
}

describe("handleAgentCard", () => {
    test("returns agent card as JSON", async () => {
        const card = makeAgentCard();
        const handlers = createA2AHttpHandlers({
            agentCard: card,
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("GET");
        const res = makeRes();
        await handlers.handleAgentCard(req, res);
        expect(res.getStatusCode()).toBe(200);
        expect(res.getJson()).toEqual(card);
    });
});

describe("handleJsonRpc", () => {
    test("rejects non-POST methods with 405", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("GET");
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(res.getStatusCode()).toBe(405);
        expect(res.getHeaders().Allow).toBe("POST");
    });

    test("rejects unauthenticated requests when auth required", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
            auth: { required: true, validKeys: [{ label: "test", key: "secret" }] },
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "message/send",
            params: { message: {} },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(res.getStatusCode()).toBe(401);
    });

    test("accepts authenticated requests", async () => {
        const handler = makeMockRequestHandler();
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
            auth: { required: true, validKeys: [{ label: "test", key: "secret" }] },
        });
        const req = makeReq(
            "POST",
            {
                jsonrpc: "2.0",
                id: 1,
                method: "message/send",
                params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } },
            },
            { authorization: "Bearer secret" },
        );
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(res.getStatusCode()).toBe(200);
        const body = res.getJson() as Record<string, unknown>;
        expect(body.jsonrpc).toBe("2.0");
        expect(body.result).toBeDefined();
    });

    test("rejects empty POST body with parse error", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST");
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number; message: string } };
        expect(body.error.code).toBe(-32700);
        expect(body.error.message).toContain("Empty request body");
    });

    test("rejects invalid JSON-RPC version", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST", { jsonrpc: "1.0", id: 1, method: "test" });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number } };
        expect(body.error.code).toBe(-32600);
    });

    test("rejects missing method", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST", { jsonrpc: "2.0", id: 1 });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number } };
        expect(body.error.code).toBe(-32600);
    });

    test("returns method not found for unknown method", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST", { jsonrpc: "2.0", id: 1, method: "unknown/method" });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number; message: string } };
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toContain("unknown/method");
    });

    test("routes message/send correctly", async () => {
        const handler = makeMockRequestHandler();
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "message/send",
            params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(handler.sendMessage).toHaveBeenCalledTimes(1);
    });

    test("rejects message/send without message param", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "message/send",
            params: {},
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number } };
        expect(body.error.code).toBe(-32602);
    });

    test("routes tasks/get correctly", async () => {
        const handler = makeMockRequestHandler();
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "tasks/get",
            params: { id: "task-1" },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(handler.getTask).toHaveBeenCalledTimes(1);
    });

    test("routes tasks/cancel correctly", async () => {
        const handler = makeMockRequestHandler();
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "tasks/cancel",
            params: { id: "task-1" },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(handler.cancelTask).toHaveBeenCalledTimes(1);
    });

    test("rejects tasks/get without id", async () => {
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: makeMockRequestHandler(),
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "tasks/get",
            params: {},
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number } };
        expect(body.error.code).toBe(-32602);
    });

    test("handles server errors gracefully", async () => {
        const handler = makeMockRequestHandler();
        (handler.sendMessage as ReturnType<typeof mock>).mockImplementation(async () => {
            throw new Error("Internal failure");
        });
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "message/send",
            params: { message: { role: "user", parts: [] } },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        const body = res.getJson() as { error: { code: number; message: string } };
        expect(body.error.code).toBe(-32000);
        expect(body.error.message).toContain("Internal failure");
    });

    test("message/stream sends SSE events", async () => {
        const handler = makeMockRequestHandler();
        const handlers = createA2AHttpHandlers({
            agentCard: makeAgentCard(),
            requestHandler: handler,
        });
        const req = makeReq("POST", {
            jsonrpc: "2.0",
            id: 1,
            method: "message/stream",
            params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } },
        });
        const res = makeRes();
        await handlers.handleJsonRpc(req, res);
        expect(res.getHeaders()["Content-Type"]).toContain("text/event-stream");
        expect(res.getBody()).toContain("data:");
        expect(res.getBody()).toContain("[DONE]");
    });
});
