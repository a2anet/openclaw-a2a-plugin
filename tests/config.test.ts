// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { buildRootConfigWithA2A, parseA2APluginConfig } from "../src/config.js";

describe("parseA2APluginConfig", () => {
    test("returns empty config for undefined", () => {
        expect(parseA2APluginConfig(undefined)).toEqual({});
    });

    test("returns empty config for null", () => {
        expect(parseA2APluginConfig(null)).toEqual({});
    });

    test("returns empty config for non-object", () => {
        expect(parseA2APluginConfig("string")).toEqual({});
    });

    test("parses outbound agents", () => {
        const result = parseA2APluginConfig({
            outbound: {
                agents: {
                    weather: { url: "https://weather.example.com/agent-card.json" },
                    search: {
                        url: "https://search.example.com/agent-card.json",
                        custom_headers: { Authorization: "Bearer secret" },
                    },
                },
            },
        });
        expect(result.outbound?.agents).toEqual({
            weather: { url: "https://weather.example.com/agent-card.json" },
            search: {
                url: "https://search.example.com/agent-card.json",
                custom_headers: { Authorization: "Bearer secret" },
            },
        });
    });

    test("skips agents with empty URL", () => {
        const result = parseA2APluginConfig({
            outbound: {
                agents: {
                    valid: { url: "https://example.com" },
                    invalid: { url: "  " },
                },
            },
        });
        expect(result.outbound?.agents).toEqual({
            valid: { url: "https://example.com" },
        });
    });

    test("parses outbound numeric options", () => {
        const result = parseA2APluginConfig({
            outbound: {
                sendMessageCharacterLimit: 100000,
                minimizedObjectStringLength: 10000,
                viewArtifactCharacterLimit: 100000,
                agentCardTimeout: 30,
                sendMessageTimeout: 120,
                getTaskTimeout: 120,
                getTaskPollInterval: 10,
            },
        });
        expect(result.outbound?.sendMessageCharacterLimit).toBe(100000);
        expect(result.outbound?.minimizedObjectStringLength).toBe(10000);
        expect(result.outbound?.viewArtifactCharacterLimit).toBe(100000);
        expect(result.outbound?.agentCardTimeout).toBe(30);
        expect(result.outbound?.sendMessageTimeout).toBe(120);
        expect(result.outbound?.getTaskTimeout).toBe(120);
        expect(result.outbound?.getTaskPollInterval).toBe(10);
    });

    test("parses outbound boolean options", () => {
        const result = parseA2APluginConfig({
            outbound: { taskStore: false, fileStore: false },
        });
        expect(result.outbound?.taskStore).toBe(false);
        expect(result.outbound?.fileStore).toBe(false);
    });

    test("ignores invalid numeric options", () => {
        const result = parseA2APluginConfig({
            outbound: {
                sendMessageTimeout: -1,
                getTaskTimeout: "not a number",
            },
        });
        expect(result.outbound).toBeUndefined();
    });

    test("parses inbound agent card", () => {
        const result = parseA2APluginConfig({
            inbound: {
                agentCard: {
                    name: "  My Agent  ",
                    description: "  A test agent  ",
                },
            },
        });
        expect(result.inbound?.agentCard?.name).toBe("My Agent");
        expect(result.inbound?.agentCard?.description).toBe("A test agent");
    });

    test("ignores empty agent card name and description", () => {
        const result = parseA2APluginConfig({
            inbound: {
                agentCard: { name: "  ", description: "" },
                allowUnauthenticated: true,
            },
        });
        expect(result.inbound?.agentCard).toBeUndefined();
    });

    test("parses inbound agent card skills", () => {
        const result = parseA2APluginConfig({
            inbound: {
                agentCard: {
                    skills: [
                        {
                            id: "chat",
                            name: "Chat",
                            description: "General chat",
                            tags: ["general"],
                        },
                    ],
                },
            },
        });
        expect(result.inbound?.agentCard?.skills).toEqual([
            {
                id: "chat",
                name: "Chat",
                description: "General chat",
                tags: ["general"],
            },
        ]);
    });

    test("skips skills missing required fields", () => {
        const result = parseA2APluginConfig({
            inbound: {
                agentCard: {
                    skills: [
                        { id: "valid", name: "Valid", description: "OK" },
                        { id: "", name: "Invalid", description: "Missing ID" },
                        { id: "no-name", name: "", description: "Missing name" },
                    ],
                },
            },
        });
        expect(result.inbound?.agentCard?.skills).toEqual([
            { id: "valid", name: "Valid", description: "OK" },
        ]);
    });

    test("parses inbound auth config", () => {
        const result = parseA2APluginConfig({
            inbound: {
                allowUnauthenticated: false,
                apiKeys: [{ label: "key1", key: "abc123" }],
            },
        });
        expect(result.inbound?.allowUnauthenticated).toBe(false);
        expect(result.inbound?.apiKeys).toEqual([{ label: "key1", key: "abc123" }]);
    });

    test("skips inbound keys with missing fields", () => {
        const result = parseA2APluginConfig({
            inbound: {
                apiKeys: [
                    { label: "good", key: "abc" },
                    { label: "", key: "bad" },
                    { label: "no-key", key: "" },
                ],
            },
        });
        expect(result.inbound?.apiKeys).toEqual([{ label: "good", key: "abc" }]);
    });

    test("parses inbound gateway timeout", () => {
        const result = parseA2APluginConfig({
            inbound: { gatewayTimeout: 600 },
        });
        expect(result.inbound?.gatewayTimeout).toBe(600);
    });
});

describe("buildRootConfigWithA2A", () => {
    test("deep merges inbound without clobbering sibling keys", () => {
        const rootConfig = {
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                apiKeys: [{ label: "alice", key: "abc" }],
                                allowUnauthenticated: false,
                            },
                        },
                    },
                },
            },
        };
        const result = buildRootConfigWithA2A(rootConfig, {
            inbound: { agentCard: { name: "Updated" } },
        });
        const config = (
            (result.plugins as Record<string, unknown>).entries as Record<string, unknown>
        ).a2a as Record<string, Record<string, unknown>>;
        const inbound = config.config.inbound as Record<string, unknown>;
        expect(inbound.apiKeys).toEqual([{ label: "alice", key: "abc" }]);
        expect(inbound.allowUnauthenticated).toBe(false);
        expect((inbound.agentCard as Record<string, unknown>).name).toBe("Updated");
    });

    test("deep merges inbound.agentCard without clobbering sibling fields", () => {
        const rootConfig = {
            plugins: {
                entries: {
                    a2a: {
                        config: {
                            inbound: {
                                agentCard: {
                                    name: "Original",
                                    description: "Existing description",
                                    skills: [{ id: "chat", name: "Chat", description: "Talk" }],
                                },
                            },
                        },
                    },
                },
            },
        };
        const result = buildRootConfigWithA2A(rootConfig, {
            inbound: { agentCard: { name: "Updated" } },
        });
        const config = (
            (result.plugins as Record<string, unknown>).entries as Record<string, unknown>
        ).a2a as Record<string, Record<string, unknown>>;
        const inbound = config.config.inbound as Record<string, unknown>;
        const agentCard = inbound.agentCard as Record<string, unknown>;
        expect(agentCard.name).toBe("Updated");
        expect(agentCard.description).toBe("Existing description");
        expect(agentCard.skills).toEqual([{ id: "chat", name: "Chat", description: "Talk" }]);
    });
});
