// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type {
    Message,
    Task,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
    TextPart,
} from "@a2a-js/sdk";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";

import type { GatewayCallResult } from "./gateway-call.js";

type GatewayCall = (params: {
    method: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
}) => Promise<GatewayCallResult>;

export type OpenClawExecutorParams = {
    agentId: string;
    callGateway: GatewayCall;
};

/**
 * Bridges inbound A2A protocol requests to OpenClaw's agent via gateway WebSocket RPC.
 */
export class OpenClawExecutor implements AgentExecutor {
    private abortControllers = new Map<string, AbortController>();
    private agentId: string;
    private callGateway: GatewayCall;

    constructor(params: OpenClawExecutorParams) {
        this.agentId = params.agentId;
        this.callGateway = params.callGateway;
    }

    execute = async (
        requestContext: RequestContext,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        const { taskId, userMessage } = requestContext;
        const effectiveContextId = requestContext.contextId ?? crypto.randomUUID();
        const abortController = new AbortController();
        this.abortControllers.set(taskId, abortController);
        const sessionKey = `agent:${this.agentId}:a2a:${effectiveContextId}`;

        const text = userMessage.parts
            .filter((p: { kind: string }): p is TextPart => p.kind === "text")
            .map((p: TextPart) => p.text)
            .join("\n");

        if (!text.trim()) {
            const errorMessage = {
                kind: "message" as const,
                messageId: crypto.randomUUID(),
                role: "agent" as const,
                parts: [{ kind: "text" as const, text: "No text content in message" }],
                contextId: effectiveContextId,
            } satisfies Message;
            eventBus.publish(errorMessage);
            eventBus.finished();
            this.abortControllers.delete(taskId);
            return;
        }

        try {
            const initialTask = {
                kind: "task" as const,
                id: taskId,
                contextId: effectiveContextId,
                status: { state: "working" as const, timestamp: new Date().toISOString() },
                history: [userMessage],
            } satisfies Task;
            eventBus.publish(initialTask);

            const result = await this.callGateway({
                method: "agent",
                params: {
                    message: text,
                    sessionKey,
                    agentId: this.agentId,
                    deliver: false,
                    idempotencyKey: crypto.randomUUID(),
                },
            });

            if (abortController.signal.aborted) {
                return;
            }

            if (!result.ok) {
                throw new Error(result.error ?? "Agent execution failed");
            }

            type AgentPayload = {
                status?: string;
                summary?: string;
                result?: {
                    payloads?: Array<{ text: string; mediaUrl?: string | null }>;
                };
            };
            const data = result.data as AgentPayload | undefined;

            if (data?.status === "error") {
                throw new Error(data.summary ?? "Agent execution failed");
            }

            const responseText =
                data?.result?.payloads
                    ?.map((p: { text: string }) => p.text)
                    .filter(Boolean)
                    .join("\n\n") || "No response";

            const artifactUpdate = {
                kind: "artifact-update" as const,
                taskId,
                contextId: effectiveContextId,
                artifact: {
                    artifactId: "response",
                    parts: [{ kind: "text" as const, text: responseText }],
                },
            } satisfies TaskArtifactUpdateEvent;
            eventBus.publish(artifactUpdate);

            const completedStatus = {
                kind: "status-update" as const,
                taskId,
                contextId: effectiveContextId,
                status: { state: "completed" as const, timestamp: new Date().toISOString() },
                final: true,
            } satisfies TaskStatusUpdateEvent;
            eventBus.publish(completedStatus);
            eventBus.finished();
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }
            const errorText = err instanceof Error ? err.message : String(err);

            const failedStatus = {
                kind: "status-update" as const,
                taskId,
                contextId: effectiveContextId,
                status: {
                    state: "failed" as const,
                    timestamp: new Date().toISOString(),
                    message: {
                        kind: "message" as const,
                        messageId: crypto.randomUUID(),
                        role: "agent" as const,
                        parts: [{ kind: "text" as const, text: errorText }],
                    },
                },
                final: true,
            } satisfies TaskStatusUpdateEvent;
            eventBus.publish(failedStatus);
            eventBus.finished();
        } finally {
            this.abortControllers.delete(taskId);
        }
    };

    cancelTask = async (taskId: string): Promise<void> => {
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(taskId);
        }
    };
}
