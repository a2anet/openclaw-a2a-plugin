// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { A2AAgentCardConfig, A2ASkillConfig } from "../config.js";
import { DEFAULT_INBOUND_AGENT_ID, SINGLE_AGENT_RPC_PATH } from "./paths.js";

export type BuildAgentCardParams = {
    openclawConfig: OpenClawConfig;
    publicUrl: string;
    authRequired?: boolean;
    /** OpenClaw agent ID this card represents (used for name resolution). */
    agentId?: string;
    /** Agent Card metadata (name, description, skills) for this agent. */
    agentCardConfig?: A2AAgentCardConfig;
    /** Path the JSON-RPC endpoint is served on, appended to `publicUrl`. */
    rpcPath?: string;
};

export class AgentCardBuilder {
    private readonly agentId: string;
    private readonly agentCardConfig?: A2AAgentCardConfig;
    private readonly rpcPath: string;

    constructor(private readonly params: BuildAgentCardParams) {
        this.agentId = params.agentId ?? DEFAULT_INBOUND_AGENT_ID;
        this.agentCardConfig = params.agentCardConfig;
        this.rpcPath = params.rpcPath ?? SINGLE_AGENT_RPC_PATH;
    }

    build(): AgentCard {
        const name =
            this.agentCardConfig?.name ??
            this.resolveAgentName() ??
            `OpenClaw Agent (${this.agentId})`;
        const description = this.agentCardConfig?.description ?? "AI assistant powered by OpenClaw";
        const baseUrl = this.params.publicUrl.replace(/\/$/, "");

        const card: AgentCard = {
            name,
            description,
            protocolVersion: "0.3.0",
            version: "1.0.0",
            url: `${baseUrl}${this.rpcPath}`,
            capabilities: {
                streaming: true,
                pushNotifications: false,
            },
            defaultInputModes: ["text"],
            defaultOutputModes: ["text"],
            skills: this.buildSkills(),
        };

        if (this.params.authRequired) {
            card.securitySchemes = {
                a2aApiKey: { type: "apiKey", name: "Authorization", in: "header" },
            };
            card.security = [{ a2aApiKey: [] }];
        }

        return card;
    }

    /**
     * Resolve the agent name from OpenClaw config.
     * Navigates `config.agents.list[].identity.name` or `config.agents.list[].name`.
     */
    private resolveAgentName(): string | undefined {
        const agents = this.params.openclawConfig.agents?.list;
        if (!Array.isArray(agents)) {
            return undefined;
        }
        const entry = agents.find((a) => a.id?.toLowerCase() === this.agentId.toLowerCase());
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

    private buildSkills(): AgentSkill[] {
        if (!this.agentCardConfig?.skills || this.agentCardConfig.skills.length === 0) {
            return [];
        }
        return this.agentCardConfig.skills.map((skill: A2ASkillConfig) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            tags: skill.tags ?? [],
            ...(skill.examples ? { examples: skill.examples } : {}),
            inputModes: skill.inputModes ?? ["text"],
            outputModes: skill.outputModes ?? ["text"],
        }));
    }
}
