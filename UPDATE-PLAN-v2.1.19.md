# NanoClaw Update Plan — v2.0.33 → v2.1.19

_Drafted 2026-06-22. Fact-checked against the live repo 2026-06-22 (see "Verified" notes inline). Deferred from a live session — run this in a dedicated maintenance window when the fleet can tolerate ~15–30 min of downtime._

> **Note on the target:** `v2.1.19` is **not a git tag** (latest tag is `v2.1.17`). `upstream/main` `package.json` reads `2.1.19` at tip **`625264b`** — "update to v2.1.19" means "update to `upstream/main` tip," not a tag checkout. Merge-base with our HEAD is **`f2d2ce9`**.

## Why this is a maintenance-window job, not a quick pull

- **427 upstream commits, 363 files** (101 in `src/`, 41 in `container/`, 131 skills).
- **3 breaking changes**, all of which can take the live fleet down if mishandled:
  1. **OneCLI SDK `@onecli-sh/sdk` `^0.3.1` → `2.2.1`** needs a gateway speaking the `/v1` API. Pinned: `onecli-gateway 1.36.0`, `onecli-cli 2.2.5` (`versions.json`, verified upstream). The gateway is a **separate process** — the code update does not upgrade it. If the SDK bumps but the gateway doesn't, **every credential call 404s** → fleet loses Gmail/Notion/Slack/X access. Migration doc: `docs/onecli-upgrades.md`. _(Current on-disk CLI is `1.1.0` — both gateway **and** CLI need upgrading.)_
  2. **Startup requires an upgrade marker.** Host refuses to boot unless `data/upgrade-state.json` is stamped via a sanctioned path (`enforceUpgradeTripwire` in `src/index.ts` — verified). Recovery doc: `docs/upgrade-recovery.md`.
  3. **Service names are now per-install** (slugged). The real format from `setup/lib/install-slug.sh` is **`com.nanoclaw-v2-<slug>`** (dash-joined, with a `v2` — NOT dotted `com.nanoclaw.<slug>`). For **this install** the concrete target is **`com.nanoclaw-v2-a040daa4`** (slug = `sha1(/Users/ohad/Projects/nanoclaw)[:8]`). Your `~/Library/LaunchAgents/com.nanoclaw.plist` and any `kickstart com.nanoclaw` commands stop matching a real service. _(The container **image** is already slugged locally — running image is `nanoclaw-agent-v2-a040daa4`; only the **launchd service**, loaded as plain `com.nanoclaw`, is still unslugged.)_

## Decision to make first: merge vs migrate

You have **14 local commits** (below) vs **101 changed upstream `src/` files** → a `git merge` will likely conflict heavily.
**Recommendation: evaluate `/migrate-nanoclaw` first** (extracts your customizations, replays them on clean upstream) — usually cleaner than a 427-commit merge at this drift. Fall back to `/update-nanoclaw`'s merge path only if migrate doesn't fit.

### Local commits that MUST survive
```
fad0468 feat(router): ack inbound with a 👀 reaction when an agent engages
46f08df test(recurrence): central DB for the pause gate + paused-skip cover
e4120fd chore: add ops scripts + design docs
884e96e feat: agent-group pause + agent-control module; remove mnemon
d8e106a fix(transcription): WhatsApp voice notes → Groq Whisper + real API errors
c2711cd fix(agent-runner): stop scheduled routines spamming idle sign-offs
b56bfaf fix(container-config): never wipe a corrupt container.json on read
7f19fe2 chore: preserve Gmail MCP fix
41cc72e feat: add /add-mnemon skill   ← NOTE: mnemon is killed (see memory); may drop
461e88d feat: enable fameclaw inside agent containers
f35cab1 chore: un-track nanoclaw.db (v1 runtime DB)
+ 3 v1→v2 migration housekeeping commits
```
Plus **uncommitted working-tree** items to fold in:
- `container/skills/gtm-humanizing-outreach/` (untracked — **keep**).
- `docs/blog-aeo-learnings.md` (untracked — **keep**).
- `.claude/skills/manage-channels/SKILL.md` (+2 lines — **RESOLVED, see below**). The uncommitted edit is a genuine gotcha worth keeping (the `register` overwrites `.env ASSISTANT_NAME` note). **But** it sits on a stale base: upstream substantially rewrote this file (old `src/db/...`/`src/access.ts` → `src/modules/permissions/...` paths, plus a new `scripts/q.ts` wrapper block) **and** modifies it in this update. **Resolution: take upstream's version of the file, then re-apply just your gotcha paragraph** — do NOT keep the local file wholesale (it would reintroduce stale module paths).

### Commit-by-commit conflict verdict (verified against `upstream/main`)

| Local commit | Upstream coverage? | Verdict |
|---|---|---|
| `fad0468` router 👀-ack | None found | **Preserve cleanly** — no upstream conflict |
| `d8e106a` WhatsApp PTT → Groq Whisper | **None** — upstream "transcript" commits (`6686315`, `f00f863`) are session-transcript *file rotation*, a different concern | **Preserve cleanly** — earlier conflict worry was a FALSE ALARM |
| `c2711cd` agent-runner idle sign-offs | None found | **Preserve cleanly** |
| `884e96e` agent-group pause / agent-control | None found (but see ⚠️ below — reads container config) | **Preserve**, re-check against container-config-to-db |
| `b56bfaf` never wipe corrupt `container.json` on read | ⚠️ **Likely obsolete** — see below | **Re-evaluate / probably drop** |
| `41cc72e` /add-mnemon skill | mnemon killed (see memory) | **Drop** |

> ⚠️ **Highest-risk merge area (NOT a minor conflict): `container-config-to-db`.** Upstream moved per-group container config **out of `container.json` files into the central DB** (`ad5d4d2`, `aeeb54a`, + per-group model/effort overrides). This directly undercuts local `b56bfaf` (a *file*-based corrupt-read guard — likely obsolete) and may collide with `884e96e` (agent-control reads/writes container config). **Budget the most conflict-resolution time here.** Re-read how upstream reads container config before reconciling either commit.

> ✅ The upstream fixes we wanted today landed and are verified present: `107945f` (A2A reply routing, #2267) and `be3a8a9` (race-free on-wake + explicit restart CLI).

## Runbook (ordered — do not reorder 4→5→6)

### 0. Prep
- [ ] Pick a window; warn anyone relying on the fleet.
- [ ] Commit or stash the working tree clean (commit the gtm skill + blog-aeo doc; decide on manage-channels). Update tooling **requires** a clean tree.
- [ ] Note current OneCLI gateway version: open `http://127.0.0.1:10254` (CLI not on PATH) or check the gateway process. Read `docs/onecli-upgrades.md` end-to-end before proceeding.

### 1. Safety net
- [ ] `git branch backup/pre-update-$(git rev-parse --short HEAD)-$(date +%Y%m%d-%H%M%S)` and matching tag.
- [ ] Back up `data/` (esp. `data/v2.db`, session DBs) and `.env`.

### 2. OneCLI gateway FIRST (critical path)
- [ ] Upgrade the gateway to the pinned `1.36.0` per `docs/onecli-upgrades.md`. Verify it serves `/v1` (`curl http://127.0.0.1:10254/v1/...`).
- [ ] Confirm agents' secret-mode + assignments are intact after upgrade (`onecli agents list` / `secrets`).
- _Why first: if the code lands before the gateway speaks /v1, the fleet 404s the moment it restarts._

### 3. Apply the code update
- [ ] `/migrate-nanoclaw` (preferred) **or** `/update-nanoclaw` merge. Resolve conflicts preserving the 14 local commits' intent; drop redundant ones where upstream now covers them.
- [ ] `pnpm install` (lockfile changed). `cd container/agent-runner && bun install` if its lock changed.

### 4. Stamp the upgrade marker (or host won't boot)
- [ ] `pnpm exec tsx scripts/upgrade-state.ts set`

### 5. Service rename (the real delta — image is already slugged)
- [ ] Confirm the target label: `source setup/lib/install-slug.sh && launchd_label` → expect **`com.nanoclaw-v2-a040daa4`** for this install (format is `com.nanoclaw-v2-<slug>`, dash-joined — NOT `com.nanoclaw.<slug>`).
- [ ] Regenerate/rename `~/Library/LaunchAgents/com.nanoclaw.plist` → `com.nanoclaw-v2-a040daa4.plist` with the matching `Label`. Review `com.nanoclaw.health-check-2026-05-01.plist` and `com.nanoclaw.logrotate.plist` too (both present). 
- [ ] **Leave independent services alone:** `com.ohad.nanoclaw-monitor` and `com.cloudflared.nanoclaw` (the tunnel, currently loaded) are not part of the rename — but update any `kickstart com.nanoclaw` calls inside them or your scripts.
- [ ] Grep your custom scripts for `com.nanoclaw` and update to `com.nanoclaw-v2-a040daa4` (anything that kickstarts/loads the service).

### 6. Build + validate
- [ ] `pnpm run build` && `pnpm test`
- [ ] `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit` (container changed)
- [ ] `./container/build.sh` (41 container files changed — rebuild required). Note: `build.sh` already derives the slugged image name (`nanoclaw-agent-v2-a040daa4`); no image-name action needed.

### 7. Restart with the NEW service name
- [ ] `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` (old), then `launchctl load ~/Library/LaunchAgents/com.nanoclaw-v2-a040daa4.plist` (new); or `launchctl kickstart -k gui/$(id -u)/com.nanoclaw-v2-a040daa4`.

### 8. Channels/providers + skills
- [ ] Re-run `/add-slack`, `/add-whatsapp`, `/add-telegram`, etc. for each installed channel (safe — updates code only, not creds/wiring), and `/add-*` for providers. Run `/update-skills` if skill branches exist.
- [ ] **manage-channels SKILL.md:** after the merge takes upstream's rewritten file, re-apply your `register`-overwrites-`ASSISTANT_NAME` gotcha paragraph onto it (don't let the merge keep the stale local copy with old `src/db/...` paths).

## Verification checklist (after restart)
- [ ] Host boots (no "update did not go through supported path" — if it trips, re-run the upgrade-state command per `docs/upgrade-recovery.md`).
- [ ] OneCLI: an agent makes a real API call (Gmail/Notion) with no 401/404.
- [ ] DM NC Marty → it replies (delivery + routing healthy; confirms the readonly + thread fixes landed).
- [ ] Spokes (Quill, Penn, Viber, Scout, Watchtower, Wiki) respond.
- [ ] Scheduled tasks still queued (`list_tasks` via NC Marty): Dream, digest, learnings-triage nudge (`task-1782117322735-mlzmru`), board room if scheduled.
- [ ] Host-side custom systems unaffected: `nanoclaw-monitor` still writes BOARD + `learnings-summary.md`; capture-learning hook still fires.

## Rollback
- `git reset --hard <backup-tag>` (or checkout `backup/pre-update-...` branch).
- Restore `data/` + `.env` backups.
- Downgrade the OneCLI gateway to its prior version if the new one misbehaves.
- Unload the new `com.nanoclaw-v2-a040daa4` service and reload the **old** `com.nanoclaw.plist` (the old code expects the old unslugged label).

## Not affected by this update (no action)
- Host-side custom scripts in `~/.claude/` (monitor, capture-learning, triage command) — outside the repo.
- `groups/` agent customizations (gitignored) — survive the merge.
- X cookies (env-var, not OneCLI) and `GROQ_API_KEY` (host `.env`) — unaffected by the OneCLI bump.
