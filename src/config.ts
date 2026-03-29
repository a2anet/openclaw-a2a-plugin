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

export type A2AInboundConfig = {
    allowUnauthenticated?: boolean;
    apiKeys?: A2AInboundKey[];
};

export type A2APluginConfig = {
    agents?: Record<string, A2AAgentEntry>;
    name?: string;
    description?: string;
    skills?: A2ASkillConfig[];
    inbound?: A2AInboundConfig;
    gatewayTimeout?: number;
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

function parseInbound(value: unknown): A2AInboundConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const allowUnauthenticated =
        typeof raw.allowUnauthenticated === "boolean" ? raw.allowUnauthenticated : undefined;
    let apiKeys: A2AInboundKey[] | undefined;
    if (Array.isArray(raw.apiKeys)) {
        apiKeys = [];
        for (const entry of raw.apiKeys) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                continue;
            }
            const e = entry as Record<string, unknown>;
            const label = typeof e.label === "string" ? e.label.trim() : "";
            const key = typeof e.key === "string" ? e.key : "";
            if (!label || !key) {
                continue;
            }
            apiKeys.push({ label, key });
        }
        if (apiKeys.length === 0) {
            apiKeys = undefined;
        }
    }
    if (allowUnauthenticated === undefined && apiKeys === undefined) {
        return undefined;
    }
    return {
        ...(allowUnauthenticated !== undefined ? { allowUnauthenticated } : {}),
        ...(apiKeys ? { apiKeys } : {}),
    };
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

export function parseA2APluginConfig(value: unknown): A2APluginConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const raw = value as Record<string, unknown>;
    const agents = parseAgents(raw.agents);
    const inbound = parseInbound(raw.inbound);
    const skills = parseSkills(raw.skills);

    const gatewayTimeout =
        typeof raw.gatewayTimeout === "number" && raw.gatewayTimeout > 0
            ? raw.gatewayTimeout
            : undefined;

    return {
        ...(agents ? { agents } : {}),
        name: typeof raw.name === "string" ? raw.name.trim() || undefined : undefined,
        description:
            typeof raw.description === "string" ? raw.description.trim() || undefined : undefined,
        ...(skills ? { skills } : {}),
        ...(inbound ? { inbound } : {}),
        ...(gatewayTimeout ? { gatewayTimeout } : {}),
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
 */
export function buildRootConfigWithA2A(
    rootConfig: Record<string, unknown>,
    a2aConfigUpdate: Record<string, unknown>,
): Record<string, unknown> {
    const { pluginsEntries, a2aEntry, a2aConfig } = extractA2AEntry(rootConfig);
    return {
        ...rootConfig,
        plugins: {
            ...(rootConfig.plugins as Record<string, unknown>),
            entries: {
                ...pluginsEntries,
                a2a: { ...a2aEntry, config: { ...a2aConfig, ...a2aConfigUpdate } },
            },
        },
    };
}
