/**
 * Agent-control MCP tools: pause_agent_group, resume_agent_group.
 *
 * Fire-and-forget — the tool writes a system action row and returns
 * immediately. The host (`src/modules/agent-control/handlers.ts`) verifies
 * the caller is authorized to manage other agents and applies the pause.
 *
 * Without the host module installed, the system message is dropped with
 * "Unknown system action" and nothing changes.
 */
import { writeMessageOut } from '../db/messages-out.js';
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

export const pauseAgentGroup: McpToolDefinition = {
  tool: {
    name: 'pause_agent_group',
    description:
      'Pause an agent group by name. While paused, scheduled/recurring wakes do not fire — interactive inbound messages still work normally. Use when an owner/admin asks you to pause a specific agent (e.g. "pause quill"). Verify the requester is an owner or admin before calling. Fire-and-forget.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Agent group name to pause (e.g. "Quill")' },
        reason: { type: 'string', description: 'Short note explaining why — surfaces to whoever resumes later' },
      },
      required: ['name'],
    },
  },
  async handler(args) {
    const name = (args.name as string)?.trim();
    if (!name || !NAME_RE.test(name)) return err('Invalid agent group name');

    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'pause_agent_group',
        name,
        reason: (args.reason as string) || null,
      }),
    });

    log(`pause_agent_group: ${requestId} → ${name}`);
    return ok(`Pause requested for "${name}". Scheduled wakes will stop on the next host sweep tick.`);
  },
};

export const resumeAgentGroup: McpToolDefinition = {
  tool: {
    name: 'resume_agent_group',
    description:
      'Resume a previously paused agent group by name. Recurring wakes start firing again from the next natural cron tick (not "right now"). Use when an owner/admin asks you to resume a specific agent. Fire-and-forget.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Agent group name to resume (e.g. "Quill")' },
      },
      required: ['name'],
    },
  },
  async handler(args) {
    const name = (args.name as string)?.trim();
    if (!name || !NAME_RE.test(name)) return err('Invalid agent group name');

    const requestId = generateId();
    writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'resume_agent_group',
        name,
      }),
    });

    log(`resume_agent_group: ${requestId} → ${name}`);
    return ok(`Resume requested for "${name}".`);
  },
};

registerTools([pauseAgentGroup, resumeAgentGroup]);
