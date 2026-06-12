# Routine Session Rotation — Build Spec

**For the executing session:** Scheduled routines (kind=`task` rows) currently inherit the session's eternal SDK continuation, so every recurrence appends to one ever-growing transcript. The fix makes task wakes run in **ephemeral, stateless SDK sessions** while chat keeps its persistent continuation. All changes are container-side (`container/agent-runner/`); no host code, no DB migration, no schema change. The design decisions are already made — implement as written.

**Out of scope — do not touch:**
- Per-thread chat session model (works correctly; not the problem).
- The CLAUDE.local.md context fix (shipped 2026-06-11, see docs/context-fix-plan.md).
- A per-task `continuity: true` opt-in knob — listed under Future work, do not build now.
- Automatic transcript GC in the host sweep — Future work.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` tuning.

---

## Part 0 — Verified mechanics (investigated 2026-06-11, no build step)

How a routine run inherits the eternal session today:

1. **Tasks are `messages_in` rows** (`kind='task'`) in one specific session's `inbound.db` — the session the agent was in when `schedule_task` was called ([src/modules/scheduling/actions.ts:20-40](../src/modules/scheduling/actions.ts)). Recurrence inserts the next occurrence into the **same db** with a fresh id sharing `series_id` ([src/modules/scheduling/recurrence.ts](../src/modules/scheduling/recurrence.ts)).
2. **One continuation per session, resumed forever.** The SDK session uuid is stored per-provider in `outbound.db session_state` ([container/agent-runner/src/db/session-state.ts](../container/agent-runner/src/db/session-state.ts)); the poll loop loads it at startup and passes it as `resume` on every query ([poll-loop.ts:54](../container/agent-runner/src/poll-loop.ts), [providers/claude.ts:289](../container/agent-runner/src/providers/claude.ts)). Only `/clear` (chat command) or a stale-session error resets it.
3. **Warm streams swallow tasks.** Queries stay open between turns by design (poll-loop.ts:262-268). The follow-up poller pushes ANY pending non-system row — including `*/15` task rows — into the active query (poll-loop.ts:300-332). So routine runs land **inside the chat continuation**, and cold-start task batches resume it.
4. **Compaction bounds context, not the file.** Auto-compact at 165K tokens keeps the model from dying; the `.jsonl` transcript grows without bound and is re-parsed on every resume.

**Measured damage (2026-06-11):**
- `sess-1777036413364` (Marty's primary DM, hosts dream/wiki-lint/reddit/transcripts tasks + chat): live continuation `b9a6d393-…` = **76MB** transcript, accumulating since ~Apr 24.
- `sess-1780669683361` (Slack thread session hosting the `*/15` email task): continuation `973368bf-…` = **9.1MB** and growing every 15 minutes.
- `sess-1777038701227` (Slack DM console — daily digest, pipeline review, leads): 4.3MB.

**Message taxonomy needed below:** chat rows are `kind='chat'`/`'chat-sdk'`; agent-to-agent replies are `kind='chat'` with `channel_type='agent'` ([src/modules/agent-to-agent/agent-route.ts:150](../src/modules/agent-to-agent/agent-route.ts)); routine wakes are `kind='task'`; `kind='system'` rows are MCP plumbing, always excluded. Rows carry a `trigger` flag (0 = accumulate-only context).

**Why stateless-per-run is safe for these routines:** every live routine is already written stateless — each reads its procedure file (`dream-routine.md`, etc.) and its state files (`email-processed-ids.txt`, `email-seen-ids.json`, `email-daily-header.txt`) on every run. Cross-run memory lives on disk, not in the transcript. The one stateful pattern — a routine that `send_message`s sibling agents and waits for replies (daily digest, board room) — is handled by keeping the ephemeral task query open for those replies (rule table below).

---

## Part 1 — The design

Two query modes in the poll loop:

| | **chat mode** (today's behavior) | **task mode** (new) |
|---|---|---|
| Triggered by | batch contains chat/chat-sdk/agent rows | batch is task rows only |
| `continuation` passed | persisted one | `undefined` (fresh SDK session) |
| Persist continuation on init/result | yes | **no** (never written; ephemeral by construction) |
| Poller: pushes into active query | all non-system, non-task rows | only agent replies (`channel_type='agent'`) |
| Poller: ends the stream when | a task row is pending, or a runner command | a real chat row is pending, a **new task** row is pending, or a runner command |
| Query closes naturally via | existing host idle ceiling / kills | same + ended by next task occurrence |

Consequences, intentional:
- Chat in a session never sees routine noise again; routine runs never drag weeks of prior runs.
- Mixed pending work: chat is selected first; task rows wait (claimed-not) until no chat is pending. Chat turns are short; tasks fire within a poll tick after.
- A routine that messages siblings keeps its ephemeral query open; replies are pushed in and the routine completes its synthesis in-context. The query dies at the next task occurrence or chat arrival or host ceiling.
- A sibling reply that arrives *after* the ephemeral query closed is processed in chat mode (it's `kind='chat'`) — the agent sees the reply text without the asking context. Degraded but functional; same class of degradation as today's container-crash case. Accepted tradeoff.
- Tokens: fresh task runs pay full system-prompt input each run but stop paying for resumed mega-history. For the current transcript sizes this is a net win.

---

## Part 2 — Implementation

### Step 1 — Pure batch-selection helpers + tests

New file `container/agent-runner/src/query-mode.ts`:

```ts
import type { MessageInRow } from './db/messages-in.js';

export type QueryMode = 'chat' | 'task';

export interface BatchSelection {
  mode: QueryMode;
  rows: MessageInRow[];
}

/**
 * Pick which pending rows form the next query batch and in which mode.
 * Chat-ish rows (anything except kind='task') win when wake-eligible;
 * task rows run only when no chat work is actionable. Returns null when
 * nothing should wake the agent (accumulate-only chat and no tasks).
 *
 * Input must already exclude kind='system'.
 */
export function selectBatch(pending: MessageInRow[]): BatchSelection | null {
  const chatRows = pending.filter((m) => m.kind !== 'task');
  const taskRows = pending.filter((m) => m.kind === 'task');

  if (chatRows.some((m) => m.trigger === 1)) {
    return { mode: 'chat', rows: chatRows };
  }
  if (taskRows.length > 0) {
    // Accumulate-only chat rows ride along so the agent sees the context,
    // matching today's "trigger=0 rides with the next wake" contract.
    return { mode: 'task', rows: [...taskRows] };
  }
  return null;
}

export interface PollerAction {
  push: MessageInRow[];
  end: boolean;
}

/**
 * Decide what the follow-up poller does with newly-pending rows while a
 * query is active. Ending the stream leaves rows pending for the outer
 * loop, which re-selects with selectBatch(). Input excludes kind='system'.
 */
export function pollerAction(mode: QueryMode, pending: MessageInRow[]): PollerAction {
  if (mode === 'chat') {
    const tasks = pending.some((m) => m.kind === 'task');
    return { push: tasks ? [] : pending, end: tasks };
  }
  // task mode: agent replies join the run; real chat or the next task
  // occurrence ends the ephemeral query.
  const agentReplies = pending.filter((m) => m.channel_type === 'agent');
  const enders = pending.some((m) => m.kind === 'task' || (m.kind !== 'task' && m.channel_type !== 'agent'));
  return { push: enders ? [] : agentReplies, end: enders };
}
```

New file `container/agent-runner/src/query-mode.test.ts` (`bun:test`, NOT vitest). Cases to cover:
1. Mixed chat+task pending → mode `chat`, rows exclude tasks.
2. Task-only pending → mode `task`.
3. Chat rows all `trigger=0`, no tasks → `null` (accumulate gate preserved).
4. Chat rows all `trigger=0` + due task → mode `task` (the gate must not starve tasks — this is a behavior fix over today's combined-batch gate).
5. `pollerAction('chat', [task])` → `{push: [], end: true}`.
6. `pollerAction('chat', [chat])` → pushes it, no end.
7. `pollerAction('task', [agent reply])` → pushes it, no end.
8. `pollerAction('task', [chat from human])` → end, push nothing.
9. `pollerAction('task', [new task])` → end, push nothing.
10. `pollerAction('task', [agent reply, new task])` → end, push nothing (no partial push on end).

**Acceptance:** `cd container/agent-runner && bun test query-mode` green; `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit` from repo root clean.

### Step 2 — Wire modes into the poll loop

All edits in `container/agent-runner/src/poll-loop.ts`.

2a. **Outer loop batch selection.** Replace the current selection block (the `getPendingMessages().filter(...)` + the `if (!messages.some((m) => m.trigger === 1))` accumulate gate) with `selectBatch`:

```ts
const pending = getPendingMessages().filter((m) => m.kind !== 'system');
pollCount++;
// (keep the heartbeat log line, using pending.length)
const selection = selectBatch(pending);
if (!selection) {
  await sleep(POLL_INTERVAL_MS);
  continue;
}
const { mode, rows: messages } = selection;
```

Everything downstream (`markProcessing`, command handling, pre-task scripts, attachments, formatting) operates on `messages` exactly as before. The `/clear` command path only matters in chat mode and needs no guard — task rows never match `isClearCommand`.

2b. **Query invocation.** Pass continuation only in chat mode, and tell `processQuery` the mode:

```ts
const query = config.provider.query({
  prompt,
  continuation: mode === 'chat' ? continuation : undefined,
  cwd: config.cwd,
  systemContext: config.systemContext,
});
...
const result = await processQuery(query, routing, processingIds, config.providerName, mode);
if (mode === 'chat' && result.continuation && result.continuation !== continuation) {
  continuation = result.continuation;
  setContinuation(config.providerName, continuation);
}
```

2c. **`processQuery` signature + persistence guard.** Add `mode: QueryMode` parameter. In the `init` event handler, persist only for chat:

```ts
if (event.type === 'init') {
  queryContinuation = event.continuation;
  if (mode === 'chat') {
    setContinuation(providerName, event.continuation);
  } else {
    log(`Ephemeral task session ${event.continuation} (not persisted)`);
  }
}
```

2d. **Follow-up poller.** Inside the interval callback, after the existing `isRunnerCommand` end-check, replace the current "push everything non-system" logic with `pollerAction`:

```ts
const nonSystem = pending.filter((m) => m.kind !== 'system');
const action = pollerAction(mode, nonSystem);
if (action.end) {
  log(`Pending ${mode === 'chat' ? 'task' : 'chat/next-task'} rows — ending ${mode} stream for outer loop`);
  endedForCommand = true;
  query.end();
  return;
}
const newMessages = action.push;
if (newMessages.length === 0) return;
```

Keep the existing follow-up pre-task-script MODULE-HOOK block in place untouched (it becomes a no-op for chat-mode pushes since tasks are never pushed, and task-mode pushes are agent replies; the hook markers are install-skill anchors — do not remove them).

**Acceptance:**
- `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit` clean; `cd container/agent-runner && bun test` all green.
- Code-level invariant check: `grep -n "setContinuation" container/agent-runner/src/poll-loop.ts` — every call site is guarded by a chat-mode condition (the startup `migrateLegacyContinuation` read is fine).

### Step 3 — Restart (no image rebuild)

*(Corrected 2026-06-11: the original spec said `./container/build.sh` — that was wrong and cost an hour against a wedged Docker daemon. Agent containers run `bun` directly on the agent-runner source bind-mounted from the repo; the image has no `/app/dist`. Code-only changes to `container/agent-runner/src/` roll out with a service restart. An image rebuild is only needed for Dockerfile or dependency changes, and this build has neither.)*

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Acceptance:** service up (`tail logs/nanoclaw.log` shows routing), no crash-loop in `logs/nanoclaw.error.log`.

### Step 4 — Live verification with a throwaway task

DM Marty (Telegram/WhatsApp DM — the `sess-1777036413364` session): ask him to schedule a one-shot task 2 minutes out, prompt: `"Reply to Ohad with the single word PING-ROTATION-TEST."` Then verify, with `AG=ag-1777036413328-jgnx14; S=data/v2-sessions/$AG`:

1. **Before it fires:** `sqlite3 $S/sess-1777036413364-hknc8x/outbound.db "select value from session_state where key like 'continuation:%';"` — note the uuid.
2. **After it fires** (message arrives in the DM): re-run the same query — **the uuid must be unchanged** (the task ran ephemeral, nothing persisted).
3. `ls -lt $S/.claude-shared/projects/-workspace-agent/*.jsonl | head -3` — a **new small jsonl** exists with a uuid that is NOT the stored continuation (the ephemeral run), with an mtime matching the task firing.
4. Send a normal DM ("what did you just do?") — Marty responds with chat continuity intact (still resumes the stored uuid; the reply may not know about the ephemeral run's internals — that's by design; he can read his own sent messages/files).

**Acceptance:** all four checks pass. If check 2 shows a changed uuid, a `setContinuation` guard is missing — stop and fix before proceeding.

### Step 5 — Reset the bloated continuations  ⚠️ GATED: confirm with Ohad before running

This discards the in-context (compacted) chat memory of the listed sessions. Durable context now lives in CLAUDE.local.md + workspace files + `conversations/` archives (that's what the 2026-06-11 context fix was for), so the loss is mostly routine noise — but it is not reversible. **Ask Ohad before executing this step.**

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist   # containers must be down: container owns outbound.db

AG=/Users/ohad/Projects/nanoclaw/data/v2-sessions/ag-1777036413328-jgnx14
for s in sess-1777036413364-hknc8x sess-1780669683361-x8nbdw sess-1777038701227-z9h2fl sess-1778071730888-zu3tfc; do
  sqlite3 "$AG/$s/outbound.db" "DELETE FROM session_state WHERE key LIKE 'continuation:%';"
done

# Archive the orphaned mega-transcripts (uuids from Part 0; verify against
# what step 5's deletes just orphaned before moving):
mkdir -p "$AG/.claude-shared/projects/-workspace-agent/_archived-2026-06"
cd "$AG/.claude-shared/projects/-workspace-agent"
mv b9a6d393-f913-4218-8598-6c0ea1eee7b7.jsonl 973368bf-2712-4add-ad69-bc06542c02e5.jsonl \
   1c841cb0-9993-4bf1-a91f-6f0e2528270d.jsonl 49acf88f-c802-4eb0-9fea-0bf46eb72492.jsonl \
   _archived-2026-06/ 2>/dev/null
# Subagent dirs named after those uuids can move too.

launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

**Acceptance:** next DM to Marty gets a coherent reply (fresh session, context from CLAUDE.local.md); next `*/15` email tick runs clean (check `logs/nanoclaw.log` for the wake + a reply/no-op); no `No conversation found` errors in `logs/nanoclaw.error.log` (and if one appears, the existing stale-session recovery clears it automatically — verify it did).

---

## Part 3 — Risks & accepted tradeoffs

- **Sibling replies after the ephemeral query closes** land in chat mode without the asking context (degraded, not broken — reply text is self-contained). Same failure class as today's container-crash mid-routine.
- **`ask_user_question` during a routine**: blocks in-process and survives as long as the container does — unchanged from today. If the container dies waiting, the retry re-runs the task fresh — also unchanged.
- **Latency**: a task arriving during a warm chat stream now ends the stream and respawns the SDK subprocess (~seconds). Symmetrically for chat arriving during a task run. Imperceptible at routine cadences.
- **Token shape**: fresh runs re-pay the system prompt per occurrence and rarely hit prompt cache; they stop paying for resumed mega-transcripts. Net win at current transcript sizes.
- **PreCompact transcript archiving** rarely fires for short ephemeral runs — routine runs won't land in `conversations/`. They already write their outputs to files/reports by design.

## Future work (explicitly not this build)

- `continuity: true` per-task knob (schedule_task MCP param → content JSON → `selectBatch` override) for a routine that genuinely needs cross-run transcript memory. No current routine does.
- Host-sweep transcript GC: archive jsonl files not referenced by any `session_state` continuation and older than N days.
- Turn-capping/rotating long-lived **chat** continuations (the 76MB was mostly task-driven; if chat alone regrows it, revisit).

## Build order

1. Step 1 (helpers + tests) → 2 (poll-loop wiring) → 3 (rebuild + restart).
2. Step 4 live verification. Stop on any failed check.
3. Step 5 only with Ohad's explicit go-ahead.
4. Report: test output, the four step-4 check results, transcript dir listing after step 5.
