# v2 breaking changes — impact on this migration

From upstream `CHANGELOG.md` v2.0.0 notes. Each item below lists the breaking change and where in this migration it may cause issues.

## New entity model
Users, roles (owner/admin), messaging groups, and agent groups are separate entities linked by `messaging_group_agents`. Privilege is user-level instead of channel-level; "main channel = admin" is retired.

**Impact on this migration:**
- `src/container-runner.ts` — the `RegisteredGroup` type and the `group.folder` field may have changed shape. The mount-building logic in `03-container-mcps.md` references `group.folder`; verify the v2 equivalent before applying.
- `groups/main/CLAUDE.md` is preserved as-is but the notion of "main group" may map differently in v2. No code change needed from this migration.

## Two-DB session split
Each session now has `inbound.db` (host writes, container reads) and `outbound.db` (container writes, host reads). Replaces the single shared session DB.

**Impact on this migration:**
- `src/db.ts` — the `getMessageContentById` addition in `02-source.md` needs to target the DB that holds received messages (likely `inbound.db` on the host side, readable from container). Determine the v2 module path and db-handle name before adding the function.
- Container-side reads of message history (if any are triggered by the custom MCPs or skills) should use the inbound db handle, not the outbound one.

## Install flow replaced
`bash nanoclaw.sh` is the new default. The Claude-guided `/setup` skill is an alternative.

**Impact on this migration:**
- `setup/whatsapp-auth.ts` and the `setup/index.ts` STEPS registry addition in `02-source.md` may not apply. If the STEPS registry is gone, either (a) invoke `src/whatsapp-auth.ts` manually once during setup, (b) port the orchestration to a bash step, or (c) check if `/add-whatsapp` already ships an auth step.

## Channels moved to the `channels` branch
Trunk no longer ships Discord, Slack, Telegram, WhatsApp, iMessage, Teams, Linear, GitHub, WeChat, Matrix, Google Chat, Webex, Resend, or WhatsApp Cloud. Install per-fork via `/add-<channel>` skills (which copy from the `channels` branch).

**Impact on this migration:**
- The four channel remotes (`gmail`, `slack`, `telegram`, `whatsapp`) are obsolete as an install path. Removed from the re-install plan; replaced by `/add-<channel>` per `01-channels-and-voice.md`.
- The remotes themselves can remain configured in git for history reference but are not consulted during upgrade.

## Alternative providers moved to `providers` branch
OpenCode, Codex, Ollama install via `/add-opencode`, `/add-codex`, `/add-ollama-provider`. Claude remains the default.

**Impact on this migration:**
- This fork uses Claude. No action needed.

## Three-level channel isolation
Per-channel: wire to own agent (separate agent groups), share an agent with independent conversations (`session_mode: 'shared'`), or merge channels into one shared session (`session_mode: 'agent-shared'`). Configured via `/manage-channels`.

**Impact on this migration:**
- The pre-migration fork used one agent across WhatsApp + Slack + Telegram + Gmail per group. The default v2 mode should match this.
- The Notion-on-slack-only scoping from v1 had a natural mapping to agent-group isolation but is now dropped per user decision. Not an issue.

## Apple Container removed from default
Still available via `/convert-to-apple-container`.

**Impact on this migration:**
- This fork was on Docker per the existing CLAUDE.md. No action.

## Shared-source agent-runner
Per-group `agent-runner-src/` overlays are gone; all groups mount the same agent-runner read-only. Per-group customization flows through composed CLAUDE.md.

**Impact on this migration:**
- If the fork had per-group agent-runner overlays, they must be collapsed into shared base + per-group CLAUDE.md fragments. Based on the fork analysis, no per-group agent-runner overlays exist here, so this is not a concern.

## Agent-runner runtime moved Node → Bun
Container image is self-contained; no host-side impact. Host stays on Node + pnpm.

**Impact on this migration:**
- `container/agent-runner/src/index.ts` modifications in `03-container-mcps.md` use `fs.existsSync`, `fs.readFileSync`, async imports, object spread — all supported in Bun. But the v1 file may have imports that Bun handles differently (e.g. `require` of CommonJS modules). Verify by running `bun build` or the container's test suite after applying.
- The `npx` commands in the MCP server configs run inside the container image. If the image uses Bun runtime, `npx` is still available (via node shim) — no change needed.

## OneCLI Agent Vault is the sole credential path
Containers never receive raw API keys; credentials are injected at request time.

**Impact on this migration:**
- **Load-bearing** for the Notion MCP workaround. OneCLI acts as an HTTPS proxy that only routes Anthropic APIs. The Notion MCP config must continue to clear `HTTPS_PROXY`/`HTTP_PROXY` and set `NO_PROXY=api.notion.com`. See `03-container-mcps.md`.
- Gmail and GCal MCPs use OAuth with `credentials.json` files (no API key proxying needed) — OneCLI doesn't affect them.

## Container buildkit cache
Per existing CLAUDE.md:
> The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

**Impact:** After applying container-side modifications (`03-container-mcps.md`), prune the builder before rebuilding or the MCP config additions may not land in the image.
