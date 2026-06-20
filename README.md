# Vikunja Discord Bot

A self-hosted Discord bot that integrates with [Vikunja](https://vikunja.io) to:

- **Manage tasks** via Discord slash commands (create, list, get, update, delete).
- **Receive notifications** in a Discord channel when tasks are created, updated, or deleted on your Vikunja instance (via Vikunja webhooks).

---

## Features

| Slash Command | Description |
|---|---|
| `/task-create` | Create a new task in a Vikunja project |
| `/task-list` | List tasks (all or filtered by project, with search & pagination) |
| `/task-get` | Get details of a task by ID |
| `/task-update` | Update an existing task (title, description, due date, priority, done state) |
| `/task-delete` | Delete a task by ID |
| `/project-list` | List all accessible Vikunja projects |
| `/webhook-register` | Register a Vikunja webhook for a project and choose which events should notify Discord |

**Notifications** are delivered via an embedded Express HTTP server that receives webhook POSTs from Vikunja and forwards them to a configured Discord channel.

---

## Prerequisites

- **Node.js ≥ 18** (tested on Node 22)
- A **Discord Application** with a bot user ([Discord Developer Portal](https://discord.com/developers/applications))
- A running **Vikunja** instance (v0.22+ recommended for webhook support)
- A publicly reachable URL for the bot's webhook endpoint (e.g. via a reverse proxy or services like ngrok during development)

---

## Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/adam-beckett-1999/Vikunja-Discord-Bot.git
cd Vikunja-Discord-Bot
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Your Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | Your Discord application's Client ID |
| `DISCORD_GUILD_IDS` | ✅* | Comma-separated guild IDs for guild-scoped commands (omit for global) |
| `VIKUNJA_BASE_URL` | ✅ | Base URL of your Vikunja instance (e.g. `https://tasks.example.com`) |
| `VIKUNJA_API_TOKEN` | ✅ | Vikunja API token (Settings → API Tokens) |
| `WEBHOOK_PORT` | ✅ | Port the webhook server listens on (default `3000`) |
| `WEBHOOK_SECRET` | ⬜ | Secret used to verify webhook signatures from Vikunja |
| `NOTIFICATION_CHANNEL_ID` | ✅ | Discord channel ID where task notifications are posted |

### 3. Register slash commands

**Guild-scoped** (instant, recommended during development):

```bash
npm run deploy
```

**Global** (takes up to 1 hour to propagate):

```bash
npm run deploy:global
```

### 4. Start the bot

```bash
npm start
```

The bot logs in to Discord and starts the webhook HTTP server on `WEBHOOK_PORT`.

### 5. Register a Vikunja webhook

Once the bot is running and accessible at a public URL, use the Discord slash command:

```
/webhook-register project:<project_name> url:https://your-bot.example.com/webhook event1:task.created event2:task.updated event3:task.comment.created
```

The event options (`event1` to `event5`) are optional. If omitted, the default lifecycle events are used: `task.created`, `task.updated`, and `task.deleted`.
When provided, set one event per option to control which Vikunja webhook events are delivered to Discord.
Vikunja will POST the selected events to the bot, which forwards them as Discord embeds to your `NOTIFICATION_CHANNEL_ID`.
If `WEBHOOK_SECRET` is set, `/webhook-register` will include that same secret when creating the webhook so incoming deliveries can pass signature verification.

---

## Webhook Security

When `WEBHOOK_SECRET` is set, the bot verifies the `X-Vikunja-Signature` HMAC-SHA256 header on every incoming webhook request. Set the same value in Vikunja when creating the webhook to ensure only legitimate requests are processed.

---

## Project Structure

```
├── src/
│   ├── index.js                  # Bot entry point – loads commands & events, starts webhook server
│   ├── config.js                 # Centralised configuration from environment variables
│   ├── commands/
│   │   ├── task/
│   │   │   ├── create.js
│   │   │   ├── list.js
│   │   │   ├── get.js
│   │   │   ├── update.js
│   │   │   └── delete.js
│   │   ├── project/
│   │   │   └── list.js
│   │   └── webhook/
│   │       └── register.js
│   ├── events/
│   │   ├── ready.js
│   │   └── interactionCreate.js
│   ├── services/
│   │   └── vikunja.js            # Axios-based Vikunja REST API client
│   ├── utils/
│   │   └── embeds.js             # Discord EmbedBuilder helpers
│   └── webhook/
│       └── server.js             # Express server that receives Vikunja webhook events
├── tests/
│   └── embeds.test.js            # Unit tests (Node.js built-in test runner)
├── deploy-commands.js            # Slash command registration script
├── .env.example
└── package.json
```

---

## Running Tests

```bash
npm test
```

---

## Docker

### Build image locally

```bash
docker build -t vikunja-discord-bot:dev .
```

### Run container locally

```bash
docker run --rm -p 3000:3000 --env-file .env vikunja-discord-bot:dev
```

The container exposes port `3000`, deploys slash commands on startup, and then starts the bot.
Make sure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_IDS` are set in the container environment so command registration can succeed.

---

## CI: Docker Hub Publish

This repository includes a GitHub Actions workflow at:

`.github/workflows/docker-build-push-dev.yml`

It also includes a release workflow at:

`.github/workflows/docker-build-push-release.yml`

### Branch to tag mapping

| Branch | Workflow | Published tags |
|---|---|---|
| `initial-dev` | `docker-build-push-dev.yml` | `dev`, `sha-<commit>` |
| `release` | `docker-build-push-release.yml` | `latest`, `sha-<commit>` |

The workflow runs on pushes to `initial-dev` (and manual runs), builds the Docker image, and publishes to Docker Hub with:

- `DOCKERHUB_USERNAME/vikunja-discord-bot:dev`
- `DOCKERHUB_USERNAME/vikunja-discord-bot:sha-<commit>`

### Required repository secrets

| Secret | Required | Description |
|---|---|---|
| `DOCKERHUB_USERNAME` | ✅ | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | ✅ | Docker Hub access token with push permissions |
| `DISCORD_WEBHOOK_URL` | ⬜ | Optional webhook for success/failure workflow notifications |

---

## License

MIT
