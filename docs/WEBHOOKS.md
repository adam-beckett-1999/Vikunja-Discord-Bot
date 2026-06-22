![Vikunja Discord Bot Banner](/demo/vikunja-discord-bot-banner-with-background.png)

---

# Webhook Setup

## Register a Vikunja webhook

You will need the bot to be publicly accessible for webhook handling to work correctly. The easiest method is through a reverse proxy. If you are already self-hosting Vikunja, you probably have a reverse proxy solution in place.

Set `BOT_PUBLIC_URL` to the public base URL of your bot, for example `https://your-bot.example.com`. The bot automatically appends `/webhook` when registering webhooks.

When using the command, the webhook is mapped to the channel where you ran the command, so posts to the defined project appear in that channel. If you define the channel when running the command, you can bind that webhook to any other channel the bot has permission to post in.

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
| --- | --- |
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

## Manage webhook channel routing

Use the following commands to list and update which projects and webhooks post to which channels:

```text
/webhook-channel set project:<project_name> channel:#alerts
/webhook-channel remove project:<project_name>
/webhook-channel list
```

---

## Webhook Security

When you register a webhook through `/webhook-register`, the bot generates a secret, stores it in `/data/webhook-records.json`, and uses that record to verify the `X-Vikunja-Signature` HMAC-SHA256 header on incoming webhook requests.

### Default hardening

- Incoming webhook payloads are size-limited (`WEBHOOK_MAX_BODY_KB`, default `256`).
- Signature verification is scoped to the matching project webhook record whenever possible.
- Local data stores under `/data` are written with restricted permissions.

### Recommended operational hardening

- Restrict network access so only Vikunja, or your reverse proxy, can reach the webhook endpoint.
- Terminate TLS at a reverse proxy and keep `BOT_PUBLIC_URL` on HTTPS.
- Rotate Vikunja API tokens and Discord bot tokens if access to `.env` is ever exposed.