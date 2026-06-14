import type { AgentGroup } from '../types.js';
import { getDb } from './connection.js';

export function createAgentGroup(group: AgentGroup): void {
  getDb()
    .prepare(
      `INSERT INTO agent_groups (id, name, folder, agent_provider, created_at)
       VALUES (@id, @name, @folder, @agent_provider, @created_at)`,
    )
    .run(group);
}

export function getAgentGroup(id: string): AgentGroup | undefined {
  return getDb().prepare('SELECT * FROM agent_groups WHERE id = ?').get(id) as AgentGroup | undefined;
}

export function getAgentGroupByFolder(folder: string): AgentGroup | undefined {
  return getDb().prepare('SELECT * FROM agent_groups WHERE folder = ?').get(folder) as AgentGroup | undefined;
}

export function getAgentGroupByName(name: string): AgentGroup | undefined {
  return getDb().prepare('SELECT * FROM agent_groups WHERE name = ? COLLATE NOCASE').get(name) as
    | AgentGroup
    | undefined;
}

export function getAllAgentGroups(): AgentGroup[] {
  return getDb().prepare('SELECT * FROM agent_groups ORDER BY name').all() as AgentGroup[];
}

export function updateAgentGroup(id: string, updates: Partial<Pick<AgentGroup, 'name' | 'agent_provider'>>): void {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = value;
    }
  }
  if (fields.length === 0) return;

  getDb()
    .prepare(`UPDATE agent_groups SET ${fields.join(', ')} WHERE id = @id`)
    .run(values);
}

export function deleteAgentGroup(id: string): void {
  getDb().prepare('DELETE FROM agent_groups WHERE id = ?').run(id);
}

export function pauseAgentGroup(id: string, reason: string | null = null): void {
  getDb()
    .prepare('UPDATE agent_groups SET paused_at = ?, paused_reason = ? WHERE id = ?')
    .run(new Date().toISOString(), reason, id);
}

export function resumeAgentGroup(id: string): void {
  getDb().prepare('UPDATE agent_groups SET paused_at = NULL, paused_reason = NULL WHERE id = ?').run(id);
}

/**
 * Set (or clear, with null) the manager's console messaging group — where
 * spoke replies and owner chat converge. See migration 015 / routeAgentMessage.
 */
export function setAgentGroupConsole(id: string, messagingGroupId: string | null): void {
  getDb().prepare('UPDATE agent_groups SET console_messaging_group_id = ? WHERE id = ?').run(messagingGroupId, id);
}
