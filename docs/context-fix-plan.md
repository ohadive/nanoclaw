# Agent Context Fix — Build Spec

**For the executing session:** This is a wiring fix, not a feature. Per-group context files are referenced inside `groups/<g>/CLAUDE.local.md` as plain-text paths, so their content never loads into agent sessions. The fix is converting load-bearing references to `@./path` imports and drafting the one missing memory file (Marty's). **No host or container source code changes are needed** — see Part 0. Do not improvise content: every file edit below is spelled out verbatim.

**Out of scope — do not touch:**
- The "Be concise" directive in `container/CLAUDE.md`. Flagged as a separate later experiment.
- The 7MB-transcript issue (scheduled routines running as single long sessions). Different fix, later.
- Drafting context for Scout / Watchtower / Wiki (`slack_marketing`) — their `CLAUDE.local.md` files are empty, nothing to convert (see Part 5).
- The composer (`src/claude-md-compose.ts`) — verified working, no fix needed.

---

## Part 0 — Mechanism verification (done, no build step)

**Question:** do nested `@./path` imports inside `CLAUDE.local.md` resolve through the composed CLAUDE.md?

**Answer: yes, definitively. The composer needs no fix.**

Evidence chain:

1. `src/claude-md-compose.ts:129-138` — the composed `groups/<g>/CLAUDE.md` is imports-only, ending with `@./CLAUDE.local.md`. Regenerated on every spawn.
2. `src/container-runner.ts:281-304` — group dir mounts RW at `/workspace/agent`; composed CLAUDE.md mounts RO at `/workspace/agent/CLAUDE.md`.
3. `container/agent-runner/src/index.ts:41` — agent cwd is `/workspace/agent`. `container/agent-runner/src/providers/claude.ts:300` — SDK launched with `settingSources: ['project', 'user']`, so the CLI loads `/workspace/agent/CLAUDE.md` as project memory and resolves its import tree.
4. **Empirical test (run 2026-06-11, CLI 2.1.173):** a fixture with `CLAUDE.md → @./CLAUDE.local.md → @./brand/voice-profile.md → @./nested-extra.md` (3 hops, sentinel tokens in the leaf files) was probed with `claude -p`. Both sentinels were visible in context. This also confirmed **relative imports resolve relative to the importing file's directory** (the leaf import only existed relative to `brand/`), not the cwd.

Documented limits that shape the edits below:

- **Max import depth: 5 hops.** Our deepest chain after this fix is 3 (composed CLAUDE.md → CLAUDE.local.md → brand file). Safe.
- **Imports inside backticks, code spans, or code blocks are NOT evaluated.** This is the exact root cause pattern: `` `/workspace/agent/brand/voice-profile.md` `` in backticks is inert text. Every `@-import` you write must be a plain, un-backticked line.
- **Only files can be imported, not directories.** Directory references stay as plain paths (deliberate on-demand reads).
- **Absolute container paths** (e.g. `@/workspace/extra/projects/voice/voice-reference.md`) **do NOT resolve — anywhere**. *(Corrected post-build, 2026-06-11:)* empirical testing showed @-imports only resolve within the project directory subtree; absolute paths and `../` parent-relative paths outside it are silently skipped. The escape hatch is a **symlink inside the group dir pointing at the container path** — the boundary check is on the literal path, not the resolved target. This is exactly the composer's own `.claude-shared.md` pattern. Part 3 was implemented this way: `groups/slack_gtm/.voice-reference.md → /workspace/extra/projects/voice/voice-reference.md` and `.gtm-wiki-index.md → /workspace/extra/projects/gtm/wiki/index.md`, imported as `@./.voice-reference.md` / `@./.gtm-wiki-index.md`.
- The container image pins claude-code `2.1.116` (`container/Dockerfile:22`); the host test ran on 2.1.173. Import resolution is a long-stable feature; treat the version delta as no-risk.

**Session pickup note for all acceptance checks:** the composed CLAUDE.md regenerates per spawn and the CLI re-reads memory per process start, but an in-flight container session may carry old context until a fresh session starts. When verifying via a live channel, use a new thread (per-thread sessions) or restart the service: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`.

---

## Part 1 — Quill (`groups/x-content-creator/CLAUDE.local.md`) — SHIP AND TEST FIRST

### Current plain-path references (the bug, enumerated)

| Line | Current text | Verdict |
|---|---|---|
| 19 | `` Files: `/workspace/agent/sprints/2026-W24/` `` | Keep as path — episodic, directory |
| 25 | `` `/home/node/.claude/skills/last30days/` `` | Keep as path — skill dir |
| 30 | `` Brand voice: `/workspace/agent/brand/voice-profile.md` `` | **Convert to `@./brand/voice-profile.md`** |
| 31 | `` Sprint files: `/workspace/agent/sprints/2026-WXX/` `` | Keep as path — template/episodic |
| 32 | `` Trend scans: `/workspace/agent/trends/last-30-days/YYYY-MM-DD.md` `` | Keep as path — episodic |
| 33 | `` Performance log: `/workspace/agent/performance/log.md` `` | Keep as path — grows over time |
| 50 | `` Full rules in `/workspace/agent/brand/voice-profile.md` `` | Superseded by import — section replaced |
| 58 | `` `/workspace/agent/sprints/2026-W24/01-trend-scan.md` `` | Keep as path — episodic |

Additionally, these files exist in the group dir, are load-bearing for every drafting task, and are **never referenced at all** in the current file: `brand/audience.md` (5.1KB), `brand/positioning.md` (4.0KB), `playbooks/pillars.md` (4.5KB), plus nine task playbooks under `playbooks/`. Import the first three; index the playbooks as on-demand paths.

Always-load budget added: voice-profile 2.9KB + audience 5.1KB + positioning 4.0KB + pillars 4.5KB ≈ 16.5KB ≈ ~4K tokens per session. Acceptable. Do NOT import `brand/creative-kit.md` (15KB, visual work only) or individual playbooks (each task names its playbook).

### Edit 1.1 — replace the "Key file locations" section

In `groups/x-content-creator/CLAUDE.local.md`, replace this exact block:

```markdown
## Key file locations

- Brand voice: `/workspace/agent/brand/voice-profile.md`
- Sprint files: `/workspace/agent/sprints/2026-WXX/`
- Trend scans: `/workspace/agent/trends/last-30-days/YYYY-MM-DD.md`
- Performance log: `/workspace/agent/performance/log.md`
```

with (note: the `@` lines must NOT be in backticks or a code fence in the actual file):

```markdown
## Always-loaded context

The following files are imported into every session — brand voice, audience, positioning, and content pillars:

@./brand/voice-profile.md
@./brand/audience.md
@./brand/positioning.md
@./playbooks/pillars.md

## On-demand files (read when the task needs them)

- Sprint files: `/workspace/agent/sprints/2026-WXX/`
- Trend scans: `/workspace/agent/trends/last-30-days/YYYY-MM-DD.md`
- Performance log: `/workspace/agent/performance/log.md`
- Creative kit (visuals/infographics): `/workspace/agent/brand/creative-kit.md`
- Playbooks in `/workspace/agent/playbooks/`: `weekly-cycle.md` (operating rhythm), `article-drafting.md`, `typefully-publish.md`, `cta-matching.md`, `infographic-briefs.md`, `repurpose-quotes.md`, `last-30-days.md`, `performance-review.md`, `notion-mirror.md`. Pillar deep-dives in `playbooks/pillars/`.
```

### Edit 1.2 — replace the now-redundant voice quick ref

Replace this exact block:

```markdown
## Content voice quick ref

No em-dashes. No semicolons. No exclamation points. No bold/italic in posts. Short sentences. Heavy I/you. Consequence framing. X line breaks: parallel clauses on own lines, blank line before punchline. Full rules in `/workspace/agent/brand/voice-profile.md`.
```

with:

```markdown
## Content voice

Full voice rules load from the imported `brand/voice-profile.md` above. Non-negotiables: no em-dashes, no semicolons, no exclamation points, no markdown formatting in post bodies.
```

(The duplication is removed deliberately — two copies of the voice rules drift.)

### Acceptance — Quill

1. Static: `grep -c '^@\./' groups/x-content-creator/CLAUDE.local.md` returns `4`, and `grep '@\./' groups/x-content-creator/CLAUDE.local.md` shows none of them wrapped in backticks or inside a code fence.
2. Live import probe (host-side; the group dir's relative imports resolve on host because the target files sit in the same directory):

```bash
cd /Users/ohad/Projects/nanoclaw/groups/x-content-creator
claude -p --model claude-haiku-4-5 "Without using any tools, answer from your already-loaded context only. (1) What does the voice profile say about semicolons? (2) Name the three content pillars. If this isn't in your context, reply exactly NOT LOADED."
```

Pass: answer states semicolons are banned and names the pillars (brand vision / authority / positioning). Fail: `NOT LOADED` or invented content.

3. Optional end-to-end: after `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`, message Quill in a **new thread** with the same no-tools question.

---

## Part 2 — Marty (`groups/dm-with-ohad/CLAUDE.local.md`) — currently empty (0 bytes)

Marty has no `personality` column (the `agent_groups` table has none) and `~/Projects/Marty/soul.md` is **not mounted** into his container — today Marty runs on nothing but the runtime system prompt and per-task prompts. The content below was drafted from soul.md, the routine files in his group dir, his live scheduled tasks (queried from his session DBs), and Quill's/Viber's memory files. Identity is deliberately compact per Ohad's constraint: context over character.

### Edit 2.1 — write this exact content to `groups/dm-with-ohad/CLAUDE.local.md`

(The single `@./email-routing-rules.md` line must be plain text, not backticked. Everything else is literal file content.)

```markdown
# Marty — Per-group memory

## Who I am

Marty, Ohad's chief of staff and the hub of his agent fleet. I run the war room so Ohad stays in the field: routines, follow-ups, email triage, and relaying between agents. Direct, no filler, no corporate speak. If I see a better path than what Ohad asked for, I make the case instead of hedging. Never use: seamlessly, tailored, comprehensive, leverage, transform, revolutionize, robust, delve, game-changer.

## How I report (ADHD-aware)

- Lead with the decision or the anomaly, not the data. Bold the thing that needs his brain.
- Never more than 3 items needing his attention per message. Park the rest.
- Sequence everything: what's first, what's next, what can wait.
- If nothing needs attention, say so in one line. No filler to sound busy.
- Don't paste long markdown reports into chat — file path + 3-bullet summary (Telegram chokes on report markdown).

## The fleet (I'm the hub — spokes can't message each other, only me)

Roster truth is `list_agents`, not this list. Current lineup:

- **Quill** — X/Twitter content pipeline (weekly sprints, drafts, topic scans). Reaches Ohad through me.
- **Viber** — GTM operator for the Cowork Starter Kit launch (Slack #gtm).
- **Scout** — competitor/market research (currently Koongo competitor snapshots).
- **Watchtower** — system monitoring.
- **Wiki** — maintains the institutional wiki from #marketing call transcripts.

When carrying content between spokes (board room, cross-checks), pass the actual output, not a summary.

## Key locations

- Institutional wiki (clients, prospects, positioning history): `/workspace/extra/projects/wiki/` — RW. Read `index.md` first, load only the pages the task needs. Never read the whole wiki upfront.
- Ohad's Claude Code memory: `/workspace/extra/claude/memory/` — READ-ONLY mount. Never attempt writes. The Dream routine reports on it; Ohad applies changes by hand.
- Content reference library: `/workspace/extra/projects/Content/` — read-only.
- My report outputs: `dream-reports/` (nightly), `board-room/` (weekly), `research/` (leads runs), all under `/workspace/agent/`.
- The `falcon-*` files and `falcon-work*/` dirs in my workspace are the Falcon influencer-discovery engagement. Discovery-only: no automated outreach, ever.

## Routines

Each scheduled task prompt names its procedure file — read the procedure when the task fires, don't memorize it.

| When (IL) | What | Procedure |
|---|---|---|
| Daily 03:00 | Dream — memory consolidation report | `/workspace/agent/dream-routine.md` |
| Daily 07:00 | Transcript ingestion + LinkedIn ideas | prompt self-contained |
| Daily 08:30 | Morning team digest → Ohad | prompt self-contained (`list_agents` snapshot) |
| Daily 18:00 | Reddit roundup from #reddit | prompt self-contained |
| Daily 20:00 | Haifa weather brief (Hebrew) | prompt self-contained |
| Mon 06:00 | Leads research → `research/` | `/workspace/agent/leads-routine.md` |
| Mon 08:00 | Pipeline staleness review | prompt self-contained (reads `drafts/follow-ups/` + wiki index) |
| Thu 16:00 | Board room — sibling quality cross-check | `/workspace/agent/board-room-routine.md` |
| Sun 20:00 | Wiki lint | prompt self-contained |
| Every 15m | Email triage (marty@ + ohad@) | rules imported below |

## Email routing rules (always loaded)

@./email-routing-rules.md

## Judgment defaults

- Capture and flag, never auto-apply. Dream and board room are report-only — a wrong "fix" to good work costs more than a missed flag.
- Routine input missing (mount gone, file absent)? Abort and DM Ohad the error. Don't improvise a degraded run.
- Genuinely urgent items (published factual error, payment request, broken system) get a one-line DM immediately. Everything else rides the morning brief or BOARD.
- Hedge status claims about other people's data ("possibly stale", "looks superseded") — Ohad decides what's dead.
- Never archive email on the ohad@ account.
```

### Acceptance — Marty

1. Static: file is non-empty; `grep -c '^@\./email-routing-rules.md' groups/dm-with-ohad/CLAUDE.local.md` returns `1`.
2. Live import probe (relative import resolves on host):

```bash
cd /Users/ohad/Projects/nanoclaw/groups/dm-with-ohad
claude -p --model claude-haiku-4-5 "Without using any tools, answer from your already-loaded context only: what do the email routing rules say about archiving on the ohad@ account, and which email category gets handled autonomously with a one-liner after? If not in context, reply exactly NOT LOADED."
```

Pass: "do not archive on ohad@" + calendar invites/scheduling confirmations booked autonomously.

3. Optional end-to-end: DM Marty (new session/thread) the same no-tools question.

**Observation to surface to Ohad (not a build step):** Marty's session DBs hold what look like 3–4 separate live `*/15min` email-triage tasks across different sessions (`task-1781177441843`, `-441847`, `-441895`, `-442062`). Possible duplicates worth a manual `list_tasks` audit.

---

## Part 3 — Viber (`groups/slack_gtm/CLAUDE.local.md`)

Viber's file is instruction-rich and most of its path references are deliberate lazy-loads ("read X before doing Y") — those stay. Two things are load-bearing enough to always-load: the core voice file (his own file says "always") and his GTM wiki index (1.2KB, the catalog of his whole working memory). His mounts (from `groups/slack_gtm/container.json`): product → `/workspace/extra/projects/product` , GTM workspace → `/workspace/extra/projects/gtm`, `~/.claude/context` → `/workspace/extra/projects/voice` (RO).

These imports use absolute container paths — they resolve in-container, dangle harmlessly on host.

### Edit 3.1 — voice section

In `groups/slack_gtm/CLAUDE.local.md`, replace this exact block:

```markdown
Ohad's voice & reference library is mounted **read-only** at `/workspace/extra/projects/voice/`.
**Before writing anything Ohad will publish, load the relevant voice file** so it sounds like him, not
generic AI:
- `voice-reference.md` — core voice + banned words/phrases (always)
```

with (the `@` line plain, un-backticked):

```markdown
Ohad's voice & reference library is mounted **read-only** at `/workspace/extra/projects/voice/`.
The core voice + banned words/phrases file is always loaded:

@/workspace/extra/projects/voice/voice-reference.md

**Before writing anything Ohad will publish, additionally load the relevant per-channel voice file** so
it sounds like him, not generic AI:
```

(The remaining bullets — `linkedin-voice.md`, `email-voice.md`, etc. — stay exactly as they are: per-channel, on-demand.)

### Edit 3.2 — wiki index

Replace this exact sentence (in "Your GTM brain — the wiki"):

```markdown
You maintain a persistent GTM wiki at **`/workspace/extra/projects/gtm/wiki/`**. **Knowledge
compounds** — every source enriches existing pages, not just new ones.
```

with:

```markdown
You maintain a persistent GTM wiki at **`/workspace/extra/projects/gtm/wiki/`**. Its catalog is always
loaded:

@/workspace/extra/projects/gtm/wiki/index.md

**Knowledge compounds** — every source enriches existing pages, not just new ones.
```

Note: `groups/slack_gtm/wiki/` (in the group dir itself) is a stale legacy copy — the live wiki is the mounted `/Users/ohad/Projects/Agents/Viber-GTM/wiki/`. Do not import the group-dir copy.

### Acceptance — Viber

Absolute container paths can't resolve on the host, so use a path-mapped sandbox:

```bash
rm -rf /tmp/viber-import-test && mkdir -p /tmp/viber-import-test
sed -e 's|@/workspace/extra/projects/voice|@/Users/ohad/.claude/context|' \
    -e 's|@/workspace/extra/projects/gtm|@/Users/ohad/Projects/Agents/Viber-GTM|' \
    /Users/ohad/Projects/nanoclaw/groups/slack_gtm/CLAUDE.local.md > /tmp/viber-import-test/CLAUDE.local.md
printf '@./CLAUDE.local.md\n' > /tmp/viber-import-test/CLAUDE.md
cd /tmp/viber-import-test
claude -p --model claude-haiku-4-5 "Without using any tools, answer from your already-loaded context only: (1) name three banned words from the voice reference, (2) name two pages listed in the GTM wiki index. If not in context, reply exactly NOT LOADED."
rm -rf /tmp/viber-import-test
```

Pass: real banned words (e.g. from the seamlessly/leverage/robust family) + real wiki index entries. This validates the import lines are syntactically live (plain text, correct position); the container-path mapping is mechanical. Optional end-to-end: ask Viber in a new #gtm thread.

---

## Part 4 — Restart and live verification

After Parts 1–3 land:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

This forces fresh containers so every group's next session composes and loads the new files. Not strictly required (next natural spawn picks it up), but it makes "did it work" testable today.

---

## Part 5 — The other groups (enumeration, no conversions needed)

| Group | Folder | CLAUDE.local.md | Path→import conversions |
|---|---|---|---|
| Scout | `scout` | empty (0 bytes) | None possible — file is empty. Gap: `koongo-competitor-snapshots.md` (2.5KB) sits unreferenced in its group dir. Future follow-up (not this build): a minimal identity stub importing it. |
| Watchtower | `watchtower` | empty (0 bytes) | None — runs entirely on scheduled-task prompts. |
| Wiki | `slack_marketing` | empty (0 bytes) | None. Future follow-up: identity stub pointing at the mounted wiki + ingest conventions. |

Only Quill and Viber had the path-instead-of-import bug; Marty's was a missing-file bug. The three empty files are a separate (smaller) gap — agents that work purely from task prompts today — explicitly not in this build.

---

## Build order

1. **Part 1** — Quill edits (1.1, 1.2) + acceptance probes. Ships first, testable in isolation.
2. **Part 2** — Marty's CLAUDE.local.md + acceptance probes.
3. **Part 3** — Viber edits (3.1, 3.2) + sandbox probe.
4. **Part 4** — service restart + optional live-channel spot checks (new threads).
5. Report results: per-group probe output, plus the duplicate-email-task observation from Part 2.
