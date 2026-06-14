# NanoClaw — Error Report (last 3 days: Jun 8–11, 2026)

Two real incidents we fixed, plus a handful of recurring/environmental errors flooding the logs.

---

## Fixed this period

### 1. Workspace directory split — agents lost their working files (Jun 11)
**What:** Marty's nightly Dream routine failed — `/workspace/agent/dream-routine.md` was missing. Root cause was bigger: every agent's real workspace lives in `NanoClaw/<group>/`, but around Jun 9–10 the live `/workspace/agent` mount got swapped to freshly-scaffolded thin `groups/<group>/` dirs. All six agents silently lost their routines, dream-reports, research, and drafts.
**Fix:** Non-destructive merge `rsync --ignore-existing NanoClaw/<g>/ → groups/<g>/` across all 6 groups (~330 files restored). Never overwrote the fresher state agents wrote post-flip. Restarted the service. Dream schedule (`0 3 * * *`) verified — fires tonight against the now-present file.
**Suspected cause:** A migration/scaffold step (or a lost symlink) recreated `groups/<g>/` as empty real dirs and the mount started resolving there instead of `NanoClaw/<g>/`. Symptom repaired; the *trigger* of the swap was not root-caused — if a group dir resets to a thin scaffold again, that's the recurrence.

### 2. Corrupt container.json wiped agent mounts (Jun 10)
**What:** Surfaced as Marty's alarm *"Wiki storage reset — all files gone"* — a **false alarm, no data lost** (host wiki was intact, git-backed, daily auto-commit). A malformed `container.json` had silently erased `additionalMounts`/`mcpServers`/`packages` on four agents (Marty, Wiki, Quill, Viber), so their containers spawned **without their wiki/Content bind mounts** — they "went blind."
**Fix:** Commit `b56bfaf`. `readContainerConfig` no longer returns an empty config on a parse error — it backs the file up to `container.json.corrupt-<ts>` and throws, so read-modify-write callers abort instead of clobbering. `writeContainerConfig` is now atomic (temp file + rename). Mounts restored on all 4 groups; 4 tests added.
**Suspected cause:** A torn/non-atomic write produced invalid JSON; the old read-path caught the parse error, returned `{}`, and the spawn-time identity-field sync persisted that empty config back — permanently erasing the mounts. (Note: upstream already moved to a DB-backed config immune to this; this patch becomes redundant when that's pulled in.)

---

## Recurring / environmental

### 3. WhatsApp "Bad MAC" decryption flood — ~38,500 occurrences ✅ FIXED (Jun 11)
libsignal/Baileys 1:1 session-ratchet desync on the WhatsApp adapter (`doDecryptWhisperMessage`). Mostly harmless noise, but the main reason the logs ballooned (`nanoclaw.log` 944MB, `error.log` 71MB).
**Fix (today):** Stopped the service, backed up `store/auth/` (→ `store/auth-backup-2026-06-11.tar.gz`, 5MB), cleared the 5,629 desynced `session-*.json` ratchets — kept `creds.json`, pre-keys, sender-keys, app-state, so **no QR re-pair needed**. Restarted; WhatsApp reconnected paired and clean. **Bad MAC count since restart: 0.**
**Suspect:** accumulated stale 1:1 sessions never being pruned; will re-establish lazily as messages arrive.

### 4. Host process heap OOM — 33 FATAL "JavaScript heap out of memory"
The host Node process crashed from memory exhaustion several times. **Suspect:** tied to #3 — the Bad-MAC churn plus unbounded log/message accumulation. Should be relieved now that #3 is cleared and logs are rotated; watch for recurrence.

### 5. "Container runtime failed to start" FATAL — thousands of hits
Host couldn't reach the Docker daemon (`Cannot connect to the Docker daemon … Is the docker daemon running?`). Agents can't run when Docker Desktop is down. **Suspect:** Docker Desktop stopped/restarted on the host; environmental, not a code bug.

### 6. Transient network failures
- Google OAuth `getaddrinfo ENOTFOUND oauth2.googleapis.com` (~947) — DNS resolution blips on the token endpoint.
- Telegram `getUpdates` NetworkError (~149) — polling hiccups, self-recovered (consecutiveFailures reset).
**Suspect:** intermittent host/container network egress, not persistent.

### 7. better-sqlite3 "Could not locate the bindings file" — 11 hits
Native module ABI/path mismatch. **Suspect (confirmed via STATUS.md):** host runs on Node 22 (`/usr/local/bin/node`) but the shell defaults to Node 25; running `pnpm rebuild` under the wrong Node clobbers the prebuilt binding. Restore with `prebuild-install` (or rebuild under Node 22).

---

## Remediation done today (Jun 11)
- ✅ **Logs rotated** — `nanoclaw.log` 944MB → 0 and `error.log` 71MB → 0 (~1GB reclaimed) via copy-truncate; filtered snapshots kept as `*.1`.
- ✅ **WhatsApp session reset** — Bad-MAC flood eliminated (now 0), no re-pair, full auth backup retained.
- ✅ **Workspace dirs restored** — ~330 files merged back into `groups/<g>/` across all 6 agents.

## Still open
- Root-cause the workspace-dir swap (#1) so `groups/<g>/` can't get re-scaffolded out from under live agents.
- Watch host memory (#4) now that the Bad-MAC driver is gone.
- Add periodic log rotation so the logs don't balloon again (currently manual).
