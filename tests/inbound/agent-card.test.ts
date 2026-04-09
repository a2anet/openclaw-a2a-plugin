// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { AgentCardBuilder } from "../../src/inbound/agent-card.js";

describe("AgentCardBuilder", () => {
    const baseParams = {
        openclawConfig: {},
        pluginConfig: {},
        publicUrl: "https://example.com",
    };

    test("uses inbound agentCard name when set", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            pluginConfig: { inbound: { agentCard: { name: "Custom Name" } } },
        }).build();
        expect(card.name).toBe("Custom Name");
    });

    test("falls back to OpenClaw identity name", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            openclawConfig: {
                agents: {
                    list: [{ id: "main", identity: { name: "Identity Name" } }],
                },
            },
        }).build();
        expect(card.name).toBe("Identity Name");
    });

    test("falls back to agent name from config", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            openclawConfig: {
                agents: { list: [{ id: "main", name: "Agent Name" }] },
            },
        }).build();
        expect(card.name).toBe("Agent Name");
    });

    test("falls back to generic name with agent ID", () => {
        const card = new AgentCardBuilder(baseParams).build();
        expect(card.name).toBe("OpenClaw Agent (main)");
    });

    test("uses custom agentId for lookup", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            agentId: "custom",
            openclawConfig: {
                agents: {
                    list: [
                        { id: "main", identity: { name: "Main" } },
                        { id: "custom", identity: { name: "Custom" } },
                    ],
                },
            },
        }).build();
        expect(card.name).toBe("Custom");
    });

    test("sets A2A endpoint URL", () => {
        const card = new AgentCardBuilder(baseParams).build();
        expect(card.url).toBe("https://example.com/a2a");
    });

    test("strips trailing slash from URL", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            publicUrl: "https://example.com/",
        }).build();
        expect(card.url).toBe("https://example.com/a2a");
    });

    test("sets protocol version and capabilities", () => {
        const card = new AgentCardBuilder(baseParams).build();
        expect(card.protocolVersion).toBe("0.3.0");
        expect(card.capabilities?.streaming).toBe(true);
        expect(card.capabilities?.pushNotifications).toBe(false);
    });

    test("builds skills from inbound agentCard config", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            pluginConfig: {
                inbound: {
                    agentCard: {
                        skills: [{ id: "chat", name: "Chat", description: "General chat" }],
                    },
                },
            },
        }).build();
        expect(card.skills).toHaveLength(1);
        expect(card.skills[0].id).toBe("chat");
    });

    test("returns empty skills when none configured", () => {
        const card = new AgentCardBuilder(baseParams).build();
        expect(card.skills).toEqual([]);
    });

    test("uses inbound agentCard description", () => {
        const card = new AgentCardBuilder({
            ...baseParams,
            pluginConfig: {
                inbound: { agentCard: { description: "My custom description" } },
            },
        }).build();
        expect(card.description).toBe("My custom description");
    });

    test("falls back to default description", () => {
        const card = new AgentCardBuilder(baseParams).build();
        expect(card.description).toBe("AI assistant powered by OpenClaw");
    });

    test("adds security schemes when auth required", () => {
        const card = new AgentCardBuilder({ ...baseParams, authRequired: true }).build();
        const raw = card as Record<string, unknown>;
        expect(raw.securitySchemes).toBeDefined();
        expect(raw.security).toBeDefined();
    });

    test("omits security schemes when auth not required", () => {
        const card = new AgentCardBuilder(baseParams).build();
        const raw = card as Record<string, unknown>;
        expect(raw.securitySchemes).toBeUndefined();
        expect(raw.security).toBeUndefined();
    });
});
