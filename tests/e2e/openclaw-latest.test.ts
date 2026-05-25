// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// End-to-end test that installs the latest `openclaw`, loads the locally-built
// plugin into it, starts the gateway, and exercises the A2A protocol surface
// over HTTP. The goal is to catch breakage from openclaw updates (plugin SDK,
// HTTP route registration, config schema, etc.) without needing an LLM in the
// loop — we assert on JSON-RPC envelope shape, not on agent reply content.
//
// Skipped unless `RUN_E2E=1` is set so it stays out of normal `bun test`. The
// nightly workflow at `.github/workflows/e2e-nightly.yml` runs it against
// `openclaw@latest`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUN = process.env.RUN_E2E === "1";
const describeE2E = RUN ? describe : describe.skip;

const PORT = 18789;
const BASE = `http://127.0.0.1:${PORT}`;
const PLUGIN_ROOT = resolve(import.meta.dir, "..", "..");
const OPENCLAW_VERSION = process.env.OPENCLAW_VERSION ?? "latest";

describeE2E(`openclaw@${OPENCLAW_VERSION} + plugin`, () => {
    let openclawBin: string;
    let gateway: ChildProcess | undefined;
    const tmpDirsToClean: string[] = [];

    beforeAll(async () => {
        // Build the plugin so dist/ is up to date — openclaw loads from dist/.
        const build = spawnSync("bun", ["run", "build"], {
            cwd: PLUGIN_ROOT,
            stdio: "inherit",
        });
        if (build.status !== 0) {
            throw new Error("plugin build failed");
        }

        // Isolated openclaw home — keeps the test hermetic and parallel-safe.
        const openclawHome = mkdtempSync(join(tmpdir(), "openclaw-e2e-"));
        const installRoot = mkdtempSync(join(tmpdir(), "openclaw-install-"));
        tmpDirsToClean.push(openclawHome, installRoot);

        // Install latest openclaw into a throwaway tree.
        const install = spawnSync(
            "npm",
            ["install", "--prefix", installRoot, "--no-save", `openclaw@${OPENCLAW_VERSION}`],
            { stdio: "inherit" },
        );
        if (install.status !== 0) {
            throw new Error("openclaw install failed");
        }
        openclawBin = join(installRoot, "node_modules", ".bin", "openclaw");
        if (!existsSync(openclawBin)) {
            throw new Error(`openclaw binary not found at ${openclawBin}`);
        }

        // Seed a minimal config so `plugins install` doesn't bail on an
        // unconfigured gateway. We rewrite it with our real config after the
        // install completes — running install first lets it recognize the
        // plugin so our `plugins.allow` / `plugins.entries.a2a` entries don't
        // get pruned as "stale".
        const configDir = join(openclawHome, ".openclaw");
        const configPath = join(configDir, "openclaw.json");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            configPath,
            JSON.stringify({ gateway: { mode: "local", auth: { mode: "none" } } }, null, 2),
        );

        // Pack the plugin to a tarball — installing from the source dir lets
        // the plugin's devDependency on openclaw shadow openclaw's peer link.
        const packDir = mkdtempSync(join(tmpdir(), "openclaw-plugin-pack-"));
        tmpDirsToClean.push(packDir);
        const pack = spawnSync(
            "npm",
            ["pack", PLUGIN_ROOT, "--pack-destination", packDir, "--silent"],
            { stdio: ["ignore", "pipe", "inherit"] },
        );
        if (pack.status !== 0) {
            throw new Error("npm pack failed");
        }
        const tarball = pack.stdout.toString().trim().split("\n").pop()?.trim();
        if (!tarball) {
            throw new Error("npm pack produced no tarball name");
        }
        const tarballPath = join(packDir, tarball);

        // Install the packed plugin into the isolated openclaw home.
        const pluginInstall = spawnSync(openclawBin, ["plugins", "install", tarballPath], {
            env: { ...process.env, OPENCLAW_HOME: openclawHome },
            stdio: "inherit",
        });
        if (pluginInstall.status !== 0) {
            throw new Error("plugin install into openclaw failed");
        }

        // Merge our config into the post-install config (which has `meta` and
        // `plugins.entries.a2a.enabled: true` written by the install command).
        // Preserving meta avoids tripping openclaw's "missing-meta-before-write"
        // tamper check and ensures the entries we add aren't pruned as stale.
        // message/send may produce a failed task (no LLM configured) — we only
        // assert envelope shape, not agent reply content.
        const installed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        const merged = {
            ...installed,
            gateway: { mode: "local", auth: { mode: "none" } },
            plugins: {
                ...(installed.plugins as Record<string, unknown> | undefined),
                allow: ["a2a"],
                entries: {
                    ...((installed.plugins as { entries?: Record<string, unknown> } | undefined)
                        ?.entries ?? {}),
                    a2a: {
                        enabled: true,
                        config: {
                            inbound: {
                                allowUnauthenticated: true,
                                agentCard: {
                                    name: "E2E Test Agent",
                                    description: "Used by openclaw-a2a-plugin e2e tests",
                                },
                            },
                        },
                    },
                },
            },
        };
        writeFileSync(configPath, JSON.stringify(merged, null, 2));

        // Start the gateway and wait until the Agent Card endpoint is live.
        gateway = spawn(openclawBin, ["gateway"], {
            env: { ...process.env, OPENCLAW_HOME: openclawHome },
            stdio: "inherit",
        });

        const deadline = Date.now() + 60_000;
        let lastStatus: number | string = "no-response";
        while (Date.now() < deadline) {
            try {
                const r = await fetch(`${BASE}/.well-known/agent-card.json`);
                lastStatus = r.status;
                if (r.ok) {
                    return;
                }
            } catch (err) {
                lastStatus = `error: ${(err as Error).message}`;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error(`gateway did not become ready within 60s (last status: ${lastStatus})`);
    }, 180_000);

    afterAll(async () => {
        if (gateway && !gateway.killed) {
            const exited = new Promise<void>((resolveExit) => {
                gateway?.once("exit", () => resolveExit());
            });
            gateway.kill("SIGTERM");
            const timeout = new Promise<void>((resolveExit) =>
                setTimeout(() => {
                    if (gateway && !gateway.killed) gateway.kill("SIGKILL");
                    resolveExit();
                }, 8_000),
            );
            await Promise.race([exited, timeout]);
        }
        for (const dir of tmpDirsToClean) {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);

    test("GET /.well-known/agent-card.json returns a well-formed Agent Card", async () => {
        const res = await fetch(`${BASE}/.well-known/agent-card.json`);
        expect(res.status).toBe(200);
        const card = (await res.json()) as Record<string, unknown>;
        expect(typeof card.name).toBe("string");
        expect(typeof card.description).toBe("string");
        expect(typeof card.url).toBe("string");
        expect(typeof card.version).toBe("string");
        expect(card.capabilities).toBeDefined();
        expect(Array.isArray(card.skills)).toBe(true);
    });

    test("POST /a2a rejects malformed JSON with a JSON-RPC parse error", async () => {
        const res = await fetch(`${BASE}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{not json",
        });
        const body = (await res.json()) as { error?: { code?: number } };
        expect(body.error?.code).toBe(-32700);
    });

    // `message/send` blocks until the embedded agent settles — without an LLM
    // configured the lane fails after a few seconds, so allow generous headroom
    // and assert only on envelope shape.
    test("POST /a2a message/send returns a valid JSON-RPC envelope", async () => {
        const res = await fetch(`${BASE}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "1",
                method: "message/send",
                params: {
                    message: {
                        messageId: crypto.randomUUID(),
                        role: "user",
                        parts: [{ kind: "text", text: "ping" }],
                    },
                },
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            jsonrpc?: string;
            id?: string;
            result?: { kind?: string; id?: string };
            error?: unknown;
        };
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe("1");
        if (body.result) {
            expect(["task", "message"]).toContain(body.result.kind);
        } else {
            expect(body.error).toBeDefined();
        }
    }, 30_000);

    test("POST /a2a tasks/get returns a JSON-RPC response for a non-existent task", async () => {
        const res = await fetch(`${BASE}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "2",
                method: "tasks/get",
                params: { id: "does-not-exist" },
            }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { jsonrpc?: string; error?: unknown; result?: unknown };
        expect(body.jsonrpc).toBe("2.0");
        // We only care that the method is still routed; either error or result is acceptable.
        expect(body.error !== undefined || body.result !== undefined).toBe(true);
    });

    test("POST /a2a message/stream opens an SSE stream", async () => {
        const res = await fetch(`${BASE}/a2a`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "3",
                method: "message/stream",
                params: {
                    message: {
                        messageId: crypto.randomUUID(),
                        role: "user",
                        parts: [{ kind: "text", text: "ping" }],
                    },
                },
            }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        // Read one chunk to confirm the stream is producing data, then close.
        const reader = res.body?.getReader();
        if (!reader) throw new Error("no stream body");
        const { value } = await reader.read();
        await reader.cancel();
        const chunk = new TextDecoder().decode(value ?? new Uint8Array());
        expect(chunk).toContain("data:");
    }, 30_000);
});
