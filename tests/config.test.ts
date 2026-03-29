// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { parseA2APluginConfig } from "../src/config.js";

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

    test("parses name and description", () => {
        const result = parseA2APluginConfig({
            name: "  My Agent  ",
            description: "  A test agent  ",
        });
        expect(result.name).toBe("My Agent");
        expect(result.description).toBe("A test agent");
    });

    test("ignores empty name and description", () => {
        const result = parseA2APluginConfig({ name: "  ", description: "" });
        expect(result.name).toBeUndefined();
        expect(result.description).toBeUndefined();
    });

    test("parses agents with named IDs", () => {
        const result = parseA2APluginConfig({
            agents: {
                weather: { url: "https://weather.example.com/agent-card.json" },
                search: {
                    url: "https://search.example.com/agent-card.json",
                    custom_headers: { Authorization: "Bearer secret" },
                },
            },
        });
        expect(result.agents).toEqual({
            weather: { url: "https://weather.example.com/agent-card.json" },
            search: {
                url: "https://search.example.com/agent-card.json",
                custom_headers: { Authorization: "Bearer secret" },
            },
        });
    });

    test("skips agents with empty URL", () => {
        const result = parseA2APluginConfig({
            agents: {
                valid: { url: "https://example.com" },
                invalid: { url: "  " },
            },
        });
        expect(result.agents).toEqual({
            valid: { url: "https://example.com" },
        });
    });

    test("parses skills", () => {
        const result = parseA2APluginConfig({
            skills: [
                {
                    id: "chat",
                    name: "Chat",
                    description: "General chat",
                    tags: ["general"],
                },
            ],
        });
        expect(result.skills).toEqual([
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
            skills: [
                { id: "valid", name: "Valid", description: "OK" },
                { id: "", name: "Invalid", description: "Missing ID" },
                { id: "no-name", name: "", description: "Missing name" },
            ],
        });
        expect(result.skills).toEqual([{ id: "valid", name: "Valid", description: "OK" }]);
    });

    test("parses inbound config", () => {
        const result = parseA2APluginConfig({
            inbound: {
                allowUnauthenticated: false,
                apiKeys: [{ label: "key1", key: "abc123" }],
            },
        });
        expect(result.inbound).toEqual({
            allowUnauthenticated: false,
            apiKeys: [{ label: "key1", key: "abc123" }],
        });
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
});
