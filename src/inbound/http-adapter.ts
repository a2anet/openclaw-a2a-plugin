// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import type { DefaultRequestHandler } from "@a2a-js/sdk/server";

import type { A2AInboundKey } from "../config.js";
import { sendAuthError, validateApiKey } from "./auth.js";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

async function readJsonBody(
    req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;

        const done = (result: { ok: true; value: unknown } | { ok: false; error: string }) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        req.on("data", (chunk: Buffer) => {
            if (settled) {
                return;
            }
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                done({ ok: false, error: "Request body too large" });
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => {
            try {
                const body = Buffer.concat(chunks).toString("utf8");
                if (!body.trim()) {
                    done({ ok: false, error: "Empty request body" });
                    return;
                }
                done({ ok: true, value: JSON.parse(body) });
            } catch {
                done({ ok: false, error: "Invalid JSON body" });
            }
        });

        req.on("error", (err) => {
            done({ ok: false, error: err.message });
        });
    });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

function sendJsonRpcError(res: ServerResponse, id: unknown, code: number, message: string) {
    sendJson(res, 200, {
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code, message },
    });
}

function setSseHeaders(res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
}

export type A2AAuthConfig = {
    required: boolean;
    validKeys: A2AInboundKey[];
};

export type A2AHttpHandlerParams = {
    agentCard: AgentCard;
    requestHandler: DefaultRequestHandler;
    auth?: A2AAuthConfig;
};

/**
 * Create HTTP handlers for A2A protocol endpoints.
 */
export function createA2AHttpHandlers(params: A2AHttpHandlerParams) {
    const { agentCard, requestHandler, auth } = params;

    async function handleAgentCard(_req: IncomingMessage, res: ServerResponse): Promise<void> {
        sendJson(res, 200, agentCard);
    }

    async function handleJsonRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
        }

        if (auth?.required) {
            const result = validateApiKey(req, auth.validKeys);
            if (!result.ok) {
                sendAuthError(res, "Authentication required");
                return;
            }
        }

        const bodyResult = await readJsonBody(req);
        if (!bodyResult.ok) {
            sendJsonRpcError(res, null, -32700, bodyResult.error);
            return;
        }

        const body = bodyResult.value as Record<string, unknown>;
        const id = body.id;
        const method = body.method;
        const bodyParams = body.params as Record<string, unknown> | undefined;

        if (body.jsonrpc !== "2.0") {
            sendJsonRpcError(res, id, -32600, "Invalid Request: jsonrpc must be 2.0");
            return;
        }

        if (typeof method !== "string") {
            sendJsonRpcError(res, id, -32600, "Invalid Request: method must be a string");
            return;
        }

        try {
            switch (method) {
                case "message/send": {
                    const message = bodyParams?.message;
                    if (!message || typeof message !== "object") {
                        sendJsonRpcError(res, id, -32602, "Invalid params: message required");
                        return;
                    }
                    const sendParams = { ...bodyParams } as unknown as Parameters<
                        typeof requestHandler.sendMessage
                    >[0];
                    const result = await requestHandler.sendMessage(sendParams);
                    sendJson(res, 200, { jsonrpc: "2.0", id, result });
                    break;
                }

                case "message/stream": {
                    const message = bodyParams?.message;
                    if (!message || typeof message !== "object") {
                        sendJsonRpcError(res, id, -32602, "Invalid params: message required");
                        return;
                    }
                    setSseHeaders(res);
                    const streamParams = { ...bodyParams } as unknown as Parameters<
                        typeof requestHandler.sendMessageStream
                    >[0];
                    const stream = await requestHandler.sendMessageStream(streamParams);
                    for await (const event of stream) {
                        res.write(`data: ${JSON.stringify(event)}\n\n`);
                    }
                    res.write("data: [DONE]\n\n");
                    res.end();
                    break;
                }

                case "tasks/get": {
                    const taskId = bodyParams?.id ?? bodyParams?.taskId;
                    if (typeof taskId !== "string") {
                        sendJsonRpcError(res, id, -32602, "Invalid params: id required");
                        return;
                    }
                    const result = await requestHandler.getTask({
                        id: taskId,
                        historyLength:
                            typeof bodyParams?.historyLength === "number"
                                ? bodyParams.historyLength
                                : undefined,
                    });
                    sendJson(res, 200, { jsonrpc: "2.0", id, result });
                    break;
                }

                case "tasks/cancel": {
                    const taskId = bodyParams?.id ?? bodyParams?.taskId;
                    if (typeof taskId !== "string") {
                        sendJsonRpcError(res, id, -32602, "Invalid params: id required");
                        return;
                    }
                    const result = await requestHandler.cancelTask({ id: taskId });
                    sendJson(res, 200, { jsonrpc: "2.0", id, result });
                    break;
                }

                default:
                    sendJsonRpcError(res, id, -32601, `Method not found: ${method}`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sendJsonRpcError(res, id, -32000, `Server error: ${message}`);
        }
    }

    return { handleAgentCard, handleJsonRpc };
}
