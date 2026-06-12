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
