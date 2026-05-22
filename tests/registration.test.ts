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

type CapturedHttpRoute = {
    path: string;
    auth?: string;
};

type CapturedService = {
    id: string;
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
    registrationMode?:
        | "full"
        | "tool-discovery"
        | "cli-metadata"
        | "discovery"
        | "setup-only"
        | "setup-runtime";
}) {
    const tools: Array<{ name: string }> = [];
    type ToolFactory = (ctx: { agentId?: string }) => { name: string } | null | undefined;
    const toolFactories: ToolFactory[] = [];
    const cliRegistrations: CapturedCliRegistration[] = [];
    const reloadRegistrations: CapturedReloadRegistration[] = [];
    const httpRoutes: CapturedHttpRoute[] = [];
    const services: CapturedService[] = [];
    const mode = options?.registrationMode ?? "full";

    const needsRuntime = mode === "full" || mode === "tool-discovery";

    return {
        tools,
        toolFactories,
        cliRegistrations,
        reloadRegistrations,
        httpRoutes,
        services,
        api: {
            id: "a2a",
            name: "A2A Protocol",
            source: "test",
            registrationMode: mode,
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
            runtime: needsRuntime
                ? {
                      state: {
                          resolveStateDir: () => "/tmp",
                      },
                      config: {
                          loadConfig: () => ({}),
                          writeConfigFile: async () => {},
                      },
                  }
                : ({} as Record<string, never>),
            logger: {
                info() {},
                warn() {},
                error() {},
                debug() {},
            },
            registerTool(tool: { name: string } | ToolFactory) {
                // Plugin-owned tools may be factories resolved per calling agent.
                if (typeof tool === "function") {
                    toolFactories.push(tool);
                    const resolved = tool({ agentId: "main" });
                    if (resolved) {
                        tools.push(resolved);
                    }
                    return;
                }
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
            registerHttpRoute(route: CapturedHttpRoute) {
                httpRoutes.push({ path: route.path, auth: route.auth });
            },
            registerChannel() {},
            registerGatewayMethod() {},
            registerService(service: CapturedService) {
                services.push({ id: service.id });
            },
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

    test("registers single-agent HTTP routes on the default paths", () => {
        const { api, httpRoutes } = createApi();

        plugin.register(api as never);

        expect(httpRoutes.map((route) => route.path).sort()).toEqual([
            "/.well-known/agent-card.json",
            "/a2a",
        ]);
        for (const route of httpRoutes) {
            expect(route.auth).toBe("plugin");
        }
    });

    test("registers per-agent HTTP routes when inbound.agents is configured", () => {
        const { api, httpRoutes } = createApi({
            pluginConfig: {
                inbound: {
                    apiKeys: [{ label: "test", key: "secret" }],
                    agents: {
                        swe: { agentCard: { name: "SWE" } },
                        pmo: { agentCard: { name: "PMO" } },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(httpRoutes.map((route) => route.path).sort()).toEqual([
            "/a2a/pmo",
            "/a2a/pmo/agent-card.json",
            "/a2a/swe",
            "/a2a/swe/agent-card.json",
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

    test("marks per-agent card writes as no-op reloads in multi-agent mode", () => {
        const { api, reloadRegistrations } = createApi({
            pluginConfig: {
                inbound: {
                    apiKeys: [{ label: "test", key: "secret" }],
                    agents: {
                        swe: { agentCard: { name: "SWE" } },
                        pmo: { agentCard: { name: "PMO" } },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(reloadRegistrations).toEqual([
            {
                noopPrefixes: [
                    "plugins.entries.a2a.config.inbound.agentCard",
                    "plugins.entries.a2a.config.inbound.agents.swe.agentCard",
                    "plugins.entries.a2a.config.inbound.agents.pmo.agentCard",
                ],
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

describe("OpenClaw registration mode compatibility", () => {
    test("cli-metadata mode registers CLI without accessing runtime", () => {
        const { api, cliRegistrations, tools } = createApi({
            registrationMode: "cli-metadata",
        });

        plugin.register(api as never);

        expect(cliRegistrations).toHaveLength(1);
        expect(cliRegistrations[0]?.opts?.descriptors).toEqual([
            {
                name: "a2a",
                description: "Manage A2A plugin keys and local configuration",
                hasSubcommands: true,
            },
        ]);
        expect(tools).toHaveLength(0);
    });

    test("cli-metadata mode with outbound config does not register tools", () => {
        const { api, tools, cliRegistrations } = createApi({
            registrationMode: "cli-metadata",
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

        expect(tools).toHaveLength(0);
        expect(cliRegistrations).toHaveLength(1);
    });

    test("tool-discovery mode registers outbound tools without HTTP routes or services", () => {
        const { api, tools, httpRoutes, services, cliRegistrations, reloadRegistrations } =
            createApi({
                registrationMode: "tool-discovery",
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
        expect(cliRegistrations).toHaveLength(1);
        expect(httpRoutes).toHaveLength(0);
        expect(services).toHaveLength(0);
        expect(reloadRegistrations).toHaveLength(0);
    });

    test("tool-discovery mode registers update_agent_card when inbound is configured", () => {
        const { api, tools } = createApi({
            registrationMode: "tool-discovery",
            pluginConfig: {
                inbound: {
                    apiKeys: [{ label: "test", key: "secret" }],
                },
            },
        });

        plugin.register(api as never);

        expect(tools.map((tool) => tool.name)).toContain("a2a_update_agent_card");
    });

    test("update_agent_card resolves to the calling agent in multi-agent mode", () => {
        const { api, toolFactories } = createApi({
            pluginConfig: {
                inbound: {
                    apiKeys: [{ label: "test", key: "secret" }],
                    agents: {
                        swe: { agentCard: { name: "SWE" } },
                        pmo: { agentCard: { name: "PMO" } },
                    },
                },
            },
        });

        plugin.register(api as never);

        expect(toolFactories).toHaveLength(1);
        const factory = toolFactories[0];
        // A configured agent gets the tool; others (and missing IDs) get nothing.
        expect(factory({ agentId: "swe" })?.name).toBe("a2a_update_agent_card");
        expect(factory({ agentId: "pmo" })?.name).toBe("a2a_update_agent_card");
        expect(factory({ agentId: "unknown" })).toBeNull();
        expect(factory({})).toBeNull();
    });

    test("discovery mode does not crash on empty runtime", () => {
        const { api } = createApi({
            registrationMode: "discovery",
        });

        expect(() => plugin.register(api as never)).not.toThrow();
    });

    test("setup-only mode does not crash on empty runtime", () => {
        const { api } = createApi({
            registrationMode: "setup-only",
        });

        expect(() => plugin.register(api as never)).not.toThrow();
    });
});
