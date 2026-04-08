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

const CHANNEL_ID = "a2a";

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
    private abortControllers = new Map<string, AbortController>();
    private agentId: string;
    private runtime: PluginRuntime;
    private config: OpenClawConfig;
    private fileStore: FileStore | null;

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

    execute = async (
        requestContext: RequestContext,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        const { taskId, userMessage } = requestContext;
        const effectiveContextId = requestContext.contextId ?? crypto.randomUUID();
        const abortController = new AbortController();
        this.abortControllers.set(taskId, abortController);

        const textSegments = userMessage.parts
            .filter((p: { kind: string }): p is TextPart => p.kind === "text")
            .map((p: TextPart) => p.text);

        const dataParts = userMessage.parts.filter(
            (p: { kind: string }): p is DataPart => p.kind === "data",
        );

        let savedFilePaths: string[] = [];
        const hasFiles = userMessage.parts.some((p) => p.kind === "file");
        if (this.fileStore && hasFiles) {
            savedFilePaths = await this.fileStore.saveMessage(userMessage);
        }

        let gatewayText = textSegments.join("\n");

        if (dataParts.length > 0) {
            gatewayText += "\n\n<data>\n";
            for (const part of dataParts) {
                gatewayText += `<item>\n${JSON.stringify(part.data, null, 2)}\n</item>\n`;
            }
            gatewayText += "</data>";
        }

        if (savedFilePaths.length > 0) {
            gatewayText += "\n\n<files>\n";
            for (const filePath of savedFilePaths) {
                gatewayText += `<file>${filePath}</file>\n`;
            }
            gatewayText += "</files>";
        }

        if (!gatewayText.trim()) {
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
            const sessionKey = this.runtime.channel.routing.buildAgentSessionKey({
                agentId: this.agentId,
                channel: CHANNEL_ID,
                peer: { kind: "direct", id: effectiveContextId },
            });
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

            const finalizedCtx = this.runtime.channel.reply.finalizeInboundContext({
                Body: gatewayText,
                BodyForAgent: gatewayText,
                RawBody: gatewayText,
                CommandBody: gatewayText,
                BodyForCommands: gatewayText,
                From: `a2a:${effectiveContextId}`,
                To: `a2a:${this.agentId}`,
                SessionKey: sessionKey,
                SenderId: `a2a:${effectiveContextId}`,
                SenderName: "Remote A2A Agent",
                Provider: CHANNEL_ID,
                Surface: CHANNEL_ID,
                ChatType: "direct",
                ConversationLabel: effectiveContextId,
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
                artifactParts.push({ kind: "text" as const, text: "No response" });
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

            const completedStatus = {
                kind: "status-update" as const,
                taskId,
                contextId: effectiveContextId,
                status: {
                    state: "completed" as const,
                    timestamp: new Date().toISOString(),
                },
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
