// SPDX-FileCopyrightText: 2025-present A2A Net <hello@a2anet.com>
//
// SPDX-License-Identifier: Apache-2.0

// Shared setup for the e2e suite: install `openclaw@latest` into a throwaway
// tree once per process, pack the plugin into a tarball once, then offer
// `startGateway(...)` which prepares a fresh `OPENCLAW_HOME`, installs the
// plugin into it, merges a per-test config into the post-install file, spawns
// the gateway, and waits for the configured readiness path to come up.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PLUGIN_ROOT = resolve(import.meta.dir, "..", "..");
export const OPENCLAW_VERSION = process.env.OPENCLAW_VERSION ?? "latest";

type SharedTooling = {
    openclawBin: string;
    tarballPath: string;
};

let sharedToolingPromise: Promise<SharedTooling> | undefined;
let orphanCleanupDone = false;

/**
 * Wipe leftover e2e temp dirs from previous (possibly crashed) runs.
 *
 * Bun's test runner does not invoke `process.on("exit"/"beforeExit")` handlers,
 * so we cannot reliably clean up at the end of a run. Each `openclaw-install-*`
 * dir is ~500MB; left unattended they fill the disk. Cleaning at startup is
 * the simplest robust strategy: every run begins with a clean slate, and a
 * crash mid-run is repaired on the next invocation.
 */
function cleanupOrphanedTempDirs(): void {
    if (orphanCleanupDone) return;
    orphanCleanupDone = true;
    const dir = tmpdir();
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        if (/^openclaw-(install|plugin-pack|e2e)-/.test(name)) {
            try {
                rmSync(join(dir, name), { recursive: true, force: true });
            } catch {
                // Best-effort; OS will reap tmpdir eventually.
            }
        }
    }
}

/**
 * Install `openclaw@latest` and pack the plugin, exactly once per Bun process.
 * Subsequent callers receive the cached paths. Orphaned temp dirs from prior
 * runs are wiped at the start of the first call.
 */
export function getSharedTooling(): Promise<SharedTooling> {
    if (sharedToolingPromise) {
        return sharedToolingPromise;
    }
    cleanupOrphanedTempDirs();
    sharedToolingPromise = (async () => {
        // Build the plugin so dist/ is up to date — openclaw loads from dist/.
        const build = spawnSync("bun", ["run", "build"], {
            cwd: PLUGIN_ROOT,
            stdio: "inherit",
        });
        if (build.status !== 0) {
            throw new Error("plugin build failed");
        }

        const installRoot = mkdtempSync(join(tmpdir(), "openclaw-install-"));

        const install = spawnSync(
            "npm",
            ["install", "--prefix", installRoot, "--no-save", `openclaw@${OPENCLAW_VERSION}`],
            { stdio: "inherit" },
        );
        if (install.status !== 0) {
            throw new Error("openclaw install failed");
        }
        const openclawBin = join(installRoot, "node_modules", ".bin", "openclaw");
        if (!existsSync(openclawBin)) {
            throw new Error(`openclaw binary not found at ${openclawBin}`);
        }

        // Pack the plugin to a tarball — installing from the source dir lets
        // the plugin's devDependency on openclaw shadow openclaw's peer link.
        const packDir = mkdtempSync(join(tmpdir(), "openclaw-plugin-pack-"));
        const pack = spawnSync(
            "npm",
            ["pack", PLUGIN_ROOT, "--pack-destination", packDir, "--silent"],
            { stdio: ["ignore", "pipe", "inherit"] },
        );
        if (pack.status !== 0) {
            throw new Error("npm pack failed");
        }
        const tarballName = pack.stdout.toString().trim().split("\n").pop()?.trim();
        if (!tarballName) {
            throw new Error("npm pack produced no tarball name");
        }
        const tarballPath = join(packDir, tarballName);

        return { openclawBin, tarballPath };
    })();
    return sharedToolingPromise;
}

export type GatewayConfig = {
    port: number;
    /** Plugin config object passed verbatim under `plugins.entries.a2a.config`. */
    pluginConfig: Record<string, unknown>;
    /** Optional gateway-level overrides, merged into `gateway`. */
    gateway?: Record<string, unknown>;
    /**
     * Path to poll for readiness. The helper waits until this returns 200, which
     * confirms the plugin has registered its HTTP routes (the gateway itself is
     * up before plugins finish loading). Defaults to `/.well-known/agent-card.json`
     * (single-agent inbound). For multi-agent, pass one of the per-agent paths
     * such as `/a2a/<agentId>/agent-card.json`. For outbound-only configs, set
     * `readinessPath: null` to skip the wait — the helper polls a TCP connection
     * instead.
     */
    readinessPath?: string | null;
};

export type Gateway = {
    base: string;
    process: ChildProcess;
    home: string;
    stop: () => Promise<void>;
};

/**
 * Install the plugin tarball into a fresh `OPENCLAW_HOME`, merge the supplied
 * plugin config into the post-install `openclaw.json`, spawn the gateway, and
 * resolve once the configured readiness path responds with 200.
 */
export async function startGateway(config: GatewayConfig): Promise<Gateway> {
    const { openclawBin, tarballPath } = await getSharedTooling();
    const home = mkdtempSync(join(tmpdir(), "openclaw-e2e-"));
    const configDir = join(home, ".openclaw");
    const configPath = join(configDir, "openclaw.json");
    mkdirSync(configDir, { recursive: true });

    const gatewayBase = { mode: "local", auth: { mode: "none" }, ...(config.gateway ?? {}) };
    writeFileSync(configPath, JSON.stringify({ gateway: gatewayBase }, null, 2));

    const pluginInstall = spawnSync(openclawBin, ["plugins", "install", tarballPath], {
        env: { ...process.env, OPENCLAW_HOME: home },
        stdio: "inherit",
    });
    if (pluginInstall.status !== 0) {
        throw new Error("plugin install into openclaw failed");
    }

    const installed = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const installedPlugins =
        (installed.plugins as { entries?: Record<string, unknown> } | undefined) ?? {};
    const merged = {
        ...installed,
        gateway: { ...((installed.gateway as Record<string, unknown>) ?? {}), ...gatewayBase },
        plugins: {
            ...installedPlugins,
            entries: {
                ...(installedPlugins.entries ?? {}),
                a2a: {
                    enabled: true,
                    config: config.pluginConfig,
                },
            },
        },
    };
    writeFileSync(configPath, JSON.stringify(merged, null, 2));

    const logs: string[] = [];
    const proc = spawn(openclawBin, ["gateway", "--port", String(config.port)], {
        env: { ...process.env, OPENCLAW_HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (d: Buffer) => {
        logs.push(d.toString());
    });
    proc.stderr?.on("data", (d: Buffer) => {
        logs.push(d.toString());
    });
    const base = `http://127.0.0.1:${config.port}`;

    const readinessPath =
        config.readinessPath === undefined ? "/.well-known/agent-card.json" : config.readinessPath;
    const deadline = Date.now() + 60_000;
    let lastStatus: number | string = "no-response";
    let ready = false;
    while (Date.now() < deadline) {
        if (readinessPath === null) {
            try {
                const r = await fetch(`${base}/healthz`).catch(() => fetch(`${base}/`));
                lastStatus = r.status;
                ready = true;
                break;
            } catch (err) {
                lastStatus = `error: ${(err as Error).message}`;
            }
        } else {
            try {
                const r = await fetch(`${base}${readinessPath}`);
                lastStatus = r.status;
                // 200 means served; 401/403 means the plugin's route is registered
                // but auth is rejecting us — that's also "ready" for our purposes.
                if (r.status === 200 || r.status === 401 || r.status === 403) {
                    ready = true;
                    break;
                }
            } catch (err) {
                lastStatus = `error: ${(err as Error).message}`;
            }
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
        proc.kill("SIGTERM");
        const tail = logs.join("").split("\n").slice(-40).join("\n");
        throw new Error(
            `gateway on port ${config.port} did not become ready within 60s (last status: ${lastStatus})\n--- gateway logs (tail) ---\n${tail}`,
        );
    }

    const stop = async (): Promise<void> => {
        if (!proc.killed) {
            const exited = new Promise<void>((resolveExit) => {
                proc.once("exit", () => resolveExit());
            });
            proc.kill("SIGTERM");
            await Promise.race([
                exited,
                new Promise<void>((resolveExit) =>
                    setTimeout(() => {
                        if (!proc.killed) proc.kill("SIGKILL");
                        resolveExit();
                    }, 8_000),
                ),
            ]);
        }
        rmSync(home, { recursive: true, force: true });
    };

    return { base, process: proc, home, stop };
}

export async function postJsonRpc<T = unknown>(
    base: string,
    path: string,
    body: Record<string, unknown>,
): Promise<{ status: number; json: T }> {
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as T };
}
