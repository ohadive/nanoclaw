/**
 * Host handlers for pause_agent_group / resume_agent_group system actions
 * emitted by the matching container MCP tools.
 *
 * Authorization model (MVP):
 *   - Only the agent group whose `name` matches MANAGER_AGENT_NAME may call
 *     these actions. Other agents emitting the same system action are ignored
 *     with a warning. This is a coarse gate; per-user gating (owner/admin)
 *     would require threading the originating user_id through the system
 *     action, which the current `WriteMessageOut` shape does not carry.
 *   - Inside the manager agent, gating is by who can DM that agent — i.e. the
 *     manager's CLAUDE.local.md tells it to verify owner/admin before calling.
 *
 * If you want a different agent to manage pauses, change MANAGER_AGENT_NAME
 * (or convert it into a column on agent_groups, e.g. `can_manage_agents`).
 */
import { getAgentGroupByName, pauseAgentGroup, resumeAgentGroup } from '../../db/agent-groups.js';
import { log } from '../../log.js';
import type { Session } from '../../types.js';
import { MANAGER_AGENT_NAME, isManagerSession } from './manager.js';

const callerIsAuthorized = isManagerSession;

export async function handlePauseAgentGroup(content: Record<string, unknown>, session: Session): Promise<void> {
  if (!(await callerIsAuthorized(session))) {
    log.warn('pause_agent_group rejected — unauthorized caller', {
      callerAgentGroupId: session.agent_group_id,
      target: content.name,
    });
    return;
  }

  const name = typeof content.name === 'string' ? content.name.trim() : '';
  const reason = typeof content.reason === 'string' ? content.reason : null;
  if (!name) {
    log.warn('pause_agent_group rejected — missing name', { sessionId: session.id });
    return;
  }

  const target = await getAgentGroupByName(name);
  if (!target) {
    log.warn('pause_agent_group: agent group not found', { name });
    return;
  }

  await pauseAgentGroup(target.id, reason);
  log.info('Agent group paused', { name: target.name, id: target.id, reason, by: MANAGER_AGENT_NAME });
}

export async function handleResumeAgentGroup(content: Record<string, unknown>, session: Session): Promise<void> {
  if (!(await callerIsAuthorized(session))) {
    log.warn('resume_agent_group rejected — unauthorized caller', {
      callerAgentGroupId: session.agent_group_id,
      target: content.name,
    });
    return;
  }

  const name = typeof content.name === 'string' ? content.name.trim() : '';
  if (!name) {
    log.warn('resume_agent_group rejected — missing name', { sessionId: session.id });
    return;
  }

  const target = await getAgentGroupByName(name);
  if (!target) {
    log.warn('resume_agent_group: agent group not found', { name });
    return;
  }

  await resumeAgentGroup(target.id);
  log.info('Agent group resumed', { name: target.name, id: target.id, by: MANAGER_AGENT_NAME });
}
