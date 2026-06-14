/**
 * One-time hub-and-spoke wiring for the orchestration feature.
 *
 * The manager agent (Marty) talks to every other agent group; spoke agents
 * talk only back to the manager — never to each other. The topology is
 * enforced structurally by which `agent_destinations` rows exist:
 *   - manager → spoke   (local_name = normalized spoke name)
 *   - spoke   → manager  (local_name = "marty")
 * and crucially NO spoke ↔ spoke rows. agent-route.ts's permission check
 * (a destination row must exist to send) then blocks lateral sends for free.
 *
 * Agents created via create_agent are already wired this way. This backfill
 * covers agents that pre-date orchestration (wired to their own channels
 * independently), which have no manager link yet.
 *
 * Idempotent: re-running only adds missing rows. Driven by an operational
 * skill, not auto-run on boot.
 */
import { getAgentGroupByName, getAllAgentGroups } from '../../db/agent-groups.js';
import { getSessionsByAgentGroup } from '../../db/sessions.js';
import { log } from '../../log.js';
import {
  createDestination,
  getDestinationByName,
  getDestinationByTarget,
  normalizeName,
} from '../agent-to-agent/db/agent-destinations.js';
import { writeDestinations } from '../agent-to-agent/write-destinations.js';
import { MANAGER_AGENT_NAME } from './manager.js';

export interface BackfillResult {
  /** Human-readable lines describing each link created. */
  wired: string[];
  /** Links that already existed and were left untouched. */
  skipped: string[];
  /** Non-fatal problems the operator should see (e.g. name collisions). */
  warnings: string[];
}

/** The local name every spoke uses to address the manager. */
const MANAGER_LOCAL_NAME = normalizeName(MANAGER_AGENT_NAME);

export function backfillHubAndSpoke(): BackfillResult {
  const result: BackfillResult = { wired: [], skipped: [], warnings: [] };

  const manager = getAgentGroupByName(MANAGER_AGENT_NAME);
  if (!manager) {
    throw new Error(
      `Manager agent "${MANAGER_AGENT_NAME}" not found. Create it (or set NANOCLAW_MANAGER_AGENT_NAME) before wiring.`,
    );
  }

  const now = new Date().toISOString();
  const affected = new Set<string>([manager.id]);

  for (const spoke of getAllAgentGroups()) {
    if (spoke.id === manager.id) continue;

    // manager → spoke
    if (getDestinationByTarget(manager.id, 'agent', spoke.id)) {
      result.skipped.push(`${manager.name} → ${spoke.name} (exists)`);
    } else {
      const localName = uniqueLocalName(manager.id, normalizeName(spoke.name), result, manager.name);
      createDestination({
        agent_group_id: manager.id,
        local_name: localName,
        target_type: 'agent',
        target_id: spoke.id,
        created_at: now,
      });
      affected.add(manager.id);
      result.wired.push(`${manager.name} → ${spoke.name} (as "${localName}")`);
    }

    // spoke → manager
    if (getDestinationByTarget(spoke.id, 'agent', manager.id)) {
      result.skipped.push(`${spoke.name} → ${manager.name} (exists)`);
    } else {
      const existing = getDestinationByName(spoke.id, MANAGER_LOCAL_NAME);
      if (existing) {
        // A destination named "marty" already exists but points elsewhere —
        // do NOT silently suffix (that breaks "message marty" instructions).
        result.warnings.push(
          `${spoke.name}: destination "${MANAGER_LOCAL_NAME}" already points to ${existing.target_id} ` +
            `(not the manager). Skipped — resolve manually.`,
        );
      } else {
        createDestination({
          agent_group_id: spoke.id,
          local_name: MANAGER_LOCAL_NAME,
          target_type: 'agent',
          target_id: manager.id,
          created_at: now,
        });
        affected.add(spoke.id);
        result.wired.push(`${spoke.name} → ${manager.name} (as "${MANAGER_LOCAL_NAME}")`);
      }
    }
  }

  // Projection invariant (agent-destinations.ts:11-34): refresh inbound.db
  // projections for every affected agent's active sessions, on BOTH sides,
  // or a running container keeps serving the stale map → "unknown destination".
  for (const agentGroupId of affected) {
    for (const session of getSessionsByAgentGroup(agentGroupId)) {
      writeDestinations(agentGroupId, session.id);
    }
  }

  log.info('Hub-and-spoke backfill complete', {
    manager: manager.name,
    wired: result.wired.length,
    skipped: result.skipped.length,
    warnings: result.warnings.length,
  });
  return result;
}

/**
 * Pick a free local name in `agentGroupId`'s destination namespace, starting
 * from `base`. Manager→spoke names can be safely suffixed (the manager learns
 * the names dynamically), so a collision here just bumps to base-2, base-3, …
 */
function uniqueLocalName(agentGroupId: string, base: string, result: BackfillResult, ownerName: string): string {
  if (!getDestinationByName(agentGroupId, base)) return base;
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (getDestinationByName(agentGroupId, candidate)) {
    suffix++;
    candidate = `${base}-${suffix}`;
  }
  result.warnings.push(`${ownerName}: name "${base}" was taken — used "${candidate}" instead.`);
  return candidate;
}
