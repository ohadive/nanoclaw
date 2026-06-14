/**
 * Agent-control module — host-side handlers for the manager agent's
 * orchestration MCP tools:
 *   - pause_agent_group / resume_agent_group (fire-and-forget)
 *   - dispatch_task (approval-gated action dispatch)
 *
 * Registers delivery actions; the dispatch flow also registers an approval
 * handler. Auth gating (manager-only) lives in manager.ts / handlers.ts.
 */
import { registerDeliveryAction } from '../../delivery.js';
import { registerApprovalHandler } from '../approvals/primitive.js';
import { applyDispatchTask, handleDispatchTask } from './dispatch.js';
import { handlePauseAgentGroup, handleResumeAgentGroup } from './handlers.js';

registerDeliveryAction('pause_agent_group', handlePauseAgentGroup);
registerDeliveryAction('resume_agent_group', handleResumeAgentGroup);
registerDeliveryAction('dispatch_task', handleDispatchTask);
registerApprovalHandler('dispatch_task', applyDispatchTask);
