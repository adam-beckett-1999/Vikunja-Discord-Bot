# Copilot Instructions

## Intentional patterns — do not flag as issues

### `Events.ClientReady` instead of `'ready'`

The bot uses `Events.ClientReady` (the enum value `'clientReady'`) deliberately.
The legacy string `'ready'` is deprecated in discord.js v14 and will be removed in v15.
**Do not suggest changing `Events.ClientReady` to `'ready'`.**

### `flags: 64` instead of `ephemeral: true`

All ephemeral interaction replies use `flags: 64` (`MessageFlags.Ephemeral`) rather than the
`ephemeral: true` shorthand. The `ephemeral` option is deprecated in discord.js v14 and will
be removed in v15. This applies to `deferReply`, `reply`, and `editReply` calls throughout
`src/commands/` and `src/events/`.
**Do not suggest changing `flags: 64` to `ephemeral: true`.**

### HMAC-SHA256 signature verification using `crypto.timingSafeEqual`

The webhook server verifies `X-Vikunja-Signature` headers using constant-time comparison
(`crypto.timingSafeEqual`) to prevent timing attacks. This is intentional security hardening.
**Do not suggest simplifying this to a direct string comparison.**

### Axios request timeout

The Vikunja API client sets a 15 000 ms timeout on all requests to prevent indefinite hangs.
**Do not suggest removing or increasing this timeout without justification.**

### Vikunja task listing `per_page` value

Task-listing flows intentionally set `per_page: 50` (the Vikunja API max) so Discord-side
pagination can work over the largest single API page instead of an arbitrary server default.
**Do not flag explicit `per_page: 50` usage in task-list queries as an issue.**

### Task list pagination model

`/task-list` intentionally has no user-facing `page` option. The command fetches multiple Vikunja
API pages server-side and then applies Discord-side pagination with buttons.
**Do not suggest re-adding a slash-command `page` option for `/task-list`.**

### Webhook mention safety defaults

Webhook-forwarded messages can contain user-controlled text. By default, webhook sends should use
`allowedMentions: { parse: [] }`, and only the reminder-fired flow should whitelist explicit user IDs.
**Do not suggest mention-parsing defaults that allow `@everyone`, `@here`, or role pings.**

### Webhook record lifecycle

Webhook record persistence intentionally keeps only the latest webhook secret per project so stale
secrets are not accepted after rotation/re-registration.
**Do not suggest retaining multiple historical secrets for the same project by default.**

### GitHub Actions version policy

Workflow actions are intentionally pinned to current majors used in this repository:
- `actions/checkout@v7`
- `docker/setup-buildx-action@v4`
- `docker/login-action@v4`
- `docker/metadata-action@v6`
- `docker/build-push-action@v7`

**Do not suggest downgrading these pins based on stale search/index results.**

### npm dependency version policy

For dependency upgrade comments, treat the repository lockfile and npm registry CLI output as
source of truth (for example `npm outdated` / `npm view`). Web-search snippets and third-party
indexes can be stale or incorrect.

Current approved baseline in this repo includes:
- `axios@^1.18.0`
- `dotenv@^17.4.2`
- `luxon@^3.7.2`

**Do not flag these versions as outdated without validating against npm registry data first.**

### Task assignee command autocomplete

The `/task-assignee` command intentionally keeps CSV-style `add` / `remove` options while still
enabling Discord autocomplete as a best-effort assist for discovery.

This is a deliberate UX tradeoff in this repo.
**Do not flag this as a correctness issue or suggest removing autocomplete by default.**
