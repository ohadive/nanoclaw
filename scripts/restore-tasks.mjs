// One-shot script: re-create the v1 recurring tasks that were dropped during
// the v1→v2 migration. Inserts directly into the active session's inbound.db
// using the same schema/path the host's `insertTask` uses.
//
// ⚠️ DO NOT RE-RUN. Already ran 2026-06-11. The prompts baked in below include
// SUPERSEDED task generations (the old no-state email/scheduling tasks) whose
// evolved successors are already live in other sessions. Re-running resurrects
// them and causes duplicate 15-min email/scheduling processing — this happened
// on 2026-06-11 and had to be manually cancelled (see series task-1777617888035
// / task-1777617888039). Before any future restore, diff each prompt against
// the live tasks across ALL of the group's session DBs first.
//
// Run from repo root:  node scripts/restore-tasks.mjs

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(
  __dirname,
  '..',
  'data',
  'v2-sessions',
  'ag-1777036413328-jgnx14',
  'sess-1777036413364-hknc8x',
  'inbound.db',
);

const SCHEDULING_PROMPT = `You are Marty, Ohad's scheduling assistant. You have access to two Gmail accounts:
- Ohad's inbox: ohad@ohadmichaeli.com (via mcp__gmail_ohad__ tools)
- Your inbox: marty@ohadmichaeli.com (via mcp__gmail__ tools)

**Step 1:** Check Ohad's sent mail for new scheduling requests:
- Search ohad@ohadmichaeli.com: \`in:sent is:unread Marty\` — look for emails where Ohad mentions "Marty" and asks you to schedule/book/set up a call or meeting
- Also check your inbox (marty@ohadmichaeli.com) for replies from third parties confirming a time slot in an existing scheduling thread

**Step 2:** If nothing relevant — stay completely silent. Do not send any message.

**Step 3:** If you find a NEW scheduling request from Ohad:
1. Read the email thread to understand who the other person is and any context
2. Check the "Ohad Michaeli" shared calendar (accessible via marty@ohadmichaeli.com) for his availability
3. Scheduling rules:
   - Available Sun–Thu, 10am–6pm Israel time (Asia/Jerusalem)
   - Mon & Tue: until 8pm Israel time
   - 30-min buffer between meetings
   - Default duration: 30 min unless Ohad specifies otherwise
4. Reply-all to the thread from marty@ohadmichaeli.com with 3 proposed time slots. Be friendly and professional. Sign off as "Marty".
5. Mark the email as read in Ohad's sent mail.

**Step 4:** If you find a CONFIRMATION (third party replied accepting a slot):
1. Book the event in the "Ohad Michaeli" calendar with Google Meet conferencing
2. Reply-all from marty@ohadmichaeli.com confirming the booking with meeting details
3. Mark the email as read`;

const EMAIL_TRIAGE_PROMPT = `Check your inbox at marty@ohadmichaeli.com (mcp__gmail__ tools) for new emails that need action. For each unread email:

1. If it's a reply to a scheduling thread — check Ohad's calendar (mcp__gcal__), create the event, send a confirmation email, and DM Ohad with what was done.
2. If it's a new email that needs Ohad's input or decision — summarize it and DM Ohad asking what to do.
3. If it's a newsletter, automated notification, or clearly no action needed — do nothing, don't send any message.

Only contact Ohad when there's something that requires action or a decision. Never send a message just to say there's nothing new.`;

const tasks = [
  {
    label: 'scheduling-assistant',
    recurrence: '*/20 * * * *',
    prompt: SCHEDULING_PROMPT,
  },
  {
    label: 'email-triage',
    recurrence: '0 * * * *',
    prompt: EMAIL_TRIAGE_PROMPT,
  },
];

const db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE');

const nextEvenSeq = () => {
  const row = db.prepare('SELECT MAX(seq) AS m FROM messages_in').get();
  const max = row?.m ?? 0;
  const next = max + 1;
  return next % 2 === 0 ? next : next + 1;
};

const insert = db.prepare(
  `INSERT INTO messages_in (id, seq, timestamp, status, tries, process_after, recurrence, kind, platform_id, channel_type, thread_id, content, series_id)
   VALUES (@id, @seq, datetime('now'), 'pending', 0, @processAfter, @recurrence, 'task', NULL, NULL, NULL, @content, @id)`,
);

const firstRun = new Date(Date.now() + 60_000).toISOString();

for (const t of tasks) {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const content = JSON.stringify({ prompt: t.prompt, script: null });
  insert.run({
    id,
    seq: nextEvenSeq(),
    processAfter: firstRun,
    recurrence: t.recurrence,
    content,
  });
  console.log(`✓ ${t.label.padEnd(22)} ${id}  recurrence="${t.recurrence}"`);
}

db.close();
console.log('\nFirst run scheduled at:', firstRun);
console.log('Host-sweep fires every 60s; tasks should kick within ~1 min.');
