/**
 * Manager-agent identity — shared across the agent-control host handlers
 * (pause/resume, dispatch_task) and the roster-projection gate in
 * container-runner.
 *
 * One agent group is the orchestrator ("manager"). It is the only group
 * allowed to pause/resume other groups, dispatch approval-gated tasks, and
 * read the agent roster. We identify it by name today (default "Marty",
 * overridable via NANOCLAW_MANAGER_AGENT_NAME) rather than a DB column — a
 * single-edit upgrade path. If/when multiple managers or rename-resilience
 * matter, lift this to a `can_manage_agents` column on agent_groups (see the
 * header note in handlers.ts).
 *
 * NOTE: the container side has its own copy of this name in
 * container/agent-runner/src/mcp-tools/orchestration.ts (it reads
 * container.json `groupName`, not the central DB). Keep the two in sync.
 */
import { getAgentGroup } from '../../db/agent-groups.js';
import type { Session } from '../../types.js';

export const MANAGER_AGENT_NAME = process.env.NANOCLAW_MANAGER_AGENT_NAME ?? 'Marty';

/** Does this agent group name match the configured manager? Case-insensitive. */
export function isManagerName(name: string | null | undefined): boolean {
  return !!name && name.toLowerCase() === MANAGER_AGENT_NAME.toLowerCase();
}

/**
 * Authoritative caller gate for manager-only system actions. The container
 * may also self-gate (UX — don't show the tools to spokes), but this host
 * check is the real ACL.
 */
export async function isManagerSession(session: Session): Promise<boolean> {
  const caller = await getAgentGroup(session.agent_group_id);
  return isManagerName(caller?.name);
}
