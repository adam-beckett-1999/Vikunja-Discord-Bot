![Vikunja Discord Bot Banner](/demo/vikunja-discord-bot-banner-with-background.png)

---

![Vikunja Discord Bot GIF Example 1](demo/Vikunja%20Bot%20Demo%201.gif)

![Vikunja Discord Bot GIF Example 2](demo/Vikunja%20Bot%20Demo%202.gif)

## How it works

- Slash commands let you create, list, view, update, delete, and manage assignees and reminders on tasks.
- `/webhook-register` creates a Vikunja webhook for a project and can map that project to a Discord channel.
- `/webhook-channel` lets you manage project-to-channel mappings (`set`, `remove`, `list`).
- `/alert-assignee` lets you manage who gets pinged for reminder alerts (`link`, `unlink`, `list`).
- Vikunja sends events to the bot webhook endpoint.
- The bot posts those events to the mapped Discord channel for the matching project.
- Webhook-delivered task embeds include an `Open` link button for the relevant Vikunja page.
- The bot verifies incoming webhook signatures using per-webhook secrets stored in `/data`.

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
| `TZ` | Yes | Bot timezone |
| `WEBHOOK_PORT` | No | Webhook port (default `3000`) |
| `WEBHOOK_MAX_BODY_KB` | No | Max webhook request body size in KB (default `256`) |
| `BOT_PUBLIC_URL` | Yes | Public base URL for the bot |
| `DISCORD_TOKEN` | Yes | Bot token |
| `DISCORD_CLIENT_ID` | Yes | Application client ID |
| `VIKUNJA_BASE_URL` | Yes | Vikunja base URL |
| `VIKUNJA_API_TOKEN` | Yes | Vikunja API token |

### Deploy the service

Docker-compose:

```yaml
services:
  vikunja-discord-bot:
    image: adambeckett1999/vikunja-discord-bot:latest
    container_name: vikunja-discord-bot
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    env_file:
      - .env
    ports:
      - "${WEBHOOK_PORT:-3000}:${WEBHOOK_PORT:-3000}"
    volumes:
      - vikunja-discord-bot-data:/data

volumes:
  vikunja-discord-bot-data:
```

Manual run:

```bash
docker run --rm -p ${WEBHOOK_PORT:-3000}:${WEBHOOK_PORT:-3000} -v vikunja-discord-bot-data:/data --env-file /YOUR/FILE/LOCATION/HERE/.env adambeckett1999/vikunja-discord-bot:latest
```

Once the container is running, the slash commands should register within discord. You may need to check the permissions on your bot within the server.

The bot should already be invited to the server before the container starts so the deploy step can discover it automatically. If you add the bot to a server after the container is already running, restart the container so command deployment can re-authenticate and pick up the new guild.

---

### Register a Vikunja webhook

You will need the bot to be publicly accessible for the webhook handling to work correctly. The easiest method is through a reverse proxy. If you're already self-hosting Vikunja, you probably have a reverse proxy solution in place.

Set `BOT_PUBLIC_URL` to the public base URL of your bot, for example `https://your-bot.example.com`. The bot will automatically append `/webhook` when registering webhooks.

When using the command, the webhook will be mapped to the channel where you've run the command, so posts to the defined project will appear in that channel. If you define the channel when running the command, you can bind that webhook to any other channel the bot has permission to post in.

```text
/webhook-register project:<project_name> events:task.created, task.updated, task.comment.created
```

Optional channel mapping while registering:

```text
/webhook-register project:<project_name> channel:#alerts events:task.created,task.updated,task.reminder.fired
```

The `events` option is optional and free-text. If omitted, the default lifecycle events are used: `task.created`, `task.updated`, `task.deleted`, and `task.reminder.fired`.
When provided, enter a comma-separated list of event names. The supported event types are listed below.

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

`/webhook-register` generates a webhook secret automatically, sends it to Vikunja, and records it locally in `/data/webhook-records.json` so incoming deliveries can be verified later.

You can use the following commands to list and update which projects/webhooks post to which channels:

```text
/webhook-channel set project:<project_name> channel:#alerts
/webhook-channel remove project:<project_name>
/webhook-channel list
```

---

### Configure reminder pings by assignee

Reminder notifications can now mention Discord users based on task assignees.

1. Link a Vikunja assignee to a Discord user:

```text
/alert-assignee link assignee:<assignee> discord-user:@User
```

`assignee` is global to your connected Vikunja instance.
Autocomplete suggests known assignees discovered from tasks. You can also enter `id:<vikunja_user_id>` or `username:<vikunja_username>` manually.

1. Remove a link:

```text
/alert-assignee unlink assignee:<assignee>
```

1. Show current links:

```text
/alert-assignee list
```

When a `task.reminder.fired` webhook is received, the bot checks task assignees and mentions any linked Discord users in the notification message.

### Manage task reminders

Use `/task-reminder` to work with task reminder dates directly:

```text
/task-reminder add project:<project_name> task:<task_name> at:2026-06-21 18:00
/task-reminder list project:<project_name> task:<task_name>
/task-reminder remove project:<project_name> task:<task_name> reminder:<select from autocomplete>
```

`add` expects a date and time in `YYYY-MM-DD HH:mm` format, using a 24-hour clock in the bot's configured timezone.
Set `TZ` to a valid IANA timezone (for example `UTC`) to control that timezone.
For example: `2026-06-21 18:00`.
`remove` supports autocomplete for reminder selection.

### Task completion

Use dedicated commands to change task completion status:

```text
/task-done project:<project_name> task:<task_name>
/task-pending project:<project_name> task:<task_name>
```

---

## Webhook Security

When you register a webhook through `/webhook-register`, the bot generates a secret, stores it in `/data/webhook-records.json`, and uses that record to verify the `X-Vikunja-Signature` HMAC-SHA256 header on incoming webhook requests.

Additional hardening applied by default:

- Incoming webhook payloads are size-limited (`WEBHOOK_MAX_BODY_KB`, default `256`).
- Signature verification is scoped to the matching project webhook record whenever possible.
- Local data stores under `/data` are written with restricted permissions.

Recommended operational hardening:

- Restrict network access so only Vikunja (or your reverse proxy) can reach the webhook endpoint.
- Terminate TLS at a reverse proxy and keep `BOT_PUBLIC_URL` on HTTPS.
- Rotate Vikunja API tokens and Discord bot tokens if access to `.env` is ever exposed.

---

## Planned improvements

If there's any features you would like to see, or any bugs/issues that need addressing, please create an issue.

---

## License

MIT
