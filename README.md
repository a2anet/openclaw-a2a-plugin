# OpenClaw A2A Plugin

[![npm version](https://img.shields.io/npm/v/@a2anet/openclaw-a2a-plugin.svg)](https://www.npmjs.com/package/@a2anet/openclaw-a2a-plugin) [![License](https://img.shields.io/github/license/a2anet/openclaw-a2a-plugin)](https://github.com/a2anet/openclaw-a2a-plugin/blob/main/LICENSE) [![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue)](https://a2a-protocol.org) [![Discord](https://img.shields.io/discord/1391916121589944320?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/674NGXpAjU)

[OpenClaw](https://openclaw.ai) [A2A protocol](https://a2a-project.org/) community plugin.
Send messages and files to other agents over the internet, and/or allow your agent to receive messages and files with Tailscale.
The plugin is powered by [A2A Utils](https://github.com/a2anet/a2a-utils), a comprehensive set of utility functions for using [A2A servers (remote agents)](https://a2a-protocol.org/latest/topics/key-concepts/#core-actors-in-a2a-interactions), that powers the [A2A MCP Server](https://github.com/a2anet/a2a-mcp).

> [!WARNING]
> Making your agent publicly accessible means other agents can send it messages.
> A malicious agent could attempt to convince your agent to take unwanted actions on your computer, like running commands, reading files, etc.
> The plugin requires an API key by default.
> Only share keys with people you trust, and consider using a
> [dedicated gateway agent](#-security) with restricted tools for extra safety.

## 💡 Use Cases

- Connect a sandboxed local OpenClaw to a full access OpenClaw in the cloud to efficiently share context and files
- Connect your OpenClaw with a classmate's or co-worker's to work together on a project
- Connect your OpenClaw with a company-wide OpenClaw to ask questions, give updates, and access company accounts and services
- Connect your OpenClaw to agents on A2A directories, marketplaces, etc. to ehance OpenClaw's capabilities
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

The [A2A protocol](https://a2a-project.org/) is a protocol for agent-to-agent communication.
It is supported by AWS, Azure, and GCP; and 150+ enterprises.

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

Or clone into your extensions directory:

```bash
git clone https://github.com/a2anet/openclaw-a2a-plugin.git ~/.openclaw/extensions/a2a
cd ~/.openclaw/extensions/a2a && npm install
```

Then restart the gateway.

## ⚙️ Configuration

Enable the plugin and configure it in your OpenClaw config under `plugins.entries.a2a`:

```json
{
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
          },
          "inbound": {
            "agentCard": {
              "name": "My Agent",
              "description": "A helpful assistant",
              "skills": [
                {
                  "id": "chat",
                  "name": "General Chat",
                  "description": "Answer questions and have conversations"
                }
              ]
            },
            "apiKeys": [
              { "label": "partner-agent", "key": "your-api-key-here" }
            ]
          }
        }
      }
    }
  }
}
```

### Configuration Reference

All options live under `plugins.entries.a2a.config`:

#### Outbound (`outbound`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agents` | `Record<string, {url, custom_headers?}>` | — | Named remote agents. Keys are agent IDs used in tool calls. |
| `taskStore` | `boolean` | `true` | Enable persistent task storage. |
| `fileStore` | `boolean` | `true` | Enable persistent file artifact storage. |
| `sendMessageCharacterLimit` | `number` | `50000` | Maximum characters for minimized artifact text. |
| `minimizedObjectStringLength` | `number` | `5000` | Maximum string length for minimized data objects. |
| `viewArtifactCharacterLimit` | `number` | `50000` | Maximum characters returned by view artifact tools. |
| `agentCardTimeout` | `number` | `15` | Timeout in seconds for fetching remote agent cards. |
| `sendMessageTimeout` | `number` | `60` | Timeout in seconds for send message requests. |
| `getTaskTimeout` | `number` | `60` | Timeout in seconds for get task monitoring. |
| `getTaskPollInterval` | `number` | `5` | Interval in seconds between task status polls. |

#### Inbound (`inbound`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentCard.name` | `string` | Agent identity name | Agent Card display name. |
| `agentCard.description` | `string` | `"AI assistant powered by OpenClaw"` | Agent Card description. |
| `agentCard.skills` | `array` | `[]` | Skills to advertise. Each needs `id`, `name`, `description`. Optional: `tags`, `examples`, `inputModes`, `outputModes`. Can also be set at runtime with `a2a_update_agent_card`. |
| `apiKeys` | `array` | — | Array of `{ label, key }` objects for inbound auth. |
| `allowUnauthenticated` | `boolean` | `false` | Skip API key validation for inbound requests. |
| `gatewayTimeout` | `number` | `300` | Timeout in seconds for gateway calls to the local OpenClaw agent. |

### Outbound Authentication

When a remote agent requires an API key, configure credentials in the agent's
`custom_headers`. Header values support `${ENV_VAR}` substitution so you can keep
secrets out of your config file:

```json
{
  "outbound": {
    "agents": {
      "partner": {
        "url": "https://partner-agent.example.com/.well-known/agent-card.json",
        "custom_headers": {
          "Authorization": "Bearer ${PARTNER_API_KEY}"
        }
      }
    }
  }
}
```

## 📤 Sending Messages (outbound)

Enable the plugin, configure at least one remote agent, and your OpenClaw agent
can send messages and files to any A2A-compatible agent — no Tailscale or port exposure needed. You just need the remote agent's Agent Card URL (and API key, if required).

### Tools

#### `a2a_get_agents`

List all available remote A2A agents with names and descriptions.

No parameters.

#### `a2a_get_agent`

Get detailed info about a specific agent, including skills.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | The agent's unique identifier |

#### `a2a_send_message`

Send a message to a remote agent and receive a structured response. The message
is sent non-blocking — the tool streams or polls for updates until the task
reaches a terminal state or the timeout is reached. If the task is still in
progress after the timeout, the current task state is returned. Use
`a2a_get_task` with the returned `id` to continue monitoring.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | ID of the target agent |
| `message` | string | Yes | Message content to send |
| `context_id` | string | No | Continue an existing multi-turn conversation |
| `task_id` | string | No | Attach to an existing task (for `input_required` flows) |
| `timeout` | number | No | Override default timeout in seconds |
| `data` | array | No | Structured data to include with the message. Each item is sent as a separate JSON object or array alongside the text. |
| `files` | array | No | Files to include with the message. Accepts local file paths (read and sent as binary, max 1MB) or URLs (sent as references for the remote agent to fetch). |

#### `a2a_get_task`

Check the progress of an A2A task that is still in progress. Monitors until the
task reaches a terminal state or the timeout is reached. If still in progress,
returns the current task state — call again to continue monitoring.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | ID of the agent owning the task |
| `task_id` | string | Yes | Task ID from a previous `a2a_send_message` |
| `timeout` | number | No | Monitoring timeout in seconds |
| `poll_interval` | number | No | Interval between status checks in seconds |

#### `a2a_view_text_artifact`

View text content from an artifact, optionally selecting a line or character
range. Can select by line range OR character range, but not both.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | ID of the agent that produced the artifact |
| `task_id` | string | Yes | Task ID containing the artifact |
| `artifact_id` | string | Yes | The artifact's unique identifier |
| `line_start` | number | No | Starting line number (1-based, inclusive) |
| `line_end` | number | No | Ending line number (1-based, inclusive) |
| `character_start` | number | No | Starting character index (0-based, inclusive) |
| `character_end` | number | No | Ending character index (0-based, exclusive) |

#### `a2a_view_data_artifact`

View structured data from an artifact with optional JSON path, row, and column
filtering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | Yes | ID of the agent that produced the artifact |
| `task_id` | string | Yes | Task ID containing the artifact |
| `artifact_id` | string | Yes | The artifact's unique identifier |
| `json_path` | string | No | Dot-separated path to navigate data (e.g. `"results.items"`) |
| `rows` | string | No | Row selection for list data (`"0"`, `"0-10"`, `"0,2,5"`, or `"all"`) |
| `columns` | string | No | Column selection for tabular data (`"name"`, `"name,age"`, or `"all"`) |

### Examples

#### List agents

```
a2a_get_agents()
```

```json
{
  "tweet-search": {
    "name": "Tweet Search",
    "description": "Find and analyze tweets by keyword, URL, author, list, or thread. Filter by language, media type, engagement, date range, or location. Get a clean table of tweets with authors, links, media, and counts; then refine the table and generate new columns with AI."
  }
}
```

#### Get agent details

```
a2a_get_agent(agent_id: "tweet-search")
```

```json
{
  "name": "Tweet Search",
  "description": "Find and analyze tweets by keyword, URL, author, list, or thread. Filter by language, media type, engagement, date range, or location. Get a clean table of tweets with authors, links, media, and counts; then refine the table and generate new columns with AI.",
  "skills": [
    {
      "name": "Search Tweets",
      "description": "Search X by keywords, URLs, handles, or conversation IDs. Filter by engagement (retweets/favorites/replies), dates, language, location, media type (images/videos/quotes), user verification status, and author/reply/mention relationships. Sort by Top or Latest. Return 1-10,000 results."
    },
    ...,
    {
      "name": "Generate Table",
      "description": "Generate a new table from any table with AI. Explain what table you want to generate from, what columns you want to keep, and what new columns you want to generate."
    }
  ]
}
```

#### Send a message

```
a2a_send_message(agent_id: "tweet-search", message: "Find tweets about AI from today (January 12, 2026)")
```

```json
{
  "id": "tsk-123",
  "contextId": "ctx-123",
  "kind": "task",
  "status": {
    "state": "completed",
    "message": {
      "contextId": "ctx-123",
      "kind": "message",
      "parts": [
        {
          "kind": "text",
          "text": "I found 10 tweets about \"AI\" posted on January 12, 2026. The search parameters used were:\n\n- Search Terms: AI\n- Start Date: 2026-01-12\n- End Date: 2026-01-13\n- Maximum Items: 10\n\nWould you like to see more tweets, or do you want a summary or analysis of these results?"
        }
      ]
    }
  },
  "artifacts": [
    {
      "artifactId": "art-123",
      "description": "Tweets about AI posted on January 12, 2026.",
      "name": "AI Tweets from January 12, 2026",
      "parts": [
        {
          "kind": "data",
          "data": {
            "records": {
              "_total_rows": 10,
              "_columns": [
                {
                  "count": 1,
                  "unique_count": 1,
                  "types": [
                    {
                      "name": "int",
                      "count": 1,
                      "percentage": 100.0,
                      "sample_value": 213,
                      "minimum": 213,
                      "maximum": 213,
                      "average": 213
                    }
                  ],
                  "name": "quote.author.mediaCount"
                },
                ...,
                {
                  "count": 10,
                  "unique_count": 1,
                  "types": [
                    {
                      "name": "bool",
                      "count": 10,
                      "percentage": 100.0,
                      "sample_value": false
                    }
                  ],
                  "name": "isPinned"
                }
              ]
            },
            "_tip": "Data was minimized. Call view_data_artifact() to navigate to specific data."
          }
        }
      ]
    }
  ]
}
```

#### Send a message with data and files

```
a2a_send_message(
  agent_id: "analyst",
  message: "Analyze this sales data and the attached report",
  data: [{"quarter": "Q1", "revenue": 1500000}],
  files: ["/path/to/report.pdf", "https://example.com/data.csv"]
)
```

#### Multi-turn conversation

Use `contextId` from a previous response to continue the conversation:

```
a2a_send_message(
  agent_id: "tweet-search",
  message: "Can you summarize each of the 10 tweets in the table in 3-5 words each? Just give me a simple list with the author name and summary.",
  context_id: "ctx-123"
)
```

```json
{
  "id": "tsk-456",
  "contextId": "ctx-123",
  "kind": "task",
  "status": {
    "state": "completed",
    "message": {
      "contextId": "ctx-123",
      "kind": "message",
      "parts": [
        {
          "kind": "text",
          "text": "Here is a simple list of each tweet's author and a 3-5 word summary:\n\n1. alienofeth – Real-time STT intent detection\n2. UnderdogEth_ – AI ownership discussion thread\n3. Count_Down_000 – Learning new vocabulary word\n4. ThaJonseBoy – AI and market predictions\n5. Evelyn852422353 – AI model comparison debate\n6. SyrilTchouta – Language learning with AI\n7. cx. – AI in marketing insights\n8. Halosznn_ – Graphic design course shared\n9. xmaquina – AI smarter models discussion\n10. Flagm8_ – AI and business strategy\n\nLet me know if you want more details or a different format!"
        }
      ]
    }
  },
  "artifacts": [
    {
      "artifactId": "art-456",
      "description": "A simple list of each tweet's author and a 3-5 word summary of the tweet content.",
      "name": "AI Tweet Summaries 3-5 Words",
      "parts": [
        {
          "kind": "data",
          "data": {
            "records": [
              {
                "author.userName": "ai_q2_",
                "summary": "Possibly understand"
              },
              ...,
              {
                "author.userName": "CallStackTech",
                "summary": "Real-time STT intent detection"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

#### Handle a long-running task

If the remote agent takes longer than the `timeout` (default: 60 seconds), `a2a_send_message` returns the task in its current state:

```
a2a_send_message(agent_id: "tweet-search", message: "Find tweets about AI from today (January 12, 2026)")
```

```json
{
  "id": "tsk-123",
  "contextId": "ctx-123",
  "kind": "task",
  "status": {
    "state": "working",
    "message": null
  },
  "artifacts": []
}
```

Use `a2a_get_task` to check progress:

```
a2a_get_task(agent_id: "tweet-search", task_id: "tsk-123")
```

When complete, the response matches the format shown in [Send a message](#send-a-message). If still working, call `a2a_get_task` again to continue monitoring.

#### View data artifact

```
a2a_view_data_artifact(
  agent_id: "tweet-search",
  task_id: "tsk-123",
  artifact_id: "art-123",
  json_path: "records",
  rows: "all",
  columns: "author.userName,text"
)
```

```json
{
  "artifactId": "art-123",
  "description": "Tweets about AI posted on January 12, 2026.",
  "name": "AI Tweets from January 12, 2026",
  "parts": [
    {
      "kind": "data",
      "data": [
        {
          "author.userName": "ai_q2_",
          "text": "@nyank_x わかるかもしれない"
        },
        ...,
        {
          "author.userName": "CallStackTech",
          "text": "Just built a real-time STT pipeline that detects intent faster than you can say \"Hello!\" 🎤✨ Discover how I used Deepgram to achieve su...\n\n🔗 https://t.co/dgbvdlATZ0\n\n#VoiceAI #AI #BuildInPublic"
        }
      ]
    }
  ]
}
```

## 📥 Receiving Messages (inbound)

Other A2A agents can discover and message your OpenClaw agent through the inbound
endpoints. Follow this checklist to make your agent reachable.

### Tools

The `a2a_update_agent_card` tool is registered when inbound is configured
(`apiKeys` or `allowUnauthenticated`).

#### `a2a_update_agent_card`

Live-update this agent's A2A Agent Card name, description, or skills. Changes
take effect immediately and persist to config — no restart needed. At least one
field must be provided.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Display name for the Agent Card |
| `description` | string | No | Description for the Agent Card |
| `skills` | array | No | Skills to advertise (objects with `id`, `name`, `description`, and optional `tags`/`examples`) |

### 1. Enable the Plugin

Add to your OpenClaw config:

```json5
{
  plugins: {
    entries: {
      a2a: {
        enabled: true,
      },
    },
  },
}
```

### 2. Restart the Gateway

The plugin registers its HTTP endpoints on startup, so a restart is required.

### 3. Generate an API Key

Generate a separate key for each person you want to grant access. This way you
can revoke someone's access without affecting others:

```bash
openclaw a2a generate-key alice
openclaw a2a generate-key bob
```

Each command prints the key — share it securely with the recipient.

### 4. Expose Your Gateway

You need to make your Gateway's HTTP port (default 18789) reachable from the
internet. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) is the
recommended approach — it gives your machine a public HTTPS URL with automatic
TLS certificates, no port forwarding or DNS configuration needed. You can also
use any reverse proxy (nginx, Caddy, etc.).

#### Install Tailscale

**Option A — App (macOS / Windows):**

Download from [tailscale.com/download](https://tailscale.com/download) (or the
Mac App Store on macOS). Open the app and sign in.

**Option B — Terminal (Linux / macOS / Windows):**

```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh

# macOS (Homebrew)
brew install tailscale

# Windows (winget)
winget install Tailscale.Tailscale
```

Then sign in:

```bash
tailscale up
```

#### Enable Funnel Prerequisites

These one-time steps can be done via the admin console or the CLI.

**Option A — Admin console:**

In the [Tailscale admin console](https://login.tailscale.com/admin):

1. **MagicDNS** — enable under [DNS settings](https://login.tailscale.com/admin/dns)
2. **HTTPS Certificates** — enable on the same page, below MagicDNS
3. **Funnel ACL attribute** — under [Access Controls](https://login.tailscale.com/admin/acls/file), add:

```json
"nodeAttrs": [
  {
    "target": ["autogroup:member"],
    "attr": ["funnel"]
  }
]
```

**Option B — Terminal:**

```bash
# Enable HTTPS certificates (also enables MagicDNS if not already on)
tailscale cert $(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')

# Enable Funnel for this node
tailscale funnel --bg http://localhost:18789
```

If the `funnel` command fails with a policy error, you still need to add the
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

#### Start Funnel

```bash
tailscale funnel --bg http://localhost:18789
```

> **Note:** Use `http://localhost:18789` (not `https`). The Gateway serves plain HTTP;
> Tailscale terminates TLS at the Funnel edge.

#### Tailscale Serve (Tailnet-Only)

If you only need agents on your tailnet to reach you (not the public internet),
use Tailscale Serve instead of Funnel:

```bash
tailscale serve --bg http://localhost:18789
```

With Serve, traffic is restricted to your tailnet, so disabling authentication
is reasonable.

#### Stopping Funnel

```bash
tailscale funnel --https=443 off
```

> **Note:** If you installed Tailscale via Homebrew on macOS (instead of the native app),
> you may need to pass `--socket` flags to commands. See the
> [Tailscale CLI docs](https://tailscale.com/kb/1080/cli) for details.

### 5. Verify

Open your Agent Card URL in a browser:

```
https://your-machine.tail1234.ts.net/.well-known/agent-card.json
```

You should see a JSON response with your agent's name, description, and skills.

### 6. Share Your URL and Key

Send your Agent Card URL and the generated API key to the remote agent operator.
They configure their agent to point at your URL with the key in the
`Authorization` header.

### How Inbound Auth Works

When a remote agent sends a message to your `/a2a` endpoint, it must include
your API key in the `Authorization` header:

```
Authorization: Bearer <key>
```

If no keys are configured and `allowUnauthenticated` is not set, the `/a2a`
endpoint rejects all requests. Generate at least one key to start receiving
messages.

### Key Management CLI

```bash
openclaw a2a generate-key <label>    # Generate and save a new key
openclaw a2a list-keys               # List all configured keys (masked)
openclaw a2a revoke-key <label>      # Remove a key by label
```

Restart the gateway after generating or revoking keys to apply changes.

## 🔒 Security

- **Inbound requests require authentication by default.** If no API keys are
  configured and `allowUnauthenticated` is not set, all inbound requests are
  rejected.
- API keys are 32-byte random base64url strings using **timing-safe HMAC-SHA256
  comparison** to prevent timing attacks.
- **Do not set `allowUnauthenticated: true`** unless your gateway is only
  accessible on a private network (e.g. via Tailscale Serve).
- Consider running a **dedicated OpenClaw agent** for A2A to isolate it from
  your primary agent's tools and data. Create a sandboxed agent with restricted
  tools:

```json5
{
  agents: {
    list: [
      {
        id: "a2a-gateway",
        name: "A2A Gateway",
        workspace: "~/.openclaw/workspace-a2a",
        sandbox: { mode: "all", scope: "agent" },
        tools: {
          allow: ["read", "sessions_list", "sessions_send"],
          deny: ["exec", "write", "edit", "apply_patch", "browser"],
        },
      },
    ],
  },
}
```

## 🌐 HTTP Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/.well-known/agent-card.json` | GET | No | Returns the Agent Card for discovery |
| `/a2a` | POST | Bearer token | JSON-RPC 2.0 endpoint supporting `message/send`, `message/stream`, `tasks/get`, `tasks/cancel` |

### Supported JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `message/send` | Send a message and wait for the full response |
| `message/stream` | Send a message with Server-Sent Events (SSE) streaming |
| `tasks/get` | Get the status and details of a task |
| `tasks/cancel` | Cancel an ongoing task |

### Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32001` | Authentication required |
| `-32000` | Server error |

## 💾 Data Storage

Tasks and file artifacts are saved locally within OpenClaw's state directory, separated by direction:

| Direction | Type | Path |
|-----------|------|------|
| Outbound | Tasks | `<stateDir>/a2a/outbound/tasks/` |
| Outbound | Files | `<stateDir>/a2a/outbound/files/` |
| Inbound | Tasks | `<stateDir>/a2a/inbound/tasks/` |
| Inbound | Files | `<stateDir>/a2a/inbound/files/` |

Outbound task/file storage can be disabled with `outbound.taskStore: false` and `outbound.fileStore: false`.

## 🛠️ Development

```bash
make install             # Install dependencies
make install-hooks       # Install local git hooks
make ci                  # Lint, typecheck, and test with coverage
make fix                 # Auto-fix formatting and lint issues
bun run build            # Compile to dist/
```

The local git hooks mirror the shared project template workflow:

- `.githooks/pre-commit` runs `make fix` and re-stages tracked changes
- `.githooks/pre-push` runs `make ci`

They are optional but recommended for contributors working on this repo locally.

## 📄 License

Apache-2.0

## 🤝 Join the A2A Net Community

A2A Net is a site to find and share AI agents and open-source community. Join to share your A2A agents, ask questions, stay up-to-date with the latest A2A news, be the first to hear about open-source releases, tutorials, and more!

- 🌍 Site: [A2A Net](https://a2anet.com)
- 🤖 Discord: [Join the Discord](https://discord.gg/674NGXpAjU)
