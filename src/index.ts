// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

export const VERSION = "0.1.0"; // x-release-please-version

import path from "node:path";
import type { AgentCard } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
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
import { buildAgentCard } from "./inbound/agent-card.js";
import { generateApiKey } from "./inbound/auth.js";
import { OpenClawExecutor } from "./inbound/executor.js";
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

const a2aPlugin = definePluginEntry({
    id: "a2a",
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

        // --- Outbound tools (via @a2anet/a2a-utils) ---
        const outbound = pluginConfig.outbound;
        if (outbound?.agents && Object.keys(outbound.agents).length > 0) {
            const tools = createOutboundTools({
                agents: outbound.agents,
                stateDir,
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

                    const taskStore = new JSONTaskStore(`${stateDir}/a2a/inbound/tasks`);
                    const fileStore = new LocalFileStore(`${stateDir}/a2a/inbound/files`);
                    const gatewayTimeoutMs =
                        (livePluginConfig.inbound?.gatewayTimeout ?? 300) * 1000;
                    const executor = new OpenClawExecutor({
                        agentId: "main",
                        callGateway: async (params) => {
                            if (params.method !== "agent") {
                                return { ok: false, error: `Unsupported method: ${params.method}` };
                            }
                            const request = (params.params ?? {}) as Record<string, unknown>;
                            const sessionKey =
                                typeof request.sessionKey === "string"
                                    ? request.sessionKey
                                    : `a2a-${Date.now()}`;
                            const agentId =
                                typeof request.agentId === "string" ? request.agentId : "main";
                            const prompt =
                                typeof request.message === "string" ? request.message : "";
                            const sessionId = sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
                            const sessionFile = path.join(
                                stateDir,
                                "a2a",
                                "inbound",
                                "sessions",
                                `${sessionId}.json`,
                            );
                            const configuredModel = api.config.agents?.defaults?.model;
                            const primaryModel =
                                typeof configuredModel === "string"
                                    ? configuredModel
                                    : configuredModel?.primary;
                            const slashIndex =
                                typeof primaryModel === "string" ? primaryModel.indexOf("/") : -1;
                            const provider =
                                typeof primaryModel === "string" && slashIndex > 0
                                    ? primaryModel.slice(0, slashIndex)
                                    : undefined;
                            const model =
                                typeof primaryModel === "string" && slashIndex > 0
                                    ? primaryModel.slice(slashIndex + 1)
                                    : undefined;

                            try {
                                const result = await api.runtime.agent.runEmbeddedPiAgent({
                                    sessionId,
                                    sessionKey,
                                    sessionFile,
                                    workspaceDir:
                                        api.config.agents?.defaults?.workspace ?? process.cwd(),
                                    config: api.config,
                                    prompt,
                                    timeoutMs: params.timeoutMs ?? gatewayTimeoutMs,
                                    runId: `a2a-${Date.now()}`,
                                    agentId,
                                    provider,
                                    model,
                                });
                                return {
                                    ok: true,
                                    data: {
                                        status: "success",
                                        result,
                                    },
                                };
                            } catch (err) {
                                return {
                                    ok: false,
                                    error: err instanceof Error ? err.message : String(err),
                                };
                            }
                        },
                        fileStore,
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
            const protocol = typeof rawProto === "string" ? rawProto.split(",")[0].trim() : (req.socket as import("node:tls").TLSSocket).encrypted ? "https" : "http";
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
        api.registerCli(({ program }) => {
            const a2a = program
                .command("a2a")
                .description("Manage A2A plugin keys and local configuration");

            a2a.command("generate-key [label]")
                .description("Generate a new inbound API key for A2A authentication")
                .action(async (label?: string) => {
                    const keyLabel = label?.trim() || `key-${Date.now()}`;
                    const key = generateApiKey();
                    try {
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
                            (k: Record<string, unknown>) => k.label !== label,
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
});

export default a2aPlugin;
