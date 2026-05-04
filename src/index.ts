// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

export const VERSION = "0.1.2"; // x-release-please-version

import type { AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler } from "@a2a-js/sdk/server";
import { JSONTaskStore, LocalFileStore } from "@a2anet/a2a-utils";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
    type A2AAgentCardConfig,
    type A2APluginConfig,
    buildRootConfigWithA2A,
    extractA2AEntry,
    parseA2APluginConfig,
} from "./config.js";
import { A2A_CHANNEL_ID, A2A_ROUTE, A2A_STORAGE_DIR } from "./constants.js";
import { AgentCardBuilder } from "./inbound/agent-card.js";
import { generateApiKey } from "./inbound/auth.js";
import { OpenClawExecutor } from "./inbound/executor.js";
import { type A2AAuthConfig, A2AHttpHandlers } from "./inbound/http-adapter.js";
import { createOutboundTools } from "./outbound/tools.js";
import { createUpdateAgentCardTool } from "./tools/update-agent-card.js";
import {
    assertUniqueA2AInboundKeyLabels,
    assertValidA2AInboundKeyLabel,
} from "./utils/inbound-key-label.js";

/**
 * Determine inbound auth configuration.
 */
function resolveInboundAuth(
    pluginConfig: A2APluginConfig,
    logger: OpenClawPluginApi["logger"],
): A2AAuthConfig | undefined {
    const inbound = pluginConfig.inbound;

    if (inbound?.allowUnauthenticated) {
        logger.info("[a2a] Inbound auth disabled (allowUnauthenticated: true)");
        return undefined;
    }

    if (inbound?.apiKeys && inbound.apiKeys.length > 0) {
        logger.info(`[a2a] Inbound auth enabled with ${inbound.apiKeys.length} key(s)`);
        return { required: true, validKeys: inbound.apiKeys };
    }

    logger.warn(
        "[a2a] No inbound API keys configured — the /a2a endpoint will reject all requests",
    );
    logger.warn(
        "[a2a] Run `openclaw a2a generate-key <label>` and restart the gateway to start receiving messages",
    );
    return { required: true, validKeys: [] };
}

const a2aPlugin = definePluginEntry({
    id: A2A_CHANNEL_ID,
    name: "A2A Protocol",
    description:
        "A2A protocol plugin for OpenClaw. Communicate with remote A2A agents and allow others to connect to your agent.",
    configSchema: {
        parse(value: unknown): A2APluginConfig {
            return parseA2APluginConfig(value);
        },
    },

    register(api: OpenClawPluginApi) {
        const pluginConfig = parseA2APluginConfig(api.pluginConfig);
        const stateDir = api.runtime.state.resolveStateDir();
        const workspaceDir = api.config.agents?.defaults?.workspace ?? process.cwd();

        // --- Outbound tools (via @a2anet/a2a-utils) ---
        const outbound = pluginConfig.outbound;
        if (outbound?.agents && Object.keys(outbound.agents).length > 0) {
            const tools = createOutboundTools({
                agents: outbound.agents,
                stateDir,
                workspaceDir,
                taskStore: outbound.taskStore,
                fileStore: outbound.fileStore,
                agentCardTimeout: outbound.agentCardTimeout,
                sendMessageTimeout: outbound.sendMessageTimeout,
                getTaskTimeout: outbound.getTaskTimeout,
                getTaskPollInterval: outbound.getTaskPollInterval,
                sendMessageCharacterLimit: outbound.sendMessageCharacterLimit,
                minimizedObjectStringLength: outbound.minimizedObjectStringLength,
                viewArtifactCharacterLimit: outbound.viewArtifactCharacterLimit,
            });
            for (const tool of tools) {
                api.registerTool(tool);
            }
            api.logger.info(
                `[a2a] Registered ${tools.length} outbound tools for ${Object.keys(outbound.agents).length} agent(s)`,
            );
        }

        // --- Inbound server ---
        const authConfig = resolveInboundAuth(pluginConfig, api.logger);
        const authRequired = authConfig?.required ?? false;

        // Lazy-initialized on first HTTP request (to determine public URL).
        // Uses a Promise lock to prevent concurrent initialization.
        let agentCard: AgentCard | null = null;
        let httpHandlers: A2AHttpHandlers | null = null;
        let initPromise: Promise<void> | null = null;
        let livePluginConfig = { ...pluginConfig };
        const buildAgentCard = (publicUrl: string) =>
            new AgentCardBuilder({
                openclawConfig: api.config,
                pluginConfig: livePluginConfig,
                publicUrl,
                authRequired,
            }).build();

        const initializeInbound = (publicUrl: string): Promise<void> => {
            if (agentCard) {
                return Promise.resolve();
            }
            if (initPromise) {
                return initPromise;
            }
            initPromise = Promise.resolve()
                .then(() => {
                    if (agentCard) {
                        return;
                    }

                    agentCard = buildAgentCard(publicUrl);

                    const taskStore = new JSONTaskStore(
                        `${stateDir}/${A2A_STORAGE_DIR}/inbound/tasks`,
                    );
                    const fileStore = new LocalFileStore(
                        `${workspaceDir}/${A2A_STORAGE_DIR}/inbound/files`,
                    );
                    const executor = new OpenClawExecutor({
                        agentId: "main",
                        runtime: api.runtime,
                        config: api.config,
                        fileStore,
                        workspaceDir,
                    });

                    const requestHandler = new DefaultRequestHandler(
                        agentCard,
                        taskStore,
                        executor,
                    );
                    httpHandlers = new A2AHttpHandlers({
                        agentCard,
                        getAgentCard: (req) => buildAgentCard(resolveRequestPublicUrl(req)),
                        requestHandler,
                        auth: authConfig,
                    });

                    api.logger.info(
                        `[a2a] Inbound server initialized: ${agentCard.name} at ${publicUrl}`,
                    );
                })
                .catch((err) => {
                    initPromise = null;
                    throw err;
                });
            return initPromise;
        };

        function resolveRequestPublicUrl(req: import("node:http").IncomingMessage): string {
            const forwardedHost = req.headers["x-forwarded-host"];
            const host =
                typeof forwardedHost === "string"
                    ? forwardedHost.split(",")[0].trim()
                    : req.headers.host || "localhost";
            const rawProto = req.headers["x-forwarded-proto"];
            const protocol =
                typeof rawProto === "string"
                    ? rawProto.split(",")[0].trim()
                    : (req.socket as import("node:tls").TLSSocket).encrypted
                      ? "https"
                      : "http";
            return `${protocol}://${host}`;
        }

        api.registerHttpRoute({
            path: "/.well-known/agent-card.json",
            auth: "plugin",
            handler: async (req, res) => {
                if (!httpHandlers) {
                    await initializeInbound(resolveRequestPublicUrl(req));
                }
                if (httpHandlers) {
                    await httpHandlers.handleAgentCard(req, res);
                }
            },
        });

        api.registerHttpRoute({
            path: A2A_ROUTE,
            auth: "plugin",
            handler: async (req, res) => {
                if (!httpHandlers) {
                    await initializeInbound(resolveRequestPublicUrl(req));
                }
                if (httpHandlers) {
                    await httpHandlers.handleJsonRpc(req, res);
                }
            },
        });

        // --- Update agent card tool (only when inbound is accepting requests) ---
        const inboundConfigured =
            pluginConfig.inbound?.allowUnauthenticated === true ||
            (pluginConfig.inbound?.apiKeys && pluginConfig.inbound.apiKeys.length > 0);

        if (inboundConfigured) {
            api.registerTool(
                createUpdateAgentCardTool({
                    loadConfig: async () =>
                        api.runtime.config.loadConfig() as Record<string, unknown>,
                    writeConfigFile: (cfg) =>
                        api.runtime.config.writeConfigFile(
                            cfg as import("openclaw/plugin-sdk").OpenClawConfig,
                        ),
                    updateLiveCard: (patch: Partial<A2AAgentCardConfig>) => {
                        if (!agentCard) {
                            return;
                        }
                        livePluginConfig = {
                            ...livePluginConfig,
                            inbound: {
                                ...livePluginConfig.inbound,
                                agentCard: {
                                    ...livePluginConfig.inbound?.agentCard,
                                    ...patch,
                                },
                            },
                        };
                        Object.assign(
                            agentCard,
                            buildAgentCard(agentCard.url.replace(new RegExp(`${A2A_ROUTE}$`), "")),
                        );
                    },
                }),
            );
        }

        api.registerReload({
            noopPrefixes: ["plugins.entries.a2a.config.inbound.agentCard"],
        });

        // --- CLI commands for key management ---
        api.registerCli(
            ({ program }) => {
                const a2a = program
                    .command(A2A_CHANNEL_ID)
                    .description("Manage A2A plugin keys and local configuration");

                a2a.command("generate-key [label]")
                    .description("Generate a new inbound API key for A2A authentication")
                    .action(async (label?: string) => {
                        const key = generateApiKey();
                        try {
                            const keyLabel = assertValidA2AInboundKeyLabel(
                                label?.trim() || `key-${Date.now()}`,
                            );
                            const currentConfig = api.runtime.config.loadConfig() as Record<
                                string,
                                unknown
                            >;
                            const { a2aConfig } = extractA2AEntry(currentConfig);
                            const existingInbound = parseA2APluginConfig(a2aConfig).inbound ?? {};
                            const existingKeys = existingInbound.apiKeys ?? [];
                            assertUniqueA2AInboundKeyLabels([
                                ...existingKeys,
                                { label: keyLabel, key },
                            ]);

                            await api.runtime.config.writeConfigFile(
                                buildRootConfigWithA2A(currentConfig, {
                                    inbound: {
                                        ...existingInbound,
                                        apiKeys: [...existingKeys, { label: keyLabel, key }],
                                    },
                                }) as import("openclaw/plugin-sdk").OpenClawConfig,
                            );
                            console.log(
                                `Generated API key "${keyLabel}": ${key}\n\nRestart the gateway to apply.`,
                            );
                        } catch (err) {
                            console.error(
                                `Failed to generate key: ${err instanceof Error ? err.message : String(err)}`,
                            );
                            process.exitCode = 1;
                        }
                    });

                a2a.command("list-keys")
                    .description("List configured inbound A2A API keys")
                    .action(() => {
                        try {
                            const currentConfig = api.runtime.config.loadConfig() as Record<
                                string,
                                unknown
                            >;
                            const { a2aConfig: rawA2AConfig } = extractA2AEntry(currentConfig);
                            const a2aConfig = parseA2APluginConfig(rawA2AConfig);
                            const keys = a2aConfig.inbound?.apiKeys ?? [];
                            if (keys.length === 0) {
                                console.log("No inbound API keys configured.");
                                return;
                            }
                            const maskKey = (k: string) =>
                                k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : "****";
                            const lines = keys.map((k) => `- ${k.label}: ${maskKey(k.key)}`);
                            console.log(`Inbound API keys:\n${lines.join("\n")}`);
                        } catch (err) {
                            console.error(
                                `Failed to list keys: ${err instanceof Error ? err.message : String(err)}`,
                            );
                            process.exitCode = 1;
                        }
                    });

                a2a.command("revoke-key <label>")
                    .description("Revoke an inbound A2A API key by label")
                    .action(async (label: string) => {
                        try {
                            const targetLabel = label.trim().toLowerCase();
                            const currentConfig = api.runtime.config.loadConfig() as Record<
                                string,
                                unknown
                            >;
                            const { a2aConfig } = extractA2AEntry(currentConfig);
                            const existingInbound = (a2aConfig.inbound ?? {}) as Record<
                                string,
                                unknown
                            >;
                            const existingKeys = Array.isArray(existingInbound.apiKeys)
                                ? existingInbound.apiKeys
                                : [];

                            const filtered = existingKeys.filter(
                                (k: Record<string, unknown>) =>
                                    typeof k.label !== "string" ||
                                    k.label.trim().toLowerCase() !== targetLabel,
                            );
                            if (filtered.length === existingKeys.length) {
                                console.log(`No key found with label "${label}".`);
                                process.exitCode = 1;
                                return;
                            }

                            await api.runtime.config.writeConfigFile(
                                buildRootConfigWithA2A(currentConfig, {
                                    inbound: {
                                        ...existingInbound,
                                        apiKeys: filtered.length > 0 ? filtered : undefined,
                                    },
                                }) as import("openclaw/plugin-sdk").OpenClawConfig,
                            );
                            console.log(`Revoked key "${label}". Restart the gateway to apply.`);
                        } catch (err) {
                            console.error(
                                `Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`,
                            );
                            process.exitCode = 1;
                        }
                    });
            },
            {
                descriptors: [
                    {
                        name: A2A_CHANNEL_ID,
                        description: "Manage A2A plugin keys and local configuration",
                        hasSubcommands: true,
                    },
                ],
            },
        );

        // --- Lifecycle service ---
        api.registerService({
            id: A2A_CHANNEL_ID,
            start: async () => {
                api.logger.info("[a2a] A2A service started");
            },
            stop: async () => {
                api.logger.info("[a2a] A2A service stopped");
                agentCard = null;
                httpHandlers = null;
                initPromise = null;
            },
        });

        api.logger.info("[a2a] Plugin registered successfully");
    },
});

export default a2aPlugin;
