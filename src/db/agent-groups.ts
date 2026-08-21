import type { AgentGroup } from '../types.js';
import { getDb } from './connection.js';

export async function createAgentGroup(group: AgentGroup): Promise<void> {
  await getDb().run(
    `INSERT INTO agent_groups (id, name, folder, agent_provider, created_at)
     VALUES (@id, @name, @folder, @agent_provider, @created_at)`,
    group,
  );
}

export async function getAgentGroup(id: string): Promise<AgentGroup | undefined> {
  return getDb().get<AgentGroup>('SELECT * FROM agent_groups WHERE id = ?', id);
}

export async function getAgentGroupByFolder(folder: string): Promise<AgentGroup | undefined> {
  return getDb().get<AgentGroup>('SELECT * FROM agent_groups WHERE folder = ?', folder);
}

export async function getAgentGroupByName(name: string): Promise<AgentGroup | undefined> {
  return getDb().get<AgentGroup>('SELECT * FROM agent_groups WHERE name = ? COLLATE NOCASE', name);
}

export async function getAllAgentGroups(): Promise<AgentGroup[]> {
  return getDb().all<AgentGroup>('SELECT * FROM agent_groups ORDER BY name');
}

export async function updateAgentGroup(
  id: string,
  updates: Partial<Pick<AgentGroup, 'name' | 'agent_provider'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = value;
    }
  }
  if (fields.length === 0) return;

  await getDb().run(`UPDATE agent_groups SET ${fields.join(', ')} WHERE id = @id`, values);
}

export async function deleteAgentGroup(id: string): Promise<void> {
  await getDb().run('DELETE FROM agent_groups WHERE id = ?', id);
}

export async function pauseAgentGroup(id: string, reason: string | null = null): Promise<void> {
  await getDb().run(
    'UPDATE agent_groups SET paused_at = ?, paused_reason = ? WHERE id = ?',
    new Date().toISOString(),
    reason,
    id,
  );
}

export async function resumeAgentGroup(id: string): Promise<void> {
  await getDb().run('UPDATE agent_groups SET paused_at = NULL, paused_reason = NULL WHERE id = ?', id);
}

/**
 * Set (or clear, with null) the manager's console messaging group — where
 * spoke replies and owner chat converge. See migration 015 / routeAgentMessage.
 */
export async function setAgentGroupConsole(id: string, messagingGroupId: string | null): Promise<void> {
  await getDb().run('UPDATE agent_groups SET console_messaging_group_id = ? WHERE id = ?', messagingGroupId, id);
}
