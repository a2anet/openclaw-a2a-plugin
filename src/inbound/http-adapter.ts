// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentCard } from "@a2a-js/sdk";
import type { A2ARequestHandler } from "@a2a-js/sdk/server";
import { JsonRpcTransportHandler } from "@a2a-js/sdk/server";

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

function setSseHeaders(res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
}

export type A2AAuthConfig = {
    required: boolean;
    validKeys: A2AInboundKey[];
};

export type A2AHttpHandlerParams = {
    agentCard: AgentCard;
    getAgentCard?: (req: IncomingMessage) => AgentCard;
    requestHandler: A2ARequestHandler;
    auth?: A2AAuthConfig;
};

/**
 * Create HTTP handlers for A2A protocol endpoints.
 */
export function createA2AHttpHandlers(params: A2AHttpHandlerParams) {
    const { agentCard, getAgentCard, requestHandler, auth } = params;
    const transportHandler = new JsonRpcTransportHandler(requestHandler);

    async function handleAgentCard(req: IncomingMessage, res: ServerResponse): Promise<void> {
        sendJson(res, 200, getAgentCard?.(req) ?? agentCard);
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
            sendJson(res, 400, {
                jsonrpc: "2.0",
                id: null,
                error: { code: -32700, message: bodyResult.error },
            });
            return;
        }

        const rpcResponseOrStream = await transportHandler.handle(bodyResult.value);

        if (typeof (rpcResponseOrStream as AsyncGenerator)?.[Symbol.asyncIterator] === "function") {
            const stream = rpcResponseOrStream as AsyncGenerator<unknown, void, undefined>;
            setSseHeaders(res);
            try {
                for await (const event of stream) {
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                }
            } catch (err) {
                console.error("Error during SSE streaming:", err);
            } finally {
                if (!res.writableEnded) {
                    res.end();
                }
            }
        } else {
            sendJson(res, 200, rpcResponseOrStream);
        }
    }

    return { handleAgentCard, handleJsonRpc };
}
