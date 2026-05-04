// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import {
    A2AAgents,
    A2ASession,
    type A2AToolDefinition,
    A2ATools,
    ArtifactSettings,
    JSONTaskStore,
    LocalFileStore,
} from "@a2anet/a2a-utils";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { A2AAgentEntry } from "../config.js";
import { A2A_CHANNEL_ID, A2A_STORAGE_DIR } from "../constants.js";
import { type AgentTool, jsonResult } from "../types.js";

export type CreateOutboundToolsParams = {
    agents: Record<string, A2AAgentEntry>;
    stateDir: string;
    workspaceDir: string;
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

export function createOutboundTools(params: CreateOutboundToolsParams): AgentTool[] {
    const agents = new A2AAgents(
        params.agents as Record<string, Record<string, unknown>>,
        params.agentCardTimeout !== undefined ? { timeout: params.agentCardTimeout } : undefined,
    );

    const taskStore =
        params.taskStore !== false
            ? new JSONTaskStore(`${params.stateDir}/${A2A_STORAGE_DIR}/outbound/tasks`)
            : undefined;
    const fileStore =
        params.fileStore !== false
            ? new LocalFileStore(`${params.workspaceDir}/${A2A_STORAGE_DIR}/outbound/files`)
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

    return (tools.tools as A2AToolDefinition[]).map((def) => {
        const { $schema: _, ...jsonSchema } = zodToJsonSchema(def.schema, { target: "openAi" });
        return {
            name: `${A2A_CHANNEL_ID}_${def.name}`,
            label: `${A2A_CHANNEL_ID}_${def.name}`,
            description: def.description,
            parameters: jsonSchema as AgentTool["parameters"],
            execute: async (_toolCallId: string, params: Record<string, unknown>) =>
                jsonResult(await def.execute(params)),
        };
    });
}
