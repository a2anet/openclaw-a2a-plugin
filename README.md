# OpenClaw A2A Plugin

[![npm version](https://img.shields.io/npm/v/@a2anet/openclaw-a2a-plugin.svg)](https://www.npmjs.com/package/@a2anet/openclaw-a2a-plugin) [![License](https://img.shields.io/github/license/a2anet/openclaw-a2a-plugin)](https://github.com/a2anet/openclaw-a2a-plugin/blob/main/LICENSE) [![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue)](https://a2a-protocol.org) [![Discord](https://img.shields.io/discord/1391916121589944320?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/674NGXpAjU)

[OpenClaw](https://openclaw.ai) [A2A protocol](https://a2a-project.org/) community plugin.
Send messages and files to other agents over the internet, and/or allow your agent to receive messages and files with Tailscale.
The plugin is powered by [A2A Utils](https://github.com/a2anet/a2a-utils), a comprehensive set of utility functions for using [A2A servers (remote agents)](https://a2a-protocol.org/latest/topics/key-concepts/#core-actors-in-a2a-interactions), that powers the [A2A MCP Server](https://github.com/a2anet/a2a-mcp).

## 💡 Use Cases

- Connect a sandboxed local OpenClaw to a full access OpenClaw in the cloud to efficiently share context and files
- Connect your OpenClaw with a classmate's or co-worker's to work together on a project
- Connect your OpenClaw with a company-wide OpenClaw to ask questions, give updates, and access company accounts and services
- Connect your OpenClaw to agents on A2A marketplaces to ehance OpenClaw's capabilities
- Connect your OpenClaw with a friend's to plan a fun day out based on what it knows about you
- Connect your OpenClaw with a co-worker's to schedule a meeting and share all required information, documents, etc. up front

## ✨ Features

- **Send messages to remote agents** — 6 outbound tools (`a2a_get_agents`, `a2a_get_agent`, `a2a_send_message`, `a2a_get_task`, `a2a_view_text_artifact`, `a2a_view_data_artifact`) for communicating with any A2A agent
- **Receive messages from remote agents** — expose your OpenClaw agent as an A2A server with Agent Card discovery, JSON-RPC 2.0 endpoint, and SSE streaming
- **Send and receive files** — outbound messages can include local file paths (up to 1MB) or URLs; inbound files are saved locally
- **Multi-turn conversations** — continue conversations across multiple messages using `context_id`
- **Long-running task support** — if `a2a_send_message` times out, use `a2a_get_task` to monitor until the task reaches a terminal state
- **Automatic artifact minimization** — large text and data artifacts are automatically minimized for LLM context windows, with dedicated tools for detailed navigation
- **Inbound authentication** — API key-based auth with timing-safe HMAC-SHA256 comparison, per-key labels, and CLI key management
- **Live Agent Card updates** — update your agent's name, description, and skills at runtime with `a2a_update_agent_card` without restarting
- **Tailscale integration** — expose your agent to the internet via Tailscale Funnel, or restrict to your tailnet with Tailscale Serve
- **Custom headers and outbound auth** — per-agent custom headers with `${ENV_VAR}` substitution for secrets
- **Configurable timeouts and limits** — control character limits, timeouts, poll intervals, and whether to enable task and file storage

## 🤖 A2A Core Concepts

The [A2A protocol](https://a2a-project.org/) is a protocol for agent-to-agent communication supported by AWS, Azure, GCP, and [150+ enterprises](https://a2a-protocol.org/latest/partners/).

- **Agent Card** — A JSON object at a publicly available URL (e.g. `/.well-known/agent-card.json`) that describes an agent (name, description, skills, etc).
- **Message** — a single communication turn between agents, containing one or
  more Parts. Each message has a role (`user` or `agent`).
- **Part** — content within a Message, Task, or Artifact: text (`TextPart`), JSON data (`DataPart`), or files (`FilePart`).
- **Task** — a unit of work with a unique ID. Useful for long-running tasks, agents can disconnect and poll intermittently.
- **Artifact** — output produced by a task (e.g. generated text, JSON data, files).

## 📦 Installation

To install the plugin:

```bash
openclaw plugins install @a2anet/openclaw-a2a-plugin
```

Then restart the gateway:

```bash
openclaw gateway restart
```

Follow the set up instructions in "📤 Sending Messages (outbound)" and/or "📥 Receiving Messages (inbound)".

## 📤 Sending Messages (outbound)

### Set Up

Configure at least one remote agent in your OpenClaw config. You just need the
remote agent's Agent Card URL (and API key, if required). No Tailscale or port
exposure needed.

```json
{
    "tools": {
        "profile": "full"
    },
    "plugins": {
        "entries": {
            "a2a": {
                "enabled": true,
                "config": {
                    "outbound": {
                        "agents": {
                            "weather": {
                                "url": "https://weather-agent.example.com/.well-known/agent-card.json"
                            },
                            "search": {
                                "url": "https://example.com/search-agent/agent-card.json",
                                "custom_headers": {
                                    "Authorization": "Bearer ${SEARCH_API_KEY}"
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "sandbox": {
        "tools": {
            "alsoAllow": [
                "a2a_get_agents",
                "a2a_get_agent",
                "a2a_send_message",
                "a2a_get_task",
                "a2a_view_text_artifact",
                "a2a_view_data_artifact"
            ]
        }
    }
}
```

> **Note:** Header values support `${ENV_VAR}` substitution so you can keep secrets out of
> your config file.
> The "sandbox" section is only required if sandbox is enabled.

| Field                         | Type                                     | Default | Description                                                 |
| ----------------------------- | ---------------------------------------- | ------- | ----------------------------------------------------------- |
| `agents`                      | `Record<string, {url, custom_headers?}>` | —       | Named remote agents. Keys are agent IDs used in tool calls. |
| `taskStore`                   | `boolean`                                | `true`  | Enable persistent task storage.                             |
| `fileStore`                   | `boolean`                                | `true`  | Enable persistent file artifact storage.                    |
| `sendMessageCharacterLimit`   | `number`                                 | `50000` | Maximum characters for minimized artifact text.             |
| `minimizedObjectStringLength` | `number`                                 | `5000`  | Maximum string length for minimized data objects.           |
| `viewArtifactCharacterLimit`  | `number`                                 | `50000` | Maximum characters returned by view artifact tools.         |
| `agentCardTimeout`            | `number`                                 | `15`    | Timeout in seconds for fetching remote agent cards.         |
| `sendMessageTimeout`          | `number`                                 | `60`    | Timeout in seconds for send message requests.               |
| `getTaskTimeout`              | `number`                                 | `60`    | Timeout in seconds for get task monitoring.                 |
| `getTaskPollInterval`         | `number`                                 | `5`     | Interval in seconds between task status polls.              |

### Tools

The `a2a_*` tools are registered when at least one agent is configured (`agents`).
The plugin is powered by [A2A Utils](https://github.com/a2anet/a2a-utils), for example tool usage, results, etc. see [A2A Utils JavaScript A2ATools](https://github.com/a2anet/a2a-utils/blob/main/javascript/README.md#a2atools).

#### `a2a_get_agents`

List all available remote A2A agents with names and descriptions.

No parameters.

#### `a2a_get_agent`

Get detailed info about a specific agent, including skills.

| Parameter  | Type   | Required | Description                   |
| ---------- | ------ | -------- | ----------------------------- |
| `agent_id` | string | Yes      | The agent's unique identifier |

#### `a2a_send_message`

Send a message to a remote agent and receive a structured response. The message
is sent non-blocking — the tool streams or polls for updates until the task
reaches a terminal state or the timeout is reached. If the task is still in
progress after the timeout, the current task state is returned. Use
`a2a_get_task` with the returned `id` to continue monitoring.

| Parameter    | Type   | Required | Description                                                                                                                                                |
| ------------ | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_id`   | string | Yes      | ID of the target agent                                                                                                                                     |
| `message`    | string | Yes      | Message content to send                                                                                                                                    |
| `context_id` | string | No       | Continue an existing multi-turn conversation                                                                                                               |
| `task_id`    | string | No       | Attach to an existing task (for `input_required` flows)                                                                                                    |
| `timeout`    | number | No       | Override default timeout in seconds                                                                                                                        |
| `data`       | array  | No       | Structured data to include with the message. Each item is sent as a separate JSON object or array alongside the text.                                      |
| `files`      | array  | No       | Files to include with the message. Accepts local file paths (read and sent as binary, max 1MB) or URLs (sent as references for the remote agent to fetch). |

#### `a2a_get_task`

Check the progress of an A2A task that is still in progress. Monitors until the
task reaches a terminal state or the timeout is reached. If still in progress,
returns the current task state — call again to continue monitoring.

| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `agent_id`      | string | Yes      | ID of the agent owning the task            |
| `task_id`       | string | Yes      | Task ID from a previous `a2a_send_message` |
| `timeout`       | number | No       | Monitoring timeout in seconds              |
| `poll_interval` | number | No       | Interval between status checks in seconds  |

#### `a2a_view_text_artifact`

View text content from an artifact, optionally selecting a line or character
range. Can select by line range OR character range, but not both.

| Parameter         | Type   | Required | Description                                   |
| ----------------- | ------ | -------- | --------------------------------------------- |
| `agent_id`        | string | Yes      | ID of the agent that produced the artifact    |
| `task_id`         | string | Yes      | Task ID containing the artifact               |
| `artifact_id`     | string | Yes      | The artifact's unique identifier              |
| `line_start`      | number | No       | Starting line number (1-based, inclusive)     |
| `line_end`        | number | No       | Ending line number (1-based, inclusive)       |
| `character_start` | number | No       | Starting character index (0-based, inclusive) |
| `character_end`   | number | No       | Ending character index (0-based, exclusive)   |

#### `a2a_view_data_artifact`

View structured data from an artifact with optional JSON path, row, and column
filtering.

| Parameter     | Type   | Required | Description                                                            |
| ------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `agent_id`    | string | Yes      | ID of the agent that produced the artifact                             |
| `task_id`     | string | Yes      | Task ID containing the artifact                                        |
| `artifact_id` | string | Yes      | The artifact's unique identifier                                       |
| `json_path`   | string | No       | Dot-separated path to navigate data (e.g. `"results.items"`)           |
| `rows`        | string | No       | Row selection for list data (`"0"`, `"0-10"`, `"0,2,5"`, or `"all"`)   |
| `columns`     | string | No       | Column selection for tabular data (`"name"`, `"name,age"`, or `"all"`) |

## 📥 Receiving Messages (inbound)

> [!WARNING]
> Making your agent publicly accessible means other agents can send it messages.
> A malicious agent could attempt to convince your agent to take unwanted actions on your computer, like running commands, reading files, etc.
> The plugin requires an API key for inbound requests by default.
> Only share keys with people you trust, and consider setting up a separate profile with restricted tools for extra safety.

### Set Up

Other agents can discover and message your OpenClaw agent through the inbound
endpoint. Follow the steps below to make your agent reachable.

#### 1. Configure Inbound

```json
{
    "tools": {
        "profile": "full"
    },
    "plugins": {
        "entries": {
            "a2a": {
                "enabled": true
            }
        }
    },
    "sandbox": {
        "tools": {
            "alsoAllow": ["a2a_update_agent_card"]
        }
    }
}
```

> **Note:** The "sandbox" section is only required if sandbox is enabled.

| Field                   | Type      | Default                              | Description                                                                                                                                                                      |
| ----------------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentCard.name`        | `string`  | Agent identity name                  | Agent Card display name.                                                                                                                                                         |
| `agentCard.description` | `string`  | `"AI assistant powered by OpenClaw"` | Agent Card description.                                                                                                                                                          |
| `agentCard.skills`      | `array`   | `[]`                                 | Skills to advertise. Each needs `id`, `name`, `description`. Optional: `tags`, `examples`, `inputModes`, `outputModes`. Can also be set at runtime with `a2a_update_agent_card`. |
| `apiKeys`               | `array`   | —                                    | Array of `{ label, key }` objects for inbound auth.                                                                                                                              |
| `allowUnauthenticated`  | `boolean` | `false`                              | Skip API key validation for inbound requests.                                                                                                                                    |

#### 2. Restart the Gateway

The plugin registers its HTTP endpoints on startup, so a restart is required:

```bash
openclaw gateway restart
```

#### 3. Expose Your Gateway

You need to make your gateway's HTTP port (default 18789) reachable from the
internet. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) is the
recommended approach — it gives your machine a public HTTPS URL with automatic
TLS certificates, no port forwarding or DNS configuration needed. You can also
use any reverse proxy (nginx, Caddy, etc.).

> **Note:** The commands below were verified on **macOS** (Apple Silicon)
> with the [Tailscale Mac app](https://tailscale.com/download/mac). The
> overall flow is the same on Linux and Windows, but the install and daemon
> setup will differ — consult the
> [Tailscale install docs](https://tailscale.com/kb/1347/installation) for
> your OS.

##### Install Tailscale

Install the **[Tailscale Mac app](https://tailscale.com/download/mac)**. The GUI app ships a Network Extension
that plumbs MagicDNS into macOS's system resolver, so browsers and other apps
can resolve your `*.ts.net` hostname.

After installing, launch the app, click the Tailscale menu bar icon, and
sign in. The CLI is bundled with the app.

Confirm you're online:

```bash
tailscale status
```

You should see your node name, tailnet IP, and user.

##### Provision an HTTPS Certificate

Funnel needs a LetsEncrypt cert for your node's `*.ts.net` name. Running
`tailscale cert` once provisions it and also confirms that HTTPS certificates
and MagicDNS are enabled on your tailnet:

```bash
cd /tmp && tailscale cert "$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"
```

The `cd /tmp` is because `tailscale cert` writes `<host>.crt` and
`<host>.key` to the current directory.

##### Enable Funnel

```bash
tailscale funnel --bg http://localhost:18789
```

On success, Tailscale prints the public URL, e.g.:

```
Available on the internet:

https://your-machine.tailXXXXXX.ts.net/
|-- proxy http://localhost:18789
```

If the `funnel` command fails with a policy error, you need to add the
Funnel ACL attribute in the [admin console](https://login.tailscale.com/admin/acls/file)
(there is no CLI equivalent for editing ACLs):

```json
"nodeAttrs": [
  {
    "target": ["autogroup:member"],
    "attr": ["funnel"]
  }
]
```

It can take up to a minute or two after `tailscale funnel --bg` returns
before the public URL actually serves traffic from the open internet,
because the Funnel edge has to propagate your config and finish TLS
provisioning. If an external request returns a TLS error or "broken pipe",
wait ~60s and retry.

##### Tailscale Serve (Tailnet-Only)

If you only need agents on your tailnet to reach you (not the public internet),
use Tailscale Serve instead of Funnel:

```bash
tailscale serve --bg http://localhost:18789
```

With Serve, traffic is restricted to your tailnet, so disabling authentication
is reasonable.

##### Stopping Funnel

```bash
tailscale funnel --https=443 off
```

#### 4. Verify

Open your Agent Card URL in a browser:

```
https://your-machine.tail123.ts.net/.well-known/agent-card.json
```

You should see the JSON Agent Card (name, description, skills, etc.).

#### 5. Generate an API Key

The Agent Card is public, but for other people to send messages to your OpenClaw you'll need to generate an API key for them:

```bash
openclaw a2a generate-key flynn
```

#### 6. Customise Your Agent Card

The Agent Card will have default values.
Once you've generated an API key, ask your OpenClaw to use the `a2a_update_agent_card` tool to update its Agent Card:

> Update your Agent Card with the `a2a_update_agent_card` tool

#### 7. Share Your URL and Key

Send your Agent Card URL and the generated API key to the person you generated it for.
They'll need to install the plugin and add your OpenClaw as a remote agent with the headers:

```json
"custom_headers": {
    "Authorization": "Bearer [GENERATED API KEY]"
}
```

That's it! Your friend's agent should now be able to send messages and files to your OpenClaw.

### Tools

The `a2a_update_agent_card` tool is registered when inbound is configured
(`apiKeys` or `allowUnauthenticated`).

#### `a2a_update_agent_card`

Live-update this agent's A2A Agent Card name, description, or skills. Changes
take effect immediately and persist to config — no restart needed. At least one
field must be provided.

| Parameter     | Type   | Required | Description                                                                                    |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `name`        | string | No       | Display name for the Agent Card                                                                |
| `description` | string | No       | Description for the Agent Card                                                                 |
| `skills`      | array  | No       | Skills to advertise (objects with `id`, `name`, `description`, and optional `tags`/`examples`) |

## 🌐 HTTP Endpoints

| Endpoint                       | Method | Auth         | Description                                                                                    |
| ------------------------------ | ------ | ------------ | ---------------------------------------------------------------------------------------------- |
| `/.well-known/agent-card.json` | GET    | No           | Returns the Agent Card for discovery                                                           |
| `/a2a`                         | POST   | Bearer token | JSON-RPC 2.0 endpoint supporting `message/send`, `message/stream`, `tasks/get`, `tasks/cancel` |

### Supported JSON-RPC Methods

| Method           | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `message/send`   | Send a message and wait for the full response          |
| `message/stream` | Send a message with Server-Sent Events (SSE) streaming |
| `tasks/get`      | Get the status and details of a task                   |
| `tasks/cancel`   | Cancel an ongoing task                                 |

### Error Codes

| Code     | Meaning                 |
| -------- | ----------------------- |
| `-32700` | Parse error             |
| `-32600` | Invalid request         |
| `-32601` | Method not found        |
| `-32602` | Invalid params          |
| `-32001` | Authentication required |
| `-32000` | Server error            |

## 🦞 OpenClaw Implementation

### What happens when a remote agent sends you a message

1. **HTTP entry.** The remote agent POSTs A2A JSON-RPC to `/a2a`. The HTTP handler enforces a 1 MB body limit and validates the `Authorization: Bearer <key>` header against your configured API keys using a timing-safe comparison. With no keys configured the endpoint rejects every request unless you explicitly set `allowUnauthenticated: true`.
2. **Parts are unpacked.** Text parts are concatenated. Data parts are serialized and wrapped in `<data><item>…</item></data>` tags. File parts are written to `<workspace>/a2a/inbound/files/` via the inbound `LocalFileStore`, and the saved paths are listed back to the agent inside `<files><file>…</file></files>` tags. Files are stored under the workspace so the agent's normal filesystem tools can read them.
3. **Inbound context is built.** The plugin assembles an OpenClaw `MsgContext` with the unpacked text as `Body` / `BodyForAgent`, `Provider: "a2a"`, `Surface: "a2a"`, `From: "a2a:<senderLabel>"`, `SenderId: "a2a:<senderLabel>"`, `SenderName: "<senderLabel>"`, `To: "a2a:<agentId>"`, `ChatType: "direct"`, `ConversationLabel: "<contextId>"`, `MessageThreadId: "<contextId>"`, `InputProvenance: { kind: "external_user", sourceChannel: "a2a" }`, and `CommandAuthorized: false`. It then runs the context through `finalizeInboundContext`, which sanitizes the body and enforces the strict-boolean default-deny on `CommandAuthorized`.
4. **Session is recorded.** The plugin first creates a base direct-message session per remote sender label, keyed as `agent:<agentId>:a2a:direct:<senderLabel>`, then derives a threaded child session for the A2A `contextId`, keyed as `agent:<agentId>:a2a:direct:<senderLabel>:thread:<contextId>`. `dispatchInboundReplyWithBase` writes the inbound turn into OpenClaw's normal session store (the same `sessions.json` your other channels use, resolved from `config.session.store` via `resolveStorePath`) using that threaded session key and sets `ParentSessionKey` to the sender-level base session. This keeps conversations from the same remote agent grouped together while still isolating each A2A `contextId` as its own OpenClaw conversation.
5. **Reply runs through the agent runtime.** The shared inbound dispatcher invokes the buffered block dispatcher, which loads the agent's full configuration (model, system prompt, MCP servers, tool allowlists, sandbox policy, command auth) and runs a normal reply turn with the message body as the user prompt. The agent has access to every tool it would normally have on any other channel.
6. **Reply parts become A2A artifacts.** As the dispatcher streams text and media URLs back via the `deliver` callback, the executor converts them into A2A `TextPart` and `FilePart` artifact parts and publishes them on the A2A event bus, followed by a terminal `completed` (or `failed`) status update.

### What the agent can and cannot do on behalf of the remote caller

- **The agent runs with its full normal capabilities.** Whatever tools, MCP servers, and shell access you've granted your OpenClaw agent are reachable to a remote A2A request once it has been authenticated. Treat A2A API keys with the same care as any other agent credential — anyone holding one can issue prompts that your agent will execute under its own identity.
- **The remote caller is not your owner.** OpenClaw's command authorization (`resolveCommandAuthorization`) computes `senderIsOwner` by matching the inbound `From`/`SenderId` against your provider allowlists. The A2A plugin presents the sender as `a2a:<senderLabel>` under the `a2a` provider, which is not a registered channel and is not in any owner allowlist, so the sender is never resolved as owner. Combined with the `CommandAuthorized: false` default-deny, this means remote A2A callers cannot trigger owner-only text commands (`/think`, `/reset`, model-switching commands, etc.) through this channel.
- **The message is marked as untrusted external input.** Because `InputProvenance.kind` is `external_user`, the agent's persisted user message is tagged as coming from outside the operator. Hooks and tools that branch on provenance (e.g. inter-session vs. external_user vs. internal_system) will see A2A traffic as external. The plugin also runs the body through `sanitizeInboundSystemTags` via `finalizeInboundContext`, so attempts to smuggle synthetic envelope headers in the message text are stripped before the agent sees them.
- **Agent policy is still the authority.** Sandbox/tool allowlists, MCP server allowlists, exec approvals, dm/group policies, and any custom hooks all run exactly as they would for a local request. The plugin does not bypass any of them — if you don't want a remote A2A caller to be able to read `~/.ssh`, restrict it at the agent's tool/sandbox config the same way you would for any other channel.

### Storage and secret boundaries

- HTTP JSON bodies are capped at 1 MB by the inbound handler.
- Inbound files land in `<workspace>/a2a/inbound/files/`; outbound artifacts in `<workspace>/a2a/outbound/files/`. Task state for both directions lives under `<state>/a2a/{inbound,outbound}/tasks/`, separate from file storage.
- Inbound API keys are generated from 32 random bytes by `openclaw a2a generate-key` and only ever shared with agents you authorize. Outbound `custom_headers` support `${ENV_VAR}` substitution so remote-agent credentials stay in your environment instead of your config file.

## 💾 Data Storage

Tasks and file artifacts are saved locally, separated by direction. Task state lives under OpenClaw's state directory; file artifacts live under OpenClaw's workspace directory so the agent can access received files.

| Direction | Type  | Path                              |
| --------- | ----- | --------------------------------- |
| Outbound  | Tasks | `<state>/a2a/outbound/tasks/`     |
| Outbound  | Files | `<workspace>/a2a/outbound/files/` |
| Inbound   | Tasks | `<state>/a2a/inbound/tasks/`      |
| Inbound   | Files | `<workspace>/a2a/inbound/files/`  |

Outbound task/file storage can be disabled with `outbound.taskStore: false` and `outbound.fileStore: false`.

## 🛠️ Development

Install the dependencies:

```bash
make install
```

Install git hooks:

```bash
make install-hooks
```

Install the plugin:

```bash
openclaw plugins install /absolute/path/to/openclaw-a2a-plugin
```

Restart the gateway:

```bash
openclaw gateway restart
```

## 📄 License

Apache-2.0

## 🤝 Join the A2A Net Community

A2A Net is a site to find and share AI agents and open-source community. Join to share your A2A agents, ask questions, stay up-to-date with the latest A2A news, be the first to hear about open-source releases, tutorials, and more!

- 🌍 Site: [A2A Net](https://a2anet.com)
- 🤖 Discord: [Join the Discord](https://discord.gg/674NGXpAjU)
