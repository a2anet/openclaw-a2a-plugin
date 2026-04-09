// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, spyOn, test } from "bun:test";

import plugin from "../src/index.js";

type CapturedCliRegistration = {
    registrar?: (params: { program: FakeCommand }) => void;
    opts?: {
        commands?: string[];
        descriptors?: Array<{
            name: string;
            description: string;
            hasSubcommands?: boolean;
        }>;
    };
};

type CapturedReloadRegistration = {
    restartPrefixes?: string[];
    hotPrefixes?: string[];
    noopPrefixes?: string[];
};

class FakeCommand {
    subcommands = new Map<string, FakeCommand>();
    actionHandler?: (...args: string[]) => unknown | Promise<unknown>;

    constructor(readonly name = "root") {}

    command(spec: string) {
        const commandName = spec.split(" ")[0] ?? spec;
        const command = new FakeCommand(commandName);
        this.subcommands.set(commandName, command);
        return command;
    }

    description(_text: string) {
        return this;
    }

    action(handler: (...args: string[]) => unknown | Promise<unknown>) {
        this.actionHandler = handler;
        return this;
    }
}

function createApi(options?: {
    pluginConfig?: Record<string, unknown>;
    config?: Record<string, unknown>;
}) {
    const tools: Array<{ name: string }> = [];
    const cliRegistrations: CapturedCliRegistration[] = [];
    const reloadRegistrations: CapturedReloadRegistration[] = [];

    return {
        tools,
        cliRegistrations,
        reloadRegistrations,
        api: {
            id: "a2a",
            name: "A2A Protocol",
            source: "test",
            registrationMode: "full" as const,
            pluginConfig: options?.pluginConfig ?? {},
            config:
                options?.config ??
                ({
                    agents: {
                        defaults: {
                            workspace: "/tmp",
                        },
                    },
                } satisfies Record<string, unknown>),
            runtime: {
                state: {
                    resolveStateDir: () => "/tmp",
                },
                config: {
                    loadConfig: () => ({}),
                    writeConfigFile: async () => {},
                },
            },
            logger: {
                info() {},
                warn() {},
                error() {},
                debug() {},
            },
            registerTool(tool: { name: string }) {
                tools.push(tool);
            },
            registerCli(
                registrar: CapturedCliRegistration["registrar"],
                opts?: CapturedCliRegistration["opts"],
            ) {
                cliRegistrations.push({ registrar, opts });
            },
            registerReload(registration: CapturedReloadRegistration) {
                reloadRegistrations.push(registration);
            },
            registerHook() {},
            registerHttpRoute() {},
            registerChannel() {},
            registerGatewayMethod() {},
            registerService() {},
            registerNodeHostCommand() {},
            registerSecurityAuditCollector() {},
            registerConfigMigration() {},
            registerAutoEnableProbe() {},
            registerProvider() {},
            registerSpeechProvider() {},
            registerRealtimeTranscriptionProvider() {},
            registerRealtimeVoiceProvider() {},
            registerMediaUnderstandingProvider() {},
            registerImageGenerationProvider() {},
            registerMusicGenerationProvider() {},
            registerVideoGenerationProvider() {},
            registerWebFetchProvider() {},
            registerWebSearchProvider() {},
            registerInteractiveHandler() {},
            onConversationBindingResolved() {},
            registerCommand() {},
            registerContextEngine() {},
            registerMemoryPromptSection() {},
            registerMemoryPromptSupplement() {},
            registerMemoryCorpusSupplement() {},
            registerMemoryFlushPlan() {},
            registerMemoryRuntime() {},
            registerMemoryEmbeddingProvider() {},
            resolvePath(input: string) {
                return input;
            },
            on() {},
        },
    };
}

describe("plugin registration", () => {
    test("registers outbound tools with the current a2a-utils API shape", () => {
        const { api, tools } = createApi({
            pluginConfig: {
                outbound: {
                    agents: {
                        weather: {
                            url: "https://example.com/.well-known/agent-card.json",
                        },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(tools.map((tool) => tool.name)).toEqual([
            "a2a_get_agents",
            "a2a_get_agent",
            "a2a_send_message",
            "a2a_get_task",
            "a2a_view_text_artifact",
            "a2a_view_data_artifact",
        ]);
    });

    test("registers CLI metadata for the a2a root command", () => {
        const { api, cliRegistrations } = createApi();

        plugin.register(api as never);

        expect(cliRegistrations).toHaveLength(1);
        expect(cliRegistrations[0]?.opts?.descriptors).toEqual([
            {
                name: "a2a",
                description: "Manage A2A plugin keys and local configuration",
                hasSubcommands: true,
            },
        ]);
    });

    test("marks live agent-card config writes as no-op reloads", () => {
        const { api, reloadRegistrations } = createApi();

        plugin.register(api as never);

        expect(reloadRegistrations).toEqual([
            {
                noopPrefixes: ["plugins.entries.a2a.config.inbound.agentCard"],
            },
        ]);
    });

    test("revoke-key matches labels case-insensitively", async () => {
        const writeConfigFile = mock(async () => {});
        const { api, cliRegistrations } = createApi({
            config: {
                agents: {
                    defaults: {
                        workspace: "/tmp",
                    },
                },
            },
        });
        api.runtime.config.loadConfig = () => ({
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                apiKeys: [
                                    { label: "Alice", key: "secret-1" },
                                    { label: "Bob", key: "secret-2" },
                                ],
                            },
                        },
                    },
                },
            },
        });
        api.runtime.config.writeConfigFile = writeConfigFile;

        plugin.register(api as never);

        const program = new FakeCommand();
        cliRegistrations[0]?.registrar?.({ program });
        const revokeCommand = program.subcommands.get("a2a")?.subcommands.get("revoke-key");
        expect(revokeCommand?.actionHandler).toBeDefined();

        const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
        try {
            await revokeCommand?.actionHandler?.("alice");
        } finally {
            consoleLogSpy.mockRestore();
        }

        expect(writeConfigFile).toHaveBeenCalledTimes(1);
        expect(writeConfigFile.mock.calls[0]?.[0]).toEqual({
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                apiKeys: [{ label: "Bob", key: "secret-2" }],
                            },
                        },
                    },
                },
            },
        });
    });
});
