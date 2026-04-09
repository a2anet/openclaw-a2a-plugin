// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import * as path from "node:path";
import type {
    DataPart,
    Message,
    Part,
    Task,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
    TextPart,
} from "@a2a-js/sdk";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { type FileStore, LocalFileStore } from "@a2anet/a2a-utils";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import { resolveOutboundMediaUrls } from "openclaw/plugin-sdk/reply-payload";
import { resolveThreadSessionKeys } from "openclaw/plugin-sdk/routing";

const CHANNEL_ID = "a2a";
const ANONYMOUS_SENDER_LABEL = "anonymous";
const DEFAULT_CLIENT_ERROR_MESSAGE = "Something went wrong.";

type TaskExecutionState = {
    controller: AbortController;
    eventBus: ExecutionEventBus;
    contextId: string;
};

class AttachedFileRetrievalError extends Error {
    constructor(cause: unknown) {
        super("Attached file retrieval failed", { cause });
        this.name = "AttachedFileRetrievalError";
    }
}

export type OpenClawExecutorParams = {
    agentId: string;
    runtime: PluginRuntime;
    config: OpenClawConfig;
    fileStore?: FileStore | null;
    workspaceDir: string;
};

/**
 * Bridges inbound A2A protocol requests into OpenClaw's shared auto-reply pipeline.
 */
export class OpenClawExecutor implements AgentExecutor {
    private taskExecutions = new Map<string, TaskExecutionState>();
    private agentId: string;
    private runtime: PluginRuntime;
    private config: OpenClawConfig;
    private fileStore: FileStore | null;

    private static isAbortLikeError(err: unknown): boolean {
        if (!(err instanceof Error)) {
            return false;
        }
        if (err.name === "AbortError") {
            return true;
        }
        const message = err.message.toLowerCase();
        return (
            message.includes("aborted") ||
            message.includes("canceled") ||
            message.includes("cancelled")
        );
    }

    private static isTimeoutLikeError(err: unknown): boolean {
        if (!(err instanceof Error)) {
            return false;
        }
        if (err.name === "TimeoutError") {
            return true;
        }
        const message = err.message.toLowerCase();
        return message.includes("timed out") || message.includes("timeout");
    }

    private static toClientErrorMessage(err: unknown): string {
        if (err instanceof AttachedFileRetrievalError) {
            if (OpenClawExecutor.isAbortLikeError(err.cause)) {
                return "The request was canceled.";
            }
            if (OpenClawExecutor.isTimeoutLikeError(err.cause)) {
                return "The request timed out.";
            }
            return "The attached file could not be retrieved.";
        }
        if (OpenClawExecutor.isAbortLikeError(err)) {
            return "The request was canceled.";
        }
        if (OpenClawExecutor.isTimeoutLikeError(err)) {
            return "The request timed out.";
        }
        return DEFAULT_CLIENT_ERROR_MESSAGE;
    }

    constructor(params: OpenClawExecutorParams) {
        this.agentId = params.agentId;
        this.runtime = params.runtime;
        this.config = params.config;
        this.fileStore =
            params.fileStore === null
                ? null
                : (params.fileStore ??
                  new LocalFileStore(path.join(params.workspaceDir, "a2a", "inbound", "files")));
    }

    private publishFinalStatusUpdate(params: {
        eventBus: ExecutionEventBus;
        taskId: string;
        contextId: string;
        state: "completed" | "failed" | "canceled";
        message?: string;
    }) {
        const { eventBus, taskId, contextId, state, message } = params;
        const status = {
            state,
            timestamp: new Date().toISOString(),
            ...(message
                ? {
                      message: {
                          kind: "message" as const,
                          messageId: crypto.randomUUID(),
                          role: "agent" as const,
                          parts: [{ kind: "text" as const, text: message }],
                      },
                  }
                : {}),
        };

        eventBus.publish({
            kind: "status-update" as const,
            taskId,
            contextId,
            status,
            final: true,
        } satisfies TaskStatusUpdateEvent);
    }

    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        const { taskId, userMessage } = requestContext;
        const effectiveContextId = requestContext.contextId ?? crypto.randomUUID();
        const senderLabel = requestContext.context?.user?.userName ?? ANONYMOUS_SENDER_LABEL;
        const abortController = new AbortController();
        this.taskExecutions.set(taskId, {
            controller: abortController,
            eventBus,
            contextId: effectiveContextId,
        });

        const textSegments = userMessage.parts
            .filter((p: { kind: string }): p is TextPart => p.kind === "text")
            .map((p: TextPart) => p.text);

        const dataParts = userMessage.parts.filter(
            (p: { kind: string }): p is DataPart => p.kind === "data",
        );
        const hasFiles = userMessage.parts.some((p) => p.kind === "file");
        const hasUsableFileContext = hasFiles && this.fileStore !== null;
        if (
            textSegments.join("\n").trim().length === 0 &&
            dataParts.length === 0 &&
            !hasUsableFileContext
        ) {
            const errorMessage = {
                kind: "message" as const,
                messageId: crypto.randomUUID(),
                role: "agent" as const,
                parts: [{ kind: "text" as const, text: "No text content in message" }],
                contextId: effectiveContextId,
            } satisfies Message;
            eventBus.publish(errorMessage);
            eventBus.finished();
            this.taskExecutions.delete(taskId);
            return;
        }

        try {
            const initialTask = {
                kind: "task" as const,
                id: taskId,
                contextId: effectiveContextId,
                status: {
                    state: "working" as const,
                    timestamp: new Date().toISOString(),
                },
                history: [userMessage],
            } satisfies Task;
            eventBus.publish(initialTask);

            let gatewayText = textSegments.join("\n");

            if (dataParts.length > 0) {
                gatewayText += "\n\n<data>\n";
                for (const part of dataParts) {
                    gatewayText += `<item>\n${JSON.stringify(part.data, null, 2)}\n</item>\n`;
                }
                gatewayText += "</data>";
            }

            let savedFilePaths: string[] = [];
            if (this.fileStore && hasFiles) {
                try {
                    savedFilePaths = await this.fileStore.saveMessage(userMessage);
                } catch (err) {
                    throw new AttachedFileRetrievalError(err);
                }
            }

            if (savedFilePaths.length > 0) {
                gatewayText += "\n\n<files>\n";
                for (const filePath of savedFilePaths) {
                    gatewayText += `<file>${filePath}</file>\n`;
                }
                gatewayText += "</files>";
            }

            const baseSessionKey = this.runtime.channel.routing.buildAgentSessionKey({
                agentId: this.agentId,
                channel: CHANNEL_ID,
                peer: { kind: "direct", id: senderLabel },
                dmScope: "per-peer",
            });
            const { sessionKey, parentSessionKey } = resolveThreadSessionKeys({
                baseSessionKey,
                threadId: effectiveContextId,
                parentSessionKey: baseSessionKey,
            });

            const finalizedCtx = this.runtime.channel.reply.finalizeInboundContext({
                Body: gatewayText,
                BodyForAgent: gatewayText,
                RawBody: gatewayText,
                CommandBody: gatewayText,
                BodyForCommands: gatewayText,
                From: `a2a:${senderLabel}`,
                To: `a2a:${this.agentId}`,
                SessionKey: sessionKey,
                SenderId: `a2a:${senderLabel}`,
                SenderName: senderLabel,
                Provider: CHANNEL_ID,
                Surface: CHANNEL_ID,
                ChatType: "direct",
                ConversationLabel: effectiveContextId,
                MessageThreadId: effectiveContextId,
                ParentSessionKey: parentSessionKey,
                InputProvenance: { kind: "external_user", sourceChannel: CHANNEL_ID },
                ForceSenderIsOwnerFalse: true,
                Timestamp: Date.now(),
                CommandAuthorized: false,
            });
            const storePath = this.runtime.channel.session.resolveStorePath(
                this.config.session?.store,
                { agentId: this.agentId },
            );
            const artifactParts: Part[] = [];
            let dispatchError: unknown;

            await dispatchInboundReplyWithBase({
                cfg: this.config,
                channel: CHANNEL_ID,
                route: { agentId: this.agentId, sessionKey },
                storePath,
                ctxPayload: finalizedCtx,
                core: {
                    channel: {
                        session: this.runtime.channel.session,
                        reply: this.runtime.channel.reply,
                    },
                },
                deliver: async (payload: {
                    text?: string;
                    mediaUrls?: string[];
                    mediaUrl?: string;
                }) => {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    if (payload.text) {
                        artifactParts.push({ kind: "text", text: payload.text });
                    }
                    for (const url of resolveOutboundMediaUrls(payload)) {
                        artifactParts.push({
                            kind: "file",
                            file: { uri: url },
                        } as Part);
                    }
                },
                onRecordError: (err: unknown) => {
                    console.error(`[a2a] failed recording inbound session: ${String(err)}`);
                },
                onDispatchError: (err: unknown, info: { kind: string }) => {
                    dispatchError ??= err;
                    console.error(`[a2a] failed dispatching ${info.kind} reply: ${String(err)}`);
                },
                replyOptions: { abortSignal: abortController.signal },
            });

            if (abortController.signal.aborted) {
                return;
            }

            if (dispatchError) {
                throw dispatchError;
            }

            if (artifactParts.length === 0) {
                this.publishFinalStatusUpdate({
                    eventBus,
                    taskId,
                    contextId: effectiveContextId,
                    state: "failed",
                    message: DEFAULT_CLIENT_ERROR_MESSAGE,
                });
                eventBus.finished();
                return;
            }

            const artifactUpdate = {
                kind: "artifact-update" as const,
                taskId,
                contextId: effectiveContextId,
                artifact: {
                    artifactId: "response",
                    parts: artifactParts,
                },
            } satisfies TaskArtifactUpdateEvent;
            eventBus.publish(artifactUpdate);
            this.publishFinalStatusUpdate({
                eventBus,
                taskId,
                contextId: effectiveContextId,
                state: "completed",
            });
            eventBus.finished();
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }
            console.error(`[a2a] task ${taskId} failed`, err);
            this.publishFinalStatusUpdate({
                eventBus,
                taskId,
                contextId: effectiveContextId,
                state: "failed",
                message: OpenClawExecutor.toClientErrorMessage(err),
            });
            eventBus.finished();
        } finally {
            this.taskExecutions.delete(taskId);
        }
    }

    async cancelTask(taskId: string, eventBus?: ExecutionEventBus): Promise<void> {
        const executionState = this.taskExecutions.get(taskId);
        if (!executionState) {
            return;
        }

        executionState.controller.abort();

        const targetEventBus = executionState.eventBus ?? eventBus;
        this.publishFinalStatusUpdate({
            eventBus: targetEventBus,
            taskId,
            contextId: executionState.contextId,
            state: "canceled",
            message: "The request was canceled.",
        });
        targetEventBus.finished();
        this.taskExecutions.delete(taskId);
    }
}
