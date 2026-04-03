// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, test } from "bun:test";
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

describe("OpenClawExecutor", () => {
    test("publishes artifact and completed status on success", async () => {
        const callGateway = mock(async () => ({
            ok: true as const,
            data: {
                status: "done",
                result: { payloads: [{ text: "Hello back!" }] },
            },
        }));

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        await executor.execute(makeContext(), eventBus);

        // Should have: task (working), artifact-update, status-update (completed)
        expect(eventBus.events.length).toBe(3);
        expect((eventBus.events[0] as Record<string, unknown>).kind).toBe("task");
        expect((eventBus.events[1] as Record<string, unknown>).kind).toBe("artifact-update");
        expect((eventBus.events[2] as Record<string, unknown>).kind).toBe("status-update");

        const status = eventBus.events[2] as Record<string, { state: string }>;
        expect(status.status.state).toBe("completed");
        expect(eventBus.finished).toHaveBeenCalledTimes(1);
    });

    test("publishes error message for empty text", async () => {
        const callGateway = mock(async () => ({ ok: true as const }));
        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
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
        expect(callGateway).not.toHaveBeenCalled();
        expect(eventBus.finished).toHaveBeenCalledTimes(1);
    });

    test("publishes failed status with error message on gateway error", async () => {
        const callGateway = mock(async () => ({
            ok: false as const,
            error: "Connection refused",
        }));

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        await executor.execute(makeContext(), eventBus);

        // task (working) + status-update (failed)
        expect(eventBus.events.length).toBe(2);
        const failedEvent = eventBus.events[1] as Record<string, unknown>;
        expect(failedEvent.kind).toBe("status-update");
        const status = failedEvent.status as Record<string, unknown>;
        expect(status.state).toBe("failed");
        // Verify error text is included in the message
        const msg = status.message as Record<string, unknown>;
        expect(msg.role).toBe("agent");
        const parts = msg.parts as Array<{ text: string }>;
        expect(parts[0].text).toBe("Connection refused");
        expect(eventBus.finished).toHaveBeenCalledTimes(1);
    });

    test("publishes failed status on agent error payload", async () => {
        const callGateway = mock(async () => ({
            ok: true as const,
            data: { status: "error", summary: "Tool not found" },
        }));

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        await executor.execute(makeContext(), eventBus);

        const failedEvent = eventBus.events[1] as Record<string, unknown>;
        const status = failedEvent.status as Record<string, unknown>;
        expect(status.state).toBe("failed");
        const msg = status.message as Record<string, unknown>;
        const parts = msg.parts as Array<{ text: string }>;
        expect(parts[0].text).toBe("Tool not found");
    });

    test("cancelTask aborts in-flight execution", async () => {
        let resolveGateway!: (v: { ok: boolean }) => void;
        const callGateway = mock(
            () =>
                new Promise<{ ok: boolean }>((r) => {
                    resolveGateway = r;
                }),
        );

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();

        const executePromise = executor.execute(makeContext(), eventBus);
        await executor.cancelTask("task-1");
        resolveGateway({ ok: true });
        await executePromise;

        // After abort, only the initial task event should be published (no completed/failed)
        const kinds = eventBus.events.map((e) => (e as Record<string, unknown>).kind);
        expect(kinds).toContain("task");
        expect(kinds).not.toContain("status-update");
    });

    test("generates contextId when not provided", async () => {
        const callGateway = mock(async () => ({
            ok: true as const,
            data: { result: { payloads: [{ text: "OK" }] } },
        }));

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        const ctx = makeContext({ contextId: undefined });
        await executor.execute(ctx, eventBus);

        // contextId should be auto-generated (present on events)
        const taskEvent = eventBus.events[0] as Record<string, string>;
        expect(taskEvent.contextId).toBeTruthy();
    });

    test("concatenates multiple text parts", async () => {
        let capturedParams: Record<string, unknown> = {};
        const callGateway = mock(async (params: { params?: Record<string, unknown> }) => {
            capturedParams = params.params ?? {};
            return {
                ok: true as const,
                data: { result: { payloads: [{ text: "OK" }] } },
            };
        });

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        const ctx = makeContext({
            userMessage: {
                role: "user",
                messageId: crypto.randomUUID(),
                parts: [
                    { kind: "text", text: "Part 1" },
                    { kind: "text", text: "Part 2" },
                ],
            } as Message,
        });
        await executor.execute(ctx, eventBus);

        expect(capturedParams.message).toBe("Part 1\nPart 2");
    });

    test("includes data parts as XML tags", async () => {
        let capturedParams: Record<string, unknown> = {};
        const callGateway = mock(async (params: { params?: Record<string, unknown> }) => {
            capturedParams = params.params ?? {};
            return {
                ok: true as const,
                data: { result: { payloads: [{ text: "OK" }] } },
            };
        });

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        const ctx = makeContext({
            userMessage: {
                role: "user",
                messageId: crypto.randomUUID(),
                parts: [
                    { kind: "text", text: "Process this data" },
                    { kind: "data", data: { key: "value" } },
                ],
            } as Message,
        });
        await executor.execute(ctx, eventBus);

        const message = capturedParams.message as string;
        expect(message).toContain("Process this data");
        expect(message).toContain("<data>");
        expect(message).toContain("<item>");
        expect(message).toContain('"key": "value"');
        expect(message).toContain("</item>");
        expect(message).toContain("</data>");
    });

    test("includes mediaUrl as file parts in artifact", async () => {
        const callGateway = mock(async () => ({
            ok: true as const,
            data: {
                result: {
                    payloads: [
                        { text: "Here is an image", mediaUrl: "https://example.com/image.png" },
                    ],
                },
            },
        }));

        const executor = new OpenClawExecutor({ agentId: "main", callGateway });
        const eventBus = makeEventBus();
        await executor.execute(makeContext(), eventBus);

        const artifactEvent = eventBus.events[1] as Record<string, unknown>;
        expect(artifactEvent.kind).toBe("artifact-update");
        const artifact = artifactEvent.artifact as Record<string, unknown>;
        const parts = artifact.parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[0].kind).toBe("text");
        expect(parts[1].kind).toBe("file");
        const fileObj = parts[1].file as Record<string, unknown>;
        expect(fileObj.uri).toBe("https://example.com/image.png");
    });

    test("saves file parts via fileStore", async () => {
        const savedMessages: Message[] = [];
        const mockFileStore = {
            saveMessage: mock(async (msg: Message) => {
                savedMessages.push(msg);
                return ["/tmp/saved/file.pdf"];
            }),
            getMessage: mock(async () => []),
            deleteMessage: mock(async () => {}),
            saveArtifact: mock(async () => []),
            getArtifact: mock(async () => []),
            deleteArtifact: mock(async () => {}),
        };

        let capturedParams: Record<string, unknown> = {};
        const callGateway = mock(async (params: { params?: Record<string, unknown> }) => {
            capturedParams = params.params ?? {};
            return {
                ok: true as const,
                data: { result: { payloads: [{ text: "OK" }] } },
            };
        });

        const executor = new OpenClawExecutor({
            agentId: "main",
            callGateway,
            fileStore: mockFileStore,
        });
        const eventBus = makeEventBus();
        const ctx = makeContext({
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
        });
        await executor.execute(ctx, eventBus);

        expect(mockFileStore.saveMessage).toHaveBeenCalledTimes(1);
        const message = capturedParams.message as string;
        expect(message).toContain("Here is a file");
        expect(message).toContain("<files>");
        expect(message).toContain("<file>");
        expect(message).toContain("/tmp/saved/file.pdf");
        expect(message).toContain("</files>");
    });
});
