// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { buildAgentCard } from "../../src/inbound/agent-card.js";

describe("buildAgentCard", () => {
    const baseParams = {
        openclawConfig: {},
        pluginConfig: {},
        publicUrl: "https://example.com",
    };

    test("uses plugin config name when set", () => {
        const card = buildAgentCard({
            ...baseParams,
            pluginConfig: { name: "Custom Name" },
        });
        expect(card.name).toBe("Custom Name");
    });

    test("falls back to OpenClaw identity name", () => {
        const card = buildAgentCard({
            ...baseParams,
            openclawConfig: {
                agents: {
                    list: [{ id: "main", identity: { name: "Identity Name" } }],
                },
            },
        });
        expect(card.name).toBe("Identity Name");
    });

    test("falls back to agent name from config", () => {
        const card = buildAgentCard({
            ...baseParams,
            openclawConfig: {
                agents: { list: [{ id: "main", name: "Agent Name" }] },
            },
        });
        expect(card.name).toBe("Agent Name");
    });

    test("falls back to generic name with agent ID", () => {
        const card = buildAgentCard(baseParams);
        expect(card.name).toBe("OpenClaw Agent (main)");
    });

    test("uses custom agentId for lookup", () => {
        const card = buildAgentCard({
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
        });
        expect(card.name).toBe("Custom");
    });

    test("sets A2A endpoint URL", () => {
        const card = buildAgentCard(baseParams);
        expect(card.url).toBe("https://example.com/a2a");
    });

    test("strips trailing slash from URL", () => {
        const card = buildAgentCard({
            ...baseParams,
            publicUrl: "https://example.com/",
        });
        expect(card.url).toBe("https://example.com/a2a");
    });

    test("sets protocol version and capabilities", () => {
        const card = buildAgentCard(baseParams);
        expect(card.protocolVersion).toBe("0.3.0");
        expect(card.capabilities?.streaming).toBe(true);
        expect(card.capabilities?.pushNotifications).toBe(false);
    });

    test("builds skills from plugin config", () => {
        const card = buildAgentCard({
            ...baseParams,
            pluginConfig: {
                skills: [{ id: "chat", name: "Chat", description: "General chat" }],
            },
        });
        expect(card.skills).toHaveLength(1);
        expect(card.skills[0].id).toBe("chat");
    });

    test("returns empty skills when none configured", () => {
        const card = buildAgentCard(baseParams);
        expect(card.skills).toEqual([]);
    });

    test("adds security schemes when auth required", () => {
        const card = buildAgentCard({ ...baseParams, authRequired: true });
        const raw = card as Record<string, unknown>;
        expect(raw.securitySchemes).toBeDefined();
        expect(raw.security).toBeDefined();
    });

    test("omits security schemes when auth not required", () => {
        const card = buildAgentCard(baseParams);
        const raw = card as Record<string, unknown>;
        expect(raw.securitySchemes).toBeUndefined();
        expect(raw.security).toBeUndefined();
    });
});
