// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, mock, test } from "bun:test";

import { createUpdateAgentCardTool } from "../../src/tools/update-agent-card.js";

function makeDeps(existingConfig?: Record<string, unknown>) {
    const storedConfig = existingConfig ?? {
        plugins: {
            entries: {
                a2a: {
                    config: {
                        inbound: {
                            agentCard: { name: "Original" },
                        },
                    },
                },
            },
        },
    };
    let written: Record<string, unknown> | null = null;

    return {
        loadConfig: mock(async () => storedConfig),
        writeConfigFile: mock(async (cfg: Record<string, unknown>) => {
            written = cfg;
        }),
        updateLiveCard: mock(() => {}),
        getWritten: () => written,
    };
}

describe("createUpdateAgentCardTool", () => {
    test("creates tool with correct name", () => {
        const tool = createUpdateAgentCardTool(makeDeps());
        expect(tool.name).toBe("a2a_update_agent_card");
    });

    test("returns error when no fields provided", async () => {
        const tool = createUpdateAgentCardTool(makeDeps());
        const result = await tool.execute("call-1", {});
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe(true);
        expect(parsed.error_message).toContain("At least one");
    });

    test("updates name successfully", async () => {
        const deps = makeDeps();
        const tool = createUpdateAgentCardTool(deps);
        const result = await tool.execute("call-1", { name: "New Name" });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.updated).toContain('name: "New Name"');
        expect(deps.writeConfigFile).toHaveBeenCalledTimes(1);
        expect(deps.updateLiveCard).toHaveBeenCalledTimes(1);

        // Check the written config has the name under inbound.agentCard
        const written = deps.getWritten() as Record<string, unknown>;
        const plugins = written.plugins as Record<string, unknown>;
        const entries = plugins.entries as Record<string, unknown>;
        const a2a = entries.a2a as Record<string, unknown>;
        const config = a2a.config as Record<string, unknown>;
        const inbound = config.inbound as Record<string, unknown>;
        const agentCard = inbound.agentCard as Record<string, unknown>;
        expect(agentCard.name).toBe("New Name");
    });

    test("updates description successfully", async () => {
        const deps = makeDeps();
        const tool = createUpdateAgentCardTool(deps);
        const result = await tool.execute("call-1", { description: "New Desc" });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.updated).toContain('description: "New Desc"');
    });

    test("updates skills successfully", async () => {
        const deps = makeDeps();
        const tool = createUpdateAgentCardTool(deps);
        const result = await tool.execute("call-1", {
            skills: [{ id: "s1", name: "Skill 1", description: "A skill" }],
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.updated).toContain("skills: 1 skill(s)");
    });

    test("trims name and description whitespace", async () => {
        const deps = makeDeps();
        const tool = createUpdateAgentCardTool(deps);
        await tool.execute("call-1", { name: "  Trimmed  ", description: "  Also trimmed  " });
        const call = (deps.updateLiveCard as ReturnType<typeof mock>).mock.calls[0];
        expect(call[0]).toEqual({ name: "Trimmed", description: "Also trimmed" });
    });

    test("handles config write errors", async () => {
        const deps = makeDeps();
        (deps.writeConfigFile as ReturnType<typeof mock>).mockImplementation(async () => {
            throw new Error("Disk full");
        });
        const tool = createUpdateAgentCardTool(deps);
        const result = await tool.execute("call-1", { name: "Test" });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe(true);
        expect(parsed.error_message).toContain("Disk full");
        expect(deps.updateLiveCard).not.toHaveBeenCalled();
    });

    test("handles empty string name as no update", async () => {
        const tool = createUpdateAgentCardTool(makeDeps());
        const result = await tool.execute("call-1", { name: "   " });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe(true);
    });

    test("persists to nested config structure correctly", async () => {
        const deps = makeDeps({
            otherKey: "preserved",
            plugins: {
                otherPlugin: true,
                entries: {
                    otherEntry: {},
                    a2a: {
                        enabled: true,
                        config: {
                            outbound: { agents: {} },
                            inbound: {
                                agentCard: { name: "Old", description: "Old desc" },
                                apiKeys: [{ label: "alice", key: "abc" }],
                            },
                        },
                    },
                },
            },
        });
        const tool = createUpdateAgentCardTool(deps);
        await tool.execute("call-1", { name: "Updated" });

        const written = deps.getWritten() as Record<string, unknown>;
        expect(written.otherKey).toBe("preserved");
        const plugins = written.plugins as Record<string, unknown>;
        expect(plugins.otherPlugin).toBe(true);
        const entries = plugins.entries as Record<string, unknown>;
        expect(entries.otherEntry).toBeDefined();
        const a2a = entries.a2a as Record<string, unknown>;
        expect(a2a.enabled).toBe(true);
        const config = a2a.config as Record<string, unknown>;
        expect(config.outbound).toBeDefined();
        const inbound = config.inbound as Record<string, unknown>;
        const agentCard = inbound.agentCard as Record<string, unknown>;
        expect(agentCard.name).toBe("Updated");
        // apiKeys should be preserved via deep merge
        expect(inbound.apiKeys).toEqual([{ label: "alice", key: "abc" }]);
    });
});
