# Vikunja Discord Bot

A self-hosted Discord bot for Vikunja.

It does two things:

- Lets you manage Vikunja tasks from Discord slash commands
- Forwards Vikunja webhook events into a Discord channel as embeds

## What you need

- A Discord bot and application token
- A Vikunja instance with an API token
- A publicly reachable URL for the bot webhook endpoint
- Docker and Docker Compose

## Quick start

1. Copy the example env file and fill it in.

```bash
cp .env.example .env
```

2. Start the bot with Docker Compose.

```bash
docker compose up -d
```

The compose file uses the Docker Hub image and the container will register slash commands on startup.

## Docker image

Public image:

```text
your-dockerhub-username/vikunja-discord-bot:latest
```

If you want to run it manually without Compose:

```bash
docker run --rm -p 3000:3000 --env-file .env your-dockerhub-username/vikunja-discord-bot:latest
```

## Environment variables

Set these in `.env`:

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | Discord application client ID |
| `DISCORD_GUILD_IDS` | Yes* | Comma-separated guild IDs for instant slash command registration |
| `VIKUNJA_BASE_URL` | Yes | Vikunja base URL |
| `VIKUNJA_API_TOKEN` | Yes | Vikunja API token |
| `WEBHOOK_PORT` | Yes | Webhook server port (default `3000`) |
| `WEBHOOK_SECRET` | No | Secret used to verify incoming Vikunja webhooks |
| `NOTIFICATION_CHANNEL_ID` | Yes | Discord channel for webhook embeds |

\* Leave `DISCORD_GUILD_IDS` empty if you prefer global slash commands.

## How it works

- Slash commands let you create, list, view, update, and delete tasks.
- `/webhook-register` creates a Vikunja webhook for a project.
- Vikunja sends events to the bot webhook endpoint.
- The bot posts those events to your chosen Discord channel as embeds.
- If `WEBHOOK_SECRET` is set, the bot verifies incoming webhook signatures.

## Useful commands

Register slash commands manually if you want to do it outside the container startup flow:

```bash
npm run deploy
```

Start the bot locally without Docker:

```bash
npm start
```

## License

MIT
