// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Message } from "@a2a-js/sdk";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";

import { OpenClawExecutor } from "../../src/inbound/executor.js";

function makeMessage(text: string): Message {
    return {
        role: "user",
        messageId: crypto.randomUUID(),
        parts: [{ kind: "text", text }],
    };
}

function makeContext(overrides?: Partial<RequestContext>): RequestContext {
    return {
        taskId: "task-1",
        contextId: "ctx-1",
        userMessage: makeMessage("Hello"),
        ...overrides,
    } as RequestContext;
}

function makeEventBus() {
    const events: unknown[] = [];
    return {
        events,
        publish: mock((event: unknown) => {
            events.push(event);
        }),
        finished: mock(() => {}),
    } as unknown as ExecutionEventBus & { events: unknown[] };
}

function makeRuntime(options?: {
    onDispatch?: (params: Record<string, unknown>) => Promise<void>;
    sessionKey?: string;
    storePath?: string;
}) {
    const sessionKey = options?.sessionKey ?? "agent:main:a2a:direct:ctx-1";
    const storePath = options?.storePath ?? "/tmp/sessions.json";

    const buildAgentSessionKey = mock(() => sessionKey);
    const finalizeInboundContext = mock((ctx: Record<string, unknown>) => ctx);
    const recordInboundSession = mock(async () => undefined);
    const resolveStorePath = mock(() => storePath);
    const dispatchReplyWithBufferedBlockDispatcher = mock(
        async (params: Record<string, unknown>) => {
            if (options?.onDispatch) {
                await options.onDispatch(params);
                return;
            }
            const dispatcherOptions = params.dispatcherOptions as {
                deliver?: (payload: { text?: string }) => Promise<void>;
            };
            await dispatcherOptions.deliver?.({ text: "Hello back!" });
        },
    );

    return {
        runtime: {
            channel: {
                routing: {
                    buildAgentSessionKey,
                },
                reply: {
                    finalizeInboundContext,
                    dispatchReplyWithBufferedBlockDispatcher,
                },
                session: {
                    resolveStorePath,
                    recordInboundSession,
                },
            },
        } as const,
        mocks: {
            buildAgentSessionKey,
            finalizeInboundContext,
            recordInboundSession,
            resolveStorePath,
            dispatchReplyWithBufferedBlockDispatcher,
        },
    };
}

describe("OpenClawExecutor", () => {
    test("publishes artifact and completed status on success", async () => {
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(makeContext(), eventBus);

        expect(eventBus.events.length).toBe(3);
        expect((eventBus.events[0] as Record<string, unknown>).kind).toBe("task");
        expect((eventBus.events[1] as Record<string, unknown>).kind).toBe("artifact-update");
        expect((eventBus.events[2] as Record<string, unknown>).kind).toBe("status-update");
        expect((eventBus.events[2] as Record<string, { state: string }>).status.state).toBe(
            "completed",
        );
        expect(eventBus.finished).toHaveBeenCalledTimes(1);
        expect(runtime.mocks.buildAgentSessionKey).toHaveBeenCalledWith({
            agentId: "main",
            channel: "a2a",
            peer: { kind: "direct", id: "ctx-1" },
        });
        expect(runtime.mocks.recordInboundSession).toHaveBeenCalledTimes(1);
        const recordArgs = runtime.mocks.recordInboundSession.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(recordArgs.storePath).toBe("/tmp/sessions.json");
        expect(recordArgs.sessionKey).toBe("agent:main:a2a:direct:ctx-1");
        expect(recordArgs.ctx).toMatchObject({
            ForceSenderIsOwnerFalse: true,
            CommandAuthorized: false,
            InputProvenance: { kind: "external_user", sourceChannel: "a2a" },
            Provider: "a2a",
            Surface: "a2a",
        });
    });

    test("publishes error message for empty text", async () => {
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        const ctx = makeContext({
            userMessage: {
                role: "user",
                messageId: crypto.randomUUID(),
                parts: [{ kind: "text", text: "   " }],
            } as Message,
        });
        await executor.execute(ctx, eventBus);

        expect(eventBus.events.length).toBe(1);
        expect((eventBus.events[0] as Record<string, unknown>).kind).toBe("message");
        expect(runtime.mocks.buildAgentSessionKey).not.toHaveBeenCalled();
        expect(eventBus.finished).toHaveBeenCalledTimes(1);
    });

    test("publishes failed status when dispatch reports an error", async () => {
        const errorSpy = spyOn(console, "error").mockImplementation(() => {});
        try {
            const runtime = makeRuntime({
                onDispatch: async (params) => {
                    const dispatcherOptions = params.dispatcherOptions as {
                        onError?: (err: unknown, info: { kind: string }) => void;
                    };
                    dispatcherOptions.onError?.(new Error("Connection refused"), {
                        kind: "final",
                    });
                },
            });
            const executor = new OpenClawExecutor({
                agentId: "main",
                runtime: runtime.runtime as never,
                config: {} as never,
                workspaceDir: "/workspace",
            });
            const eventBus = makeEventBus();

            await executor.execute(makeContext(), eventBus);

            expect(eventBus.events.length).toBe(2);
            const failedEvent = eventBus.events[1] as Record<string, unknown>;
            expect(failedEvent.kind).toBe("status-update");
            const status = failedEvent.status as Record<string, unknown>;
            expect(status.state).toBe("failed");
            const msg = status.message as Record<string, unknown>;
            const parts = msg.parts as Array<{ text: string }>;
            expect(parts[0].text).toBe("Connection refused");
            expect(eventBus.finished).toHaveBeenCalledTimes(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    test("cancelTask aborts in-flight execution", async () => {
        let resolveDispatch!: () => void;
        const dispatchDone = new Promise<void>((resolve) => {
            resolveDispatch = resolve;
        });
        const runtime = makeRuntime({
            onDispatch: async () => {
                await dispatchDone;
            },
        });
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        const executePromise = executor.execute(makeContext(), eventBus);
        await executor.cancelTask("task-1");
        resolveDispatch();
        await executePromise;

        const kinds = eventBus.events.map((event) => (event as Record<string, unknown>).kind);
        expect(kinds).toContain("task");
        expect(kinds).not.toContain("status-update");
    });

    test("forwards an AbortSignal to the reply pipeline", async () => {
        let capturedSignal: AbortSignal | undefined;
        const runtime = makeRuntime({
            onDispatch: async (params) => {
                const replyOptions = params.replyOptions as
                    | { abortSignal?: AbortSignal }
                    | undefined;
                capturedSignal = replyOptions?.abortSignal;
                const dispatcherOptions = params.dispatcherOptions as {
                    deliver?: (payload: { text?: string }) => Promise<void>;
                };
                await dispatcherOptions.deliver?.({ text: "ok" });
            },
        });
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        const executePromise = executor.execute(makeContext(), eventBus);
        await executor.cancelTask("task-1");
        await executePromise;

        expect(capturedSignal).toBeInstanceOf(AbortSignal);
        expect(capturedSignal?.aborted).toBe(true);
    });

    test("generates contextId when not provided", async () => {
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(makeContext({ contextId: undefined }), eventBus);

        const taskEvent = eventBus.events[0] as Record<string, string>;
        expect(taskEvent.contextId).toBeTruthy();
        expect(runtime.mocks.buildAgentSessionKey).toHaveBeenCalledTimes(1);
    });

    test("concatenates multiple text parts into the inbound body", async () => {
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(
            makeContext({
                userMessage: {
                    role: "user",
                    messageId: crypto.randomUUID(),
                    parts: [
                        { kind: "text", text: "Part 1" },
                        { kind: "text", text: "Part 2" },
                    ],
                } as Message,
            }),
            eventBus,
        );

        const finalizedCtx = runtime.mocks.finalizeInboundContext.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(finalizedCtx.Body).toBe("Part 1\nPart 2");
        expect(finalizedCtx.BodyForAgent).toBe("Part 1\nPart 2");
    });

    test("includes data parts as XML tags", async () => {
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(
            makeContext({
                userMessage: {
                    role: "user",
                    messageId: crypto.randomUUID(),
                    parts: [
                        { kind: "text", text: "Process this data" },
                        { kind: "data", data: { key: "value" } },
                    ],
                } as Message,
            }),
            eventBus,
        );

        const finalizedCtx = runtime.mocks.finalizeInboundContext.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        const body = finalizedCtx.Body as string;
        expect(body).toContain("Process this data");
        expect(body).toContain("<data>");
        expect(body).toContain("<item>");
        expect(body).toContain('"key": "value"');
        expect(body).toContain("</item>");
        expect(body).toContain("</data>");
    });

    test("includes media URLs as file parts in the published artifact", async () => {
        const runtime = makeRuntime({
            onDispatch: async (params) => {
                const dispatcherOptions = params.dispatcherOptions as {
                    deliver?: (payload: {
                        text?: string;
                        mediaUrls?: string[];
                        mediaUrl?: string;
                    }) => Promise<void>;
                };
                await dispatcherOptions.deliver?.({
                    text: "Here are files",
                    mediaUrls: ["https://example.com/one.png", "https://example.com/two.png"],
                });
            },
        });
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(makeContext(), eventBus);

        const artifactEvent = eventBus.events[1] as Record<string, unknown>;
        expect(artifactEvent.kind).toBe("artifact-update");
        const artifact = artifactEvent.artifact as Record<string, unknown>;
        const parts = artifact.parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(3);
        expect(parts[0].kind).toBe("text");
        expect(parts[1].kind).toBe("file");
        expect(parts[2].kind).toBe("file");
        expect((parts[1].file as Record<string, unknown>).uri).toBe("https://example.com/one.png");
        expect((parts[2].file as Record<string, unknown>).uri).toBe("https://example.com/two.png");
    });

    test("falls back to legacy mediaUrl when mediaUrls is absent", async () => {
        const runtime = makeRuntime({
            onDispatch: async (params) => {
                const dispatcherOptions = params.dispatcherOptions as {
                    deliver?: (payload: {
                        text?: string;
                        mediaUrls?: string[];
                        mediaUrl?: string;
                    }) => Promise<void>;
                };
                await dispatcherOptions.deliver?.({
                    text: "Single legacy media",
                    mediaUrl: "https://example.com/legacy.png",
                });
            },
        });
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(makeContext(), eventBus);

        const artifactEvent = eventBus.events[1] as Record<string, unknown>;
        const artifact = artifactEvent.artifact as Record<string, unknown>;
        const parts = artifact.parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[1].kind).toBe("file");
        expect((parts[1].file as Record<string, unknown>).uri).toBe(
            "https://example.com/legacy.png",
        );
    });

    test("prefers mediaUrls and ignores legacy mediaUrl when both are present", async () => {
        const runtime = makeRuntime({
            onDispatch: async (params) => {
                const dispatcherOptions = params.dispatcherOptions as {
                    deliver?: (payload: {
                        text?: string;
                        mediaUrls?: string[];
                        mediaUrl?: string;
                    }) => Promise<void>;
                };
                await dispatcherOptions.deliver?.({
                    mediaUrls: ["https://example.com/preferred.png"],
                    mediaUrl: "https://example.com/preferred.png",
                });
            },
        });
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(makeContext(), eventBus);

        const artifactEvent = eventBus.events[1] as Record<string, unknown>;
        const artifact = artifactEvent.artifact as Record<string, unknown>;
        const parts = artifact.parts as Array<Record<string, unknown>>;
        // Only one file part — no duplicate from the legacy mediaUrl field.
        expect(parts).toHaveLength(1);
        expect(parts[0].kind).toBe("file");
        expect((parts[0].file as Record<string, unknown>).uri).toBe(
            "https://example.com/preferred.png",
        );
    });

    test("saves file parts via fileStore and includes saved paths in the inbound body", async () => {
        const savedMessages: Message[] = [];
        const mockFileStore = {
            saveMessage: mock(async (message: Message) => {
                savedMessages.push(message);
                return ["/tmp/saved/file.pdf"];
            }),
            getMessage: mock(async () => []),
            deleteMessage: mock(async () => {}),
            saveArtifact: mock(async () => []),
            getArtifact: mock(async () => []),
            deleteArtifact: mock(async () => {}),
        };
        const runtime = makeRuntime();
        const executor = new OpenClawExecutor({
            agentId: "main",
            runtime: runtime.runtime as never,
            config: {} as never,
            fileStore: mockFileStore,
            workspaceDir: "/workspace",
        });
        const eventBus = makeEventBus();

        await executor.execute(
            makeContext({
                userMessage: {
                    role: "user",
                    messageId: "msg-123",
                    parts: [
                        { kind: "text", text: "Here is a file" },
                        {
                            kind: "file",
                            file: {
                                name: "file.pdf",
                                mimeType: "application/pdf",
                                bytes: Buffer.from("content").toString("base64"),
                            },
                        },
                    ],
                } as Message,
            }),
            eventBus,
        );

        expect(savedMessages).toHaveLength(1);
        expect(mockFileStore.saveMessage).toHaveBeenCalledTimes(1);
        const finalizedCtx = runtime.mocks.finalizeInboundContext.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        const body = finalizedCtx.Body as string;
        expect(body).toContain("Here is a file");
        expect(body).toContain("<files>");
        expect(body).toContain("<file>");
        expect(body).toContain("/tmp/saved/file.pdf");
        expect(body).toContain("</files>");
    });
});
