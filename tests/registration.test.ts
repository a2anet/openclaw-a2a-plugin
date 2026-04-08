// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import plugin from "../src/index.js";

type CapturedCliRegistration = {
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
            registerCli(_registrar: unknown, opts?: CapturedCliRegistration["opts"]) {
                cliRegistrations.push({ opts });
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
});
