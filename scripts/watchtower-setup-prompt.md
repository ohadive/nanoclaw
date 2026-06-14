# Watchtower Tier 1 Setup — Autonomous Execution

You are a Claude Code session launched by launchd at 5am IDT on 2026-05-08. Working directory: `/Users/ohad/Projects/nanoclaw`. Ohad is asleep. Run autonomously, do not ask questions, finish the job.

## Read first

1. `/Users/ohad/.claude/plans/i-want-to-start-shimmying-hejlsberg.md` — full plan
2. `groups/dm-with-ohad/CLAUDE.md` — personality template to fork
3. `groups/dm-with-ohad/container.json` — mount + MCP config template

## Scope (Tier 1 only — Watchtower)

Do **only** the "Scheduled Execution: Tier 1 at 5am IDT" section of the plan. Do **not** touch Scout, Penny, Sprint, Ace, Pitch, or Ship. Do **not** change Marty or Wiki beyond removing Marty's wiring to `#notifications`.

## Steps

### 1. Create `groups/watchtower/`

```
groups/watchtower/
├── CLAUDE.md          # personality, scope, escalation
├── container.json     # forked from dm-with-ohad/, mounts trimmed to RO
└── skills/            # empty — container defaults are enough
```

**CLAUDE.md essentials:**
- Identity: Watchtower, NanoClaw monitoring agent for Ohad
- Scope: post a daily 8am IDT digest in `#notifications` covering n8n workflow status, Typefully draft queue, content drafts in `~/Projects/Content/Social Media/drafts/`, and sprint-progress changes across `~/Projects/Shopify/clients/*/sprint-progress.md`
- Hard rules: never write to client folders; never DM clients; never publish anywhere; on uncertainty, DM Ohad via Marty
- Escalation: if a tool fails or a digest can't be generated, post a brief failure note in `#notifications` and DM Ohad via Marty

**container.json mounts:** `~/Projects/Content` (RO), `~/Projects/Shopify/clients` (RO), `~/Projects/n8n` (RO). No MCP servers needed — container defaults plus `mcp__claude_ai_n8n__*` (the n8n MCP comes via Ohad's connector setup if available; otherwise Watchtower can use `agent-browser` to read n8n UI).

### 2. Register the agent group + re-wire `#notifications`

Use the canonical setup command:

```bash
pnpm exec tsx setup/index.ts --step register -- \
  --platform-id "C08HD76JPK2" --name "slack-notifications" \
  --folder "watchtower" --channel "slack" \
  --session-mode "shared" --assistant-name "Watchtower"
```

This may fail because `messaging_groups` row already exists wired to Marty. If it does, manually re-wire:

```bash
sqlite3 data/v2.db "DELETE FROM messaging_group_agents WHERE messaging_group_id='mg-17780740923N-notif' AND agent_group_id='ag-1777036413328-jgnx14';"
sqlite3 data/v2.db "DELETE FROM agent_destinations WHERE agent_group_id='ag-1777036413328-jgnx14' AND messaging_group_id='mg-17780740923N-notif';"
# then re-run register
```

Confirm the new agent group ID with `sqlite3 data/v2.db "SELECT id, name, folder FROM agent_groups WHERE folder='watchtower';"`.

### 3. Verify

- `sqlite3 data/v2.db "SELECT * FROM agent_groups WHERE folder='watchtower';"` — row exists
- `sqlite3 data/v2.db "SELECT * FROM messaging_group_agents WHERE messaging_group_id='mg-17780740923N-notif';"` — only Watchtower (not Marty)
- Wait ~30s for the container to spin up after first message routing

### 4. Send a test message

Trigger the welcome path: write a row into `data/v2-sessions/<watchtower-group-id>/<session>/inbound.db` `messages_in` with content "Welcome — please confirm you're online." (Or simpler: post a message directly to `#notifications` from Slack via the bot token in `.env` — same effect.)

Confirm the agent responds in `#notifications` within 60 seconds. Read its response from `data/v2-sessions/<group>/<session>/outbound.db` `messages_out`.

### 5. Schedule the daily digest

Once Watchtower is online, route a message asking it to call `schedule_task` with cron `0 8 * * *` Asia/Jerusalem and a description that pulls the digest scope above. Confirm via `outbound.db` that it acknowledged.

### 6. Status report

When done (or if blocked), DM Ohad via Marty:

```bash
# Find Marty's session for the slack DM with Ohad
sqlite3 data/v2.db "SELECT id FROM sessions WHERE agent_group_id='ag-1777036413328-jgnx14' ORDER BY created_at DESC LIMIT 5;"
# Insert a system message into Marty's inbound.db with a status summary.
```

The status message should cover: what got done, what failed and why, and any pending decisions for Ohad to handle when he wakes (especially: Scout setup, Tier 2/3 bot user creation).

Also append a structured log to `/Users/ohad/Projects/nanoclaw/logs/watchtower-setup.log`.

## Failure mode

If anything irrecoverable happens (DB corruption, container won't build, can't find Marty's session):
1. Do NOT retry destructive ops.
2. Do NOT rollback partial state — leave it for human inspection.
3. Append the full error trace to `logs/watchtower-setup.log`.
4. DM Ohad via Marty with a one-line summary + path to the log.
5. Stop.

## End condition

When Watchtower posts in `#notifications` and the daily-digest schedule is registered (or you've logged a clear failure with reproduction steps), end the session. The wrapper script handles plist self-cleanup.
