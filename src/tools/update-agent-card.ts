// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import { Type } from "@sinclair/typebox";

import { type A2APluginConfig, buildRootConfigWithA2A } from "../config.js";
import { type AgentTool, jsonResult } from "../types.js";

export type UpdateAgentCardDeps = {
    loadConfig: () => Promise<Record<string, unknown>>;
    writeConfigFile: (config: Record<string, unknown>) => Promise<void>;
    /** Called after config is written to update the in-memory agent card. */
    updateLiveCard: (patch: Partial<A2APluginConfig>) => void;
};

/**
 * Create the a2a_update_agent_card tool for live-updating the inbound agent card.
 */
export function createUpdateAgentCardTool(deps: UpdateAgentCardDeps): AgentTool {
    return {
        name: "a2a_update_agent_card",
        label: "A2A: Update Agent Card",
        description:
            "Update this agent's A2A Agent Card. Changes take effect immediately for " +
            "incoming discovery requests, and are persisted to config. " +
            "At least one of name, description, or skills must be provided.",
        parameters: Type.Object({
            name: Type.Optional(Type.String({ description: "New agent card name." })),
            description: Type.Optional(Type.String({ description: "New agent card description." })),
            skills: Type.Optional(
                Type.Array(
                    Type.Object({
                        id: Type.String({ description: "Unique skill identifier." }),
                        name: Type.String({ description: "Human-readable skill name." }),
                        description: Type.String({ description: "What this skill does." }),
                        tags: Type.Optional(Type.Array(Type.String())),
                        examples: Type.Optional(Type.Array(Type.String())),
                    }),
                    { description: "Replace the agent card's advertised skills." },
                ),
            ),
        }),
        async execute(_toolCallId, params) {
            const name = typeof params.name === "string" ? params.name.trim() : undefined;
            const description =
                typeof params.description === "string" ? params.description.trim() : undefined;
            const skills = Array.isArray(params.skills) ? params.skills : undefined;

            if (!name && !description && !skills) {
                return jsonResult({
                    error: true,
                    error_message: "At least one of name, description, or skills must be provided.",
                });
            }

            const patch: Partial<A2APluginConfig> = {};
            if (name) {
                patch.name = name;
            }
            if (description) {
                patch.description = description;
            }
            if (skills) {
                patch.skills = skills.map((s: Record<string, unknown>) => ({
                    id: String(s.id ?? ""),
                    name: String(s.name ?? ""),
                    description: String(s.description ?? ""),
                    ...(Array.isArray(s.tags) ? { tags: s.tags.map(String) } : {}),
                    ...(Array.isArray(s.examples) ? { examples: s.examples.map(String) } : {}),
                }));
            }

            try {
                // Persist to config file
                const currentConfig = await deps.loadConfig();
                await deps.writeConfigFile(buildRootConfigWithA2A(currentConfig, patch));

                // Update in-memory card
                deps.updateLiveCard(patch);

                const changes: string[] = [];
                if (name) {
                    changes.push(`name: "${name}"`);
                }
                if (description) {
                    changes.push(`description: "${description}"`);
                }
                if (skills) {
                    changes.push(`skills: ${skills.length} skill(s)`);
                }

                return jsonResult({
                    updated: changes,
                    note: "Changes are live and persisted to config.",
                });
            } catch (err) {
                return jsonResult({
                    error: true,
                    error_message: `Failed to update agent card: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        },
    };
}
