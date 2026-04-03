// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { A2APluginConfig, A2ASkillConfig } from "../config.js";

/**
 * Resolve the agent name from OpenClaw config.
 * Navigates `config.agents.list[].identity.name` or `config.agents.list[].name`.
 */
function resolveAgentName(openclawConfig: OpenClawConfig, agentId: string): string | undefined {
    const agents = openclawConfig.agents?.list;
    if (!Array.isArray(agents)) {
        return undefined;
    }
    const entry = agents.find((a) => a.id?.toLowerCase() === agentId.toLowerCase());
    if (!entry) {
        return undefined;
    }
    const identityName = entry.identity?.name;
    return typeof identityName === "string"
        ? identityName
        : typeof entry.name === "string"
          ? entry.name
          : undefined;
}

function buildSkills(skills?: A2ASkillConfig[]): AgentSkill[] {
    if (!skills || skills.length === 0) {
        return [];
    }
    return skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags ?? [],
        ...(s.examples ? { examples: s.examples } : {}),
        inputModes: s.inputModes ?? ["text"],
        outputModes: s.outputModes ?? ["text"],
    }));
}

export type BuildAgentCardParams = {
    openclawConfig: OpenClawConfig;
    pluginConfig: A2APluginConfig;
    publicUrl: string;
    authRequired?: boolean;
    agentId?: string;
};

/**
 * Build an A2A Agent Card from OpenClaw's agent identity and plugin config.
 */
export function buildAgentCard(params: BuildAgentCardParams): AgentCard {
    const { openclawConfig, pluginConfig, publicUrl, authRequired } = params;
    const agentId = params.agentId ?? "main";

    const agentCardConfig = pluginConfig.inbound?.agentCard;
    const agentName = resolveAgentName(openclawConfig, agentId);
    const name = agentCardConfig?.name ?? agentName ?? `OpenClaw Agent (${agentId})`;
    const description = agentCardConfig?.description ?? "AI assistant powered by OpenClaw";
    const baseUrl = publicUrl.replace(/\/$/, "");

    const card: AgentCard = {
        name,
        description,
        protocolVersion: "0.3.0",
        version: "1.0.0",
        url: `${baseUrl}/a2a`,
        capabilities: {
            streaming: true,
            pushNotifications: false,
        },
        defaultInputModes: ["text"],
        defaultOutputModes: ["text"],
        skills: buildSkills(agentCardConfig?.skills),
    };

    if (authRequired) {
        card.securitySchemes = {
            a2aApiKey: { type: "apiKey", name: "Authorization", in: "header" },
        };
        card.security = [{ a2aApiKey: [] }];
    }

    return card;
}
