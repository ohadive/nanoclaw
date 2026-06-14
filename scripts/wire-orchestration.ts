/**
 * wire-orchestration — one-time setup for the hub-and-spoke orchestration
 * feature (Marty as manager).
 *
 * What it does:
 *   1. Backfills agent_destinations so the manager (Marty) can message every
 *      other agent and each spoke can message Marty back — NO spoke↔spoke
 *      links. Idempotent: re-running only adds what's missing.
 *   2. Reports the manager's channel wirings and their session_mode, and (with
 *      --set-owner-dm=<messaging_group_id>) designates that messaging group as
 *      the manager's CONSOLE: spoke-agent replies are delivered into that
 *      session and the owner talks to the manager there. The wiring is kept in
 *      'shared' mode (one clean DM session) — NOT 'agent-shared', which is
 *      ambiguous for a manager that also works in busy channels.
 *
 * Usage:
 *   pnpm exec tsx scripts/wire-orchestration.ts                       # backfill + report
 *   pnpm exec tsx scripts/wire-orchestration.ts --set-owner-dm=<mgId> # set console
 *
 * Safe to run while the host service is up — the backfill refreshes the
 * inbound.db destination projections for any running sessions on both sides,
 * and the console setting takes effect on the next inter-agent message (the
 * router reads it live).
 */
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { getAgentGroup, getAgentGroupByName, setAgentGroupConsole } from '../src/db/agent-groups.js';
import { initDb } from '../src/db/connection.js';
import {
  getMessagingGroup,
  getMessagingGroupAgentByPair,
  getMessagingGroupsByAgentGroup,
  updateMessagingGroupAgent,
} from '../src/db/messaging-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { backfillHubAndSpoke } from '../src/modules/agent-control/backfill-hub.js';
import { MANAGER_AGENT_NAME } from '../src/modules/agent-control/manager.js';

function parseSetOwnerDm(argv: string[]): string | null {
  for (const a of argv) {
    const m = a.match(/^--set-owner-dm=(.+)$/);
    if (m) return m[1];
  }
  return null;
}

function main(): void {
  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db);

  const manager = getAgentGroupByName(MANAGER_AGENT_NAME);
  if (!manager) {
    console.error(
      `✗ Manager agent "${MANAGER_AGENT_NAME}" not found. Create it (or set NANOCLAW_MANAGER_AGENT_NAME) first.`,
    );
    process.exit(1);
  }

  // 1. Backfill destinations
  console.log(`\n● Backfilling hub-and-spoke destinations (manager: ${manager.name})\n`);
  const result = backfillHubAndSpoke();
  if (result.wired.length) {
    console.log('  Wired:');
    for (const w of result.wired) console.log(`    + ${w}`);
  } else {
    console.log('  Wired: (nothing new — already linked)');
  }
  if (result.skipped.length) console.log(`  Skipped ${result.skipped.length} existing link(s).`);
  if (result.warnings.length) {
    console.log('\n  ⚠ Warnings:');
    for (const w of result.warnings) console.log(`    ! ${w}`);
  }

  // 2. Report manager wirings + session_mode
  console.log(`\n● ${manager.name}'s channel wirings (for owner-DM session unification):\n`);
  const wirings = getMessagingGroupsByAgentGroup(manager.id);
  if (wirings.length === 0) {
    console.log('  (none — the manager is not wired to any messaging group yet)');
  }
  const currentConsole = getAgentGroup(manager.id)?.console_messaging_group_id ?? null;
  for (const mg of wirings) {
    const pair = getMessagingGroupAgentByPair(mg.id, manager.id);
    const mode = pair?.session_mode ?? '(unknown)';
    const kind = mg.is_group ? 'group' : 'DM';
    const isConsole = mg.id === currentConsole ? '  ← CONSOLE' : '';
    console.log(`  - ${mg.name ?? mg.platform_id}  [${mg.channel_type} ${kind}]  session_mode=${mode}${isConsole}`);
    console.log(`      messaging_group_id: ${mg.id}`);
  }

  // 3. Optionally designate the console messaging group
  const target = parseSetOwnerDm(process.argv.slice(2));
  if (target) {
    const mg = getMessagingGroup(target);
    const pair = mg ? getMessagingGroupAgentByPair(mg.id, manager.id) : undefined;
    if (!mg || !pair) {
      console.error(`\n✗ No wiring found for manager in messaging group "${target}".`);
      process.exit(1);
    }
    // Keep the console as a single clean session (NOT agent-shared, which is
    // ambiguous for a multi-channel manager). Set the console pointer so spoke
    // replies route here.
    if (pair.session_mode === 'agent-shared') {
      updateMessagingGroupAgent(pair.id, { session_mode: 'shared' });
    }
    setAgentGroupConsole(manager.id, mg.id);
    console.log(
      `\n✓ Set ${manager.name}'s console to "${mg.name ?? mg.platform_id}" (session_mode=shared).` +
        `\n  Spoke replies now land in this session, and ${manager.name}'s replies default back here.` +
        `\n  Takes effect on the next inter-agent message — no restart needed.`,
    );
  } else if (wirings.length && !currentConsole) {
    console.log(
      `\nTo make ${manager.name} relay spoke replies back to you, set a console DM:` +
        `\n  pnpm exec tsx scripts/wire-orchestration.ts --set-owner-dm=<messaging_group_id>` +
        `\n(pick the owner's DM group above — not a shared team channel).`,
    );
  }

  console.log('\n● Done.\n');
}

main();
