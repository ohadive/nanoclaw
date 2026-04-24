# Config and build

## `package.json` dependencies

**Intent:** Dependencies pulled in by channels, voice transcription, and the WhatsApp auth script.

**Scope:** Standard (but deduplicate with v2 channel skills)

**How to apply:**

After installing v2 channel skills (`/add-whatsapp`, `/add-gmail`, etc.), most of these are already in `package.json`. Check and add any missing:

```json
"@slack/bolt": "^4.3.0",
"@slack/types": "^2.15.0",
"@whiskeysockets/baileys": "^6.17.16",
"google-auth-library": "^9.15.1",
"googleapis": "^146.0.0",
"grammy": "^1.39.3",
"openai": "^6.27.0",
"qrcode": "^1.5.4",
"qrcode-terminal": "^0.12.0",
"zod": "^4.3.6"
```

Expected sources:
- `@slack/bolt`, `@slack/types` — from `/add-slack`
- `@whiskeysockets/baileys`, `qrcode`, `qrcode-terminal` — from `/add-whatsapp`
- `google-auth-library`, `googleapis` — from `/add-gmail`
- `grammy` — from `/add-telegram`
- `zod` — may be transitively required, or from channel skills
- `openai` — manual add for voice transcription (not shipped by upstream)

Run `npm install` after any additions.

## `.env.example`

**Intent:** Document required env vars so the user knows to populate `.env`.

**Scope:** Standard

**How to apply:**

Add any missing entries:

```
# Slack (if using /add-slack)
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=

# WhatsApp presenter behavior
ASSISTANT_HAS_OWN_NUMBER=

# OpenAI (for voice transcription)
OPENAI_API_KEY=
```

Channel skills typically add their own entries; deduplicate.

## `.gitignore`

**Intent:** Exclude runtime DB and auto-maintained session-status file from git.

**Scope:** Standard

**How to apply:**

Under the "Local data & auth" section, add:
```
nanoclaw.db
.claude/STATUS.md
```

## Files explicitly not migrated
- `package-lock.json` — will regenerate from scratch on `npm install` in the worktree.
- `.nanoclaw/` (local per-installation skill state, if present) — excluded by `.gitignore`; regenerates.
