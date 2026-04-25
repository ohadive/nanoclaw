---
name: init-first-agent
description: Initialize the first messaging group and agent after NanoClaw is installed. Handles channel registration, platform-ID resolution, and group folder setup. Use after /setup completes channel authentication.
---

# Init First Agent

Register a messaging group so NanoClaw routes messages to an agent container.
Run after `/setup` has completed channel authentication (WhatsApp QR/pair, Telegram bot token, etc.).

## 1. Confirm prerequisites

Check that the chosen channel is authenticated:

- **WhatsApp**: `store/auth/creds.json` exists
- **Telegram**: `TELEGRAM_BOT_TOKEN` is set in `.env` — verify: `npx tsx setup/index.ts --step pair-telegram`
- **Slack**: `SLACK_BOT_TOKEN` is set in `.env`
- **Discord**: `DISCORD_BOT_TOKEN` is set in `.env`

If authentication is missing, stop and invoke the relevant channel skill (`/add-whatsapp`, `/add-telegram`, etc.) first.

## 2. Collect group metadata

Ask the user (or infer from context):

- **Channel**: whatsapp | telegram | slack | discord
- **Group or DM**: Is this a group chat or a 1-on-1 DM?
- **Name**: Human-readable label for the group (e.g. "Family", "Dev Team")
- **Folder**: Slug used for `groups/<folder>/` (e.g. `whatsapp_family`). Must match `[a-z0-9_-]+`.
- **Is main**: Is this the primary channel that receives all messages without a trigger?

## 3. Resolve the DM platform ID

You need the channel-specific ID for the chat. How to get it depends on the channel:

### Channels with cold DM (resolution-required): discord, teams, webex, gchat

These platforms don't deliver events until the user sends the first message. The bot can't see itself or determine a DM ID ahead of time.

**3a. User DMs the bot once**

Tell the user:

> Open the app and send any message to the bot (e.g. "hi"). The bot will log its ID — watch the output:
>
> ```bash
> tail -f logs/nanoclaw.log | grep 'platform_id\|chat_jid\|NEW_CHAT'
> ```
>
> Copy the ID that appears (e.g. `dc:123456789` for Discord).

Wait for the user to provide the ID before continuing.

### Channels with static IDs: whatsapp, telegram

These adapters can resolve IDs without an initial message:

**WhatsApp** — The JID is the phone number in E.164 format suffixed with `@s.whatsapp.net` for DMs or `@g.us` for groups. Examples:
- DM: `15551234567@s.whatsapp.net`
- Group: `12345678901234567890@g.us` (fetch from `npx tsx setup/index.ts --step groups -- --list`)

**Telegram** — Send `/chatid` to the bot in the target chat. The bot replies with the numeric ID. Prefix it with `tg:`:
- DM: `tg:123456789`
- Group/supergroup: `tg:-1001234567890`

If the Telegram bot isn't running yet, start it first:

```bash
npx tsx setup/index.ts --step pair-telegram
npm run dev &   # or restart the service
```

Then send `/chatid` in the chat and copy the ID.

**3b. Telegram pair-code verification**

After collecting the Telegram chat ID, verify the bot can reach it:

```bash
npx tsx setup/index.ts --step pair-telegram
```

A successful `PAIR_TELEGRAM STATUS=success` block confirms the token is valid and the bot is reachable.

### Slack

> **Note**: Slack DMs require a public inbound webhook tunnel (ngrok, cloudflared, etc.) plus a configured Slack Event Subscriptions Request URL pointing at `http://<your-tunnel>/slack/events`. A plain cold DM does not reach the bot because the `@chat-adapter/slack` adapter is webhook-only with no Socket Mode support. Setting up a Slack tunnel is out of scope for this skill — use `/add-slack` which covers the full Slack setup including tunnel guidance.

## 4. Register the group

Run the register step with the resolved ID:

```bash
npx tsx setup/index.ts --step register -- \
  --channel <channel> \
  --platform-id '<resolved-id>' \
  --name '<Group Name>' \
  --folder '<channel>_<slug>' \
  [--is-main] \
  [--no-trigger-required] \
  --assistant-name '<AssistantName>'
```

For a **main DM** (responds to all messages, no trigger needed):

```bash
npx tsx setup/index.ts --step register -- \
  --channel whatsapp \
  --platform-id '15551234567@s.whatsapp.net' \
  --name 'My Phone' \
  --folder 'whatsapp_main' \
  --is-main \
  --assistant-name 'Andy'
```

For a **group chat** (trigger-only):

```bash
npx tsx setup/index.ts --step register -- \
  --channel telegram \
  --platform-id 'tg:-1001234567890' \
  --name 'Dev Team' \
  --folder 'telegram_dev-team' \
  --assistant-name 'Andy'
```

A successful `REGISTER_CHANNEL STATUS=success` block confirms the group is registered and the folder was created under `groups/`.

## 5. Verify

```bash
npx tsx setup/index.ts --step verify
```

`REGISTERED_GROUPS` should be ≥ 1. Then send a test message in the registered chat — the agent should respond within a few seconds.

Check logs if needed:

```bash
tail -f logs/nanoclaw.log
```
