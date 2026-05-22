// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

/** OpenClaw agent ID used when a single inbound agent is exposed. */
export const DEFAULT_INBOUND_AGENT_ID = "main";

/** JSON-RPC endpoint path for the single-agent inbound configuration. */
export const SINGLE_AGENT_RPC_PATH = "/a2a";

/** Agent Card discovery path for the single-agent inbound configuration. */
export const SINGLE_AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** JSON-RPC endpoint path for a named inbound agent (`/a2a/<agentId>`). */
export function multiAgentRpcPath(agentId: string): string {
    return `${SINGLE_AGENT_RPC_PATH}/${agentId}`;
}

/** Agent Card discovery path for a named inbound agent (`/a2a/<agentId>/agent-card.json`). */
export function multiAgentCardPath(agentId: string): string {
    return `${SINGLE_AGENT_RPC_PATH}/${agentId}/agent-card.json`;
}
