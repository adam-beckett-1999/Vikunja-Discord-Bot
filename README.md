# Vikunja Discord Bot

Self-hosted Discord bot for Vikunja.

![Vikunja Bot Demo 1](demo/Vikunja%20Bot%20Demo%201.gif)

![Vikunja Bot Demo 2](demo/Vikunja%20Bot%20Demo%202.gif)

## How it works

- Slash commands let you create, list, view, update, and delete tasks.
- `/webhook-register` creates a Vikunja webhook for a project.
- Vikunja sends events to the bot webhook endpoint.
- The bot posts those events to your chosen Discord channel as embeds.
- If `WEBHOOK_SECRET` is set, the bot verifies incoming webhook signatures.

## What you need

- A Discord bot and application token
- A Vikunja instance with an API token
- A publicly reachable URL for the bot webhook endpoint
- Docker and Docker Compose

---

## Quick start

### Create the Discord bot (Developer Portal)

1. Go to the Discord Developer Portal: <https://discord.com/developers/applications>
2. Click **New Application**, enter a name, and create it.
3. Open the new application and copy the **Application ID**.
   Use this as `DISCORD_CLIENT_ID` in your `.env`.
4. In **Bot**:
   - Click **Add Bot**
   - Click **Reset Token** (or **Copy**) and save the token
   - Use this as `DISCORD_TOKEN` in your `.env`
5. In **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
6. Open the generated URL, choose your server, and authorize the bot.

---

### Set Environment variables

Set these in `.env` in the same folder as your compose file, or ensure you include the path in your docker run command:

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | Discord application client ID |
| `DISCORD_GUILD_IDS` | Yes | Discord guild IDs for instant slash command registration |
| `VIKUNJA_BASE_URL` | Yes | Vikunja base URL |
| `VIKUNJA_API_TOKEN` | Yes | Vikunja API token |
| `WEBHOOK_PORT` | Yes | Webhook server port (default `3000`) |
| `WEBHOOK_SECRET` | No | Secret used to verify incoming Vikunja webhooks |
| `NOTIFICATION_CHANNEL_ID` | Yes | Discord channel for webhook embeds |

---

### Deploy the service

Docker-compose:

```yaml
services:
  vikunja-discord-bot:
    image: adambeckett1999/vikunja-discord-bot:latest
    container_name: vikunja-discord-bot
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "3000:3000"
```

Manual run:

```bash
docker run --rm -p 3000:3000 --env-file /YOUR/FILE/LOCATION/HERE/.env adambeckett1999/vikunja-discord-bot:latest
```

Once the container is running, the slash commands should register within discord. You may need to check the permissions on your bot within the server.

---

### Register a Vikunja webhook

You will need the bot to be publicly accessible for the webhook handling to work correctly. The easiest method is through a reverse proxy. If you're already self-hosting Vikunja, you probably have a reverse proxy solution in place.

Create a new proxy forwarding to the IP and port of the bot container, and use the HTTPS URL for the next steps.

```text
/webhook-register project:<project_name> url:https://your-bot.example.com/webhook events:task.created, task.updated, task.comment.created
```

The `events` option is optional and free-text. If omitted, the default lifecycle events are used: `task.created`, `task.updated`, and `task.deleted`.
When provided, enter a comma-separated list of event names. The supports event types are listed below.

Format example:

```text
task.created, task.updated, task.comment.created
```

| Event | Meaning |
|---|---|
| `task.created` | A new task was created |
| `task.updated` | An existing task was edited |
| `task.deleted` | A task was deleted |
| `task.overdue` | A task became overdue |
| `tasks.overdue` | One or more tasks became overdue |
| `task.comment.created` | A comment was added to a task |
| `task.comment.edited` | A task comment was edited |
| `task.comment.deleted` | A task comment was deleted |
| `task.assignee.created` | A user was assigned to a task |
| `task.assignee.deleted` | A user was unassigned from a task |
| `task.attachment.created` | An attachment was added to a task |
| `task.attachment.deleted` | An attachment was removed from a task |
| `task.relation.created` | A task relation was created |
| `task.relation.deleted` | A task relation was removed |
| `task.reminder.fired` | A task reminder fired |
| `project.updated` | A project was updated |
| `project.deleted` | A project was deleted |
| `project.shared.team` | A project was shared with a team |
| `project.shared.user` | A project was shared with a user |

Vikunja will POST the selected events to the bot, which forwards them as Discord embeds to your `NOTIFICATION_CHANNEL_ID`.
If `WEBHOOK_SECRET` is set, `/webhook-register` will include that same secret when creating the webhook so incoming deliveries can pass signature verification.

---

## Webhook Security

When `WEBHOOK_SECRET` is set, the bot verifies the `X-Vikunja-Signature` HMAC-SHA256 header on every incoming webhook request. If you're manually creating the webhooks within Vikunja, set the same value when creating the webhook to ensure only legitimate requests are processed.

---

## Planned improvements

- Support for multiple discord channels for webhook posts (defined by the '/webhook-register' command instead of statically set in .env)
- Better handling for comments (show comment content in webhook post and new command e.g '/task-comment')

If there's any features you would like to see, or any bugs/issues that need addressing, please create an issue.

---

## License

MIT
