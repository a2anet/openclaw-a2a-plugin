// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

export const VERSION = "0.2.0"; // x-release-please-version

import * as path from "node:path";

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
import { AgentCardBuilder } from "./inbound/agent-card.js";
import { generateApiKey } from "./inbound/auth.js";
import { OpenClawExecutor } from "./inbound/executor.js";
import { type A2AAuthConfig, A2AHttpHandlers } from "./inbound/http-adapter.js";
import {
    DEFAULT_INBOUND_AGENT_ID,
    SINGLE_AGENT_CARD_PATH,
    SINGLE_AGENT_RPC_PATH,
    multiAgentCardPath,
    multiAgentRpcPath,
} from "./inbound/paths.js";
import { createOutboundTools } from "./outbound/tools.js";
import { createUpdateAgentCardTool } from "./tools/update-agent-card.js";
import {
    assertUniqueA2AInboundKeyLabels,
    assertValidA2AInboundKeyLabel,
} from "./utils/inbound-key-label.js";

/**
 * A single inbound agent's addressable endpoint: its JSON-RPC path, Agent Card
 * discovery path, persistence locations, the card metadata it starts with, and
 * how a card edit is persisted back to config.
 */
type InboundEndpoint = {
    agentId: string;
    rpcPath: string;
    cardPath: string;
    taskStorePath: string;
    fileStorePath: string;
    /** Card metadata from config; the starting point for {@link InboundEndpointRuntime.liveCardConfig}. */
    initialCardConfig?: A2AAgentCardConfig;
    /** Wrap a card patch in the root-config shape that persists it to this endpoint. */
    buildConfigUpdate: (patch: Partial<A2AAgentCardConfig>) => Record<string, unknown>;
};

/** Lazily initialized runtime state for an {@link InboundEndpoint}. */
type InboundEndpointRuntime = {
    endpoint: InboundEndpoint;
    /** Card metadata as currently served, including live edits from the update tool. */
    liveCardConfig?: A2AAgentCardConfig;
    agentCard: AgentCard | null;
    /** Public base URL captured on first init; used to rebuild the card on live edits. */
    publicUrl: string | null;
    httpHandlers: A2AHttpHandlers | null;
    initPromise: Promise<void> | null;
};

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

function registerCli(api: OpenClawPluginApi, pluginConfig: A2APluginConfig): void {
    api.registerCli(
        ({ program }) => {
            const a2a = program
                .command("a2a")
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
                    name: "a2a",
                    description: "Manage A2A plugin keys and local configuration",
                    hasSubcommands: true,
                },
            ],
        },
    );
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

        registerCli(api, pluginConfig);

        // Tool descriptors must be registered in `tool-discovery` as well as
        // `full` so the agent runtime can enumerate plugin tools when it
        // cold-loads the plugin registry; everything else (HTTP routes,
        // services, reload) requires the live gateway and stays in `full`.
        // `tool-discovery` is widened in newer SDKs than this plugin's
        // declared peer range, hence the cast.
        const registrationMode = api.registrationMode as string;
        if (registrationMode !== "full" && registrationMode !== "tool-discovery") {
            return;
        }

        const stateDir = api.runtime.state.resolveStateDir();
        const workspaceDir = api.config.agents?.defaults?.workspace ?? process.cwd();

        const inboundAgents = pluginConfig.inbound?.agents;
        const isMultiAgentInbound = !!inboundAgents && Object.keys(inboundAgents).length > 0;

        // One addressable endpoint per inbound agent, exposed on `/a2a/<agentId>`
        // in multi-agent mode or the default `/a2a` paths otherwise. Their
        // runtime state is lazily initialized on first request, so in
        // `tool-discovery` mode they stay uninitialized.
        const inboundEndpoints = resolveInboundEndpoints();
        const endpointRuntimes = new Map<string, InboundEndpointRuntime>(
            inboundEndpoints.map((endpoint) => [
                endpoint.agentId,
                {
                    endpoint,
                    liveCardConfig: endpoint.initialCardConfig,
                    agentCard: null,
                    publicUrl: null,
                    httpHandlers: null,
                    initPromise: null,
                },
            ]),
        );

        function resolveInboundEndpoints(): InboundEndpoint[] {
            if (isMultiAgentInbound && inboundAgents) {
                return Object.entries(inboundAgents).map(([agentId, agentEntry]) => ({
                    agentId,
                    rpcPath: multiAgentRpcPath(agentId),
                    cardPath: multiAgentCardPath(agentId),
                    taskStorePath: path.join(stateDir, "a2a", "inbound", agentId, "tasks"),
                    fileStorePath: path.join(workspaceDir, "a2a", "inbound", agentId, "files"),
                    initialCardConfig: agentEntry.agentCard,
                    buildConfigUpdate: (patch) => ({
                        inbound: { agents: { [agentId]: { agentCard: patch } } },
                    }),
                }));
            }
            return [
                {
                    agentId: DEFAULT_INBOUND_AGENT_ID,
                    rpcPath: SINGLE_AGENT_RPC_PATH,
                    cardPath: SINGLE_AGENT_CARD_PATH,
                    taskStorePath: path.join(stateDir, "a2a", "inbound", "tasks"),
                    fileStorePath: path.join(workspaceDir, "a2a", "inbound", "files"),
                    initialCardConfig: pluginConfig.inbound?.agentCard,
                    buildConfigUpdate: (patch) => ({ inbound: { agentCard: patch } }),
                },
            ];
        }

        function buildCardFor(runtime: InboundEndpointRuntime, publicUrl: string): AgentCard {
            const { agentId, rpcPath } = runtime.endpoint;
            return new AgentCardBuilder({
                openclawConfig: api.config,
                agentCardConfig: runtime.liveCardConfig,
                agentId,
                rpcPath,
                publicUrl,
                authRequired,
            }).build();
        }

        // Apply a card edit from the update tool: update the served metadata and,
        // if the endpoint is already initialized, rebuild its live Agent Card so
        // discovery requests reflect the change immediately.
        function applyCardPatch(
            runtime: InboundEndpointRuntime,
            patch: Partial<A2AAgentCardConfig>,
        ): void {
            runtime.liveCardConfig = { ...runtime.liveCardConfig, ...patch };
            if (!runtime.agentCard || runtime.publicUrl === null) {
                return;
            }
            Object.assign(runtime.agentCard, buildCardFor(runtime, runtime.publicUrl));
        }

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

        const authRequired = pluginConfig.inbound?.allowUnauthenticated !== true;

        // --- Update agent card tool (only when inbound is accepting requests) ---
        const inboundConfigured =
            pluginConfig.inbound?.allowUnauthenticated === true ||
            (pluginConfig.inbound?.apiKeys && pluginConfig.inbound.apiKeys.length > 0);

        if (inboundConfigured) {
            // In multi-agent mode the tool resolves to the calling agent's own
            // card by its ID; in single-agent mode every caller shares the one
            // endpoint.
            api.registerTool(
                (ctx) => {
                    let runtime: InboundEndpointRuntime | undefined;
                    if (isMultiAgentInbound) {
                        runtime = ctx.agentId ? endpointRuntimes.get(ctx.agentId) : undefined;
                    } else {
                        runtime = endpointRuntimes.get(DEFAULT_INBOUND_AGENT_ID);
                    }
                    if (!runtime) {
                        return null;
                    }
                    return createUpdateAgentCardTool({
                        loadConfig: async () =>
                            api.runtime.config.loadConfig() as Record<string, unknown>,
                        writeConfigFile: (cfg) =>
                            api.runtime.config.writeConfigFile(
                                cfg as import("openclaw/plugin-sdk").OpenClawConfig,
                            ),
                        buildConfigUpdate: (patch) => runtime.endpoint.buildConfigUpdate(patch),
                        updateLiveCard: (patch) => applyCardPatch(runtime, patch),
                    });
                },
                { name: "a2a_update_agent_card" },
            );
        }

        // Everything below requires the live gateway runtime.
        if (registrationMode !== "full") {
            return;
        }

        // Each named inbound agent routes to the OpenClaw agent of the same ID.
        // Warn (rather than fail) when one has no match, since requests to it
        // would otherwise fail to route with no obvious cause. Match exactly,
        // since routing and tool resolution key off the verbatim agent ID.
        if (isMultiAgentInbound) {
            if (pluginConfig.inbound?.agentCard) {
                api.logger.warn(
                    "[a2a] inbound.agentCard is ignored when inbound.agents is set; configure each agent's card under inbound.agents.<agentId>.agentCard.",
                );
            }

            const knownAgentIds = new Set(
                (api.config.agents?.list ?? [])
                    .map((agent) => agent.id)
                    .filter((id): id is string => typeof id === "string"),
            );
            // The gateway lowercases route paths when matching, so IDs differing
            // only by case map to the same `/a2a/<id>` route and would misroute.
            const canonicalIds = new Map<string, string>();
            for (const endpoint of inboundEndpoints) {
                if (!knownAgentIds.has(endpoint.agentId)) {
                    api.logger.warn(
                        `[a2a] Inbound agent "${endpoint.agentId}" does not match any configured OpenClaw agent; requests to ${endpoint.rpcPath} will fail to route.`,
                    );
                }
                const canonical = endpoint.agentId.toLowerCase();
                const collidesWith = canonicalIds.get(canonical);
                if (collidesWith) {
                    api.logger.warn(
                        `[a2a] Inbound agents "${collidesWith}" and "${endpoint.agentId}" differ only by case; their ${endpoint.rpcPath} routes collide and requests will be misrouted.`,
                    );
                } else {
                    canonicalIds.set(canonical, endpoint.agentId);
                }
            }
        }

        // --- Inbound server ---
        const authConfig = resolveInboundAuth(pluginConfig, api.logger);

        const initializeEndpoint = (
            runtime: InboundEndpointRuntime,
            publicUrl: string,
        ): Promise<void> => {
            if (runtime.agentCard) {
                return Promise.resolve();
            }
            if (runtime.initPromise) {
                return runtime.initPromise;
            }
            const { agentId, rpcPath, taskStorePath, fileStorePath } = runtime.endpoint;
            runtime.initPromise = Promise.resolve()
                .then(() => {
                    if (runtime.agentCard) {
                        return;
                    }

                    const card = buildCardFor(runtime, publicUrl);

                    const taskStore = new JSONTaskStore(taskStorePath);
                    const fileStore = new LocalFileStore(fileStorePath);
                    const executor = new OpenClawExecutor({
                        agentId,
                        runtime: api.runtime,
                        config: api.config,
                        fileStore,
                        workspaceDir,
                    });

                    const requestHandler = new DefaultRequestHandler(card, taskStore, executor);
                    runtime.httpHandlers = new A2AHttpHandlers({
                        agentCard: card,
                        getAgentCard: (req) => buildCardFor(runtime, resolveRequestPublicUrl(req)),
                        requestHandler,
                        auth: authConfig,
                    });
                    runtime.publicUrl = publicUrl;
                    runtime.agentCard = card;

                    api.logger.info(
                        `[a2a] Inbound server initialized: ${card.name} at ${publicUrl}${rpcPath}`,
                    );
                })
                .catch((err) => {
                    runtime.initPromise = null;
                    throw err;
                });
            return runtime.initPromise;
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

        const endpointHandler =
            (
                runtime: InboundEndpointRuntime,
                dispatch: (
                    handlers: A2AHttpHandlers,
                    req: import("node:http").IncomingMessage,
                    res: import("node:http").ServerResponse,
                ) => Promise<void>,
            ) =>
            async (
                req: import("node:http").IncomingMessage,
                res: import("node:http").ServerResponse,
            ): Promise<void> => {
                if (!runtime.httpHandlers) {
                    await initializeEndpoint(runtime, resolveRequestPublicUrl(req));
                }
                if (runtime.httpHandlers) {
                    await dispatch(runtime.httpHandlers, req, res);
                }
            };

        for (const runtime of endpointRuntimes.values()) {
            api.registerHttpRoute({
                path: runtime.endpoint.cardPath,
                auth: "plugin",
                handler: endpointHandler(runtime, (handlers, req, res) =>
                    handlers.handleAgentCard(req, res),
                ),
            });

            api.registerHttpRoute({
                path: runtime.endpoint.rpcPath,
                auth: "plugin",
                handler: endpointHandler(runtime, (handlers, req, res) =>
                    handlers.handleJsonRpc(req, res),
                ),
            });
        }

        api.registerReload({
            // Card-metadata edits are applied live, so they need no reload. Adding
            // or removing agents under `inbound.agents` is deliberately not listed,
            // so it still reloads to register or drop endpoints. In multi-agent
            // mode `inbound.agentCard` is inert, so treat its edits as no-ops too
            // rather than forcing a restart that changes nothing.
            noopPrefixes: isMultiAgentInbound
                ? [
                      "plugins.entries.a2a.config.inbound.agentCard",
                      ...inboundEndpoints.map(
                          (endpoint) =>
                              `plugins.entries.a2a.config.inbound.agents.${endpoint.agentId}.agentCard`,
                      ),
                  ]
                : ["plugins.entries.a2a.config.inbound.agentCard"],
        });

        // --- Lifecycle service ---
        api.registerService({
            id: "a2a",
            start: async () => {
                api.logger.info("[a2a] A2A service started");
            },
            stop: async () => {
                api.logger.info("[a2a] A2A service stopped");
                for (const runtime of endpointRuntimes.values()) {
                    runtime.agentCard = null;
                    runtime.publicUrl = null;
                    runtime.httpHandlers = null;
                    runtime.initPromise = null;
                }
            },
        });

        api.logger.info("[a2a] Plugin registered successfully");
    },
});

export default a2aPlugin;
