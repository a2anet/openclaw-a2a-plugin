// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export type GatewayCallResult<T = Record<string, unknown>> = {
    ok: boolean;
    data?: T;
    error?: string;
};

/**
 * Minimal WebSocket-based gateway call for internal plugin use.
 * Connects to the local OpenClaw gateway, performs the connect handshake,
 * makes a single method request, and returns the response.
 */
export async function callGateway<T = Record<string, unknown>>(params: {
    method: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
    url?: string;
    token?: string;
}): Promise<GatewayCallResult<T>> {
    const { method, params: methodParams, timeoutMs = 60_000, url, token } = params;
    const gatewayUrl = url || process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";
    const gatewayToken = token || process.env.OPENCLAW_GATEWAY_TOKEN || "";

    return new Promise((resolve) => {
        let settled = false;
        let ws: WebSocket | null = null;

        const cleanup = () => {
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // ignore
                }
                ws = null;
            }
        };

        const done = (result: GatewayCallResult<T>) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(result);
        };

        const timer = setTimeout(() => {
            done({ ok: false, error: `Gateway timeout after ${timeoutMs}ms` });
        }, timeoutMs);

        ws = new WebSocket(gatewayUrl);

        ws.on("open", () => {
            if (settled || !ws) {
                return;
            }
            const connectId = randomUUID();
            ws.send(
                JSON.stringify({
                    type: "req",
                    id: connectId,
                    method: "connect",
                    params: {
                        minProtocol: 3,
                        maxProtocol: 3,
                        client: {
                            id: "gateway-client",
                            version: "1.0.0",
                            platform: "node",
                            mode: "backend",
                        },
                        auth: gatewayToken ? { token: gatewayToken } : undefined,
                        role: "operator",
                        scopes: ["operator.read", "operator.write", "operator.admin"],
                    },
                }),
            );
        });

        ws.on("message", (data: Buffer | string) => {
            if (settled || !ws) {
                return;
            }
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === "event") {
                    return;
                }

                if (msg.type === "res") {
                    const payload = msg.payload;

                    if (!msg.ok) {
                        const errMsg =
                            typeof msg.error === "string"
                                ? msg.error
                                : (msg.error?.message ?? "Request failed");
                        done({ ok: false, error: errMsg });
                        return;
                    }

                    // hello-ok — connection established, send the method request
                    if (payload?.type === "hello-ok") {
                        const requestId = randomUUID();
                        ws.send(
                            JSON.stringify({
                                type: "req",
                                id: requestId,
                                method,
                                params: methodParams,
                            }),
                        );
                        return;
                    }

                    // "accepted" ack — wait for final result
                    if (payload?.status === "accepted") {
                        return;
                    }

                    // Final result
                    done({ ok: true, data: payload as T });
                }
            } catch {
                // ignore parse errors
            }
        });

        ws.on("error", (err) => {
            done({ ok: false, error: `WebSocket error: ${err.message}` });
        });

        ws.on("close", (code, reason) => {
            if (!settled) {
                done({
                    ok: false,
                    error: `Gateway connection closed (${code}): ${reason?.toString() || "no reason"}`,
                });
            }
        });
    });
}
