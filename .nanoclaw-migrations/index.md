# NanoClaw Migration Guide

Generated: 2026-04-24
Base: `29839464bff39b7672c0a7504d9bb7649a79c5f1` (v1.2.x divergence point)
HEAD at generation: `a3f94df33d27fa5acc3c2b68587a5097e20cce1f`
Upstream HEAD at generation: `d8b1f52f2b61f7104f28d3667bab79b934a121e7` (v2.0.5)
Backup tag (pre-generation): `pre-update-5754dd8-20260423-160211`

Migration applied: 2026-04-24
Post-migration HEAD: `f0a52cf4530535fb02af3ce87a610aea1fd5550c`
Upstream HEAD at migration: `a4346f566c87a25418aa5e783fc2a54089e11e6a` (v2.0.10)
Backup tag (pre-migration): `pre-migrate-40aa6ad-20260424-115328`

This is a **v1 → v2 major-version migration**. NanoClaw v2 is a substantial architectural rewrite. See `06-v2-risks.md` for breaking-change impact.

## Migration plan

Ordering matters. Apply in sequence, validate after each stage.

### Stage 1 — Clean v2 base
Worktree checked out from `upstream/main` at the `d8b1f52` commit (or later). Before replay, the tree is untouched upstream v2.

### Stage 2 — Channels + voice transcription
See [01-channels-and-voice.md](01-channels-and-voice.md).
- Install channels via v2 skills: `/add-gmail`, `/add-slack`, `/add-telegram`, `/add-whatsapp`. In v2 these copy from the upstream `channels` branch — no more separate fork remotes.
- Re-apply WhatsApp voice transcription: install `/add-voice-transcription` (upstream skill) or merge `upstream/skill/voice-transcription` if the skill still lives on a branch. If neither exists in v2, replay manually from this guide.
- **Validate build here.**

### Stage 3 — Source customizations
See [02-source.md](02-source.md).
- Create new file `src/whatsapp-auth.ts`.
- Create new file `setup/whatsapp-auth.ts` and register it in `setup/index.ts` (**flagged risk** — v2 replaces setup with `bash nanoclaw.sh`; integration point may have moved).
- Add `getMessageContentById(id, chatJid)` to `src/db.ts` (**flagged risk** — v2 splits into inbound.db/outbound.db; target the inbound DB for received-message lookups).
- Add `thread_id?: string` to `NewMessage` in `src/types.ts`.
- **Validate build here.**

### Stage 4 — Container MCP integrations
See [03-container-mcps.md](03-container-mcps.md).
- Add Gmail (marty@), Gmail-Ohad (ohad@), Google Calendar, and Notion volume mounts to `src/container-runner.ts`.
- Add matching MCP server registrations and `allowedTools` entries to `container/agent-runner/src/index.ts`.
- **Explicit change from v1:** Notion MCP opens to **all groups** in v2, not just `slack_main`. The `group.folder === 'slack_main'` gate is removed.
- **Flagged risks:** agent-runner moves Node→Bun in v2 (verify `fs.existsSync`/`readFileSync` work); `RegisteredGroup` type may have new shape under v2 entity model.
- **Validate build + container rebuild here.**

### Stage 5 — Config and env
See [04-config.md](04-config.md).
- Merge `package.json` dependencies needed for channels + transcription (many may already be pulled in by channel skills — deduplicate).
- Add env vars to `.env.example`.
- Extend `.gitignore` with `nanoclaw.db` and `.claude/STATUS.md`.

### Stage 6 — Custom skills (copy verbatim)
See [05-custom-skills.md](05-custom-skills.md).
- `.claude/skills/fameclaw/` — full directory.
- `.claude/skills/add-karpathy-llm-wiki/` — full directory.
- `container/skills/wiki/` — full directory (container-side skill for the wiki).

### Stage 7 — Group memory (untouched)
`groups/` is never modified by this migration. The backup tag + the fact that the migrate-nanoclaw skill swaps via `git reset` (not worktree replace) means `groups/global/CLAUDE.md`, `groups/main/CLAUDE.md`, and any other group directories remain in place automatically. No action needed.

## Applied skills

### From upstream skill branches (re-install via v2 skills)
- `add-whatsapp` (v2 `channels` branch)
- `add-voice-transcription` (or `skill/voice-transcription`, to be verified)
- `add-karpathy-llm-wiki` — **custom, not upstream**. Copy verbatim.
- `migrate-nanoclaw` (upstream; already installed to run this migration)

### From per-channel fork remotes (replaced by v2 `channels` branch)
These are no longer installed via remote merge in v2:
- gmail (was `gmail/main` — now `upstream/channels` / `/add-gmail`)
- slack (was `slack/main` — now `upstream/channels` / `/add-slack`)
- telegram (was `telegram/main` — now `upstream/channels` / `/add-telegram`)
- whatsapp (was `whatsapp/main` — now `upstream/channels` / `/add-whatsapp`)

The four channel remotes (`gmail`, `slack`, `telegram`, `whatsapp`) can remain configured in git for history, but are no longer the install path.

### Custom skills (copy verbatim — no upstream)
- `fameclaw` — YouTube creator prospecting
- `add-karpathy-llm-wiki` + `container/skills/wiki/` — LLM wiki knowledge base

## Skill interactions

- **Voice transcription ↔ WhatsApp**: voice transcription must be applied *after* whatsapp is installed. It modifies `src/channels/whatsapp.ts` (imports transcription helpers, wraps voice-note handling) and requires `src/transcription.ts` and the `openai` npm dep.
- **OneCLI ↔ Notion MCP**: OneCLI is the sole credential path in v2 and acts as an HTTPS proxy that only routes Anthropic APIs. The Notion MCP config must explicitly clear `HTTPS_PROXY`/`HTTP_PROXY` and set `NO_PROXY=api.notion.com` or Notion API calls fail. This workaround is load-bearing under v2 and documented in `03-container-mcps.md`.
- **Gmail dual-account ↔ Google Calendar**: the `gcal` MCP server reads `GOOGLE_OAUTH_CREDENTIALS` from `/home/node/.gmail-mcp/gcp-oauth.keys.json` — it reuses the *primary* (marty@) Gmail OAuth keys, not a separate calendar-specific OAuth. This is intentional; do not create a separate OAuth app for the calendar.

## Files ignored during migration
- `src/channels/{gmail,slack,telegram,whatsapp}.ts` and their tests — prettier-only diffs in commit `68e01f8`, no behavior changes. v2 channel skills install fresh files.
- `src/channels/index.ts` — v2 uses self-registering channels.
- `src/ipc.ts` — whitespace/comment-only change.
- `src/container-runtime.test.ts` — test formatting only.

## Rollback
```
git reset --hard pre-update-5754dd8-20260423-160211
```
