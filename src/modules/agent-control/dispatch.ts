/**
 * `dispatch_task` — the approval-gated "action" path for the manager agent.
 *
 * Hybrid control model: the manager asking a spoke for status/reads is free
 * (plain send_message). But telling a spoke to take an ACTION with side
 * effects must be approved by an owner/admin first. The container tool emits a
 * `dispatch_task` system action; the host gates it through the standard
 * approvals flow (DM card → Approve/Reject); on approve the task is written
 * into the target spoke's agent-shared session and the spoke is woken.
 *
 * Reject is handled centrally by the approvals response-handler, which
 * notifies the requesting (manager) session — so Marty hears about both
 * approve and reject without extra wiring here.
 */
import { getAgentGroup, getAgentGroupByName } from '../../db/agent-groups.js';
import { getSession } from '../../db/sessions.js';
import { wakeContainer } from '../../container-runner.js';
import { log } from '../../log.js';
import { resolveSession, writeSessionMessage } from '../../session-manager.js';
import type { Session } from '../../types.js';
import { notifyAgent, requestApproval, type ApprovalHandlerContext } from '../approvals/primitive.js';
import { isManagerSession } from './manager.js';

const ACTION = 'dispatch_task';

/**
 * Delivery handler for the `dispatch_task` system action. Validates the caller
 * is the manager, resolves the target, and queues an owner/admin approval.
 */
export async function handleDispatchTask(content: Record<string, unknown>, session: Session): Promise<void> {
  if (!(await isManagerSession(session))) {
    log.warn('dispatch_task rejected — unauthorized caller', {
      callerAgentGroupId: session.agent_group_id,
      target: content.name,
    });
    return;
  }

  const name = typeof content.name === 'string' ? content.name.trim() : '';
  const task = typeof content.task === 'string' ? content.task.trim() : '';
  const reason = typeof content.reason === 'string' ? content.reason : null;
  if (!name || !task) {
    notifyAgent(session, 'dispatch_task failed: both "name" and "task" are required.');
    return;
  }

  const target = await getAgentGroupByName(name);
  if (!target) {
    notifyAgent(session, `dispatch_task failed: no agent named "${name}".`);
    return;
  }
  if (target.id === session.agent_group_id) {
    notifyAgent(session, 'dispatch_task failed: cannot dispatch a task to yourself.');
    return;
  }

  const manager = await getAgentGroup(session.agent_group_id);
  log.info('dispatch_task requested', { from: manager?.name, to: target.name, task, reason });

  await requestApproval({
    session,
    agentName: manager?.name ?? 'manager',
    action: ACTION,
    payload: { targetAgentGroupId: target.id, targetName: target.name, task, reason },
    title: 'Task Dispatch Request',
    question: `${manager?.name ?? 'The manager'} wants **${target.name}** to:\n\n${task}${
      reason ? `\n\n_Reason: ${reason}_` : ''
    }`,
  });
}

/**
 * Approval handler — runs only on approve. Writes the task into the target
 * spoke's agent-shared session (so it lands in the spoke's orchestration
 * brain) and wakes it. `ctx.session` is the MANAGER's session (the requester);
 * `ctx.notify` posts back to the manager.
 */
export async function applyDispatchTask(ctx: ApprovalHandlerContext): Promise<void> {
  const { session, payload, userId, notify } = ctx;
  const targetAgentGroupId = payload.targetAgentGroupId as string;
  const targetName = payload.targetName as string;
  const task = payload.task as string;

  const manager = await getAgentGroup(session.agent_group_id);
  const { session: targetSession } = await resolveSession(targetAgentGroupId, null, null, 'agent-shared');

  await writeSessionMessage(targetAgentGroupId, targetSession.id, {
    id: `dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'chat',
    timestamp: new Date().toISOString(),
    // platformId = manager's agent group id so the spoke resolves the sender
    // to its "marty" destination and renders it as a message from the manager.
    platformId: session.agent_group_id,
    channelType: 'agent',
    threadId: null,
    content: JSON.stringify({
      text: task,
      sender: manager?.name ?? 'manager',
      senderId: session.agent_group_id,
    }),
  });

  const fresh = await getSession(targetSession.id);
  if (fresh) {
    await wakeContainer(fresh);
  }

  log.info('dispatch_task approved', { to: targetName, approver: userId });
  notify(`✅ Task dispatched to ${targetName}.`);
}
