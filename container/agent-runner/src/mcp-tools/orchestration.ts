/**
 * Orchestration MCP tools — MANAGER-ONLY (Marty).
 *
 *   - list_agents  : read a local snapshot of every agent group (name, paused
 *                    state, last-active, running) from the roster projection
 *                    the host writes into inbound.db at wake time.
 *   - dispatch_task: assign an ACTION (side effects) to another agent. Unlike
 *                    a plain message/ask (free), this is gated — the host
 *                    routes it through an owner/admin DM approval before the
 *                    target agent ever sees it.
 *
 * These tools self-gate: they are only registered when this container's
 * groupName matches the manager name. The host ALSO re-checks the caller is
 * the manager (manager.ts / dispatch.ts) — that host check is the real ACL;
 * this gate is just UX so spokes don't see tools they can't use.
 *
 * The manager name is read from NANOCLAW_MANAGER_AGENT_NAME (default "Marty"),
 * mirroring src/modules/agent-control/manager.ts on the host.
 */
import { getInboundDb } from '../mailbox/sqlite/connection.js';
import { writeMessageOut } from '../db/messages-out.js';
import { loadConfig } from '../config.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

interface RosterRow {
  agent_group_id: string;
  name: string;
  paused_at: string | null;
  paused_reason: string | null;
  last_active: string | null;
  running: number;
}

export const listAgents: McpToolDefinition = {
  tool: {
    name: 'list_agents',
    description:
      'List every agent group you orchestrate, with its paused state, whether its container is currently running, and when it was last active. A cheap status snapshot — use it before reporting team status, then message specific agents for deeper detail. Read-only.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  async handler() {
    const selfId = loadConfig().agentGroupId;
    let rows: RosterRow[] = [];
    try {
      rows = getInboundDb().prepare('SELECT * FROM agent_roster ORDER BY name').all() as RosterRow[];
    } catch {
      return ok('No agent roster available yet. (The host populates it on each wake — try again shortly.)');
    }

    const others = rows.filter((r) => r.agent_group_id !== selfId);
    if (others.length === 0) return ok('No other agents are registered yet.');

    const lines = others.map((r) => {
      const state = r.paused_at
        ? `paused${r.paused_reason ? ` (${r.paused_reason})` : ''}`
        : r.running
          ? 'running'
          : 'idle';
      const seen = r.last_active ? `last active ${r.last_active}` : 'no activity yet';
      return `- ${r.name}: ${state}, ${seen}`;
    });
    return ok(lines.join('\n'));
  },
};

export const dispatchTask: McpToolDefinition = {
  tool: {
    name: 'dispatch_task',
    description:
      'Assign an ACTION with side effects to another agent (e.g. "post the newsletter", "reply to the customer"). This REQUIRES owner/admin approval: the owner gets a DM card and must approve before the target agent receives the task. For read-only/status requests, just message the agent normally instead — those are free and need no approval. Fire-and-forget: you will be notified when the task is approved (and dispatched) or rejected.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Target agent name (e.g. "Quill")' },
        task: { type: 'string', description: 'The action to perform — be specific and self-contained' },
        reason: { type: 'string', description: 'Short justification shown to the approver' },
      },
      required: ['name', 'task'],
    },
  },
  async handler(args) {
    const name = (args.name as string)?.trim();
    const task = (args.task as string)?.trim();
    if (!name || !NAME_RE.test(name)) return err('Invalid agent name');
    if (!task) return err('Task is required');

    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'dispatch_task',
        requestId,
        name,
        task,
        reason: (args.reason as string) || null,
      }),
    });

    log(`dispatch_task: ${requestId} → ${name}`);
    return ok(`Dispatch to "${name}" submitted for owner approval. You'll be notified when it's approved or rejected.`);
  },
};

// ── Manager-only self-gate ──
// Register these tools only when this container is the manager agent.
const MANAGER_AGENT_NAME = process.env.NANOCLAW_MANAGER_AGENT_NAME ?? 'Marty';
const groupName = loadConfig().groupName;
if (groupName && groupName.toLowerCase() === MANAGER_AGENT_NAME.toLowerCase()) {
  registerTools([listAgents, dispatchTask]);
} else {
  log(`orchestration tools skipped — "${groupName}" is not the manager (${MANAGER_AGENT_NAME})`);
}
