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
