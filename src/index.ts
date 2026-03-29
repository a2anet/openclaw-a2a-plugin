// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

export const VERSION = "0.1.0"; // x-release-please-version

import type { AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
    type A2APluginConfig,
    buildRootConfigWithA2A,
    extractA2AEntry,
    parseA2APluginConfig,
} from "./config.js";
import { buildAgentCard } from "./inbound/agent-card.js";
import { generateApiKey } from "./inbound/auth.js";
import { OpenClawExecutor } from "./inbound/executor.js";
import { callGateway } from "./inbound/gateway-call.js";
import { type A2AAuthConfig, createA2AHttpHandlers } from "./inbound/http-adapter.js";
import { createOutboundTools } from "./outbound/tools.js";
import { createUpdateAgentCardTool } from "./tools/update-agent-card.js";

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

const a2aPlugin = {
    id: "a2a",
    name: "A2A Protocol",
    description:
        "A2A protocol plugin for OpenClaw. Communicate with remote A2A agents and allow others to connect to your agent.",
    configSchema: {
        parse(value: unknown): A2APluginConfig {
            return parseA2APluginConfig(value);
        },
    },

    async register(api: OpenClawPluginApi) {
        const pluginConfig = parseA2APluginConfig(api.pluginConfig);
        const stateDir = api.runtime.state.resolveStateDir();

        // --- Outbound tools (via @a2anet/a2a-utils) ---
        if (pluginConfig.agents && Object.keys(pluginConfig.agents).length > 0) {
            const tools = createOutboundTools({
                agents: pluginConfig.agents,
                stateDir,
            });
            for (const tool of tools) {
                api.registerTool(tool);
            }
            api.logger.info(
                `[a2a] Registered ${tools.length} outbound tools for ${Object.keys(pluginConfig.agents).length} agent(s)`,
            );
        }

        // --- Inbound server ---
        const authConfig = resolveInboundAuth(pluginConfig, api.logger);
        const authRequired = authConfig?.required ?? false;

        // Lazy-initialized on first HTTP request (to determine public URL).
        // Uses a Promise lock to prevent concurrent initialization.
        let agentCard: AgentCard | null = null;
        let httpHandlers: ReturnType<typeof createA2AHttpHandlers> | null = null;
        let initPromise: Promise<void> | null = null;
        let livePluginConfig = { ...pluginConfig };

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

                    agentCard = buildAgentCard({
                        openclawConfig: api.config,
                        pluginConfig: livePluginConfig,
                        publicUrl,
                        authRequired,
                    });

                    const taskStore = new InMemoryTaskStore();
                    const gatewayTimeoutMs = (livePluginConfig.gatewayTimeout ?? 300) * 1000;
                    const executor = new OpenClawExecutor({
                        agentId: "main",
                        callGateway: async (params) => {
                            const token = api.config.gateway?.auth?.token;
                            return callGateway({
                                method: params.method,
                                params: params.params,
                                timeoutMs: params.timeoutMs ?? gatewayTimeoutMs,
                                token: typeof token === "string" ? token : undefined,
                            });
                        },
                    });

                    const requestHandler = new DefaultRequestHandler(
                        agentCard,
                        taskStore,
                        executor,
                    );
                    httpHandlers = createA2AHttpHandlers({
                        agentCard,
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

        function resolvePublicUrl(req: import("node:http").IncomingMessage): string {
            const host = req.headers.host || "localhost";
            const rawProto = req.headers["x-forwarded-proto"];
            const protocol = typeof rawProto === "string" ? rawProto.split(",")[0].trim() : "https";
            return `${protocol}://${host}`;
        }

        api.registerHttpRoute({
            path: "/.well-known/agent-card.json",
            auth: "plugin",
            handler: async (req, res) => {
                if (!httpHandlers) {
                    await initializeInbound(resolvePublicUrl(req));
                }
                if (httpHandlers) {
                    await httpHandlers.handleAgentCard(req, res);
                }
            },
        });

        api.registerHttpRoute({
            path: "/a2a",
            auth: "plugin",
            handler: async (req, res) => {
                if (!httpHandlers) {
                    await initializeInbound(resolvePublicUrl(req));
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
                    updateLiveCard: (patch) => {
                        if (!agentCard) {
                            return;
                        }
                        livePluginConfig = { ...livePluginConfig, ...patch };
                        const rebuilt = buildAgentCard({
                            openclawConfig: api.config,
                            pluginConfig: livePluginConfig,
                            publicUrl: agentCard.url.replace(/\/a2a$/, ""),
                            authRequired,
                        });
                        Object.assign(agentCard, rebuilt);
                    },
                }),
            );
        }

        // --- CLI commands for key management ---
        api.registerCommand({
            name: "a2a generate-key",
            description: "Generate a new inbound API key for A2A authentication",
            acceptsArgs: true,
            handler: async (ctx) => {
                const label = ctx.args?.trim() || `key-${Date.now()}`;
                const key = generateApiKey();
                try {
                    const currentConfig = api.runtime.config.loadConfig() as Record<
                        string,
                        unknown
                    >;
                    const { a2aConfig } = extractA2AEntry(currentConfig);
                    const existingInbound = (a2aConfig.inbound ?? {}) as Record<string, unknown>;
                    const existingKeys = Array.isArray(existingInbound.apiKeys)
                        ? existingInbound.apiKeys
                        : [];

                    await api.runtime.config.writeConfigFile(
                        buildRootConfigWithA2A(currentConfig, {
                            inbound: {
                                ...existingInbound,
                                apiKeys: [...existingKeys, { label, key }],
                            },
                        }) as import("openclaw/plugin-sdk").OpenClawConfig,
                    );
                    return {
                        text: `Generated API key "${label}": ${key}\n\nRestart the gateway to apply.`,
                    };
                } catch (err) {
                    return {
                        text: `Failed to generate key: ${err instanceof Error ? err.message : String(err)}`,
                    };
                }
            },
        });

        api.registerCommand({
            name: "a2a list-keys",
            description: "List configured inbound A2A API keys",
            acceptsArgs: false,
            handler: async () => {
                try {
                    const currentConfig = api.runtime.config.loadConfig() as Record<
                        string,
                        unknown
                    >;
                    const { a2aConfig: rawA2AConfig } = extractA2AEntry(currentConfig);
                    const a2aConfig = parseA2APluginConfig(rawA2AConfig);
                    const keys = a2aConfig.inbound?.apiKeys ?? [];
                    if (keys.length === 0) {
                        return { text: "No inbound API keys configured." };
                    }
                    const maskKey = (k: string) =>
                        k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : "****";
                    const lines = keys.map((k) => `- ${k.label}: ${maskKey(k.key)}`);
                    return { text: `Inbound API keys:\n${lines.join("\n")}` };
                } catch (err) {
                    return {
                        text: `Failed to list keys: ${err instanceof Error ? err.message : String(err)}`,
                    };
                }
            },
        });

        api.registerCommand({
            name: "a2a revoke-key",
            description: "Revoke an inbound A2A API key by label",
            acceptsArgs: true,
            handler: async (ctx) => {
                const label = ctx.args?.trim();
                if (!label) {
                    return { text: "Usage: a2a revoke-key <label>" };
                }
                try {
                    const currentConfig = api.runtime.config.loadConfig() as Record<
                        string,
                        unknown
                    >;
                    const { a2aConfig } = extractA2AEntry(currentConfig);
                    const existingInbound = (a2aConfig.inbound ?? {}) as Record<string, unknown>;
                    const existingKeys = Array.isArray(existingInbound.apiKeys)
                        ? existingInbound.apiKeys
                        : [];

                    const filtered = existingKeys.filter(
                        (k: Record<string, unknown>) => k.label !== label,
                    );
                    if (filtered.length === existingKeys.length) {
                        return { text: `No key found with label "${label}".` };
                    }

                    await api.runtime.config.writeConfigFile(
                        buildRootConfigWithA2A(currentConfig, {
                            inbound: {
                                ...existingInbound,
                                apiKeys: filtered.length > 0 ? filtered : undefined,
                            },
                        }) as import("openclaw/plugin-sdk").OpenClawConfig,
                    );
                    return { text: `Revoked key "${label}". Restart the gateway to apply.` };
                } catch (err) {
                    return {
                        text: `Failed to revoke key: ${err instanceof Error ? err.message : String(err)}`,
                    };
                }
            },
        });

        // --- Lifecycle service ---
        api.registerService({
            id: "a2a",
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
};

export default a2aPlugin;
