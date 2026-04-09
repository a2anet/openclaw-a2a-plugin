// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { A2AInboundKey } from "../config.js";

export const A2A_INBOUND_KEY_LABEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidA2AInboundKeyLabel(label: string): boolean {
    return A2A_INBOUND_KEY_LABEL_PATTERN.test(label);
}

export function parseA2AInboundKeyLabel(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const label = value.trim();
    return isValidA2AInboundKeyLabel(label) ? label : undefined;
}

export function assertValidA2AInboundKeyLabel(value: string): string {
    const label = value.trim();
    if (!isValidA2AInboundKeyLabel(label)) {
        throw new Error("API key label must match ^[A-Za-z0-9._-]{1,64}$");
    }
    return label;
}

export function assertUniqueA2AInboundKeyLabels(keys: Pick<A2AInboundKey, "label">[]): void {
    const seen = new Set<string>();
    for (const key of keys) {
        const normalized = key.label.trim().toLowerCase();
        if (seen.has(normalized)) {
            throw new Error(`Inbound API key labels must be unique: "${key.label}"`);
        }
        seen.add(normalized);
    }
}
