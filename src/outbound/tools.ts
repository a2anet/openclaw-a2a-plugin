// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import {
    A2AAgents,
    A2ASession,
    A2ATools,
    ArtifactSettings,
    JSONTaskStore,
    LocalFileStore,
} from "@a2anet/a2a-utils";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { A2AAgentEntry } from "../config.js";
import { type AgentTool, jsonResult } from "../types.js";

export type CreateOutboundToolsParams = {
    agents: Record<string, A2AAgentEntry>;
    stateDir: string;
    taskStore?: boolean;
    fileStore?: boolean;
    agentCardTimeout?: number;
    sendMessageTimeout?: number;
    getTaskTimeout?: number;
    getTaskPollInterval?: number;
    sendMessageCharacterLimit?: number;
    minimizedObjectStringLength?: number;
    viewArtifactCharacterLimit?: number;
};

/**
 * Create the 6 outbound A2A tools backed by @a2anet/a2a-utils.
 *
 * This is the thin wrapper that bridges A2ATools to OpenClaw's tool registration
 * format. Tool metadata (name, description, schema) comes from a2a-utils;
 * the `a2a_` prefix is added here for OpenClaw namespacing.
 */
export function createOutboundTools(params: CreateOutboundToolsParams): AgentTool[] {
    const agents = new A2AAgents(
        params.agents as Record<string, Record<string, unknown>>,
        params.agentCardTimeout !== undefined ? { timeout: params.agentCardTimeout } : undefined,
    );

    const taskStore =
        params.taskStore !== false
            ? new JSONTaskStore(`${params.stateDir}/a2a/outbound/tasks`)
            : undefined;
    const fileStore =
        params.fileStore !== false
            ? new LocalFileStore(`${params.stateDir}/a2a/outbound/files`)
            : undefined;

    const session = new A2ASession(agents, {
        taskStore,
        fileStore,
        sendMessageTimeout: params.sendMessageTimeout,
        getTaskTimeout: params.getTaskTimeout,
        getTaskPollInterval: params.getTaskPollInterval,
    });

    const artifactSettings = new ArtifactSettings({
        sendMessageCharacterLimit: params.sendMessageCharacterLimit,
        minimizedObjectStringLength: params.minimizedObjectStringLength,
        viewArtifactCharacterLimit: params.viewArtifactCharacterLimit,
    });

    const tools = new A2ATools(session, { artifactSettings });

    return tools.toolDefinitions.map((def) => {
        const { $schema: _, ...jsonSchema } = zodToJsonSchema(def.schema, { target: "openAi" });
        return {
            name: `a2a_${def.name}`,
            label: `a2a_${def.name}`,
            description: def.description,
            parameters: jsonSchema,
            execute: async (_toolCallId: string, params: Record<string, unknown>) =>
                jsonResult(await def.execute(params)),
        };
    });
}
