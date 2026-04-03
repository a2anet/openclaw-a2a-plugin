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
import { Type } from "@sinclair/typebox";

import type { A2AAgentEntry } from "../config.js";
import { type AgentTool, type AgentToolResult, jsonResult } from "../types.js";

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
 * This is the thin wrapper that bridges A2ATools methods to OpenClaw's
 * tool registration format — analogous to how a2a-mcp wraps A2ATools for MCP.
 */
export function createOutboundTools(
  params: CreateOutboundToolsParams,
): AgentTool[] {
  const agents = new A2AAgents(
    params.agents as Record<string, Record<string, unknown>>,
    params.agentCardTimeout !== undefined
      ? { timeout: params.agentCardTimeout }
      : undefined,
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

  return [
    {
      name: "a2a_get_agents",
      label: "a2a_get_agents",
      description:
        "List all available remote A2A agents with their names and descriptions. " +
        "Use this first to discover what agents are available before sending messages. " +
        "Each agent has a unique ID that you'll need for other A2A tools.",
      parameters: Type.Object({}),
      execute: async () => jsonResult(await tools.getAgents()),
    },
    {
      name: "a2a_get_agent",
      label: "a2a_get_agent",
      description:
        "Get detailed information about a specific remote A2A agent, including its skills. " +
        "Use this after a2a_get_agents to learn more about what a specific agent can do.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "The agent's unique identifier (from a2a_get_agents).",
        }),
      }),
      execute: async (_id, p) =>
        jsonResult(await tools.getAgent(p.agent_id as string)),
    },
    {
      name: "a2a_send_message",
      label: "a2a_send_message",
      description:
        "Send a message to a remote A2A agent and receive a structured response. " +
        "Artifact data in responses may be minimized for display. Fields prefixed with '_' " +
        "indicate metadata about minimized content. Use a2a_view_text_artifact or " +
        "a2a_view_data_artifact to access full artifact data. " +
        "If the task is still in progress after the timeout, the response includes a task_id. " +
        "Use a2a_get_task with that task_id to continue monitoring.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "ID of the agent to message (from a2a_get_agents).",
        }),
        message: Type.String({ description: "The message content to send." }),
        context_id: Type.Optional(
          Type.String({
            description:
              "Continue an existing conversation by providing its context ID.",
          }),
        ),
        task_id: Type.Optional(
          Type.String({
            description:
              "Attach to an existing task (for input_required flows).",
          }),
        ),
        timeout: Type.Optional(
          Type.Number({
            description: "Override the default timeout in seconds.",
          }),
        ),
        data: Type.Optional(
          Type.Array(Type.Unknown(), {
            description:
              "Structured data to include with the message. " +
              "Each item is sent as a separate JSON object or array alongside the text.",
          }),
        ),
        files: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "Files to include with the message. " +
              "Accepts local file paths (read and sent as binary, max 1MB) " +
              "or URLs (sent as references for the remote agent to fetch).",
          }),
        ),
      }),
      execute: async (_id, p) =>
        jsonResult(
          await tools.sendMessage(p.agent_id as string, p.message as string, {
            contextId: (p.context_id as string) ?? null,
            taskId: (p.task_id as string) ?? null,
            timeout: (p.timeout as number) ?? null,
            data: (p.data as unknown[]) ?? undefined,
            files: (p.files as string[]) ?? undefined,
          }),
        ),
    },
    {
      name: "a2a_get_task",
      label: "a2a_get_task",
      description:
        "Check the progress of an A2A task that is still in progress. " +
        "Use this after a2a_send_message returns a task in a non-terminal state " +
        '(e.g. "working") to monitor its progress. ' +
        "If the task is still running after the timeout, the current state is returned. " +
        "Call a2a_get_task again to continue monitoring.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "ID of the agent that owns the task.",
        }),
        task_id: Type.String({
          description: "Task ID from a previous a2a_send_message response.",
        }),
        timeout: Type.Optional(
          Type.Number({
            description: "Override the monitoring timeout in seconds.",
          }),
        ),
        poll_interval: Type.Optional(
          Type.Number({
            description:
              "Override the interval between status checks in seconds.",
          }),
        ),
      }),
      execute: async (_id, p) =>
        jsonResult(
          await tools.getTask(
            p.agent_id as string,
            p.task_id as string,
            (p.timeout as number) ?? null,
            (p.poll_interval as number) ?? null,
          ),
        ),
    },
    {
      name: "a2a_view_text_artifact",
      label: "a2a_view_text_artifact",
      description:
        "View text content from an artifact, optionally selecting a range. " +
        "Use this for artifacts containing text (documents, logs, code, etc.). " +
        "You can select by line range OR character range, but not both.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "ID of the agent that produced the artifact.",
        }),
        task_id: Type.String({
          description: "Task ID containing the artifact.",
        }),
        artifact_id: Type.String({
          description:
            "The artifact's unique identifier (from the task's artifacts list).",
        }),
        line_start: Type.Optional(
          Type.Number({
            description: "Starting line number (1-based, inclusive).",
          }),
        ),
        line_end: Type.Optional(
          Type.Number({
            description: "Ending line number (1-based, inclusive).",
          }),
        ),
        character_start: Type.Optional(
          Type.Number({
            description: "Starting character index (0-based, inclusive).",
          }),
        ),
        character_end: Type.Optional(
          Type.Number({
            description: "Ending character index (0-based, exclusive).",
          }),
        ),
      }),
      execute: async (_id, p) =>
        jsonResult(
          await tools.viewTextArtifact(
            p.agent_id as string,
            p.task_id as string,
            p.artifact_id as string,
            (p.line_start as number) ?? null,
            (p.line_end as number) ?? null,
            (p.character_start as number) ?? null,
            (p.character_end as number) ?? null,
          ),
        ),
    },
    {
      name: "a2a_view_data_artifact",
      label: "a2a_view_data_artifact",
      description:
        "View structured data from an artifact with optional filtering. " +
        "Use this for artifacts containing JSON data (objects, arrays, tables). " +
        "You can navigate to specific data with json_path, then filter with " +
        "rows and columns for tabular data.",
      parameters: Type.Object({
        agent_id: Type.String({
          description: "ID of the agent that produced the artifact.",
        }),
        task_id: Type.String({
          description: "Task ID containing the artifact.",
        }),
        artifact_id: Type.String({
          description:
            "The artifact's unique identifier (from the task's artifacts list).",
        }),
        json_path: Type.Optional(
          Type.String({
            description:
              'Dot-separated path to navigate into the data (e.g. "results.items").',
          }),
        ),
        rows: Type.Optional(
          Type.String({
            description:
              'Row selection for list data. Examples: "0" (single), "0-10" (range), "0,2,5" (specific), "all".',
          }),
        ),
        columns: Type.Optional(
          Type.String({
            description:
              'Column selection for tabular data. Examples: "name" (single), "name,age" (multiple), "all".',
          }),
        ),
      }),
      execute: async (_id, p) =>
        jsonResult(
          await tools.viewDataArtifact(
            p.agent_id as string,
            p.task_id as string,
            p.artifact_id as string,
            (p.json_path as string) ?? null,
            (p.rows as string) ?? null,
            (p.columns as string) ?? null,
          ),
        ),
    },
  ];
}
