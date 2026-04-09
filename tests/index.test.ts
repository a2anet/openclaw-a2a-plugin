// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import plugin, { VERSION } from "../src/index.js";

describe("package", () => {
    test("should have a version", () => {
        expect(VERSION).toBeDefined();
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });
});

describe("plugin definition", () => {
    test("exports default plugin object", () => {
        expect(plugin).toBeDefined();
        expect(plugin.id).toBe("a2a");
        expect(plugin.name).toBe("A2A Protocol");
        expect(typeof plugin.register).toBe("function");
    });

    test("has config schema with parse", () => {
        expect(typeof plugin.configSchema.parse).toBe("function");
    });

    test("config schema parse handles undefined", () => {
        const result = plugin.configSchema.parse(undefined);
        expect(result).toEqual({});
    });

    test("config schema parse handles valid config", () => {
        const result = plugin.configSchema.parse({
            outbound: {
                agents: { test: { url: "https://example.com" } },
            },
            inbound: {
                agentCard: { name: "Test" },
            },
        });
        expect(result.inbound?.agentCard?.name).toBe("Test");
        expect(result.outbound?.agents?.test?.url).toBe("https://example.com");
    });

    test("config schema parse rejects duplicate inbound API key labels", () => {
        expect(() =>
            plugin.configSchema.parse({
                inbound: {
                    apiKeys: [
                        { label: "alice", key: "first" },
                        { label: "alice", key: "second" },
                    ],
                },
            }),
        ).toThrow('Inbound API key labels must be unique: "alice"');
    });
});
