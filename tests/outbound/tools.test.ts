// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createOutboundTools } from "../../src/outbound/tools.js";

const tmpDirs: string[] = [];

function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2a-test-"));
    tmpDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tmpDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("createOutboundTools", () => {
    test("returns 6 tools", () => {
        const tools = createOutboundTools({
            agents: { test: { url: "https://example.com/agent-card.json" } },
            stateDir: tmpDir(),
        });
        expect(tools).toHaveLength(6);
    });

    test("tool names are correct", () => {
        const tools = createOutboundTools({
            agents: { test: { url: "https://example.com/agent-card.json" } },
            stateDir: tmpDir(),
        });
        const names = tools.map((t) => t.name);
        expect(names).toEqual([
            "a2a_get_agents",
            "a2a_get_agent",
            "a2a_send_message",
            "a2a_get_task",
            "a2a_view_text_artifact",
            "a2a_view_data_artifact",
        ]);
    });

    test("all tools have descriptions and parameters", () => {
        const tools = createOutboundTools({
            agents: { test: { url: "https://example.com/agent-card.json" } },
            stateDir: tmpDir(),
        });
        for (const tool of tools) {
            expect(tool.description).toBeTruthy();
            expect(tool.parameters).toBeDefined();
            expect(typeof tool.execute).toBe("function");
        }
    });
});
