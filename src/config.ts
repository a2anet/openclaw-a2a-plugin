// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { AgentSkill } from "@a2a-js/sdk";

/**
 * Skill config accepted from users — same as AgentSkill but with `tags` optional
 * and without `security` (handled at the agent card level).
 */
export type A2ASkillConfig = Omit<AgentSkill, "tags" | "security"> & { tags?: string[] };

export type A2AAgentEntry = {
    url: string;
    custom_headers?: Record<string, string>;
};

export type A2AInboundKey = {
    label: string;
    key: string;
};

export type A2AAgentCardConfig = {
    name?: string;
    description?: string;
    skills?: A2ASkillConfig[];
};

export type A2AOutboundConfig = {
    agents?: Record<string, A2AAgentEntry>;
    taskStore?: boolean;
    fileStore?: boolean;
    sendMessageCharacterLimit?: number;
    minimizedObjectStringLength?: number;
    viewArtifactCharacterLimit?: number;
    agentCardTimeout?: number;
    sendMessageTimeout?: number;
    getTaskTimeout?: number;
    getTaskPollInterval?: number;
};

export type A2AInboundConfig = {
    agentCard?: A2AAgentCardConfig;
    allowUnauthenticated?: boolean;
    apiKeys?: A2AInboundKey[];
};

export type A2APluginConfig = {
    outbound?: A2AOutboundConfig;
    inbound?: A2AInboundConfig;
};

function parseStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = value
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim());
    return result.length > 0 ? result : undefined;
}

function parseSkills(value: unknown): A2ASkillConfig[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result: A2ASkillConfig[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const raw = entry as Record<string, unknown>;
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        const description = typeof raw.description === "string" ? raw.description.trim() : "";
        if (!id || !name || !description) {
            continue;
        }
        const skill: A2ASkillConfig = { id, name, description };
        const tags = parseStringArray(raw.tags);
        if (tags) {
            skill.tags = tags;
        }
        const examples = parseStringArray(raw.examples);
        if (examples) {
            skill.examples = examples;
        }
        const inputModes = parseStringArray(raw.inputModes);
        if (inputModes) {
            skill.inputModes = inputModes;
        }
        const outputModes = parseStringArray(raw.outputModes);
        if (outputModes) {
            skill.outputModes = outputModes;
        }
        result.push(skill);
    }
    return result.length > 0 ? result : undefined;
}

function parseAgents(value: unknown): Record<string, A2AAgentEntry> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const result: Record<string, A2AAgentEntry> = {};
    for (const [id, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const e = entry as Record<string, unknown>;
        const url = typeof e.url === "string" ? e.url.trim() : "";
        if (!url) {
            continue;
        }
        let custom_headers: Record<string, string> | undefined;
        if (
            e.custom_headers &&
            typeof e.custom_headers === "object" &&
            !Array.isArray(e.custom_headers)
        ) {
            const filtered: Record<string, string> = {};
            for (const [hk, hv] of Object.entries(e.custom_headers as Record<string, unknown>)) {
                if (typeof hv === "string") {
                    filtered[hk] = hv;
                }
            }
            if (Object.keys(filtered).length > 0) {
                custom_headers = filtered;
            }
        }
        result[id] = { url, ...(custom_headers ? { custom_headers } : {}) };
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
    return typeof value === "number" && value > 0 ? value : undefined;
}

function parseApiKeys(value: unknown): A2AInboundKey[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const keys: A2AInboundKey[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const e = entry as Record<string, unknown>;
        const label = typeof e.label === "string" ? e.label.trim() : "";
        const key = typeof e.key === "string" ? e.key : "";
        if (!label || !key) {
            continue;
        }
        keys.push({ label, key });
    }
    return keys.length > 0 ? keys : undefined;
}

function parseAgentCard(value: unknown): A2AAgentCardConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() || undefined : undefined;
    const description =
        typeof raw.description === "string" ? raw.description.trim() || undefined : undefined;
    const skills = parseSkills(raw.skills);
    if (name === undefined && description === undefined && skills === undefined) {
        return undefined;
    }
    return {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(skills ? { skills } : {}),
    };
}

function parseOutbound(value: unknown): A2AOutboundConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const agents = parseAgents(raw.agents);
    const taskStore = typeof raw.taskStore === "boolean" ? raw.taskStore : undefined;
    const fileStore = typeof raw.fileStore === "boolean" ? raw.fileStore : undefined;
    const sendMessageCharacterLimit = parsePositiveNumber(raw.sendMessageCharacterLimit);
    const minimizedObjectStringLength = parsePositiveNumber(raw.minimizedObjectStringLength);
    const viewArtifactCharacterLimit = parsePositiveNumber(raw.viewArtifactCharacterLimit);
    const agentCardTimeout = parsePositiveNumber(raw.agentCardTimeout);
    const sendMessageTimeout = parsePositiveNumber(raw.sendMessageTimeout);
    const getTaskTimeout = parsePositiveNumber(raw.getTaskTimeout);
    const getTaskPollInterval = parsePositiveNumber(raw.getTaskPollInterval);

    const result: A2AOutboundConfig = {};
    if (agents) result.agents = agents;
    if (taskStore !== undefined) result.taskStore = taskStore;
    if (fileStore !== undefined) result.fileStore = fileStore;
    if (sendMessageCharacterLimit !== undefined)
        result.sendMessageCharacterLimit = sendMessageCharacterLimit;
    if (minimizedObjectStringLength !== undefined)
        result.minimizedObjectStringLength = minimizedObjectStringLength;
    if (viewArtifactCharacterLimit !== undefined)
        result.viewArtifactCharacterLimit = viewArtifactCharacterLimit;
    if (agentCardTimeout !== undefined) result.agentCardTimeout = agentCardTimeout;
    if (sendMessageTimeout !== undefined) result.sendMessageTimeout = sendMessageTimeout;
    if (getTaskTimeout !== undefined) result.getTaskTimeout = getTaskTimeout;
    if (getTaskPollInterval !== undefined) result.getTaskPollInterval = getTaskPollInterval;

    return Object.keys(result).length > 0 ? result : undefined;
}

function parseInbound(value: unknown): A2AInboundConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const agentCard = parseAgentCard(raw.agentCard);
    const allowUnauthenticated =
        typeof raw.allowUnauthenticated === "boolean" ? raw.allowUnauthenticated : undefined;
    const apiKeys = parseApiKeys(raw.apiKeys);

    if (agentCard === undefined && allowUnauthenticated === undefined && apiKeys === undefined) {
        return undefined;
    }
    return {
        ...(agentCard ? { agentCard } : {}),
        ...(allowUnauthenticated !== undefined ? { allowUnauthenticated } : {}),
        ...(apiKeys ? { apiKeys } : {}),
    };
}

export function parseA2APluginConfig(value: unknown): A2APluginConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const raw = value as Record<string, unknown>;
    const outbound = parseOutbound(raw.outbound);
    const inbound = parseInbound(raw.inbound);

    return {
        ...(outbound ? { outbound } : {}),
        ...(inbound ? { inbound } : {}),
    };
}

/**
 * Extract the A2A plugin config section from a full OpenClaw root config.
 */
export function extractA2AEntry(rootConfig: Record<string, unknown>): {
    pluginsEntries: Record<string, unknown>;
    a2aEntry: Record<string, unknown>;
    a2aConfig: Record<string, unknown>;
} {
    const pluginsEntries =
        ((rootConfig.plugins as Record<string, unknown> | undefined)?.entries as
            | Record<string, unknown>
            | undefined) ?? {};
    const a2aEntry = (pluginsEntries.a2a ?? {}) as Record<string, unknown>;
    const a2aConfig = (a2aEntry.config ?? {}) as Record<string, unknown>;
    return { pluginsEntries, a2aEntry, a2aConfig };
}

/**
 * Build a new root config with updated A2A plugin config merged in.
 * Performs a deep merge on the `inbound` key to preserve sibling fields
 * (e.g. updating `inbound.agentCard` without clobbering `inbound.apiKeys`).
 */
export function buildRootConfigWithA2A(
    rootConfig: Record<string, unknown>,
    a2aConfigUpdate: Record<string, unknown>,
): Record<string, unknown> {
    const { pluginsEntries, a2aEntry, a2aConfig } = extractA2AEntry(rootConfig);

    // Deep merge inbound so that updating agentCard doesn't clobber apiKeys,
    // and updating a single agentCard field doesn't clobber sibling card fields.
    let merged: Record<string, unknown>;
    if (a2aConfigUpdate.inbound && a2aConfig.inbound) {
        const { inbound: inboundUpdate, ...rest } = a2aConfigUpdate;
        const existingInbound = a2aConfig.inbound as Record<string, unknown>;
        const nextInbound = inboundUpdate as Record<string, unknown>;

        let mergedInbound: Record<string, unknown> = {
            ...existingInbound,
            ...nextInbound,
        };

        if (existingInbound.agentCard && nextInbound.agentCard) {
            mergedInbound = {
                ...mergedInbound,
                agentCard: {
                    ...(existingInbound.agentCard as Record<string, unknown>),
                    ...(nextInbound.agentCard as Record<string, unknown>),
                },
            };
        }

        merged = {
            ...a2aConfig,
            ...rest,
            inbound: mergedInbound,
        };
    } else {
        merged = { ...a2aConfig, ...a2aConfigUpdate };
    }

    return {
        ...rootConfig,
        plugins: {
            ...(rootConfig.plugins as Record<string, unknown>),
            entries: {
                ...pluginsEntries,
                a2a: { ...a2aEntry, config: merged },
            },
        },
    };
}
