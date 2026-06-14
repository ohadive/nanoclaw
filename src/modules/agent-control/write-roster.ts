/**
 * Project a snapshot of every agent group into the MANAGER's per-session
 * `inbound.db` so the `list_agents` container tool can read it locally. The
 * container has no access to the central v2.db — only its mounted session
 * DBs — so this mirrors the `writeDestinations` projection pattern.
 *
 * Manager-only: called from container-runner at wake time, gated on the agent
 * being the manager (see isManagerName). Spokes never pay for it.
 *
 * ⚠ DDL DUPLICATION: the `agent_roster` table is created lazily here (not in
 * INBOUND_SCHEMA — that would touch every agent's session for a manager-only
 * feature). The container reader in
 * container/agent-runner/src/db/connection.ts has a BYTE-IDENTICAL copy of
 * AGENT_ROSTER_DDL. Keep the two in sync.
 *
 * ⚠ Cross-mount visibility: open → write → close, journal_mode=DELETE (handled
 * by openInboundDb). A long-lived connection would freeze the container's view.
 */
import fs from 'fs';

import { getAllAgentGroups } from '../../db/agent-groups.js';
import { getSessionsByAgentGroup } from '../../db/sessions.js';
import { log } from '../../log.js';
import { inboundDbPath, openInboundDb } from '../../session-manager.js';

export const AGENT_ROSTER_DDL = `CREATE TABLE IF NOT EXISTS agent_roster (
  agent_group_id TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  paused_at      TEXT,
  paused_reason  TEXT,
  last_active    TEXT,
  running        INTEGER NOT NULL DEFAULT 0
)`;

export function writeAgentRoster(managerAgentGroupId: string, sessionId: string): void {
  const dbPath = inboundDbPath(managerAgentGroupId, sessionId);
  if (!fs.existsSync(dbPath)) return;

  const groups = getAllAgentGroups();
  const rows = groups.map((g) => {
    const sessions = getSessionsByAgentGroup(g.id);
    const lastActive = sessions.reduce<string | null>((max, s) => {
      if (!s.last_active) return max;
      return !max || s.last_active > max ? s.last_active : max;
    }, null);
    const running = sessions.some((s) => s.container_status === 'running' || s.container_status === 'idle') ? 1 : 0;
    return {
      agent_group_id: g.id,
      name: g.name,
      paused_at: g.paused_at ?? null,
      paused_reason: g.paused_reason ?? null,
      last_active: lastActive,
      running,
    };
  });

  const db = openInboundDb(managerAgentGroupId, sessionId);
  try {
    db.exec(AGENT_ROSTER_DDL);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM agent_roster').run();
      const stmt = db.prepare(
        `INSERT INTO agent_roster (agent_group_id, name, paused_at, paused_reason, last_active, running)
         VALUES (@agent_group_id, @name, @paused_at, @paused_reason, @last_active, @running)`,
      );
      for (const row of rows) stmt.run(row);
    });
    tx();
  } finally {
    db.close();
  }
  log.debug('Agent roster written', { sessionId, count: rows.length });
}
